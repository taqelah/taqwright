import {
  Platform,
  type TaqwrightUseOptions,
  type PcloudyDeviceConfig,
  type CloudDevice,
} from '../../types/index.js';
import { CloudProvider, basicAuth, type CloudSpec } from '../cloud.js';

const USERNAME_ENV = 'PCLOUDY_USERNAME';
const API_KEY_ENV = 'PCLOUDY_API_KEY';
const CLOUD_URL_ENV = 'PCLOUDY_CLOUD_URL';

/** pCloudy's public cloud. Enterprise tenants override via `PCLOUDY_CLOUD_URL`. */
export const DEFAULT_CLOUD_URL = 'https://device.pcloudy.com';

/** pCloudy mounts Appium here — NOT the usual `/wd/hub`. */
const HUB_PATH = '/appiumcloud/wd/hub';

/**
 * Marker for a build already sitting in the user's pCloudy Drive. pCloudy's
 * real app reference is a BARE FILENAME, which is indistinguishable from a
 * relative local path, so we prefix it — same trick Digital.ai uses with
 * `cloud:<bundleId>`. Note an empty `prebuiltScheme` would be actively
 * dangerous: `resolveAppUrl` tests `buildPath.startsWith(scheme)` and every
 * string starts with `''`, which would silently disable uploading entirely.
 */
const PREBUILT_SCHEME = 'pcloudy:';

/**
 * Vendor capability namespace. pCloudy's docs are inconsistent about the
 * capitalisation (`pCloudy:options` vs `Pcloudy:options`), so it lives in ONE
 * constant — if a session is rejected with an unknown-capability error, this
 * is the single character to flip.
 */
const VENDOR = 'pCloudy:options';

/**
 * Default device booking window when the project doesn't set one.
 *
 * Deliberately small: pCloudy REJECTS the whole session when the requested
 * duration exceeds the account's remaining balance ("You have N free mins
 * left"), so a generous default turns a working setup into a hard connect
 * failure on trial and near-exhausted accounts. Raise it per project via
 * `device.durationInMinutes` when the suite needs a longer booking.
 */
const DEFAULT_DURATION_MINUTES = 10;

/**
 * The configured pCloudy cloud, parsed to its parts. Unlike Digital.ai's
 * equivalent this DEFAULTS rather than throwing — pCloudy runs a public cloud
 * most users never override.
 */
function cloudUrl(): URL {
  const raw = (process.env[CLOUD_URL_ENV] || '').trim() || DEFAULT_CLOUD_URL;
  return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
}

/** Origin of the configured cloud, used to build every REST endpoint. */
export function cloudOrigin(): string {
  return cloudUrl().origin;
}

function restAuthHeader(): string {
  return basicAuth(process.env[USERNAME_ENV], process.env[API_KEY_ENV]);
}

const TOKEN_TTL_MS = 5 * 60_000;
const tokenCache = new Map<string, { token: string; expires: number }>();

/**
 * pCloudy's two-step auth: HTTP Basic `username:apiKey` against `/api/access`
 * mints a short-lived token that every OTHER REST call carries IN ITS BODY —
 * never as a header. That shape is why this lives here rather than in the
 * shared engine: to `cloud.ts`, pCloudy is an ordinary `authScheme: 'basic'`
 * grid, and the token never enters the engine's vocabulary.
 *
 * Memoized per origin + credentials so one inspector flow (list devices, then
 * upload a build) costs a single round-trip. `authHeader` is an explicit
 * parameter because the inspector builds it from typed-in credentials rather
 * than from `process.env`.
 */
