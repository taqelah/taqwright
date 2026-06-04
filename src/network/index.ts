/**
 * Public entrypoint for the network capture feature. Wraps the lower-level
 * modules (`proxy.ts`, `ca.ts`, `android.ts`, `ios-sim.ts`, `host-proxy.ts`)
 * into the two-phase API the fixture wants:
 *
 *   const handle = await prepareNetworkProxy({ platform, parallelIndex });
 *   // ... open WebDriver session ...
 *   await configureDeviceForCapture(handle, { udid, platform });
 *   // ... test runs ...
 *   await teardownDeviceCapture(handle);
 *   // ... session closed ...
 *   await teardownNetworkProxy(handle);
 *
 * Phase 1 (prepare) does no device I/O — it can run before Appium boots
 * the AVD/sim. Phase 2 (configure) happens after the session opens, when
 * we know the real udid.
 *
 * Every step is failure-tolerant: if any operation fails, the handle still
 * exists with a populated `attemptLog`, and the fixture writes a stub HAR
 * explaining why capture didn't happen. The test never fails because of
 * the network artifact.
 */

import type { ProxyHandle } from './proxy.js';
import { startProxy } from './proxy.js';
import { ensureCa, type CaBundle } from './ca.js';
import {
  detectAndroidDeviceType,
  installSystemCa,
  setHttpProxy,
  clearHttpProxy,
} from './android.js';
import { isSimulatorUdid, waitForBoot, installRootCert } from './ios-sim.js';
import { snapshotProxy, applyProxy, restoreProxy, type HostProxyState } from './host-proxy.js';
import { Platform } from '../types/index.js';

const BASE_PROXY_PORT = 8090;
/** The Android emulator's NAT alias for the host loopback. */
const EMULATOR_HOST_IP = '10.0.2.2';

export interface NetworkProxyHandle {
  /** The proxy is listening on this port on host loopback. */
  port: number;
  /** Snapshot the captured HAR. Safe to call multiple times. */
  flush(): Promise<object>;
  attemptLog: string[];
  /** Internal: bundles the proxy + CA + per-test device state. */
  _proxy: ProxyHandle;
  _ca: CaBundle;
  _platform: Platform;
  _hostProxyState?: HostProxyState;
  _configuredUdid?: string;
  _configuredAndroid?: boolean;
}

export async function prepareNetworkProxy(opts: {
  platform: Platform;
  parallelIndex: number;
}): Promise<NetworkProxyHandle> {
  const port = BASE_PROXY_PORT + opts.parallelIndex;
  const ca = await ensureCa();
  const proxy = await startProxy({ port, ca });

  const handle: NetworkProxyHandle = {
    port,
    attemptLog: proxy.attemptLog,
    flush: () => proxy.flush() as Promise<object>,
    _proxy: proxy,
    _ca: ca,
    _platform: opts.platform,
  };

  // iOS Simulator: macOS host proxy must be set early — URLSession caches
  // proxy config and may not re-read it once the app starts making calls.
  // Doing this before the WebDriver session opens (so before Appium boots
  // the sim and the app launches) is the safest moment.
  if (opts.platform === Platform.IOS) {
    const state = await snapshotProxy();
    if (state) {
      handle._hostProxyState = state;
      await applyProxy(state, '127.0.0.1', port);
    } else {
      proxy.attemptLog.push('network: networksetup unavailable — host proxy not set');
    }
  }

  return handle;
}

/**
 * Phase 2: with the device udid known, install the CA and (Android) the
 * device-level HTTP proxy. Real-device / Play-AVD / failure paths log a
 * single line to the handle's `attemptLog` and return without throwing.
 */
export async function configureDeviceForCapture(
  handle: NetworkProxyHandle,
  opts: { udid: string | undefined; platform: Platform },
): Promise<void> {
  if (!opts.udid) {
    handle.attemptLog.push('network: no device udid available — skipping device config');
    return;
  }

  if (opts.platform === Platform.ANDROID) {
    const type = await detectAndroidDeviceType(opts.udid);
    if (type === 'real-device') {
      handle.attemptLog.push('network: skipped (real device — not supported in v1)');
      return;
    }
    if (type === 'play-emulator') {
      handle.attemptLog.push('network: skipped (Play AVD, release-keys)');
      return;
    }
    if (type !== 'userdebug-emulator') {
      handle.attemptLog.push(`network: skipped (unknown Android device type "${type}")`);
      return;
    }
    const installed = await installSystemCa(
      opts.udid,
      handle._ca.certPemPath,
      handle._ca.androidHashName,
    );
    if (!installed) {
      handle.attemptLog.push('network: failed to install CA on AVD — HTTPS bodies will be missing');
      return;
    }
    try {
      await setHttpProxy(opts.udid, EMULATOR_HOST_IP, handle.port);
      handle._configuredUdid = opts.udid;
      handle._configuredAndroid = true;
    } catch (e) {
      handle.attemptLog.push(`network: failed to set device proxy: ${(e as Error).message}`);
    }
    return;
  }

  // iOS Simulator
  if (!isSimulatorUdid(opts.udid)) {
    handle.attemptLog.push('network: skipped (real device — not supported in v1)');
    return;
  }
  const booted = await waitForBoot(opts.udid);
  if (!booted) {
    handle.attemptLog.push('network: simulator did not finish booting in time');
    return;
  }
  const certInstalled = await installRootCert(opts.udid, handle._ca.certPemPath);
  if (!certInstalled) {
    handle.attemptLog.push('network: failed to add root cert to sim keychain');
    return;
  }
  handle._configuredUdid = opts.udid;
}

/**
 * Phase 2 teardown — runs while the WebDriver session is still alive so
 * we can clear the device-side HTTP proxy. Idempotent.
 */
export async function teardownDeviceCapture(handle: NetworkProxyHandle): Promise<void> {
  if (handle._configuredAndroid && handle._configuredUdid) {
    await clearHttpProxy(handle._configuredUdid).catch(() => undefined);
    handle._configuredAndroid = false;
  }
  // iOS: keychain entry is left in place (cheap, no per-test cleanup needed).
}

/**
 * Phase 1 teardown — stop the proxy server and restore macOS host proxy
 * state on iOS. Runs LAST in the fixture chain. Idempotent.
 */
export async function teardownNetworkProxy(handle: NetworkProxyHandle): Promise<void> {
  if (handle._platform === Platform.IOS) {
    await restoreProxy().catch(() => undefined);
  }
  await handle._proxy.stop().catch(() => undefined);
}

/**
 * Pull a usable udid out of the WebDriver session's matched capabilities.
 * Appium drivers expose this under different keys depending on driver +
 * version, so we try a few.
 */
export function extractUdid(driverCapabilities: unknown): string | undefined {
  const c = driverCapabilities as Record<string, unknown> | undefined;
  if (!c) return undefined;
  for (const key of ['udid', 'deviceUDID', 'appium:udid', 'appium:deviceUDID']) {
    const v = c[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
