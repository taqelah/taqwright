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
    Object.assign(process.env, m);
    process.env.__TAQWRIGHT_MANAGED_APPLIED = '1';
  }
}
