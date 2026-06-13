import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { androidEnvForAvd, resolveAvdSdk } from '../setup/avd.js';

const execFileP = promisify(execFile);

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

export type DeviceState = 'booted' | 'shutdown' | 'booting' | 'unknown';

export interface Device {
  type: 'android' | 'ios';
  /** Stable identifier. Android: emulator serial (`emulator-5554`) or AVD name when shutdown. iOS: UDID. */
  udid: string;
  /** Human-readable name (Pixel 6 / iPhone 15 …). */
  name: string;
  /** OS version string when known (`14`, `17.5`). Empty for shutdown Androids — we'd need to parse the AVD config. */
  osVersion?: string;
  state: DeviceState;
  /** Android-only: the AVD config name, used to boot the emulator. */
  avdName?: string;
  /** iOS-only: the simulator runtime ID (e.g. `com.apple.CoreSimulator.SimRuntime.iOS-17-5`). */
  runtime?: string;
  /**
   * `false` when a shutdown AVD's system image is installed in no known SDK, so
   * it cannot boot (the UI disables Start + shows {@link bootHint}). Left
   * `undefined` for bootable / running devices.
   */
  bootable?: boolean;
  /** Short reason an AVD is unbootable (shown in the picker). */
  bootHint?: string;
}

export interface DeviceListing {
  android: Device[];
  ios: Device[];
  toolsMissing: { adb?: boolean; emulator?: boolean; xcrun?: boolean };
}

// ─── Discovery ────────────────────────────────────────────────────

export async function listDevices(): Promise<DeviceListing> {
  const [androidAll, ios, toolsMissing] = await Promise.all([
    listAndroid().catch(() => [] as Device[]),
    process.platform === 'darwin' ? listIos().catch(() => [] as Device[]) : Promise.resolve([]),
    detectMissingTools(),
  ]);
  const android = await annotateAndroidBootability(androidAll);
  return { android, ios, toolsMissing };
}

/**
 * Flag *shutdown* Android AVDs whose system image is installed in **no** known
 * SDK (managed / `ANDROID_HOME` / system) — nothing can boot them — with
 * `bootable: false` + a `bootHint`, so the picker can disable Start and explain
 * why instead of leading into a doomed boot. AVDs whose image lives in *some*
 * SDK are left untouched (taqwright boots them against the right SDK; see
 * {@link androidEnvForAvd} / {@link resolveAvdSdk}). Running devices and AVDs we
 * can't tie to a config are left as-is. Returns all devices (no hiding).
 */
export async function annotateAndroidBootability(devices: Device[]): Promise<Device[]> {
  const out: Device[] = [];
  for (const dev of devices) {
    if (dev.state !== 'shutdown' || dev.type !== 'android' || !dev.avdName) {
      out.push(dev);
      continue;
    }
    const { image, sdkRoot } = await resolveAvdSdk(dev.avdName);
    if (image && !sdkRoot) {
      out.push({
        ...dev,
        bootable: false,
        bootHint: `system image "${image}" is not installed in any Android SDK`,
      });
    } else {
      out.push(dev);
    }
  }
  return out;
}

async function detectMissingTools(): Promise<DeviceListing['toolsMissing']> {
  const out: DeviceListing['toolsMissing'] = {};
  if (!(await commandExists('adb'))) out.adb = true;
  if (!(await commandExists('emulator'))) out.emulator = true;
  if (process.platform === 'darwin' && !(await commandExists('xcrun'))) out.xcrun = true;
  return out;
}

// ─── Android ──────────────────────────────────────────────────────

