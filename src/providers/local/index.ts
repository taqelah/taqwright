import {
  Platform,
  type TaqwrightUseOptions,
  type LocalDeviceConfig,
  type DeviceHandle,
  type DeviceProvider,
} from '../../types/index.js';
import { getActiveAndroidDevices, getAppBundleId, getConnectedIOSDeviceUDID } from '../appium.js';
import {
  buildLocalCapabilities,
  makeHandle,
  openLocalSession,
  resolveAndroidApp,
} from '../local-session.js';
import { validateBuildPath } from '../../utils.js';
import { logger } from '../../logger.js';

export class LocalDeviceProvider implements DeviceProvider {
  sessionId?: string;

  constructor(
    private readonly use: TaqwrightUseOptions,
    appBundleId?: string,
  ) {
    if (use.device.provider !== 'local-device') {
      throw new Error(`local-device provider received device.provider='${use.device.provider}'.`);
    }
    if (appBundleId) {
      logger.log(
        `Bundle id (${appBundleId}) ignored for local-device provider — resolved from the build at runtime.`,
      );
    }
  }

  async globalSetup(): Promise<void> {
    const android = this.use.platform === Platform.ANDROID;
    validateBuildPath(this.use.buildPath, android ? '.apk' : '.ipa');
    if (android && !process.env.ANDROID_HOME) {
      throw new Error(
        'ANDROID_HOME is not set. Required to locate adb / build-tools. See https://developer.android.com/tools',
      );
    }
  }

  async getDevice(): Promise<DeviceHandle> {
    const device = this.use.device as LocalDeviceConfig;
    const { appPackage, appActivity } = await resolveAndroidApp(this.use);
    const udid = await this.resolveUdid(device);
    const capabilities = buildLocalCapabilities(this.use, device, {
      appPackage,
      appActivity,
      udid,
    });

    const driver = await openLocalSession(this.use, capabilities);
    this.sessionId = driver.sessionId;

    const bundleId =
      this.use.platform === Platform.IOS && this.use.buildPath
        ? await getAppBundleId(this.use.buildPath)
        : this.use.appBundleId;
    return makeHandle(this.use, driver, bundleId);
  }

  /** Use the configured udid, else discover the connected device (warning on ambiguity). */
  private async resolveUdid(device: LocalDeviceConfig): Promise<string | undefined> {
    if (device.udid) {
      return device.udid;
    }
    if (this.use.platform === Platform.IOS) {
      return getConnectedIOSDeviceUDID();
    }
    if ((await getActiveAndroidDevices()) > 1) {
      logger.warn(
        'Multiple active Android devices detected — picking one. Set device.udid to disambiguate.',
      );
    }
    return undefined;
  }
}
