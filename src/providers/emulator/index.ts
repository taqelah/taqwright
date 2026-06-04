import {
  Platform,
  type TaqwrightUseOptions,
  type EmulatorDeviceConfig,
  type DeviceHandle,
  type DeviceProvider,
} from '../../types/index.js';
import { isEmulatorInstalled } from '../appium.js';
import {
  buildLocalCapabilities,
  makeHandle,
  openLocalSession,
  resolveAndroidApp,
} from '../local-session.js';
import { validateBuildPath } from '../../utils.js';
import { logger } from '../../logger.js';

export class EmulatorProvider implements DeviceProvider {
  sessionId?: string;

  constructor(
    private readonly use: TaqwrightUseOptions,
    appBundleId?: string,
  ) {
    if (use.device.provider !== 'emulator') {
      throw new Error(`emulator provider received device.provider='${use.device.provider}'.`);
    }
    if (appBundleId) {
      logger.log(
        `Bundle id (${appBundleId}) ignored for emulator provider — resolved from the build at runtime.`,
      );
    }
  }

  async globalSetup(): Promise<void> {
    const android = this.use.platform === Platform.ANDROID;
    validateBuildPath(this.use.buildPath, android ? '.apk' : '.app');
    if (android) {
      if (!process.env.ANDROID_HOME) {
        throw new Error('ANDROID_HOME is not set. Required to locate the Android SDK.');
      }
      if (!process.env.JAVA_HOME) {
        throw new Error('JAVA_HOME is not set.');
      }
      await isEmulatorInstalled(this.use.platform);
    }
  }

  async getDevice(): Promise<DeviceHandle> {
    const device = this.use.device as EmulatorDeviceConfig;
    const { appPackage, appActivity } = await resolveAndroidApp(this.use);
    const capabilities = buildLocalCapabilities(this.use, device, {
      appPackage,
      appActivity,
      udid: device.udid,
      extraCaps: {
        'appium:platformVersion': device.osVersion,
        'appium:wdaLaunchTimeout': 300_000,
      },
    });
    const driver = await openLocalSession(this.use, capabilities);
    this.sessionId = driver.sessionId;
    return makeHandle(this.use, driver, undefined);
  }
}