async function listAndroid(): Promise<Device[]> {
  // 1. Configured AVDs (whether running or not).
  const avds = (await commandExists('emulator')) ? await runningAvds() : [];

  // 2. Currently-online devices via adb.
  const online = (await commandExists('adb'))
    ? await onlineAdbDevices()
    : new Map<string, OnlineDevice>();

  const out: Device[] = [];
  const claimedSerials = new Set<string>();

  // For each AVD, find its serial if any live emulator advertises it. The
  // `qemu.avd_name` device property is the canonical link.
  for (const avd of avds) {
    let serial: string | undefined;
    let osVersion: string | undefined;
    for (const [s, info] of online) {
      if (info.avdName === avd) {
        serial = s;
        osVersion = info.osVersion;
        claimedSerials.add(s);
        break;
      }
    }
    out.push({
      type: 'android',
      udid: serial ?? `avd:${avd}`,
      name: avd.replaceAll('_', ' '),
      osVersion,
      state: serial ? 'booted' : 'shutdown',
      avdName: avd,
    });
  }

  // Online emulators we couldn't tie back to an AVD (rare — probably
  // started outside `emulator` CLI). Surface them anyway.
  for (const [serial, info] of online) {
    if (claimedSerials.has(serial)) continue;
    out.push({
      type: 'android',
      udid: serial,
      name: info.avdName ?? serial,
      osVersion: info.osVersion,
      state: 'booted',
      avdName: info.avdName,
    });
  }

  return out;
}

async function runningAvds(): Promise<string[]> {
  try {
    const { stdout } = await execFileP('emulator', ['-list-avds']);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

interface OnlineDevice {
  avdName?: string;
  osVersion?: string;
}

async function onlineAdbDevices(): Promise<Map<string, OnlineDevice>> {
  const out = new Map<string, OnlineDevice>();
  let stdout: string;
  try {
    ({ stdout } = await execFileP('adb', ['devices', '-l']));
  } catch {
    return out;
  }
  const lines = stdout.split('\n').slice(1);
  const serials: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+device\b/);
    if (m) serials.push(m[1]!);
  }
  // Resolve avd_name + version per serial (parallel).
  await Promise.all(
    serials.map(async (serial) => {
      const info: OnlineDevice = {};
      // Liveness gate. adb keeps a just-closed emulator in state `device` for a
      // beat after its process dies (the transport teardown lags), so the row
      // above passes the `device` filter while the device is actually gone.
      // Such a zombie answers no shell command — its avd_name never resolves —
      // so `listAndroid` can't tie it to an AVD and the unclaimed-online
      // fallback surfaces it as a phantom bare-serial device ("emulator-5554").
      // This getprop is the cheapest round-trip to adbd: a live device
      // (emulator or physical, even mid-boot) answers it the instant adb reports
      // `device`; a dead transport throws. So treat a throw as "not online" and
      // drop the serial.
      try {
        const { stdout: name } = await execFileP('adb', [
          '-s',
          serial,
          'shell',
          'getprop',
          'ro.boot.qemu.avd_name',
        ]);
        const trimmed = name.trim();
        if (trimmed) info.avdName = trimmed;
      } catch {
        return;
      }
      if (!info.avdName) {
        try {
          const { stdout: name } = await execFileP('adb', ['-s', serial, 'emu', 'avd', 'name']);
          info.avdName = name.split('\n')[0]?.trim();
        } catch {
          /* ignore */
        }
      }
      try {
        const { stdout: ver } = await execFileP('adb', [
          '-s',
          serial,
          'shell',
          'getprop',
          'ro.build.version.release',
        ]);
        info.osVersion = ver.trim();
      } catch {
        /* ignore */
      }
      out.set(serial, info);
    }),
  );
  return out;
}

