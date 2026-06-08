import { spawn, exec, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Platform } from '../types/index.js';
import { logger } from '../logger.js';
import { getLatestBuildToolsVersions } from '../utils.js';
import { managedEnv } from '../setup/paths.js';
import { spawnTool } from '../setup/spawn-tool.js';

const execP = promisify(exec);

/**
 * (Re)install an Appium driver (`uiautomator2` / `xcuitest`). By default uses
 * `npx appium`; `opts.appiumPath` targets a specific binary (the managed
 * Appium from `taqwright install`) and `opts.env` supplies the vendored
 * SDK/JDK env. Uninstall is best-effort; install rejects on failure so the
 * caller surfaces a real error.
 */
export async function installDriver(
  driverName: string,
  opts: { appiumPath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  const cmd = opts.appiumPath ?? 'npx';
  const prefix = opts.appiumPath ? [] : ['appium'];
  await new Promise<void>((resolve) => {
    const p = spawnTool(cmd, [...prefix, 'driver', 'uninstall', driverName], {
      stdio: 'pipe',
      env,
    });
    p.on('exit', () => resolve());
    p.on('error', () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    const p = spawnTool(cmd, [...prefix, 'driver', 'install', driverName], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    // Capture the child's output so a non-zero exit surfaces Appium's real
    // error (npm/network fetch failure, unsupported Node, proxy block, …)
    // instead of an opaque `exited 1`.
    let out = '';
    const cap = (d: Buffer): void => {
      out += d.toString();
    };
    p.stdout?.on('data', cap);
    p.stderr?.on('data', cap);
    p.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `appium driver install ${driverName} exited ${code}` +
                (out.trim() ? `\n${lastLines(out, 30)}` : ''),
            ),
          ),
    );
    p.on('error', reject);
  });
}

/** Keep only the last `n` lines of `s` — trims multi-hundred-line npm logs. */
function lastLines(s: string, n: number): string {
  return s.trimEnd().split('\n').slice(-n).join('\n');
}

export interface AppiumServerSpawnOptions {
  /** Bind address. Maps to `--address`. */
  host?: string;
  /** Port. Maps to `--port`. */
  port?: number;
  /** URL prefix the server is mounted at. Maps to `--base-path`. */
  basePath?: string;
}

/**
 * Boot a local `appium` server. Resolves when the server reports it is
 * listening; if Appium can't find an online device and the requested
 * provider is `emulator`, an Android emulator is started in the background.
 *
 * Tries the `appium` binary on PATH first (avoids `npx`'s global cache
 * lock, which serializes parallel taqwright processes). Falls back to
 * `npx appium` if no global install is found.
 */
export function startAppiumServer(
  provider: string,
  opts: AppiumServerSpawnOptions = {},
): Promise<ChildProcess> {
  const args: string[] = [];
  if (opts.host) args.push('--address', opts.host);
  if (opts.port !== undefined) args.push('--port', String(opts.port));
  if (opts.basePath && opts.basePath !== '/') args.push('--base-path', opts.basePath);
  // Permit on-demand chromedriver download so Android WebView contexts can be
  // automated without a version-matched chromedriver pre-installed. This only
  // *allows* the feature; a session still opts in via the
  // `appium:chromedriverAutodownload` capability. Appium 3.3+ requires the
  // feature name to be scoped to a driver (or `*` for all installed drivers).
  args.push('--allow-insecure=*:chromedriver_autodownload');

  return spawnAppium('appium', args, provider).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      return spawnAppium('npx', ['appium', ...args], provider);
    }
    throw err;
  });
}

