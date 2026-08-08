import {
  Platform,
  type TaqwrightUseOptions,
  type DigitalAiDeviceConfig,
  type CloudDevice,
} from '../../types/index.js';
import { CloudProvider, type CloudSpec } from '../cloud.js';

const ACCESS_KEY_ENV = 'DIGITALAI_ACCESS_KEY';
const CLOUD_SERVER_ENV = 'DIGITALAI_CLOUD_SERVER';

/** Device statuses Digital.ai reports as connectable (online + free). */
const AVAILABLE_STATUSES = ['available', 'online'];

/**
 * Parse Digital.ai's `GET /api/v1/devices` response into CloudDevices. The list
 * lives under `data` (`{ status, data: [...], code }`); per-device fields are
 * `deviceName`/`modelName`/`model`, `deviceOs`/`os`, `osVersion`, `isEmulator`,
 * and `displayStatus`/`currentStatus`.
 *
 * Unlike on-demand grids (BrowserStack/LambdaTest), Digital.ai devices are real
 * hardware with live status. ALL devices are returned (so the picker shows the
 * full fleet), but each carries `available` — only `Available`/online devices
 * are connectable; In-Use/Offline are shown greyed-out and unselectable. When
 * status is absent it's treated as available, to stay tolerant of shape changes.
 * Shape-tolerant; pure; exported for testing.
 */
export function parseDigitalAiDevices(raw: unknown): CloudDevice[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(r.data)
      ? (r.data as unknown[])
      : Array.isArray(r.devices)
        ? (r.devices as unknown[])
        : [];
  const devices: CloudDevice[] = [];
  for (const item of arr) {
    const d = item as Record<string, unknown>;
    const name = d.deviceName ?? d.modelName ?? d.model ?? d.name;
    if (!name) continue;
    const os = String(d.deviceOs ?? d.os ?? d.osType ?? d.platform ?? '');
    const version = d.osVersion ?? d.version ?? d.platformVersion;
    const rawStatus = String(d.displayStatus ?? d.currentStatus ?? '');
    const lower = rawStatus.toLowerCase();
    const available = lower === '' || AVAILABLE_STATUSES.includes(lower);
    devices.push({
      provider: 'digitalai',
      platform: os.toLowerCase().includes('ios') ? 'ios' : 'android',
      deviceName: String(name),
      osVersion: version != null ? String(version) : '',
      realDevice: d.isEmulator !== true,
      available,
      ...(rawStatus ? { status: rawStatus } : {}),
    });
  }
  return devices;
}

/**
 * The configured Digital.ai Testing cloud server (the customer's tenant URL),
 * parsed to a hostname + port. Unlike BrowserStack/LambdaTest there is no fixed
 * grid host — it comes from `DIGITALAI_CLOUD_SERVER` (e.g.
 * `https://mycloud.experitest.com`).
 */
function parseCloudServer(): { hostname: string; port: number; origin: string } {
  const raw = process.env[CLOUD_SERVER_ENV];
  if (!raw) {
    throw new Error(
      `${CLOUD_SERVER_ENV} is required for the digitalai provider — set it to your Digital.ai Testing cloud URL.`,
    );
  }
  const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  return {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : 443,
    origin: url.origin,
  };
}

/**
 * Per-session capabilities in Digital.ai's Appium-2 / W3C shape: standard
 * `platformName` at the top level, device + app under `appium:options`, and the
 * Digital.ai vendor caps (access key, device query, test name) under
 * `digitalai:options`. Exported for testing.
 */
export function buildCapabilities(use: TaqwrightUseOptions, projectName: string, appUrl: string) {
  const isIOS = use.platform === Platform.IOS;
  const platformName = isIOS ? 'iOS' : 'Android';
  const device = use.device as DigitalAiDeviceConfig;
  const bundleId = use.appBundleId;

  // Device selection: an explicit `deviceQuery` wins; otherwise build one from
  // the platform + name + OS version (the Digital.ai query attribute syntax).
  const deviceQuery =
    device.deviceQuery ??
    `@os='${use.platform}' and @name='${device.name}' and @version='${device.osVersion}'`;

  // Deep-merge the two vendor option objects: a shallow `...use.capabilities`
  // spread would replace the whole `appium:options` / `digitalai:options`
  // object. Pull each out, merge onto our defaults, and route the rest below.
  const userCaps = { ...(use.capabilities ?? {}) } as Record<string, unknown>;
  const userAppium = (userCaps['appium:options'] as Record<string, unknown> | undefined) ?? {};
  const userDigitalai =
    (userCaps['digitalai:options'] as Record<string, unknown> | undefined) ?? {};
  delete userCaps['appium:options'];
  delete userCaps['digitalai:options'];

  // App caps are optional: only set them when there's actually an app to drive.
  // No app (no `appUrl`/`bundleId`) → the session just attaches to the device.
  const appiumOptions: Record<string, unknown> = {};
  if (bundleId) {
    // iOS references the app by bundle id; Android by package name.
    appiumOptions[isIOS ? 'bundleId' : 'appPackage'] = bundleId;
  }
  if (appUrl) {
    // `appUrl` is the `cloud:<bundleId>` reference (already-on-cloud build).
    appiumOptions.app = appUrl;
  }
  Object.assign(appiumOptions, userAppium);

  // Route the remaining user caps. A BARE (non-namespaced) key like
  // `autoAcceptAlerts` is not W3C-valid and the `webdriver` client rejects it
  // before the request is sent, so relocate bare Appium caps into
  // `appium:options` (the form Digital.ai's docs use). Standard `platformName`
  // and any `:`-namespaced cap stay at the top level.
  const topLevelUser: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(userCaps)) {
    if (k === 'platformName' || k.includes(':')) topLevelUser[k] = v;
    else appiumOptions[k] = v;
  }

  return {
    platformName,
    'appium:options': appiumOptions,
    'digitalai:options': {
      testName: `${projectName} ${use.platform} test`,
      // Auth rides in this capability (not on the WebDriver connection).
      accessKey: process.env[ACCESS_KEY_ENV],
      deviceQuery,
      // `appiumVersion` intentionally NOT pinned — let the cloud pick its
      // supported default. Override via
      // `use.capabilities['digitalai:options'].appiumVersion`.
      ...userDigitalai,
    },
    ...topLevelUser,
  };
}

