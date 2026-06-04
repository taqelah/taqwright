import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';
import { Platform, type TaqwrightConfig } from './types/index.js';

export const TAQWRIGHT_KEY = '__taqwright__';

/** Playwright config with the taqwright config preserved on a private key. */
export interface PlaywrightConfigWithEmbedded extends PlaywrightTestConfig {
  [TAQWRIGHT_KEY]?: TaqwrightConfig;
}

const CONFIG_FILES = [
  'taqwright.config.ts',
  'taqwright.config.mts',
  'taqwright.config.js',
  'taqwright.config.mjs',
] as const;

/**
 * Resolve the user's taqwright config file path, if any. Walks up parent
 * directories from `cwd` so the inspector / test runner can be launched
 * from a subfolder of the project — same behavior Jest, Vitest, etc. use.
 */
export async function findConfigFile(cwd: string = process.cwd()): Promise<string | undefined> {
  let dir = resolve(cwd);
  while (true) {
    for (const name of CONFIG_FILES) {
      const candidate = join(dir, name);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // try next file
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined; // reached filesystem root
    dir = parent;
  }
}

async function importConfigFile(filePath: string): Promise<PlaywrightConfigWithEmbedded> {
  const mod = await import(pathToFileURL(filePath).href);
  // tsx/ts-node CJS↔ESM interop sometimes wraps the default export twice
  // (mod.default.default), so unwrap one extra level when present.
  let config = mod.default ?? mod;
  if (config && typeof config === 'object' && 'default' in config) {
    config = config.default;
  }
  return config as PlaywrightConfigWithEmbedded;
}

/** Load the taqwright config from disk, if present. */
export async function loadTaqwrightConfig(cwd?: string): Promise<TaqwrightConfig | undefined> {
  const file = await findConfigFile(cwd);
  if (!file) return undefined;
  const cfg = await importConfigFile(file);
  return cfg[TAQWRIGHT_KEY];
}

/** Load the underlying Playwright config (used by the CLI). */
export async function loadPlaywrightConfig(cwd?: string): Promise<PlaywrightConfigWithEmbedded> {
  const file = await findConfigFile(cwd);
  if (!file) return {};
  return importConfigFile(file);
}

/**
 * Define an taqwright config. Returns a Playwright TestConfig (so
 * Playwright's runner can consume `taqwright.config.ts` directly via
 * `--config`) with the taqwright shape preserved on a private key for
 * our fixture to pick up.
 */
export function defineConfig(config: TaqwrightConfig): PlaywrightConfigWithEmbedded {
  if (!config.projects || config.projects.length === 0) {
    throw new Error('taqwright defineConfig: at least one project is required');
  }

  const parallelMisconfig = findParallelMisconfig(config);
  if (parallelMisconfig) throw new Error(parallelMisconfig);

  const autoStartMisconfig = findAutoStartDeviceMisconfig(config);
  if (autoStartMisconfig) throw new Error(autoStartMisconfig);

  // Honor the user's `workers` setting. We previously hardcoded `1` to
  // prevent device contention, but with `device.pool` the fixture can
  // partition devices/Appiums/driver-ports per worker safely. Without a
  // pool, the user is responsible for ensuring `workers === 1` (or for
  // the runtime fixture's pool-exhausted guard to fail fast).
  const pwConfig: PlaywrightConfigWithEmbedded = {
    workers: config.workers ?? 1,
    fullyParallel: config.fullyParallel ?? false,
    forbidOnly: config.forbidOnly,
    timeout: config.timeout,
    retries: config.retries,
    outputDir: config.outputDir,
    testDir: config.testDir,
    testMatch: config.testMatch,
    testIgnore: config.testIgnore,
    reporter: config.reporter as PlaywrightTestConfig['reporter'],
    globalSetup: config.globalSetup,
    globalTeardown: config.globalTeardown,
    projects: config.projects.map((p) => ({
      name: p.name,
      timeout: p.timeout,
      retries: p.retries,
      testDir: p.testDir,
      testMatch: p.testMatch,
      testIgnore: p.testIgnore,
      outputDir: p.outputDir,
      grep: p.grep,
      grepInvert: p.grepInvert,
      dependencies: p.dependencies,
      // The user's `use` block (TaqwrightUseOptions) is intentionally NOT
      // forwarded to Playwright — the fixture re-reads it at runtime via
      // getUseOptions() using the stashed project name below.
      use: {
        taqwrightProject: p.name,
      } as Record<string, unknown>,
    })),
    [TAQWRIGHT_KEY]: config,
  };

  return pwConfig;
}

/**
 * Validate that a parallel run has enough devices. Returns an actionable
 * error message (one line per offending project, each `taqwright:`-prefixed)
 * or `null` when safe. `defineConfig` throws on a non-null result so a bad
 * config aborts at load — before any Appium/device work — instead of N
 * workers silently colliding on one device (the failure the runtime
 * fixture guard otherwise catches late, per-worker).
 *
 * Cloud projects (`browserstack` / `lambdatest`) are skipped: they have no
 * `device.pool` (the field doesn't exist on their type) and the cloud
 * provider manages its own device queueing.
 */
export function findParallelMisconfig(config: TaqwrightConfig): string | null {
  const workers = config.workers ?? 1;
  // workers <= 1 → serial; nothing runs concurrently, no contention.
  // (`fullyParallel` only changes scheduling granularity, not the
  // concurrent device count, which is bounded by `workers`.)
  if (workers <= 1) return null;

  const problems: string[] = [];
  for (const project of config.projects) {
    const device = project.use.device;
    // Discriminated union: only emulator / local-device own a `pool`.
    if (device.provider !== 'emulator' && device.provider !== 'local-device') {
      continue;
    }
    const pool = device.pool;
    if (!pool || pool.length === 0) {
      problems.push(
        `\`workers\` is ${workers} but project "${project.name}" ` +
          `(provider: ${device.provider}) has no \`device.pool\`. Parallel ` +
          `runs need a \`device.pool\` with at least ${workers} entries — ` +
          `add one, or set \`workers: 1\`. Without a pool, multiple workers ` +
          `collide on one device.`,
      );
    } else if (pool.length < workers) {
      problems.push(
        `\`workers\` is ${workers} but project "${project.name}"'s ` +
          `\`device.pool\` has only ${pool.length} ` +
          `entr${pool.length === 1 ? 'y' : 'ies'}. Grow it to at least ` +
          `${workers}, or lower \`workers\`.`,
      );
    }
  }

  return problems.length ? `taqwright: ${problems.join('\ntaqwright: ')}` : null;
}

/**
 * `appium.autoStartDevice` boots an offline Android emulator by passing
 * its AVD id as `appium:avd`. That needs a concrete (string) AVD name —
 * a RegExp `device.name` (or none) can't be booted. Returns an actionable
 * error (one line per offending project, `taqwright:`-prefixed) or `null`.
 * `defineConfig` throws on a non-null result so a bad config aborts at
 * load. iOS emulators (XCUITest auto-boots), real `local-device`s, and
 * cloud providers are skipped — `autoStartDevice` is a no-op for them.
 */
export function findAutoStartDeviceMisconfig(config: TaqwrightConfig): string | null {
  const problems: string[] = [];
  for (const project of config.projects) {
    const use = project.use;
    if (use.appium?.autoStartDevice !== true) continue;
    const device = use.device;
    // Only Android emulator projects need a concrete AVD id to boot.
    if (device.provider !== 'emulator' || use.platform !== Platform.ANDROID) {
      continue;
    }
    const pool = (device as { pool?: Array<{ name?: string }> }).pool;
    const ok = pool
      ? pool.every((e) => typeof e.name === 'string' && e.name.length > 0)
      : typeof device.name === 'string' && device.name.length > 0;
    if (!ok) {
      problems.push(
        `\`appium.autoStartDevice\` is set on project "${project.name}" ` +
          `but it has no concrete AVD name to boot. autoStartDevice needs ` +
          `a string \`device.name\` (or a string \`name\` on every ` +
          `\`device.pool\` entry) equal to the AVD id (e.g. ` +
          `'Pixel_7_API_34' — see \`emulator -list-avds\`). A RegExp ` +
          `\`device.name\` can't be booted. Set a string name, or remove ` +
          `\`appium.autoStartDevice\`.`,
      );
    }
  }
  return problems.length ? `taqwright: ${problems.join('\ntaqwright: ')}` : null;
}

/** Locate the use options for the active project (or the first one). */
export function getUseOptions(
  config: TaqwrightConfig | undefined,
  projectName?: string,
): TaqwrightConfig['projects'][number]['use'] | undefined {
  if (!config) return undefined;
  if (projectName) {
    const match = config.projects.find((p) => p.name === projectName);
    if (match) return match.use;
  }
  return config.projects[0]?.use;
}

export { Platform };