export async function startAndroidEmulator(avdName: string): Promise<void> {
  // Boot against the SDK that actually contains this AVD's system image (managed
  // / ANDROID_HOME / system). Fail fast + clearly when no SDK has it instead of
  // handing the emulator a doomed root and relying on its raw FATAL.
  const { image, sdkRoot } = await resolveAvdSdk(avdName);
  if (image && !sdkRoot) {
    throw new Error(
      `Cannot boot "${avdName}": its system image "${image}" is not installed in any Android ` +
        `SDK (checked the managed SDK, ANDROID_HOME, and your system SDK). Install it with ` +
        `\`sdkmanager "${image.replace(/\//g, ';')}"\`, or recreate the AVD against an installed image.`,
    );
  }
  // Merge onto process.env — androidEnvForAvd / managedEnv return only the SDK/JDK
  // keys, so passing them raw would strip SystemRoot/TEMP/… and break the child on
  // Windows. Then pin ANDROID_HOME/ANDROID_SDK_ROOT to the SDK that has the image
  // (so the emulator binary + image resolution agree).
  const env = { ...process.env, ...((await androidEnvForAvd(avdName)) ?? {}) };
  if (sdkRoot) {
    env.ANDROID_HOME = sdkRoot;
    env.ANDROID_SDK_ROOT = sdkRoot;
  } else if (env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
    env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
  }

  const resolved = env.ANDROID_HOME
    ? path.join(env.ANDROID_HOME, 'emulator', exe('emulator'))
    : undefined;
  const cmd = resolved && existsSync(resolved) ? resolved : 'emulator';
  if (cmd === 'emulator' && !(await commandExists('emulator'))) {
    throw new Error(
      'No Android SDK found to boot the emulator — set ANDROID_HOME (or run `taqwright install`).',
    );
  }
  // POSIX: detach so the boot survives our process (own session). Windows: do
  // NOT detach — DETACHED_PROCESS leaves the console-subsystem `emulator.exe`
  // with no console, so it AllocConsole()s a *visible* config-dump window.
  // Sharing our console (detached:false) + piped stdio (the dump goes to the
  // drained pipes below) keeps that window from ever appearing. Crucially we do
  // NOT set `windowsHide` — it maps to STARTF_USESHOWWINDOW/SW_HIDE, which the
  // emulator's Qt GUI honors and would hide the emulator window itself. The
  // emulator still outlives us on Windows (no auto-kill of children); stop it via
  // the Devices card / `adb emu kill`. Mirrors the runner's `stdio:'pipe'` launch.
  const child = spawn(cmd, ['-avd', avdName], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  // Surface an *immediate* launch failure (bad SDK root, missing system image,
  // ENOENT) within a short grace window so the UI shows a real error instead of
  // spinning on "booting" for 90 s. After the window, let it keep booting in the
  // background (the UI polls /api/devices for full boot). The emulator prints its
  // reason ("Broken AVD system path", "Cannot find AVD", …) to *stdout* on
  // Windows, so capture both streams. Stop buffering after the window — draining
  // (not destroying) avoids an EPIPE that could kill the emulator.
  let out = '';
  const accumulate = (d: Buffer): void => {
    out += d.toString();
  };
  child.stdout?.on('data', accumulate);
  child.stderr?.on('data', accumulate);
  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onExit = (code: number | null): void => {
      done();
      const tail = out.trim().split('\n').slice(-12).join('\n');
      reject(
        new Error(
          `Emulator "${avdName}" exited (code ${code ?? 'null'}) during startup.` +
            (tail ? `\n${tail}` : ''),
        ),
      );
    };
    const onError = (err: Error): void => {
      done();
      reject(err);
    };
    const timer = setTimeout(() => {
      done();
      child.stdout?.off('data', accumulate);
      child.stderr?.off('data', accumulate);
      child.stdout?.resume(); // keep draining without buffering
      child.stderr?.resume();
      child.unref();
      resolve();
    }, 4000);
    child.once('exit', onExit);
    child.once('error', onError);
  });

  // Best-effort: the emulator opens its window at its remembered (often tiny)
  // size and there's no CLI flag to maximize it, so on Windows nudge the window
  // to maximized once it appears. Fire-and-forget + cosmetic — never blocks or
  // throws; a no-op everywhere else.
  if (process.platform === 'win32') maximizeEmulatorWindowWindows();
}

/**
 * Windows-only, best-effort: poll for the emulator's top-level window and
 * `ShowWindow(SW_MAXIMIZE)` it (the Qt window has no remembered size flag we can
 * pass at launch). Runs a detached, console-hidden PowerShell helper so it never
 * touches the boot flow; swallows all errors. The Qt window may ignore it.
 */