function spawnAppium(cmd: string, args: string[], provider: string): Promise<ChildProcess> {
  let emulatorStartRequested = false;
  return new Promise((resolve, reject) => {
    // Merge the taqwright-managed toolchain (from `taqwright install`) so the
    // spawned server + its UiAutomator2 driver find the vendored adb/JDK.
    // No-op when setup hasn't run. Covers the inspector-server path too
    // (it doesn't go through the CLI entry's applyManagedEnv()).
    const proc = spawnTool(cmd, args, {
      stdio: 'pipe',
      env: { ...process.env, ...(managedEnv() ?? {}) },
    });
    let settled = false;
    let stderrText = '';
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrText += text;
      logger.warn(text.trimEnd());
    });
    // On Windows we go through `shell: true`, so a missing binary does not emit
    // an `ENOENT` error event — the shell just exits non-zero. Surface that as
    // an ENOENT-tagged error before the server is up so startAppiumServer's
    // `appium` -> `npx appium` fallback still fires. POSIX keeps the direct
    // `error` event below.
    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      const err: NodeJS.ErrnoException = new Error(
        `Appium server "${cmd}" exited with code ${code ?? 'null'} before starting.`,
      );
      if (/not recognized|not found|ENOENT/i.test(stderrText)) err.code = 'ENOENT';
      reject(err);
    });
    proc.stdout?.on('data', async (data: Buffer) => {
      const output = data.toString();
      logger.log(output.trimEnd());

      if (output.includes('Error: listen EADDRINUSE')) {
        settled = true;
        reject(
          new Error('Appium server is already running on this port. Stop it before running tests.'),
        );
        return;
      }
      if (output.includes('Could not find online devices')) {
        if (!emulatorStartRequested && provider === 'emulator') {
          emulatorStartRequested = true;
          await startAndroidEmulator().catch((err) => logger.error(err));
        }
      }
      if (output.includes('Appium REST http interface listener started')) {
        settled = true;
        logger.log('Appium server is up and running.');
        resolve(proc);
      }
    });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    process.on('exit', () => proc.kill());
  });
}

export function stopAppiumServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec('pkill -f appium', (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

/** PIDs of processes listening on the given TCP port (macOS/Linux via lsof). */
async function getListenerPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execP(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
    return stdout
      .trim()
      .split('\n')
      .map((l) => Number.parseInt(l.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // lsof exits non-zero when nothing matches — treat as "no listener".
    return [];
  }
}

/** True if the given PID's command line looks like an Appium server. */
async function isAppiumProcess(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execP(`ps -p ${pid} -o command=`);
    return /appium/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Kill any Appium server listening on `port`, scoped strictly to Appium
 * processes — a non-Appium listener is left untouched. Best-effort: never
 * throws. Returns true if at least one Appium process was terminated.
 */
export async function killAppiumOnPort(port: number): Promise<boolean> {
  let killed = false;
  try {
    const pids = await getListenerPids(port);
    for (const pid of pids) {
      if (!(await isAppiumProcess(pid))) continue;
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        continue;
      }
      killed = true;
      // Give it a moment to exit gracefully, then SIGKILL any survivor.
      await new Promise((r) => setTimeout(r, 500));
      try {
        process.kill(pid, 0); // throws if the process is gone
        process.kill(pid, 'SIGKILL');
      } catch {
        // already exited — nothing to do
      }
    }
  } catch (err) {
    logger.warn(`Failed to kill Appium on port ${port}: ${String(err)}`);
  }
  return killed;
}

export function isEmulatorInstalled(platform: Platform): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (platform !== Platform.ANDROID) {
      // No-op for iOS — simulators are managed via Xcode/xcrun.
      return resolve(true);
    }
    const androidHome = process.env.ANDROID_HOME;
    if (!androidHome) {
      return reject(new Error('ANDROID_HOME is not set.'));
    }
    const emulatorPath = path.join(androidHome, 'emulator', 'emulator');
    exec(`${emulatorPath} -list-avds`, (err, stdout) => {
      if (err) {
        return reject(
          new Error('Could not list emulators. Install one via Android Studio AVD Manager.'),
        );
      }
      const lines = stdout
        .trim()
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('INFO') && !l.includes('/tmp/'));
      if (lines.length === 0) {
        return reject(
          new Error('No installed emulators found. Create one via Android Studio AVD Manager.'),
        );
      }
      resolve(true);
    });
  });
}

