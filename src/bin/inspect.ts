import { spawn, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import { findConfigFile, loadTaqwrightConfig, getUseOptions } from '../config.js';
import { buildCapabilities } from '../capabilities.js';
import { isPortOpen } from '../auto-appium.js';
import { startInspectorServer } from '../inspector/server.js';
import type { InspectorDefaults } from '../inspector/session.js';

export interface InspectCliOptions {
  config?: string;
  project?: string;
  port?: string;
  host?: string;
  open?: boolean;
  /** Auto-flip session.recording = true the moment the user clicks Connect. */
  record?: boolean;
}

/**
 * `taqwright inspect` — start the inspector server and open the browser. We
 * do NOT auto-start Appium and do NOT open a WebDriver session here. The user
 * lands on a setup page, runs the doctor, optionally starts Appium, picks
 * capabilities, and clicks Connect.
 *
 * The taqwright config (if present) seeds the form with sensible defaults.
 */
export async function runInspect(opts: InspectCliOptions): Promise<void> {
  const defaults = await resolveDefaults(opts);

  const host = opts.host ?? 'localhost';
  const port = await pickFreePort(opts.port ? Number(opts.port) : 4280, host);

  const handle = await startInspectorServer({ defaults, host, port });

  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\ntaqwright inspect: shutting down…');
    try {
      await handle.session.cleanup();
    } catch {
      /* best-effort shutdown */
    }
    try {
      await handle.close();
    } catch {
      /* best-effort shutdown */
    }
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  console.log(`taqwright inspect: ready at ${handle.url}`);
  console.log('Press Ctrl+C to stop.');
  if (opts.open !== false) openBrowser(handle.url);
}

async function resolveDefaults(opts: InspectCliOptions): Promise<InspectorDefaults> {
  const configPath = opts.config ?? (await findConfigFile());

  // projectRoot/testDir are needed for Export and Run regardless of whether
  // we can resolve a project's `use` options — they depend only on the
  // config file's existence, not its shape. Pin them up-front so the
  // fallback paths still let users save and run specs.
  const projectRoot = configPath ? dirname(configPath) : undefined;

  const baseFallback = {
    project: undefined,
    projectRoot,
    testDir: 'tests',
    appium: { host: 'localhost', port: 4723, path: '/' },
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:noReset': true,
      'appium:newCommandTimeout': 240,
    },
    recordOnConnect: !!opts.record,
  } satisfies InspectorDefaults;

  if (!configPath) return baseFallback;

  const cfg = await loadTaqwrightConfig(dirname(configPath));
  const useOpts = getUseOptions(cfg, opts.project);
  if (!useOpts) {
    console.log('taqwright inspect: no project resolved from config — using built-in defaults.');
    return { ...baseFallback, testDir: cfg?.testDir ?? 'tests' };
  }
  const projectName =
    opts.project ?? cfg?.projects.find((p) => p.use === useOpts)?.name ?? cfg?.projects[0]?.name;

  return {
    project: projectName,
    projectRoot,
    testDir: cfg?.testDir ?? 'tests',
    appium: {
      host: useOpts.appium?.host ?? 'localhost',
      port: useOpts.appium?.port ?? 4723,
      path: useOpts.appium?.path ?? '/',
    },
    capabilities: buildCapabilities(useOpts) as Record<string, unknown>,
    recordOnConnect: !!opts.record,
  };
}

async function pickFreePort(preferred: number, host: string): Promise<number> {
  for (let p = preferred; p < preferred + 20; p++) {
    if (!(await isPortOpen(host, p))) return p;
  }
  return preferred;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child: ChildProcess = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    // best-effort — user can copy the URL from the log
  }
}
