import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
