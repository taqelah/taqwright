import type { Client as WebDriverClient } from 'webdriver';
import {
  Platform,
  type TaqwrightUseOptions,
  type DeviceHandle,
  type EmulatorDeviceConfig,
  type LocalDeviceConfig,
} from '../types/index.js';
import { getApkDetails, installDriver, startAppiumServer } from './appium.js';
import { bootableAvdName } from '../setup/avd.js';

type LocalDevice = EmulatorDeviceConfig | LocalDeviceConfig;

/** WebDriver connection block for a local Appium server, honouring `use.appium` overrides. */
function appiumConnection(use: TaqwrightUseOptions) {
  return {
    port: use.appium?.port ?? 4723,
    hostname: use.appium?.host ?? 'localhost',
    path: use.appium?.path ?? '/',
    logLevel: use.appium?.logLevel ?? 'warn',
    // Only override wdio's default when the user set it (local Appium is fast).
    ...(use.appium?.connectionTimeout !== undefined
      ? { connectionRetryTimeout: use.appium.connectionTimeout }
      : {}),
  };
}

/** For an Android build, read package + launchable activity out of the APK. */
export async function resolveAndroidApp(
  use: TaqwrightUseOptions,
): Promise<{ appPackage?: string; appActivity?: string }> {
  if (use.platform === Platform.ANDROID && use.buildPath) {
    const { packageName, launchableActivity } = await getApkDetails(use.buildPath);
    return { appPackage: packageName, appActivity: launchableActivity };
  }
  return {};
}

/**
 * Capabilities shared by every local Appium session (emulator + real device).
 * Provider-specific extras (e.g. the emulator's `platformVersion` /
 * `wdaLaunchTimeout`) come in via `extraCaps`; the user's own `use.capabilities`
 * always win and are merged last.
 */
export function buildLocalCapabilities(
  use: TaqwrightUseOptions,
  device: LocalDevice,
  parts: {
    appPackage?: string;
    appActivity?: string;
    udid?: string;
    extraCaps?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const platform = use.platform;
  return {
    platformName: platform,
    'appium:automationName': platform === Platform.ANDROID ? 'uiautomator2' : 'xcuitest',
    'appium:deviceName': typeof device.name === 'string' ? device.name : device.name?.source,
    'appium:udid': parts.udid,
    'appium:app': use.buildPath,
    'appium:appPackage': parts.appPackage,
    'appium:appActivity': parts.appActivity,
    'appium:autoGrantPermissions': true,
    'appium:autoAcceptAlerts': true,
    'appium:fullReset': true,
    'appium:deviceOrientation': device.orientation,
    'appium:settings[snapshotMaxDepth]': 62,
    ...(parts.extraCaps ?? {}),
    ...(use.capabilities ?? {}),
  };
}

/**
 * Install the right Appium driver, ensure a local server is up, then open a
 * session with the given capabilities. Returns the live WebDriver client; the
 * caller wraps it (with the resolved bundle id) via {@link makeHandle}.
 */
export async function openLocalSession(
  use: TaqwrightUseOptions,
  capabilities: Record<string, unknown>,
): Promise<WebDriverClient> {
  const driverName = use.platform === Platform.ANDROID ? 'uiautomator2' : 'xcuitest';
  await installDriver(driverName);
  await startAppiumServer(use.device.provider, {}, bootableAvdName(use));
  const WebDriver = (await import('webdriver')).default;
  return WebDriver.newSession({ ...appiumConnection(use), capabilities } as never);
}

/** Wrap a live driver into the `DeviceHandle` the fixture/inspector consume. */
export function makeHandle(
  use: TaqwrightUseOptions,
  driver: WebDriverClient,
  bundleId: string | undefined,
): DeviceHandle {
  return {
    driver,
    bundleId,
    options: { expectTimeout: use.expectTimeout ?? 30_000 },
    provider: use.device.provider,
  };
}
