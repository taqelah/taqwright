import {
  Platform,
  type TaqwrightUseOptions,
  type LambdaTestDeviceConfig,
} from '../../types/index.js';
import { CloudProvider, type CloudSpec } from '../cloud.js';

const SESSION_API = 'https://mobile-api.lambdatest.com/mobile-automation/api/v1';
const UPLOAD_API = 'https://manual-api.lambdatest.com/app/upload/realDevice';

/**
 * LambdaTest lists a few devices / OS versions under shorter names than the
 * longer forms a shared config might carry over from another grid. Translate
 * the known aliases so the same `device` block works on either grid.
 */
function normalizeDevice(name: string, osVersion: string): { name: string; osVersion: string } {
  const deviceAliases: Record<string, string> = { 'Google Pixel 8': 'Pixel 8' };
  const osAliases: Record<string, string> = { '14.0': '14' };
  return {
    name: deviceAliases[name] ?? name,
    osVersion: osAliases[osVersion] ?? osVersion,
  };
}

/**
 * Per-session capabilities in LambdaTest's W3C shape. The wdio/Appium-3 client
 * rejects any capability that isn't standard, `appium:`-prefixed, or inside a
 * vendor `xxx:options` object — so LambdaTest's caps live under `lt:options`
 * (with `w3c: true`), `platformName` stays top-level (standard W3C), and the
 * Appium driver caps are `appium:`-prefixed. Exported for testing.
 */
export function buildCapabilities(use: TaqwrightUseOptions, projectName: string, appUrl: string) {
  const device = use.device as LambdaTestDeviceConfig;
  const resolved = normalizeDevice(device.name, device.osVersion);
  const ciLabel =
    process.env.GITHUB_ACTIONS === 'true' ? `CI ${process.env.GITHUB_RUN_ID}` : process.env.USER;
  const isIOS = use.platform === Platform.IOS;
  const platformName = isIOS ? 'iOS' : 'Android';

  // Deep-merge a user-supplied `lt:options` (a shallow `...use.capabilities`
  // spread would replace the whole object); other user caps (appium:* /
  // standard) still pass through at the top level.
  const userCaps = { ...(use.capabilities ?? {}) } as Record<string, unknown>;
  const userLt = (userCaps['lt:options'] as Record<string, unknown> | undefined) ?? {};
  delete userCaps['lt:options'];

  return {
    platformName,
    'appium:automationName': isIOS ? 'XCUITest' : 'UiAutomator2',
    // `snapshotMaxDepth` is XCUITest-only — UiAutomator2 rejects unknown settings.
    ...(isIOS ? { 'appium:settings[snapshotMaxDepth]': 62 } : {}),
    'lt:options': {
      w3c: true,
      platformName,
      deviceName: resolved.name,
      platformVersion: resolved.osVersion,
      deviceOrientation: device.orientation,
      app: appUrl,
      isRealMobile: true,
      build: `${projectName} ${use.platform} ${ciLabel}`,
      project: projectName,
      video: true,
      devicelog: true,
      queueTimeout: 600,
      idleTimeout: 600,
      // Taqwright defaults to Appium 3 on the cloud too. Override via
      // `use.capabilities['lt:options'].appiumVersion` for 2.x — cloud device
      // pools don't carry every Appium version (check the grid's matrix).
      appiumVersion: '3.0.0',
      autoGrantPermissions: true,
      autoAcceptAlerts: true,
      enableImageInjection: device.enableCameraImageInjection,
      ...userLt,
    },
    ...userCaps,
  };
}

const lambdaTestSpec: CloudSpec = {
  provider: 'lambdatest',
  credentialEnv: ['LAMBDATEST_USERNAME', 'LAMBDATEST_ACCESS_KEY'],
  prebuiltScheme: 'lt://',
  appUrlEnvVar: (projectName) => `LAMBDATEST_APP_URL_${projectName.toUpperCase()}`,
  upload: {
    endpoint: UPLOAD_API,
    urlBody: (buildPath, projectName) =>
      new URLSearchParams({
        url: buildPath,
        visibility: 'team',
        storage: 'url',
        name: projectName,
      }),
    fileBody: (file, fileName, projectName) => {
      const form = new FormData();
      form.append('visibility', 'team');
      form.append('storage', 'file');
      form.append('appFile', new Blob([new Uint8Array(file)]), fileName);
      form.append('name', projectName);
      return form;
    },
  },
  hub: { hostname: 'mobile-hub.lambdatest.com', port: 443, path: '/wd/hub', protocol: 'https' },
  buildCapabilities: ({ use, projectName, appUrl }) => buildCapabilities(use, projectName, appUrl),
  syncRequest: (sessionId, details) => ({
    url: `${SESSION_API}/sessions/${sessionId}`,
    method: 'PATCH',
    body: details.status
      ? JSON.stringify({
          name: details.name,
          status_ind: details.status,
          custom_data: details.reason,
        })
      : JSON.stringify({ name: details.name }),
  }),
  // A status sync can race ahead of session creation; a non-OK response there
  // is expected, so don't surface it as an error.
  strictSync: false,
  requireBundleId: true,
};

export class LambdaTestDeviceProvider extends CloudProvider {
  constructor(use: TaqwrightUseOptions, appBundleId: string | undefined, projectName?: string) {
    super(lambdaTestSpec, use, appBundleId, projectName);
  }
}
