import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { loadTaqwrightConfig } from './config.js';
import { startAppiumServer, killAppiumOnPort } from './providers/appium.js';
import { isCloudProvider } from './providers/index.js';

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
 * For every project with `appium.autoStart === true`, probe its host:port.
 * If nothing is listening, spawn Appium and wait for it to come up.
 * Returns the list of spawned children (may be empty).
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
export async function maybeAutoStartAppium(
  configPath: string,
  projectFilter: string[] = [],
): Promise<ChildProcess[]> {
  const cfg = await loadTaqwrightConfig(dirname(configPath));
  if (!cfg) return [];
  // If any project declares a device pool, the per-worker fixture spawns
  // Appium itself on staggered ports — a single CLI-level pre-spawn would
  // bind the base port and prevent worker 0 from getting it.
  const hasPool = cfg.projects.some((p) => {
    const pool = (p.use?.device as { pool?: unknown[] } | undefined)?.pool;
    return Array.isArray(pool) && pool.length > 0;
  });
  if (hasPool) return [];

  const filterSet = new Set(projectFilter);
  const procs: ChildProcess[] = [];
  const seen = new Set<string>();
  for (const project of cfg.projects) {
    if (filterSet.size > 0 && !filterSet.has(project.name ?? '')) continue;

    // Cloud projects run on a remote grid, not a local Appium — a stray
    // `appium.autoStart` on one must never spawn a useless server.
    const provider = (project.use?.device as { provider?: string } | undefined)?.provider;
    if (isCloudProvider(provider)) continue;

    const appium = project.use?.appium;
    if (!appium?.autoStart) continue;

    const host = appium.host ?? 'localhost';
    const port = appium.port ?? 4723;
    const key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);

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
    const proc = await startAppiumServer('unknown', { host, port, basePath: appium.path });
    procs.push(proc);
  }
  return procs;
}