/**
 * Map taqwright's resolved test details to the Digital.ai `setReportStatus`
 * driver command (arg order: `status` then `message`). The fixture passes
 * `status: 'passed' | 'failed'`; `'skipped'` is mapped defensively. Exported for testing.
 */
export function reportStatusCommand(details: { status?: string; reason?: string; name?: string }): {
  script: string;
  args: unknown[];
} {
  const status =
    details.status === 'passed' ? 'Passed' : details.status === 'skipped' ? 'Skipped' : 'Failed';
  const message = details.reason ?? details.name ?? `taqwright test ${status.toLowerCase()}`;
  return { script: 'seetest:client.setReportStatus', args: [status, message] };
}

export const digitalAiSpec: CloudSpec = {
  provider: 'digitalai',
  authScheme: 'bearer',
  credentialEnv: [ACCESS_KEY_ENV],
  // The customer's tenant cloud URL — unlike BrowserStack/LambdaTest's fixed
  // hub, this is per-tenant and comes from the ambient environment (runner) or
  // the inspector's connect payload (surfaced to the UI via `tenantUrlEnvVar`).
  tenantUrlEnvVar: CLOUD_SERVER_ENV,
  // A build already registered in the cloud is referenced as `cloud:<bundleId>`.
  prebuiltScheme: 'cloud:',
  appUrlEnvVar: (projectName) => `DIGITALAI_APP_REF_${projectName.toUpperCase()}`,
  upload: {
    // File uploads go to `/new`; remote-URL uploads to `/new-from-url`.
    endpoint: (buildPath) =>
      `${parseCloudServer().origin}/api/v1/applications/${
        buildPath.startsWith('http') ? 'new-from-url' : 'new'
      }`,
    urlBody: (buildPath) => new URLSearchParams({ url: buildPath }),
    fileBody: (file, fileName) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file)]), fileName);
      return form;
    },
  },
  // The hub is the customer's tenant cloud server, resolved from env at runtime.
  hub: () => {
    const { hostname, port } = parseCloudServer();
    return { hostname, port, path: '/wd/hub', protocol: 'https' };
  },
  // The upload only registers the build; the session references it by bundle id.
  // (Only called when a real upload happened — a `cloud:` buildPath is passed
  // through by `prebuiltScheme` without hitting this.)
  uploadResponseToAppRef: (_data, { appBundleId }) => {
    if (!appBundleId) {
      throw new Error(
        'appBundleId is required to reference an uploaded Digital.ai build — set it, or pass buildPath as `cloud:<bundleId>`.',
      );
    }
    return `cloud:${appBundleId}`;
  },
  // Sessions may open with no app (attach to the device), so the bundle id is
  // not required at construction.
  appOptional: true,
  buildCapabilities: ({ use, projectName, appUrl }) => buildCapabilities(use, projectName, appUrl),
  // No per-session status REST endpoint — Digital.ai reports pass/fail via the
  // in-test `seetest:client.setReportStatus` driver command on the live session.
  reportStatusCommand,
  strictSync: false,
  // Bare (non-namespaced) permission caps get relocated into `appium:options`
  // by buildCapabilities above — same treatment LambdaTest gives its bare keys.
  permissionCapKeys: ['appium:autoGrantPermissions', 'appium:autoAcceptAlerts'],
  catalog: {
    listUrl: () => `${parseCloudServer().origin}/api/v1/devices`,
    parseDevices: parseDigitalAiDevices,
  },
  display: {
    label: 'Digital.ai Testing',
    subtitle: 'Real-device cloud (Experitest/SeeTest)',
    icon: '☁',
    logoUrl: '/static/cloud-vendors/digitalai.png',
  },
};

export class DigitalAiDeviceProvider extends CloudProvider {
  constructor(use: TaqwrightUseOptions, appBundleId: string | undefined, projectName?: string) {
    super(digitalAiSpec, use, appBundleId, projectName);
  }
}
