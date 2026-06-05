import { Platform } from './types/index.js';
import { loadTaqwrightConfig } from './config.js';
import {
  discoverAssignableDevices,
  selectDevicePool,
  resolvedPoolEnvKey,
  type DiscoverOpts,
} from './discovery.js';
import { startIosSimulator } from './inspector/devices.js';
import { logger } from './logger.js';

/**
 * Playwright `globalSetup` hook (injected by `defineConfig` only when a project
 * sets `device.autoDiscover: true`). Runs **once**, in the main process, before
 * any worker forks — so it owns the stateful, must-happen-once parts of
 * auto-discovery that per-worker discovery can't do safely:
 *
 *  1. Enumerate the host's devices for each auto-discover project.
 *  2. Fail fast (a single clean throw) when fewer are available than `workers`.
 *  3. Pre-boot the assigned iOS simulators (Android boot is delegated to Appium
 *     per worker via `appium:avd`).
 *  4. Freeze the resolved pool into an env var the worker fixture reads.
 *
 * The published pool is shape-identical to a hand-written `device.pool`, so the
 * worker fixture's existing partition path consumes it unchanged.
 */
export default async function autoDiscoverGlobalSetup(): Promise<void> {
  const config = await loadTaqwrightConfig();
  if (!config) return;

  const workers = config.workers ?? 1;

  for (const project of config.projects) {
    const device = project.use.device as {
      provider?: string;
      autoDiscover?: boolean;
      osVersion?: string;
      name?: string | RegExp;
    };
    if (device.autoDiscover !== true) continue;
    if (device.provider !== 'emulator' && device.provider !== 'local-device') continue;

    const opts: DiscoverOpts = {
      platform: project.use.platform,
      provider: device.provider,
      osVersion: device.osVersion,
      name: device.name,
    };

    const slots = await discoverAssignableDevices(opts);
    // Throws with an actionable message when slots.length < workers.
    const pool = selectDevicePool(slots, workers);

    // iOS: bring the assigned simulators up now (idempotent — `simctl boot`
    // swallows already-booted). XCUITest then attaches to a running sim by
    // udid, which is far more reliable than N concurrent cold auto-boots.
    if (project.use.platform === Platform.IOS) {
      for (const entry of pool) {
        await startIosSimulator(entry.udid).catch((err) => {
          logger.warn(
            `taqwright: could not pre-boot simulator ${entry.udid} — ${(err as Error).message}`,
          );
        });
      }
    }

    process.env[resolvedPoolEnvKey(project.name)] = JSON.stringify(pool);
    logger.log(
      `taqwright: autoDiscover resolved ${pool.length} device(s) for project "${project.name}".`,
    );
  }
}
