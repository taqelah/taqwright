import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readManifest } from './paths.js';

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

/**
 * Pre-flight for an autoStartDevice cold boot: returns a clear, actionable error
 * string if the named AVD's system image is absent from the active `ANDROID_HOME`
 * (so the emulator would die with "Broken AVD system path"), else `null`. The
 * usual cause is a managed taqwright SDK overriding `ANDROID_HOME` while the AVD
 * belongs to the user's system SDK. Mirrors the doctor `checkManagedSdkAvdImages`
 * fixes, scoped to the single AVD being booted.
 */
export async function avdBootPreflightError(
  avdName: string,
  androidHome: string | undefined = process.env.ANDROID_HOME,
): Promise<string | null> {
  if (!androidHome) return null; // can't check — let the boot surface its own error
  const image = await readAvdSystemImage(avdName);
  if (!image || isAvdImageInstalled(image, androidHome)) return null; // unknown or fine
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