function maximizeEmulatorWindowWindows(): void {
  // Poll up to ~30s for a process whose main window is the Android Emulator and
  // maximize it. SW_MAXIMIZE = 3. Passed via -EncodedCommand (base64 UTF-16LE) to
  // sidestep all shell quoting.
  const ps = [
    'Add-Type @"',
    'using System;using System.Runtime.InteropServices;',
    'public class TwWin{',
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);',
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);}',
    '"@',
    '$deadline=(Get-Date).AddSeconds(30)',
    'while((Get-Date) -lt $deadline){',
    '  $p=Get-Process | Where-Object {$_.MainWindowTitle -like "*Android Emulator*" -and $_.MainWindowHandle -ne 0} | Select-Object -First 1',
    '  if($p){ [TwWin]::ShowWindow($p.MainWindowHandle,3) | Out-Null; [TwWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; break }',
    '  Start-Sleep -Milliseconds 1000',
    '}',
  ].join('\n');
  try {
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.on('error', () => {});
    child.unref();
  } catch {
    /* best-effort cosmetic — ignore */
  }
}

export async function stopAndroidEmulator(serial: string): Promise<void> {
  if (!serial.startsWith('emulator-')) {
    throw new Error(`Cannot stop a device that isn't an emulator (got: ${serial}).`);
  }
  await execFileP('adb', ['-s', serial, 'emu', 'kill']);
}

/** First online serial whose resolved AVD name matches `avdName` (exact). */
export function findSerialForAvd(
  online: Map<string, { avdName?: string }>,
  avdName: string,
): string | undefined {
  for (const [serial, info] of online) {
    if (info.avdName === avdName) return serial;
  }
  return undefined;
}

