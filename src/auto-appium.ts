import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { loadTaqwrightConfig } from './config.js';
import { startAppiumServer, killAppiumOnPort } from './providers/appium.js';
import { isCloudProvider } from './providers/index.js';
import type { TaqwrightConfig } from './types/index.js';

/** A local Appium server the CLI should pre-start before the run. */
export interface AutoStartTarget {
  name: string;
  host: string;
  port: number;
  basePath?: string;
}

export async function isPortOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** Poll until nothing is listening on host:port, or the timeout elapses. */
async function waitForPortClosed(host: string, port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(host, port))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Pure selection: which projects the CLI should pre-start a local Appium for.
 *
 * Includes only single-device projects with `appium.autoStart === true`.
 * Excludes cloud projects (remote grid) and pool / autoDiscover projects (the
 * per-worker fixture spawns their Appium on staggered `basePort + idx` ports,
 * so the CLI must not pre-bind for them).
 *
 * When `projectFilter` is non-empty, only projects whose name matches are
 * considered — this prevents two parallel `taqwright test --project=A` /
 * `--project=B` invocations from racing on each other's ports.
 *
 * Deduplicates by host:port so projects that share a server (e.g. both
 * `android` and `ios-iphone` on 4725) only get one Appium instance, while
 * projects on distinct ports (e.g. parallel iOS sims on 4725 / 4726) each
 * get their own.
 */
export function autoStartTargets(
  cfg: TaqwrightConfig,
  projectFilter: string[] = [],
): AutoStartTarget[] {
  const filterSet = new Set(projectFilter);
  const seen = new Set<string>();
  const targets: AutoStartTarget[] = [];

  for (const project of cfg.projects) {
    if (filterSet.size > 0 && !filterSet.has(project.name ?? '')) continue;

    const device = project.use?.device as
      | { provider?: string; pool?: unknown[]; autoDiscover?: boolean }
      | undefined;

    // Cloud projects run on a remote grid, not a local Appium — a stray
    // `appium.autoStart` on one must never spawn a useless server.
    if (isCloudProvider(device?.provider)) continue;

    // Pool / autoDiscover projects spawn their own Appium per worker on
    // staggered ports (basePort + parallelIndex) inside the fixture, so the
    // CLI must not pre-bind for them. Single-device projects do NOT self-spawn
    // and rely on this pre-start — so pre-start those even when a pool project
    // sits elsewhere in the same config (the per-project guard; a previous
    // global one disabled pre-start for the whole config if any project had a
    // pool, leaving single-device projects with no Appium).
    const hasPool = Array.isArray(device?.pool) && device.pool.length > 0;
    if (hasPool || device?.autoDiscover === true) continue;

    const appium = project.use?.appium;
    if (!appium?.autoStart) continue;

    const host = appium.host ?? 'localhost';
    const port = appium.port ?? 4723;
    const key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({ name: project.name ?? '', host, port, basePath: appium.path });
  }

  return targets;
}

/**
 * For each project selected by {@link autoStartTargets}, probe its host:port;
 * if nothing is listening, spawn Appium and wait for it to come up. A stale
 * Appium on the port is killed and restarted; a non-Appium listener is left
 * untouched. Returns the spawned children (may be empty) for the caller to
 * kill after the run.
 */
export async function maybeAutoStartAppium(
  configPath: string,
  projectFilter: string[] = [],
): Promise<ChildProcess[]> {
  const cfg = await loadTaqwrightConfig(dirname(configPath));
  if (!cfg) return [];

  const procs: ChildProcess[] = [];
  for (const { host, port, basePath } of autoStartTargets(cfg, projectFilter)) {
    if (await isPortOpen(host, port)) {
      const killed = await killAppiumOnPort(port);
      if (killed) {
        console.log(`taqwright: killed stale Appium on ${host}:${port}, restarting…`);
        await waitForPortClosed(host, port);
      } else {
        // Something non-Appium holds the port — we must not kill it. Leave it
        // and skip spawning; the WebDriver session will surface a clear error.
        console.log(
          `taqwright: ${host}:${port} is in use by a non-Appium process; leaving it untouched.`,
        );
        continue;
      }
    }

    console.log(`taqwright: starting Appium server on ${host}:${port}…`);
    const proc = await startAppiumServer('unknown', { host, port, basePath });
    procs.push(proc);
  }
  return procs;
}
