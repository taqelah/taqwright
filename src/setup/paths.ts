import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The on-disk manifest written by `taqwright install`. Records the resolved
 * homes so {@link managedEnv} stays cheap + synchronous (no filesystem
 * scanning on the hot path).
 */
export interface ManagedManifest {
  androidHome: string;
  javaHome: string;
  /** Directory containing the managed `appium` binary (node_modules/.bin). */
  appiumBin?: string;
}

/**
 * Root of the taqwright-managed toolchain (Playwright-browsers pattern).
 * Overridable via `TAQWRIGHT_HOME`; otherwise the per-OS cache dir.
 */
export function taqwrightHome(): string {
  const override = process.env.TAQWRIGHT_HOME;
  if (override && override.trim()) return path.resolve(override);
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'taqwright');
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'taqwright');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'taqwright');
}

export const androidSdkDir = (): string => path.join(taqwrightHome(), 'android-sdk');
export const jdkDir = (): string => path.join(taqwrightHome(), 'jdk');
export const appiumDir = (): string => path.join(taqwrightHome(), 'appium');
/** APPIUM_HOME for the managed install — keeps drivers vendored, not in ~/.appium. */
export const appiumHomeDir = (): string => path.join(taqwrightHome(), 'appium-home');
export const downloadCacheDir = (): string => path.join(taqwrightHome(), 'downloads');
export const manifestPath = (): string => path.join(taqwrightHome(), 'manifest.json');

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/**
 * The user's *system* Android SDK, recoverable even after {@link applyManagedEnv}
 * has overridden `ANDROID_HOME` with the managed toolchain. Resolution order:
 *   1. `TAQWRIGHT_SYSTEM_ANDROID_HOME` — the shell value captured before the
 *      managed override (set by {@link applyManagedEnv}, inherited by workers);
 *   2. the live `ANDROID_HOME` when no managed override is in effect;
 *   3. the default Android Studio SDK location for the platform, so a system AVD
 *      still resolves even when the user never exported `ANDROID_HOME`.
 * Returns `undefined` if none can be found.
 */
export function systemAndroidHome(): string | undefined {
  const captured = process.env.TAQWRIGHT_SYSTEM_ANDROID_HOME;
  if (captured && captured.trim()) return captured;
  if (!readManifest() && process.env.ANDROID_HOME?.trim()) return process.env.ANDROID_HOME;
  const home = os.homedir();
  const candidates =
    process.platform === 'darwin'
      ? [path.join(home, 'Library', 'Android', 'sdk')]
      : process.platform === 'win32'
        ? [
            path.join(
              process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
              'Android',
              'Sdk',
            ),
          ]
        : [path.join(home, 'Android', 'Sdk')];
  return candidates.find((c) => existsSync(c));
}

export function readManifest(): ManagedManifest | undefined {
  try {
    const f = manifestPath();
    if (!existsSync(f)) return undefined;
    const m = JSON.parse(readFileSync(f, 'utf8')) as ManagedManifest;
    if (!m || !m.androidHome || !m.javaHome) return undefined;
    return m;
  } catch {
    return undefined;
  }
}

/**
 * Env overrides pointing at the taqwright-managed Android SDK + JDK, or
 * `undefined` when `taqwright install` has not provisioned them — so nothing
 * changes for users who never ran it. Cheap + synchronous (manifest read).
 */
export function managedEnv(): NodeJS.ProcessEnv | undefined {
  const m = readManifest();
  if (!m) return undefined;
  const adb = path.join(m.androidHome, 'platform-tools', exe('adb'));
  const java = path.join(m.javaHome, 'bin', exe('java'));
  if (!existsSync(adb) || !existsSync(java)) return undefined;
  const binDirs = [
    path.join(m.javaHome, 'bin'),
    path.join(m.androidHome, 'platform-tools'),
    path.join(m.androidHome, 'cmdline-tools', 'latest', 'bin'),
    path.join(m.androidHome, 'emulator'),
  ];
  if (m.appiumBin) binDirs.push(m.appiumBin);
  return {
    ANDROID_HOME: m.androidHome,
    ANDROID_SDK_ROOT: m.androidHome,
    JAVA_HOME: m.javaHome,
    // So the runtime-spawned Appium loads the vendored uiautomator2 driver
    // (not whatever happens to be in the user's ~/.appium).
    APPIUM_HOME: appiumHomeDir(),
    PATH: binDirs.join(path.delimiter) + path.delimiter + (process.env.PATH ?? ''),
  };
}

/**
 * Idempotently merge {@link managedEnv} into `process.env` so every child
 * process taqwright spawns (Appium, adb, emulator, sdkmanager) inherits the
 * vendored toolchain — no shell-rc edits required. No-op when `install` hasn't
 * run. Guarded so repeated calls don't re-prepend PATH.
 */
export function applyManagedEnv(): void {
  if (process.env.__TAQWRIGHT_MANAGED_APPLIED === '1') return;
  const m = managedEnv();
  if (m) {
    // Capture the shell's ANDROID_HOME before we clobber it, so a user-selected
    // AVD whose system image lives in the *system* SDK can still be booted (see
    // androidEnvForAvd). Set-once; inherited by spawned Playwright workers.
    if (!process.env.TAQWRIGHT_SYSTEM_ANDROID_HOME && process.env.ANDROID_HOME?.trim()) {
      process.env.TAQWRIGHT_SYSTEM_ANDROID_HOME = process.env.ANDROID_HOME;
    }
    Object.assign(process.env, m);
    process.env.__TAQWRIGHT_MANAGED_APPLIED = '1';
  }
}