/** Is the device fully ready for app install — booted AND PackageManager up? */
async function isAndroidDeviceReady(serial: string): Promise<boolean> {
  try {
    const { stdout: booted } = await execFileP('adb', [
      '-s',
      serial,
      'shell',
      'getprop',
      'sys.boot_completed',
    ]);
    if (booted.trim() !== '1') return false;
    // `pm path android` only answers once the PackageManager is up; this is the
    // gate that prevents the "device offline" / failed `adb install` race where
    // an emulator reports online before its package service is ready.
    const { stdout: pmPath } = await execFileP('adb', [
      '-s',
      serial,
      'shell',
      'pm',
      'path',
      'android',
    ]);
    return pmPath.includes('package:');
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ensure an emulator running `avdName` exists and is fully ready for app
 * install, booting it (`emulator -avd <name>`) if it isn't online yet.
 * Resolves with the device serial. Booting before any worker session avoids the
 * race where N workers cold-boot their AVDs concurrently and one starts
 * installing before its PackageManager is ready. Mirrors the iOS pre-boot in
 * `discovery-setup.ts`.
 */
export async function ensureAndroidAvdReady(
  avdName: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;

  let serial = findSerialForAvd(await onlineAdbDevices(), avdName);
  if (!serial) {
    await startAndroidEmulator(avdName);
    // Wait for the freshly-booted emulator's serial to show up in adb.
    while (!serial && Date.now() < deadline) {
      await sleep(2000);
      serial = findSerialForAvd(await onlineAdbDevices(), avdName);
    }
    if (!serial) {
      throw new Error(
        `taqwright: AVD "${avdName}" did not come online within ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
  }

  await execFileP('adb', ['-s', serial, 'wait-for-device']).catch(() => {
    /* fall through to the readiness poll */
  });
  while (Date.now() < deadline) {
    if (await isAndroidDeviceReady(serial)) return serial;
    await sleep(2000);
  }
  throw new Error(
    `taqwright: emulator ${serial} (AVD "${avdName}") was not ready (boot_completed + ` +
      `PackageManager) within ${Math.round(timeoutMs / 1000)}s.`,
  );
}

/**
 * Best-effort wait for an already-known emulator/device serial to be online
 * (adb state `device`, not `offline`) AND fully ready (boot_completed +
 * PackageManager). Unlike {@link ensureAndroidAvdReady} this never boots and
 * never throws — it returns `false` on timeout so the caller can decide. Used
 * as a per-session gate to ride out a transient mid-run "device offline" blip
 * before (re)creating the WebDriver session.
 */
export async function waitForAndroidDeviceReady(
  serial: string,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // onlineAdbDevices only lists serials in adb state `device` — an `offline`
    // (or absent) serial won't appear, so this also waits out offline→online.
    if ((await onlineAdbDevices()).has(serial) && (await isAndroidDeviceReady(serial))) {
      return true;
    }
    await sleep(1500);
  }
  return false;
}

/**
 * Resolve the adb serial for an Android target: the configured `udid` when it's
 * a real serial, otherwise the serial of the online emulator running `avdName`.
 * Returns `undefined` when nothing matches (e.g. an autoStartDevice cold start
 * where the emulator isn't up yet — Appium owns that boot).
 */
export async function resolveAndroidSerial(opts: {
  udid?: string;
  avdName?: string;
}): Promise<string | undefined> {
  const { udid, avdName } = opts;
  if (udid && !udid.startsWith('avd:')) return udid;
  if (avdName) return findSerialForAvd(await onlineAdbDevices(), avdName);
  return undefined;
}

/**
 * Does this WebDriver/adb error look like a transient device blip worth
 * retrying (vs a deterministic failure like a bad APK or a real test error)?
 * Pure — classifies by message signature.
 */
export function isTransientDeviceError(message: string): boolean {
  return [
    /device offline/i,
    /was not in the list of connected devices/i,
    /io\.appium\.settings/i,
    /error executing adbexec/i,
    /cannot start the .* application/i,
    /device unauthorized/i,
  ].some((re) => re.test(message));
}

// ─── iOS ──────────────────────────────────────────────────────────

async function listIos(): Promise<Device[]> {
  if (!(await commandExists('xcrun'))) return [];
  let stdout: string;
  try {
    ({ stdout } = await execFileP('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
  } catch {
    return [];
  }
  let parsed: {
    devices: Record<
      string,
      Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>
    >;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const out: Device[] = [];
  for (const [runtimeKey, entries] of Object.entries(parsed.devices ?? {})) {
    const osVersion = parseRuntimeVersion(runtimeKey);
    for (const entry of entries) {
      if (entry.isAvailable === false) continue;
      out.push({
        type: 'ios',
        udid: entry.udid,
        name: entry.name,
        osVersion,
        state: stateFromSimctl(entry.state),
        runtime: runtimeKey,
      });
    }
  }
  // Sort: booted first, then by name.
  out.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'booted' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

function parseRuntimeVersion(runtimeKey: string): string | undefined {
  // e.g. "com.apple.CoreSimulator.SimRuntime.iOS-17-5" → "17.5"
  const m = runtimeKey.match(/iOS-(\d+)-(\d+)$/);
  return m ? `${m[1]}.${m[2]}` : undefined;
}

function stateFromSimctl(s: string): DeviceState {
  switch (s) {
    case 'Booted':
      return 'booted';
    case 'Shutdown':
      return 'shutdown';
    case 'Booting':
      return 'booting';
    default:
      return 'unknown';
  }
}

export async function startIosSimulator(udid: string): Promise<void> {
  if (!(await commandExists('xcrun'))) {
    throw new Error('`xcrun` is not on PATH (Xcode command-line tools missing).');
  }
  // `simctl boot` brings the runtime up; `open -a Simulator` makes the
  // window visible. Both are idempotent.
  await execFileP('xcrun', ['simctl', 'boot', udid]).catch((err) => {
    if (!/already booted|state: Booted/i.test(String(err.stderr ?? err.message ?? ''))) throw err;
  });
  await execFileP('open', ['-a', 'Simulator']).catch(() => {
    /* best-effort */
  });
}

export async function stopIosSimulator(udid: string): Promise<void> {
  await execFileP('xcrun', ['simctl', 'shutdown', udid]);
}

// ─── Helpers ──────────────────────────────────────────────────────

async function commandExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [name], {
      stdio: 'ignore',
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