export async function startAndroidEmulator(): Promise<void> {
  const androidHome = process.env.ANDROID_HOME;
  if (!androidHome) throw new Error('ANDROID_HOME is not set.');
  const emulatorPath = path.join(androidHome, 'emulator', 'emulator');
  const { stdout } = await execP(`${emulatorPath} -list-avds`);
  const avds = stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('INFO') && !l.includes('/tmp/'));
  if (avds.length === 0) {
    throw new Error('No installed emulators found.');
  }
  const avd = avds[0]!;
  logger.log(`Starting emulator: ${avd}`);
  const child = spawn(emulatorPath, ['-avd', avd], { stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    child.stdout?.on('data', (data: Buffer) => {
      const out = data.toString();
      logger.log(`Emulator: ${out.trimEnd()}`);
      if (out.includes("Successfully loaded snapshot 'default_boot'")) {
        resolve();
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`Emulator exited with code ${code}`));
    });
    process.on('exit', () => child.kill());
  });
}

/** Resolve an `.app` (iOS) bundle id via macOS `osascript`. */
export function getAppBundleId(buildPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`osascript -e 'id of app "${buildPath}"'`, (err, stdout, stderr) => {
      if (err) return reject(err);
      if (stderr) return reject(new Error(stderr));
      const id = stdout.trim();
      if (!id) return reject(new Error('Bundle ID not found'));
      resolve(id);
    });
  });
}

export async function getConnectedIOSDeviceUDID(): Promise<string> {
  const { stdout } = await execP('xcrun xctrace list devices');
  const realDevices = stdout
    .split('\n')
    .filter((l) => l.includes('iPhone') && !l.includes('Simulator'));
  if (realDevices.length === 0) {
    throw new Error(
      'No connected iPhone detected. Make sure the device is plugged in and trusted.',
    );
  }
  const m = realDevices[0]!.match(/\(([\da-fA-F-]+)\)$/);
  if (!m || !m[1]) {
    throw new Error('Could not parse UDID from xctrace output.');
  }
  return m[1];
}

export async function getActiveAndroidDevices(): Promise<number> {
  const { stdout } = await execP('adb devices');
  return stdout
    .trim()
    .split('\n')
    .filter((l) => l.includes('\tdevice')).length;
}

async function getLatestBuildToolsVersion(): Promise<string> {
  const androidHome = process.env.ANDROID_HOME;
  if (!androidHome) throw new Error('ANDROID_HOME is not set.');
  const buildToolsPath = path.join(androidHome, 'build-tools');
  const files = await readdir(buildToolsPath);
  const versions = files.filter((f) => /^\d+\.\d+\.\d+(-rc\d+)?$/.test(f));
  const latest = getLatestBuildToolsVersions(versions);
  if (!latest) {
    throw new Error(
      `No valid build-tools found in ${buildToolsPath}. Install via Android Studio SDK Manager.`,
    );
  }
  return latest;
}

/**
 * Read package name + launchable activity out of an APK using `aapt`.
 */
export async function getApkDetails(buildPath: string): Promise<{
  packageName: string;
  launchableActivity: string;
}> {
  const androidHome = process.env.ANDROID_HOME;
  if (!androidHome) throw new Error('ANDROID_HOME is not set.');
  const buildTools = await getLatestBuildToolsVersion();
  const aapt = path.join(androidHome, 'build-tools', buildTools, 'aapt');
  const { stdout, stderr } = await execP(`${aapt} dump badging "${buildPath}"`);
  if (stderr) logger.warn(`aapt: ${stderr.trim()}`);
  const pkg = stdout.match(/package: name='(\S+)'/);
  const activity = stdout.match(/launchable-activity: name='(\S+)'/);
  if (!pkg || !activity) {
    throw new Error(`Unable to parse package / launchable-activity from APK: ${buildPath}`);
  }
  return { packageName: pkg[1]!, launchableActivity: activity[1]! };
}
