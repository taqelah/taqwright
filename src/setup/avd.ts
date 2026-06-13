import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Platform, type TaqwrightUseOptions } from '../types/index.js';
import { managedEnv, readManifest, systemAndroidHome } from './paths.js';

/**
 * The Android emulator AVD this `use` config will ask Appium to boot (a string
 * `device.name` on the `emulator` provider), or `undefined`. Used to pick the
 * right Android SDK for the Appium spawn — see {@link androidEnvForAvd}.
 */
export function bootableAvdName(use: TaqwrightUseOptions): string | undefined {
  const device = use.device as { provider?: string; name?: unknown };
  return use.platform === Platform.ANDROID &&
    device.provider === 'emulator' &&
    typeof device.name === 'string'
    ? device.name
    : undefined;
}

/**
 * Shared AVD ↔ system-image helpers. An AVD's `config.ini` records the system
 * image it boots as a path *relative to the SDK root* (`image.sysdir.1`), and
 * AVDs live globally in `$ANDROID_AVD_HOME` (default `~/.android/avd`) — not
 * inside any one SDK. So the same AVD can be present while the image it needs
 * is absent from the *active* `$ANDROID_HOME`. Both `taqwright doctor` and the
 * inspector's device picker key off this to tell bootable AVDs from foreign
 * ones, so the logic lives here once.
 */

/**
 * Canonicalize an AVD `image.sysdir.1` value: backslashes → forward slashes,
 * trailing separators removed. On Windows the value is written with `\` and a
 * trailing `\`, which would otherwise break the managed-SDK `existsSync` check
 * and yield a malformed `sdkmanager "system-images;…"` fix command. A no-op on
 * POSIX (values there are already forward-slash). Exported for testing.
 */
export function normalizeSysImagePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

/** The directory that holds AVD definitions (`<name>.avd/`). */
export function avdHomeDir(): string {
  return process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd');
}

/**
 * Read `<avdHome>/<avdName>.avd/config.ini` and return the normalized
 * `image.sysdir.1` (the SDK-relative system-image path the AVD boots), or
 * `undefined` if the config is missing/unreadable or has no such key.
 */
export async function readAvdSystemImage(
  avdName: string,
  avdHome: string = avdHomeDir(),
): Promise<string | undefined> {
  const configPath = path.join(avdHome, `${avdName}.avd`, 'config.ini');
  if (!existsSync(configPath)) return undefined;
  let content: string;
  try {
    content = await fs.readFile(configPath, 'utf-8');
  } catch {
    return undefined;
  }
  const m = content.match(/^image\.sysdir\.1\s*=\s*(.+)$/m);
  return m ? normalizeSysImagePath(m[1]!) : undefined;
}

/** True when `image` (an SDK-relative `image.sysdir.1`) exists under `androidHome`. */
export function isAvdImageInstalled(image: string, androidHome: string): boolean {
  return existsSync(path.join(androidHome, image));
}

/** SDK roots to search for an AVD's system image, in priority order, deduped. */
function candidateSdkRoots(): string[] {
  const roots: string[] = [];
  const managed = readManifest()?.androidHome;
  if (managed) roots.push(managed);
  if (process.env.ANDROID_HOME?.trim()) roots.push(process.env.ANDROID_HOME);
  const sys = systemAndroidHome();
  if (sys) roots.push(sys);
  return [...new Set(roots)];
}

/**
 * The SDK root that actually contains `avdName`'s system image, searching the
 * managed SDK, the active `ANDROID_HOME`, and the system SDK. Returns the image
 * (for messaging) and the first matching `sdkRoot` — `sdkRoot` is `undefined`
 * when no known SDK has the image (a broken AVD), and `image` is `undefined`
 * when the AVD's `config.ini` can't be read (caller proceeds best-effort).
 */
export async function resolveAvdSdk(
  avdName: string,
): Promise<{ image?: string; sdkRoot?: string }> {
  const image = await readAvdSystemImage(avdName);
  if (!image) return {};
  const sdkRoot = candidateSdkRoots().find((r) => isAvdImageInstalled(image, r));
  return { image, sdkRoot };
}

