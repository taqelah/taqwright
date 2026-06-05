import { Platform } from './types/index.js';
import { loadTaqwrightConfig, effectiveWorkers } from './config.js';
import {
  discoverAssignableDevices,
  selectDevicePool,
  resolvedPoolEnvKey,
  type DiscoverOpts,
} from './discovery.js';
import { startIosSimulator, ensureAndroidAvdReady } from './inspector/devices.js';
import { logger } from './logger.js';

/**
 * Playwright `globalSetup` hook (injected by `defineConfig` when a project sets
 * `device.autoDiscover: true`, or has a static Android emulator `device.pool`
 * with `autoStartDevice`). Runs **once**, in the main process, before any worker
 * forks — so it owns the stateful, must-happen-once parts of device bring-up
 * that per-worker logic can't do safely:
 *
 *  1. Enumerate the host's devices for each auto-discover project.
 *  2. Fail fast (a single clean throw) when fewer are available than `workers`.
 *  3. Pre-boot the assigned devices — iOS simulators (`simctl boot`) and Android
 *     emulators (`emulator -avd`, then wait for boot_completed + PackageManager).
 *     Booting up front, sequentially, beats N workers cold-booting concurrently:
 *     a worker that attaches to an already-ready device never hits the "device
 *     offline" / failed `adb install` race.
 *  4. Freeze the resolved auto-discover pool into an env var the worker fixture
 *     reads. (Static pools need no freeze — the fixture reads `device.pool`.)
 */
export default async function autoDiscoverGlobalSetup(): Promise<void> {
  const config = await loadTaqwrightConfig();
  if (!config) return;

  for (const project of config.projects) {
    const device = project.use.device as {
      provider?: string;
      autoDiscover?: boolean;
      osVersion?: string;
      name?: string | RegExp;
      pool?: Array<{ udid: string; name?: string; osVersion?: string }>;
    };
    const autoStartDevice = project.use.appium?.autoStartDevice !== false;
    const isAutoDiscover =
      device.autoDiscover === true &&
      (device.provider === 'emulator' || device.provider === 'local-device');
    const isStaticAndroidPool =
      !device.autoDiscover &&
      device.provider === 'emulator' &&
      project.use.platform === Platform.ANDROID &&
      Array.isArray(device.pool) &&
      device.pool.length > 0 &&
      autoStartDevice;

    if (!isAutoDiscover && !isStaticAndroidPool) continue;

    // Static Android pool: pre-boot each named AVD. The worker fixture reads
    // `device.pool` directly and selects the device via `appium:avd`, so there's
    // nothing to publish — pre-booting just makes that per-worker attach succeed.
    if (isStaticAndroidPool) {
      for (const entry of device.pool!) {
        if (typeof entry.name !== 'string' || !entry.name) continue;
        await ensureAndroidAvdReady(entry.name).catch((err) => {
          logger.warn(
            `taqwright: could not pre-boot AVD ${entry.name} — ${(err as Error).message}`,
          );
        });
      }
      logger.log(
        `taqwright: pre-booted ${device.pool!.length} emulator(s) for project "${project.name}".`,
      );
      continue;
    }

    // Per-project worker count — validate this project's discovered devices
    // against its own `workers`, not a single global value.
    const workers = effectiveWorkers(project, config);

    const opts: DiscoverOpts = {
      platform: project.use.platform,
      provider: device.provider as 'emulator' | 'local-device',
      osVersion: device.osVersion,
      name: device.name,
    };

    const slots = await discoverAssignableDevices(opts);
    // Throws with an actionable message when slots.length < workers.
    const pool = selectDevicePool(slots, workers);

    // Bring the assigned devices up now, sequentially, before any worker forks.
    if (project.use.platform === Platform.IOS) {
      for (const entry of pool) {
        await startIosSimulator(entry.udid).catch((err) => {
          logger.warn(
            `taqwright: could not pre-boot simulator ${entry.udid} — ${(err as Error).message}`,
          );
        });
      }
    } else if (device.provider === 'emulator' && autoStartDevice) {
      for (const entry of pool) {
        const avd = entry.name ?? entry.udid.replace(/^avd:/, '');
        await ensureAndroidAvdReady(avd).catch((err) => {
          logger.warn(`taqwright: could not pre-boot AVD ${avd} — ${(err as Error).message}`);
        });
      }
    }

    process.env[resolvedPoolEnvKey(project.name)] = JSON.stringify(pool);
    logger.log(
      `taqwright: autoDiscover resolved ${pool.length} device(s) for project "${project.name}".`,
    );
  }
}
