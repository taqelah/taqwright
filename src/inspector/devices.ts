import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { manifestPath, readManifest } from '../setup/paths.js';
import { avdHomeDir, isAvdImageInstalled, readAvdSystemImage } from '../setup/avd.js';

const execFileP = promisify(execFile);

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
}

export interface DeviceListing {
  android: Device[];
  ios: Device[];
  toolsMissing: { adb?: boolean; emulator?: boolean; xcrun?: boolean };
  /**
   * Shutdown Android AVDs hidden from `android` because their system image
   * isn't in the active (managed) SDK, so the managed emulator can't boot them.
   * Present only when a managed SDK is active and ≥1 AVD was hidden — lets the
   * UI explain why and point at the manifest to delete.
   */
  hiddenAndroid?: { names: string[]; manifestPath: string };
}

// ─── Discovery ────────────────────────────────────────────────────

export async function listDevices(): Promise<DeviceListing> {
  const [androidAll, ios, toolsMissing] = await Promise.all([
    listAndroid().catch(() => [] as Device[]),
    process.platform === 'darwin' ? listIos().catch(() => [] as Device[]) : Promise.resolve([]),
    detectMissingTools(),
  ]);
  const { android, hiddenAndroid } = await filterAndroidByActiveSdk(androidAll);
  return { android, ios, toolsMissing, hiddenAndroid };
}

/**
 * When a managed SDK is active (a `manifest.json` exists and overrode
 * `ANDROID_HOME`), drop *shutdown* AVDs whose system image isn't installed in
 * that SDK — the managed `emulator` can't boot them (it hangs on a never-
 * resolving "Trying to find <avd>" loop). Booted/online emulators are kept (an
 * already-running device is usable regardless of which SDK started it). With no
 * manifest, the user's own SDK is active — return everything unfiltered.
 */
async function filterAndroidByActiveSdk(
  devices: Device[],
): Promise<{ android: Device[]; hiddenAndroid?: DeviceListing['hiddenAndroid'] }> {
  const androidHome = process.env.ANDROID_HOME;
  if (!readManifest() || !androidHome) return { android: devices };

  const avdHome = avdHomeDir();
  const kept: Device[] = [];
  const hidden: string[] = [];
  for (const dev of devices) {
    // Keep anything already running, or that we can't tie to an AVD config.
    if (dev.state !== 'shutdown' || !dev.avdName) {
      kept.push(dev);
      continue;
    }
    const image = await readAvdSystemImage(dev.avdName, avdHome);
    // Unknown image → don't hide (avoid dropping a device on a parse miss).
    if (image === undefined || isAvdImageInstalled(image, androidHome)) {
      kept.push(dev);
    } else {
      hidden.push(dev.name);
    }
  }

  if (hidden.length === 0) return { android: kept };
  return { android: kept, hiddenAndroid: { names: hidden, manifestPath: manifestPath() } };
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
        /* ignore */
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
  if (!(await commandExists('emulator'))) {
    throw new Error('`emulator` is not on PATH. Install Android SDK command-line tools and retry.');
  }
  // Detached so the boot survives our process. The user can stop it via
  // the Devices card or `adb -s <serial> emu kill`.
  const child = spawn('emulator', ['-avd', avdName], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export async function stopAndroidEmulator(serial: string): Promise<void> {
  if (!serial.startsWith('emulator-')) {
    throw new Error(`Cannot stop a device that isn't an emulator (got: ${serial}).`);
  }
  await execFileP('adb', ['-s', serial, 'emu', 'kill']);
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
