#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { findConfigFile, loadTaqwrightConfig, resolveCliWorkers } from '../config.js';
import { maybeAutoStartAppium } from '../auto-appium.js';
import { runDoctorChecks } from '../doctor.js';
import { listDevices, type Device } from '../inspector/devices.js';
import { runSetup } from '../setup/index.js';
import { applyManagedEnv } from '../setup/paths.js';
import { BrandingBuffer } from './branding.js';

const _require = createRequire(import.meta.url);

interface PackageJson {
  version: string;
}

function getVersion(): string {
  try {
    const pkg = _require('../../package.json') as PackageJson;
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Locate Playwright's CLI inside our node_modules and run it.
 * (We don't import its programmatic API to keep our entrypoint lean.)
 *
 * Note: Playwright's `package.json#exports` doesn't expose `./cli.js`, so
 * `require.resolve('@playwright/test/cli.js')` throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * We resolve `package.json` (always exported) and derive the CLI path from `bin`.
 */
function locatePlaywrightCli(): string | null {
  for (const pkgName of ['@playwright/test', 'playwright']) {
    try {
      const pkgPath = _require.resolve(`${pkgName}/package.json`);
      const pkg = _require(pkgPath) as { bin?: string | Record<string, string> };
      const binRel =
        typeof pkg.bin === 'string'
          ? pkg.bin
          : (pkg.bin?.playwright ?? pkg.bin?.['@playwright/test']);
      if (!binRel) continue;
      return join(dirname(pkgPath), binRel);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function runPlaywright(args: string[]): Promise<number> {
  const cliPath = locatePlaywrightCli();
  if (!cliPath) {
    console.error('error: could not locate Playwright CLI in node_modules');
    return 1;
  }
  // We pipe (not inherit) stdout so Playwright's branded hints can be
  // rewritten to taqwright's. Trade-off: the child no longer sees a TTY on
  // stdout, so Playwright drops its live single-line progress rendering.
  // Mitigations: stdin stays inherited (interactive prompts + Playwright's
  // stdin-TTY-gated report hint still fire), and we force colour when the
  // real terminal is a TTY so output isn't flattened to monochrome.
  const env = { ...process.env };
  if (process.stdout.isTTY && env.FORCE_COLOR === undefined) {
    env.FORCE_COLOR = '1';
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env,
    });
    // Line-buffered branding rewrite (see ./branding.ts): rewrite complete
    // lines, hold the trailing partial until its newline arrives so the
    // target substring can't be split across chunks.
    const branding = new BrandingBuffer();
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      const out = branding.push(chunk);
      if (out) process.stdout.write(out);
    });
    // stderr passes through untouched (wdio / error output).
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    // `close` fires after all stdio streams have drained — flush the last
    // partial line, then resolve.
    child.on('close', (code, signal) => {
      const tail = branding.flush();
      if (tail) process.stdout.write(tail);
      if (signal) resolve(128);
      else resolve(code ?? 0);
    });
  });
}

const program = new Command();
program.name('taqwright').version(getVersion());

// If `taqwright install` vendored a toolchain, make every subcommand (test →
// auto-Appium, devices, doctor, inspect) inherit it — no shell-rc edits.
// No-op when setup hasn't run.
applyManagedEnv();

// ─── test ───────────────────────────────────────────────────────────
program
  .command('test [test-filter...]')
  .description('run tests')
  .option('-c, --config <file>', 'configuration file (default: taqwright.config.{ts,mts,js,mjs})')
  .option('--reporter <reporter>', 'reporter to use (e.g. list, html, json, junit)')
  .option('--grep <grep>', 'only run tests matching this regex')
  .option('--grep-invert <grep>', 'only run tests NOT matching this regex')
  .option('--project <name...>', 'only run tests from specified projects')
  .option('--retries <n>', 'maximum retry count for flaky tests')
  .option('--timeout <ms>', 'test timeout in milliseconds')
  .option('--shard <x/n>', 'shard to run, e.g. 1/3')
  .option('--workers <n>', "number of parallel workers (default: the run's project workers)")
  .option('--list', 'list all tests without running them')
  .option('--pass-with-no-tests', 'exit with code 0 when no tests found')
  .allowUnknownOption(true)
  .action(async (filters: string[], opts: Record<string, unknown>) => {
    const configPath = (opts.config as string | undefined) ?? (await findConfigFile());
    if (!configPath) {
      console.error(
        'error: no taqwright config found. Create taqwright.config.ts or pass --config <file>.',
      );
      process.exit(1);
    }

    const args = ['test', '--config', configPath, ...filters];
    for (const flag of [
      'reporter',
      'grep',
      'grepInvert',
      'project',
      'retries',
      'timeout',
      'shard',
    ] as const) {
      const v = opts[flag];
      if (v === undefined) continue;
      const cliFlag = flag === 'grepInvert' ? '--grep-invert' : `--${flag}`;
      if (Array.isArray(v)) {
        for (const item of v) args.push(cliFlag, String(item));
      } else {
        args.push(cliFlag, String(v));
      }
    }
    if (opts.list) args.push('--list');
    if (opts.passWithNoTests) args.push('--pass-with-no-tests');

    const projectFilter = Array.isArray(opts.project) ? (opts.project as string[]) : [];

    // Playwright's worker pool is global, so size it to the project being run.
    // Honor an explicit `--workers`; otherwise inject the resolved project's
    // `workers` so the global pool matches the one project (the common
    // one-project-per-run path). Ambiguous multi-project runs are left on the
    // config's global cap.
    const cfg = await loadTaqwrightConfig(dirname(configPath));
    const workers = cfg
      ? resolveCliWorkers(cfg, projectFilter, opts.workers as string | undefined)
      : opts.workers !== undefined
        ? Number.parseInt(String(opts.workers), 10)
        : undefined;
    if (workers !== undefined && Number.isFinite(workers)) {
      args.push('--workers', String(workers));
    }

    const appiumProcs = await maybeAutoStartAppium(configPath, projectFilter);
    const code = await runPlaywright(args);
    for (const proc of appiumProcs) {
      if (!proc.killed) proc.kill();
    }
    process.exit(code);
  });

// ─── init ───────────────────────────────────────────────────────────
program
  .command('init [dir]')
  .description('scaffold a new taqwright project (interactive)')
  .option('--test-dir <name>', 'test folder name (default: tests)')
  .option('--platform <p>', 'android | ios | both (default: android)')
  .option('--install', 'run npm install after scaffolding')
  .option('--no-install', 'skip running npm install after scaffolding')
  .option('-y, --yes', 'overwrite an existing non-empty directory without prompting')
  .option(
    '--install-toolchain',
    'auto-install the Android toolchain after scaffolding (skips the prompt)',
  )
  .option('--no-install-toolchain', 'skip the Android-toolchain prompt entirely')
  .option(
    '--with-avd',
    'also create an Android emulator (system image + AVD) when installing the toolchain',
  )
  .option('--no-with-avd', 'skip the emulator prompt')
  .option('--demo-app', 'download the demo APK so the example test runs out of the box')
  .option('--no-demo-app', 'skip the demo-app prompt entirely')
  .action(
    async (
      dir: string | undefined,
      opts: {
        testDir?: string;
        platform?: string;
        install?: boolean;
        yes?: boolean;
        installToolchain?: boolean;
        withAvd?: boolean;
        demoApp?: boolean;
      },
    ) => {
      const platform = opts.platform?.toLowerCase();
      if (platform && !['android', 'ios', 'both'].includes(platform)) {
        console.error(`error: --platform must be android, ios, or both (got "${opts.platform}")`);
        process.exit(1);
      }
      const { runInit } = await import('./init.js');
      await runInit(dir, {
        testDir: opts.testDir,
        platform: platform as 'android' | 'ios' | 'both' | undefined,
        install: opts.install,
        yes: opts.yes,
        installToolchain: opts.installToolchain,
        withAvd: opts.withAvd,
        demoApp: opts.demoApp,
      });
    },
  );

// ─── inspect ────────────────────────────────────────────────────────
program
  .command('inspect')
  .description('open the taqwright inspector (web UI) against a device')
  .option('-c, --config <file>', 'configuration file (default: taqwright.config.{ts,mts,js,mjs})')
  .option('--project <name>', 'project to inspect (default: first project in config)')
  .option('--port <n>', 'preferred local port for the inspector UI', '4280')
  .option('--host <host>', 'host to bind the inspector UI', 'localhost')
  .option('--no-open', 'do not automatically open the browser')
  .option('--record', 'auto-start recording the moment Connect succeeds')
  .action(
    async (opts: {
      config?: string;
      project?: string;
      port?: string;
      host?: string;
      open?: boolean;
      record?: boolean;
    }) => {
      const { runInspect } = await import('./inspect.js');
      await runInspect(opts);
    },
  );

// ─── codegen ────────────────────────────────────────────────────────
// Same UI as `inspect`, but recording is auto-armed on Connect — matches
// the Playwright muscle memory of "open the recorder, start clicking, get
// runnable code". Equivalent to `taqwright inspect --record`.
program
  .command('codegen')
  .description(
    'open the inspector and auto-start recording on Connect (alias of `inspect --record`)',
  )
  .option('-c, --config <file>', 'configuration file (default: taqwright.config.{ts,mts,js,mjs})')
  .option('--project <name>', 'project to record against (default: first project in config)')
  .option('--port <n>', 'preferred local port for the inspector UI', '4280')
  .option('--host <host>', 'host to bind the inspector UI', 'localhost')
  .option('--no-open', 'do not automatically open the browser')
  .action(
    async (opts: {
      config?: string;
      project?: string;
      port?: string;
      host?: string;
      open?: boolean;
    }) => {
      const { runInspect } = await import('./inspect.js');
      await runInspect({ ...opts, record: true });
    },
  );

// ─── devices ────────────────────────────────────────────────────────
program
  .command('devices')
  .description('list connected devices, simulators, and emulators')
  .action(async () => {
    const { android, ios, toolsMissing } = await listDevices();

    // Booted first, then booting, then everything else; alpha by name
    // within a state — mirrors the sort listIos() already applies.
    const stateRank = (s: Device['state']) => (s === 'booted' ? 0 : s === 'booting' ? 1 : 2);
    const bySort = (a: Device, b: Device) =>
      stateRank(a.state) - stateRank(b.state) || a.name.localeCompare(b.name);
    const fmt = (d: Device, osLabel: string) => {
      const os = d.osVersion ? `, ${osLabel} ${d.osVersion}` : '';
      return `  ${d.name}  ${d.udid}  (${d.state}${os})`;
    };

    // ── Android (adb online devices + configured AVDs, shutdown or booted) ──
    console.log('Android (adb + emulator):');
    if (toolsMissing.adb && toolsMissing.emulator) {
      console.log('  (adb and emulator not on PATH — install Android SDK)');
    } else if (android.length === 0) {
      console.log('  (no Android emulators or devices found)');
    } else {
      [...android].sort(bySort).forEach((d) => console.log(fmt(d, 'Android')));
      if (toolsMissing.emulator) {
        console.log('  (emulator not on PATH — shutdown AVDs not listed)');
      }
    }

    // ── iOS simulators (macOS only) ──
    if (process.platform === 'darwin') {
      console.log('\niOS Simulators (xcrun simctl):');
      if (toolsMissing.xcrun) {
        console.log('  (xcrun not on PATH — install Xcode command-line tools)');
      } else if (ios.length === 0) {
        console.log('  (no iOS simulators found)');
      } else {
        [...ios].sort(bySort).forEach((d) => console.log(fmt(d, 'iOS')));
      }
    }

    // Nothing to drive on this machine at all → error exit (parity with
    // the previous behaviour, which exited 1 when no tooling was present).
    const noTooling =
      !!toolsMissing.adb &&
      !!toolsMissing.emulator &&
      (process.platform !== 'darwin' || !!toolsMissing.xcrun);
    if (noTooling) {
      console.error(
        'error: neither `adb`/`emulator` nor `xcrun` is on PATH. ' +
          'Install Android SDK and/or Xcode and try again.',
      );
      process.exit(1);
    }
  });

// ─── doctor ─────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('check your environment for mobile-development readiness')
  .option('--json', 'output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const checks = await runDoctorChecks();

    if (opts.json) {
      console.log(JSON.stringify({ version: getVersion(), checks }, null, 2));
    } else {
      const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
      const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
      const green = (s: string) => paint('32', s);
      const yellow = (s: string) => paint('33', s);
      const red = (s: string) => paint('31', s);
      console.log(`taqwright doctor (v${getVersion()})`);
      for (const c of checks) {
        const mark =
          c.status === 'ok' ? green('[ok]') : c.status === 'warn' ? yellow('[--]') : red('[!!]');
        console.log(`  ${mark} ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
      }
    }

    if (checks.some((c) => c.status === 'error')) process.exit(1);
  });

// ─── install ────────────────────────────────────────────────────────
program
  .command('install')
  .description('auto-install the Android toolchain (JDK + SDK + Appium) — zero-touch')
  .option('--force', 'reinstall even if already provisioned')
  .option('--with-avd', 'also create a system image + Android emulator (~1 GB)')
  .option('--print-env', 'also print export lines for using the toolchain from your shell')
  .action(async (opts: { force?: boolean; withAvd?: boolean; printEnv?: boolean }) => {
    try {
      await runSetup({ force: opts.force, withAvd: opts.withAvd, printEnv: opts.printEnv });
    } catch (err) {
      console.error(`\ntaqwright install failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── merge-reports ──────────────────────────────────────────────────
program
  .command('merge-reports <directory>')
  .description('merge blob reports into a unified report')
  .option('--reporter <reporter>', 'reporter to use (e.g. html, list, json, junit)')
  .option('-c, --config <file>', 'configuration file')
  .action(async (directory: string, opts: { reporter?: string; config?: string }) => {
    const args = ['merge-reports', directory];
    if (opts.reporter) args.push('--reporter', opts.reporter);
    if (opts.config) args.push('--config', opts.config);
    process.exit(await runPlaywright(args));
  });

// ─── show-report ────────────────────────────────────────────────────
program
  .command('show-report [report]')
  .description('show HTML report')
  .option('--host <host>', 'host to serve report on', 'localhost')
  .option('--port <port>', 'port to serve report on', '9323')
  .action(async (report: string | undefined, opts: Record<string, string>) => {
    const args = ['show-report'];
    if (report) args.push(report);
    args.push('--host', opts.host, '--port', opts.port);
    process.exit(await runPlaywright(args));
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