/**
 * The env overrides Appium (and the emulator boot) should be spawned with so a
 * given AVD boots against an SDK that actually contains its system image.
 *
 * Without a managed toolchain this is a no-op (`undefined`) — nothing overrides
 * the shell. With one, the default is {@link managedEnv}. But when the target
 * AVD's image is absent from the managed SDK yet present in the user's *system*
 * SDK (the classic "I picked my own emulator during init" case), we transparently
 * point `ANDROID_HOME`/`ANDROID_SDK_ROOT` + the emulator/platform-tools on `PATH`
 * at the system SDK — while keeping the managed JDK and vendored Appium/uiautomator2
 * driver. If the image is in neither SDK we return the managed env unchanged and
 * let {@link avdBootPreflightError} (or the boot itself) surface the error.
 */
export async function androidEnvForAvd(avdName?: string): Promise<NodeJS.ProcessEnv | undefined> {
  const base = managedEnv();
  if (!base || !avdName) return base; // no managed override, or nothing AVD-specific to do
  const managedHome = base.ANDROID_HOME!;
  const image = await readAvdSystemImage(avdName);
  if (!image || isAvdImageInstalled(image, managedHome)) return base; // managed SDK can boot it
  const sys = systemAndroidHome();
  if (!sys || !isAvdImageInstalled(image, sys)) return base; // image in neither → let it error
  // Transparent fallback: boot against the system SDK, keep the managed JDK/Appium.
  const binDirs = [
    path.join(base.JAVA_HOME!, 'bin'),
    path.join(sys, 'platform-tools'),
    path.join(sys, 'cmdline-tools', 'latest', 'bin'),
    path.join(sys, 'emulator'),
  ];
  const appiumBin = readManifest()?.appiumBin;
  if (appiumBin && existsSync(appiumBin)) binDirs.push(appiumBin);
  return {
    ...base,
    ANDROID_HOME: sys,
    ANDROID_SDK_ROOT: sys,
    PATH: binDirs.join(path.delimiter) + path.delimiter + (process.env.PATH ?? ''),
  };
}

/**
 * Pre-flight for an autoStartDevice cold boot: returns a clear, actionable error
 * string only when the named AVD's system image is absent from *both* the managed
 * SDK and the user's system SDK (so the emulator would die with "Broken AVD system
 * path"), else `null`. When the image lives in the system SDK, {@link androidEnvForAvd}
 * transparently boots against it, so this is not an error. Mirrors the doctor
 * `checkManagedSdkAvdImages` fixes, scoped to the single AVD being booted.
 */
export async function avdBootPreflightError(
  avdName: string,
  androidHome: string | undefined = process.env.ANDROID_HOME,
): Promise<string | null> {
  if (!androidHome) return null; // can't check — let the boot surface its own error
  const image = await readAvdSystemImage(avdName);
  if (!image || isAvdImageInstalled(image, androidHome)) return null; // unknown or fine
  const sys = systemAndroidHome();
  if (sys && isAvdImageInstalled(image, sys)) return null; // androidEnvForAvd will boot against it
  const sdkmanager = `sdkmanager "${image.replace(/\//g, ';')}"`;
  const head = `Cannot boot AVD "${avdName}": its system image "${image}" is not in the active SDK (ANDROID_HOME=${androidHome}).`;
  if (readManifest()) {
    const manifest = path.join(path.dirname(androidHome), 'manifest.json');
    return (
      `${head}\n` +
      'A managed taqwright toolchain is overriding ANDROID_HOME, but this AVD belongs to your system SDK. Fix one of:\n' +
      `  (a) use your system SDK — \`rm ${manifest}\` (drops the managed override), then re-run;\n` +
      `  (b) install the image into the managed SDK — \`${sdkmanager}\`;\n` +
      "  (c) point device.name at a managed AVD (e.g. 'taqwright_api34')."
    );
  }
  return `${head}\nInstall it with \`${sdkmanager}\`, or recreate the AVD against an installed image.`;
}