export async function getAuthToken(authHeader: string = restAuthHeader()): Promise<string> {
  const origin = cloudOrigin();
  const cacheKey = `${origin}|${authHeader}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    return hit.token;
  }
  const res = await fetch(`${origin}/api/access`, { headers: { Authorization: authHeader } });
  if (!res.ok) {
    throw new Error(
      `pCloudy auth failed (${res.status}) at ${origin}/api/access — check ` +
        `${USERNAME_ENV} / ${API_KEY_ENV}` +
        (process.env[CLOUD_URL_ENV] ? ` and ${CLOUD_URL_ENV}.` : '.'),
    );
  }
  const data = (await res.json()) as {
    result?: { token?: string; error?: string };
    token?: string;
  };
  const token = data.result?.token ?? data.token;
  if (!token) {
    // pCloudy answers bad credentials with a 200 carrying `result.error`
    // ("wrong user name") rather than a 401, so surface that verbatim instead
    // of the misleading generic "no token".
    const reason = data.result?.error;
    throw new Error(
      reason
        ? `pCloudy auth failed at ${origin}/api/access: ${reason} — check ${USERNAME_ENV} / ${API_KEY_ENV}.`
        : `pCloudy ${origin}/api/access returned no token: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  tokenCache.set(cacheKey, { token, expires: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Drop every memoized token. Exported for tests. */
export function __resetPcloudyTokenCache(): void {
  tokenCache.clear();
}

/**
 * Split a pCloudy `full_name` (`<Brand>_<Model>_<OS>_<Version>`, e.g.
 * `Samsung_GalaxyTabA_Android_7.1.1`) into the fields the device picker shows.
 * The LAST segment is the OS version and the second-to-last the OS token;
 * everything before them joins with spaces as the device name. Returns `null`
 * for anything too short to carry all three. Pure; exported for testing.
 */
export function parseDeviceFullName(
  fullName: string,
): { deviceName: string; osVersion: string; platform: 'android' | 'ios' } | null {
  const parts = String(fullName ?? '')
    .split('_')
    .filter(Boolean);
  // Locate the OS token by VALUE rather than by position. pCloudy appends a
  // per-device id to some entries (`Samsung_GalaxyFold_Android_10_d69de`), so
  // counting back from the end mistakes that id for the version and leaves
  // "Android" stranded in the device name. Anything after the version is the
  // device id — irrelevant for display, and preserved anyway because the
  // picker carries the untouched `full_name` through to the session.
  const idx = parts.findIndex((p) => /^(android|ios)$/i.test(p));
  if (idx < 1 || idx + 1 >= parts.length) {
    return null;
  }
  return {
    deviceName: parts.slice(0, idx).join(' '),
    osVersion: parts[idx + 1],
    platform: parts[idx].toLowerCase() === 'ios' ? 'ios' : 'android',
  };
}

/**
 * Best-effort inverse of `parseDeviceFullName`, used only by the runner's
 * config-driven path when `device.deviceFullName` is not set.
 *
 * IMPORTANT: every real pCloudy `full_name` ends with an opaque per-device
 * alias (`Motorola_MotoG5_Android_7.0.0_ea8b0`) that cannot be derived from a
 * name and version, so this reconstruction will NOT match a catalog entry on
 * such a cloud. Treat `device.deviceFullName` as required in config, and copy
 * the exact string from the inspector's device picker. The inspector itself
 * never calls this — it carries the catalog's `full_name` end to end.
 */
export function buildDeviceFullName(
  deviceName: string,
  osVersion: string,
  platform: Platform,
): string {
  const model = String(deviceName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_');
  return `${model}_${platform === Platform.IOS ? 'ios' : 'Android'}_${osVersion}`;
}

/**
 * Parse pCloudy's `POST /api/devices` response into CloudDevices. The list
 * lives under `result.models`. Verified against the live service; each entry
 * carries explicit `platform` ('android' | 'ios'), `version` ('7.0.0'),
 * `manufacturer`, `display_name`, `model`, `full_name`, `alias_name`, `id` and
 * `available`.
 *
 * We deliberately read `platform` and `version` from their OWN fields rather
 * than picking them out of `full_name`: the explicit values are unambiguous,
 * while name parsing mis-filed every Apple device onto the Android tab.
 * `parseDeviceFullName` remains only as a fallback for entries missing them.
 *
 * Each device keeps its `full_name` verbatim as `fullName` so the picker can
 * hand the exact string back at connect time — which matters because the
 * trailing `alias_name` segment is opaque and cannot be reconstructed.
 * Shape-tolerant; pure; exported for testing.
 */
export function parsePcloudyDevices(raw: unknown): CloudDevice[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const result = (r.result ?? {}) as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(result.models)
      ? (result.models as unknown[])
      : Array.isArray(r.models)
        ? (r.models as unknown[])
        : Array.isArray(r.devices)
          ? (r.devices as unknown[])
          : Array.isArray(r.data)
            ? (r.data as unknown[])
            : [];
  const devices: CloudDevice[] = [];
  for (const item of arr) {
    const d = item as Record<string, unknown>;
    const fullName = d.full_name ?? d.fullName;
    const parsed = fullName ? parseDeviceFullName(String(fullName)) : null;

    // Explicit field first, name-derived only as a fallback.
    const platformRaw = String(d.platform ?? d.os ?? '').toLowerCase();
    const platform: 'android' | 'ios' =
      platformRaw === 'ios' || platformRaw === 'android'
        ? (platformRaw as 'android' | 'ios')
        : (parsed?.platform ?? 'android');

    // `manufacturer` + `display_name` reads far better than `model`
    // ("Motorola Moto G5" vs "MotoG5"); fall back through the parsed name.
    const pretty = [d.manufacturer, d.display_name].filter(Boolean).join(' ').trim();
    const deviceName = pretty || parsed?.deviceName || (d.model != null ? String(d.model) : '');
    if (!deviceName) {
      continue;
    }

    const version = d.version != null ? String(d.version) : '';
    // pCloudy reports per-device availability even when we filter on
    // `available_now`; honouring it greys out devices that would otherwise
    // fail the session with "Requested device is not available currently".
    const available = d.available !== false;
    devices.push({
      provider: 'pcloudy',
      platform,
      deviceName,
      osVersion: version || (parsed?.osVersion ?? ''),
      realDevice: true,
      available,
      ...(available ? {} : { status: 'In Use' }),
      ...(fullName ? { fullName: String(fullName) } : {}),
    });
  }
  return devices;
}

/**
 * Per-session capabilities in pCloudy's Appium-2 / W3C shape: standard
 * `platformName` plus `appium:`-prefixed driver caps at the top level, and the
 * pCloudy vendor caps under `pCloudy:options`.
 *
 * Session auth is the username/apiKey PAIR AS CAPABILITIES — the REST token
 * from `/api/access` never reaches the hub. Exported for testing.
 */
export function buildCapabilities(use: TaqwrightUseOptions, projectName: string, appRef: string) {
  const isIOS = use.platform === Platform.IOS;
  const platformName = isIOS ? 'iOS' : 'Android';
  const device = use.device as PcloudyDeviceConfig;

  // An explicit `deviceFullName` wins; otherwise rebuild pCloudy's composite
  // selector from the name + version the picker or config supplied.
  const deviceFullName =
    device.deviceFullName ?? buildDeviceFullName(device.name, device.osVersion, use.platform);

  // `appRef` arrives as `pcloudy:<fileName>`; pCloudy wants the bare filename.
  const applicationName = appRef.startsWith(PREBUILT_SCHEME)
    ? appRef.slice(PREBUILT_SCHEME.length)
    : appRef;

  // Deep-merge the two vendor option objects: a shallow `...use.capabilities`
  // spread would replace the whole block. Pull each out, merge onto our
  // defaults, and route the rest below.
  const userCaps = { ...(use.capabilities ?? {}) } as Record<string, unknown>;
  const userVendor = (userCaps[VENDOR] as Record<string, unknown> | undefined) ?? {};
  const userAppium = (userCaps['appium:options'] as Record<string, unknown> | undefined) ?? {};
  delete userCaps[VENDOR];
  delete userCaps['appium:options'];

  // Route the remaining user caps. A BARE (non-namespaced) key like
  // `autoAcceptAlerts` is not W3C-valid and the `webdriver` client rejects it
  // before the request is sent, so relocate bare Appium caps into
  // `appium:options`. A bare `pCloudy_*` key is a VENDOR cap, though, so it
  // goes in the vendor block instead — the same routing LambdaTest does for
  // its bare keys, and the only way to set one from the inspector's Extras
  // editor (which takes flat key/value pairs, e.g. a shorter
  // `pCloudy_DurationInMinutes`). Standard `platformName` and any
  // `:`-namespaced cap stay at the top level.
  const appiumOptions: Record<string, unknown> = { ...userAppium };
  const topLevelUser: Record<string, unknown> = {};
  const bareVendor: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(userCaps)) {
    if (k === 'platformName' || k.includes(':')) {
      topLevelUser[k] = v;
    } else if (k.startsWith('pCloudy_')) {
      bareVendor[k] = v;
    } else {
      appiumOptions[k] = v;
    }
  }

  return {
    platformName,
    'appium:automationName': isIOS ? 'XCUITest' : 'UiAutomator2',
    // XCUITest-only — UiAutomator2 rejects unknown settings.
    ...(isIOS ? { 'appium:settings[snapshotMaxDepth]': 62 } : {}),
    [VENDOR]: {
      pCloudy_Username: process.env[USERNAME_ENV],
      pCloudy_ApiKey: process.env[API_KEY_ENV],
      pCloudy_DeviceFullName: deviceFullName,
      pCloudy_DurationInMinutes: device.durationInMinutes ?? DEFAULT_DURATION_MINUTES,
      ...(applicationName ? { pCloudy_ApplicationName: applicationName } : {}),
      // `appiumVersion` intentionally NOT pinned — let the cloud pick its
      // supported default. Override via
      // `use.capabilities['pCloudy:options'].appiumVersion`.
      ...userVendor,
      ...bareVendor,
    },
    ...(Object.keys(appiumOptions).length ? { 'appium:options': appiumOptions } : {}),
    ...topLevelUser,
  };
}

export const pcloudySpec: CloudSpec = {
  provider: 'pcloudy',
  // REST auth IS HTTP Basic — but only against `/api/access`, which mints the
  // token every other call carries in its body (see `getAuthToken`). Session
  // auth is separate again, riding in capabilities.
  authScheme: 'basic',
  credentialEnv: [USERNAME_ENV, API_KEY_ENV],
  // Configurable base URL like Digital.ai, but WITH a default — which is what
  // makes the inspector's cloud-server field optional-and-prefilled instead of
  // required.
  tenantUrlEnvVar: CLOUD_URL_ENV,
  tenantUrlDefault: DEFAULT_CLOUD_URL,
  prebuiltScheme: PREBUILT_SCHEME,
  appUrlEnvVar: (projectName) => `PCLOUDY_APP_REF_${projectName.toUpperCase()}`,
  upload: {
    endpoint: () => `${cloudOrigin()}/api/upload_file`,
    urlBody: () => {
      throw new Error(
        'pCloudy has no upload-by-URL API — set `buildPath` to a local .apk/.ipa, ' +
          'or to `pcloudy:<fileName>` for a build already in your pCloudy Drive.',
      );
    },
    // Async: the multipart body must carry the `/api/access` token.
    fileBody: async (file, fileName) => {
      const token = await getAuthToken();
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file)]), fileName);
      form.append('source_type', 'raw');
      form.append('token', token);
      form.append('filter', fileName.toLowerCase().endsWith('.ipa') ? 'ipa' : 'apk');
      return form;
    },
  },
  // The upload stores the build under a name pCloudy CHOOSES — it appends its
  // own timestamp, so `app.apk` comes back as `app-1786171090.apk`. The
  // session then references that exact name via `pCloudy_ApplicationName`.
  //
  // There is deliberately NO fallback to the local file's basename: that name
  // is not what pCloudy stored, so guessing it would hand back a plausible but
  // nonexistent reference and fail later at session open. If the response
  // carries no name, something went wrong and we say so here.
  uploadResponseToAppRef: (data) => {
    const d = (data ?? {}) as { result?: { file?: string; code?: number; error?: string } };
    const file = d.result?.file;
    if (!file) {
      const reason = d.result?.error ? `: ${d.result.error}` : '';
      throw new Error(
        `pCloudy upload did not return a stored file name${reason} — ` +
          `raw response: ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    return `${PREBUILT_SCHEME}${file}`;
  },
  hub: () => {
    const u = cloudUrl();
    return {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : 443,
      path: HUB_PATH,
      protocol: 'https',
    };
  },
  buildCapabilities: ({ use, projectName, appUrl }) => buildCapabilities(use, projectName, appUrl),
  // pCloudy exposes no pass/fail reporting endpoint. Declared explicitly so a
  // spec that merely forgot one still fails the completeness test.
  noStatusReporting: true,
  strictSync: false,
  // pCloudy proxies a real Appium 2 server, so the standard `appium:`-prefixed
  // permission caps apply — same dialect as BrowserStack and Digital.ai.
  permissionCapKeys: ['appium:autoGrantPermissions', 'appium:autoAcceptAlerts'],
  catalog: {
    listUrl: () => `${cloudOrigin()}/api/devices`,
    // POST + JSON + a body token, and ONE CALL PER PLATFORM — which is why
    // this needs `fetchRaw` rather than a tweak to the shared GET.
    fetchRaw: async ({ listUrl, authHeader }) => {
      const token = await getAuthToken(authHeader);
      const models: unknown[] = [];
      for (const platform of ['android', 'ios'] as const) {
        const res = await fetch(listUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `available_now` is a STRING in pCloudy's API, not a boolean — a
          // boolean is ignored, so the catalog comes back including devices
          // that are already booked and the session then fails with
          // "Requested device is not available currently".
          //
          // `duration` here is only an availability FILTER ("free for at least
          // N minutes"), not a booking, so keep it at the minimum. Asking for
          // the session length would hide every device from an account whose
          // remaining balance is shorter than a test run — and browsing the
          // catalog should not depend on being able to afford a full session.
          body: JSON.stringify({
            token,
            duration: 1,
            platform,
            available_now: 'true',
          }),
        });
        // Surface pCloudy's own response body. A bare status code hides the
        // actual cause (an expired token, an exhausted account balance, a
        // rejected field) behind a generic "check credentials", which sends
        // people looking in the wrong place.
        if (!res.ok) {
          const body = (await res.text().catch(() => '')).trim();
          throw new Error(
            `pCloudy device list returned ${res.status} for ${platform} at ${listUrl}` +
              (body
                ? ` — ${body.slice(0, 400)}`
                : // pCloudy 500s with an EMPTY body when the account itself is
                  // the problem. Credentials are not the likely cause: a bad
                  // token comes back as HTTP 200 with `result.error`.
                  ' with an empty body. Credentials are probably fine (pCloudy answers a bad' +
                  ' token with HTTP 200). Check your pCloudy dashboard for remaining device' +
                  ' minutes and for sessions still holding a device — a failed connect can' +
                  ' leave one booked for its full duration.'),
          );
        }
        const data = (await res.json()) as {
          result?: { models?: unknown[]; error?: string; code?: number };
        };
        // pCloudy also reports failures as HTTP 200 with `result.error`.
        if (data.result?.error) {
          throw new Error(`pCloudy device list failed for ${platform}: ${data.result.error}`);
        }
        if (Array.isArray(data.result?.models)) {
          models.push(...data.result.models);
        }
      }
      return { result: { models } };
    },
    parseDevices: parsePcloudyDevices,
  },
  display: {
    label: 'pCloudy',
    subtitle: 'Real-device cloud',
    icon: '☁',
    logoUrl: '/static/cloud-vendors/pcloudy.png',
  },
};

export class PcloudyDeviceProvider extends CloudProvider {
  constructor(use: TaqwrightUseOptions, appBundleId: string | undefined, projectName?: string) {
    super(pcloudySpec, use, appBundleId, projectName);
  }
}
