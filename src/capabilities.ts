import type { Capabilities } from '@wdio/types';
import { Platform, type TaqwrightUseOptions } from './types/index.js';

export function buildCapabilities(
  use: TaqwrightUseOptions,
): Capabilities.RequestedStandaloneCapabilities {
  const isIOS = use.platform === Platform.IOS;
  const caps: Record<string, unknown> = {
    platformName: isIOS ? 'iOS' : 'Android',
    'appium:automationName': isIOS ? 'XCUITest' : 'UiAutomator2',
    'appium:newCommandTimeout': use.appium?.newCommandTimeout ?? 240,
    // The fixture handles reset between tests manually; keep Appium out of it.
    'appium:noReset': true,
  };

  const provider = (use.device as { provider?: string }).provider;
  const userCaps = use.capabilities ?? {};
  // Default-on: only an explicit `false` opts out. The downstream
  // `androidAutoBoot` check still requires a string `device.name`, so a
  // project without one is a silent no-op rather than an error — that
  // keeps RegExp-named or name-less configs working unchanged.
  const autoStartDevice = use.appium?.autoStartDevice !== false;
  // The only combo where taqwright asks Appium to cold-boot the device:
  // an Android emulator with a concrete (string) AVD id. iOS sims are
  // auto-booted by XCUITest; real devices / cloud can't be booted.
  const androidAutoBoot =
    autoStartDevice &&
    !isIOS &&
    provider === 'emulator' &&
    typeof use.device.name === 'string' &&
    use.device.name.length > 0;

  // Both `local-device` and `emulator` configs declare `udid` — pass it
  // through for either. On iOS, `appium:udid` targets a specific sim; on
  // Android, it pins the session to a particular emulator/device when
  // multiple are connected. EXCEPTION: when we hand Appium an AVD to
  // boot, the post-boot serial is unpredictable and a pool-stamped
  // (not-yet-existent) udid breaks UiAutomator2 device selection —
  // `appium:avd` is then the sole selector. A user-set `appium:udid`
  // still wins via the last-merge below.
  const declaredUdid = (use.device as { udid?: string }).udid;
  if (declaredUdid && !(androidAutoBoot && !('appium:udid' in userCaps))) {
    caps['appium:udid'] = declaredUdid;
  }
  if (use.device.name) {
    caps['appium:deviceName'] =
      typeof use.device.name === 'string' ? use.device.name : use.device.name.source;
  }
  if (use.device.osVersion) {
    caps['appium:platformVersion'] = use.device.osVersion;
  }

  if (use.buildPath) {
    caps['appium:app'] = use.buildPath;
  }
  if (use.appBundleId) {
    if (isIOS) caps['appium:bundleId'] = use.appBundleId;
    else caps['appium:appPackage'] = use.appBundleId;
  }

  // autoStartDevice: hand Appium what it needs to boot an offline device.
  if (androidAutoBoot) {
    caps['appium:avd'] = use.device.name as string;
    // Cold boots can be slow; bump only if the user hasn't tuned these.
    if (!('appium:avdLaunchTimeout' in userCaps)) {
      caps['appium:avdLaunchTimeout'] = 120_000;
    }
    if (!('appium:avdReadyTimeout' in userCaps)) {
      caps['appium:avdReadyTimeout'] = 120_000;
    }
  } else if (autoStartDevice && isIOS && provider === 'emulator') {
    // XCUITest already auto-boots a matching simulator — just give a slow
    // first boot more headroom.
    if (!('appium:simulatorStartupTimeout' in userCaps)) {
      caps['appium:simulatorStartupTimeout'] = 120_000;
    }
  }

  // iOS simulators hide the software keyboard by default (XCUITest
  // assumes a hardware keyboard) — force it on so fill()/key taps work
  // and codegen previews look right. No-op on real iOS devices; a user
  // override via use.capabilities still wins (merged last below).
  if (isIOS && !('appium:forceSimulatorSoftwareKeyboardPresence' in userCaps)) {
    caps['appium:forceSimulatorSoftwareKeyboardPresence'] = true;
  }

  return { ...caps, ...userCaps } as Capabilities.RequestedStandaloneCapabilities;
}

export function appiumRemoteOptions(use: TaqwrightUseOptions): Capabilities.RemoteConfig {
  return {
    hostname: use.appium?.host ?? 'localhost',
    port: use.appium?.port ?? 4723,
    path: use.appium?.path ?? '/',
    logLevel: use.appium?.logLevel ?? 'warn',
    capabilities: buildCapabilities(use),
  };
}
