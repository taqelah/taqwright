import { type TaqwrightUseOptions, type LambdaTestDeviceConfig } from '../../types/index.js';
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

function buildCapabilities(use: TaqwrightUseOptions, projectName: string, appUrl: string) {
  const device = use.device as LambdaTestDeviceConfig;
  const resolved = normalizeDevice(device.name, device.osVersion);
  const ciLabel =
    process.env.GITHUB_ACTIONS === 'true' ? `CI ${process.env.GITHUB_RUN_ID}` : process.env.USER;

  return {
    deviceName: resolved.name,
    platformVersion: resolved.osVersion,
    deviceOrientation: device.orientation,
    // Taqwright defaults to Appium 3 on the cloud too. Appium 2.x runs
    // best-effort locally (every `mobile:` command shape is identical across
    // the two majors); to select 2.x on the cloud, override via
    // `use.capabilities.appiumVersion`. Cloud device pools don't carry every
    // Appium version — check the grid's matrix for your chosen device.
    appiumVersion: '3.0.0',
    platformName: use.platform,
    queueTimeout: 600,
    idleTimeout: 600,
    app: appUrl,
    devicelog: true,
    video: true,
    build: `${projectName} ${use.platform} ${ciLabel}`,
    project: projectName,
    autoGrantPermissions: true,
    autoAcceptAlerts: true,
    isRealMobile: true,
    enableImageInjection: device.enableCameraImageInjection,
    'settings[snapshotMaxDepth]': 62,
    ...(use.capabilities ?? {}),
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
