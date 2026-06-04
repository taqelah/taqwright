import {
  Platform,
  type TaqwrightUseOptions,
  type BrowserStackDeviceConfig,
} from '../../types/index.js';
import { CloudProvider, type CloudSpec } from '../cloud.js';

const APP_AUTOMATE = 'https://api-cloud.browserstack.com/app-automate';

/** Build the per-session capabilities BrowserStack's W3C endpoint expects. */
function buildCapabilities(use: TaqwrightUseOptions, projectName: string, appUrl: string) {
  const platform = use.platform;
  const device = use.device as BrowserStackDeviceConfig;

  // Deep-merge `bstack:options`: a shallow `...use.capabilities` spread would
  // replace the WHOLE `bstack:options` object (object spread is shallow),
  // wiping deviceName/osVersion/etc. Pull the user's `bstack:options` out,
  // merge it onto the defaults, and spread the remaining top-level caps so
  // e.g. `appium:*` overrides still apply.
  const userCaps = { ...(use.capabilities ?? {}) } as Record<string, unknown>;
  const userBstack = (userCaps['bstack:options'] as Record<string, unknown> | undefined) ?? {};
  delete userCaps['bstack:options'];

  const ciLabel =
    process.env.GITHUB_ACTIONS === 'true' ? `CI ${process.env.GITHUB_RUN_ID}` : process.env.USER;

  return {
    // `platformName` is a standard W3C capability and MUST live at the top
    // level of `capabilities` — BrowserStack's W3C endpoint looks for it at the
    // root and rejects the session with `[BROWSERSTACK_MISSING_CAPS] ...
    // ["platformName"]` if it's only nested inside `bstack:options`. Use the
    // proper-cased Appium form ('Android'/'iOS'), matching src/capabilities.ts.
    platformName: platform === Platform.IOS ? 'iOS' : 'Android',
    'bstack:options': {
      debug: true,
      interactiveDebugging: true,
      networkLogs: true,
      enableCameraImageInjection: device.enableCameraImageInjection,
      idleTimeout: 180,
      deviceName: device.name,
      osVersion: device.osVersion,
      deviceOrientation: device.orientation,
      buildName: `${projectName} ${platform}`,
      sessionName: `${projectName} ${platform} test`,
      buildIdentifier: ciLabel,
      // `appiumVersion` is intentionally NOT pinned: BrowserStack's supported
      // Appium matrix varies by OS (Appium 3.x is rejected for Android apps
      // today), so we let BrowserStack pick its own supported default. Pin one
      // via `use.capabilities['bstack:options'].appiumVersion` — a real
      // deep-merge, so it overrides just that key.
      ...userBstack,
    },
    // Device selection + automation engine are standard W3C/Appium caps and
    // MUST be top-level `appium:`-prefixed keys — same reason as `platformName`.
    // BrowserStack does not read device selection from `bstack:options` in this
    // request shape (it rejects with `[BROWSERSTACK_MISSING_CAPS] ...
    // ["deviceName"]`). The `bstack:options` copies remain for dashboard
    // labelling only. Mirrors the proven local builder (src/capabilities.ts).
    'appium:deviceName': device.name,
    'appium:platformVersion': device.osVersion,
    'appium:automationName': platform === Platform.IOS ? 'XCUITest' : 'UiAutomator2',
    'appium:autoGrantPermissions': true,
    'appium:app': appUrl,
    'appium:autoAcceptAlerts': true,
    'appium:fullReset': true,
    // `snapshotMaxDepth` is XCUITest-only — UiAutomator2 (Android) rejects
    // unknown settings outright and the session fails to start. iOS only.
    ...(platform === Platform.IOS ? { 'appium:settings[snapshotMaxDepth]': 62 } : {}),
    ...userCaps,
  };
}

const browserStackSpec: CloudSpec = {
  provider: 'browserstack',
  credentialEnv: ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY'],
  prebuiltScheme: 'bs://',
  appUrlEnvVar: (projectName) => `BROWSERSTACK_APP_URL_${projectName.toUpperCase()}`,
  upload: {
    endpoint: `${APP_AUTOMATE}/upload`,
    urlBody: (buildPath) => new URLSearchParams({ url: buildPath }),
    fileBody: (file, fileName) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file)]), fileName);
      return form;
    },
  },
  hub: { hostname: 'hub.browserstack.com', port: 443, path: '/wd/hub', protocol: 'https' },
  buildCapabilities: ({ use, projectName, appUrl }) => buildCapabilities(use, projectName, appUrl),
  syncRequest: (sessionId, details) => ({
    url: `${APP_AUTOMATE}/sessions/${sessionId}.json`,
    method: 'PUT',
    body: details.status
      ? JSON.stringify({ status: details.status, reason: details.reason })
      : JSON.stringify({ name: details.name }),
  }),
  strictSync: true,
  // BrowserStack reports the installed app name back via its session API.
  resolveBundleId: async (sessionId, authHeader) => {
    const res = await fetch(`${APP_AUTOMATE}/sessions/${sessionId}.json`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) {
      throw new Error(`Error fetching session details: ${res.statusText}`);
    }
    const data = (await res.json()) as {
      automation_session?: { app_details?: { app_name?: string } };
    };
    return data.automation_session?.app_details?.app_name ?? '';
  },
};

export class BrowserStackDeviceProvider extends CloudProvider {
  constructor(use: TaqwrightUseOptions, appBundleId: string | undefined, projectName?: string) {
    super(browserStackSpec, use, appBundleId, projectName);
  }
}
