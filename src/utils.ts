import { existsSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * A build reference that lives somewhere other than the local filesystem —
 * `http(s)://`, or any cloud grid's prebuilt scheme (`bs://`, `lt://`,
 * `cloud:`, `pcloudy:`, …). Matched generically rather than from a hardcoded
 * list: that list silently went stale as grids were added, and a reference
 * like `pcloudy:App.apk` then failed the local-file check below with a
 * misleading "Build file not found".
 *
 * The `[a-z0-9+.-]+` (one or more, not zero) requires at least two characters
 * before the colon, so a Windows drive letter (`C:\builds\app.apk`) is still
 * treated as a local path.
 */
const REMOTE_BUILD_REF = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Throws if `buildPath` is missing or doesn't end in the expected extension.
 * Remote references (see `REMOTE_BUILD_REF`) skip both checks — they are
 * resolved by the grid, not by us.
 */
export function validateBuildPath(buildPath: string | undefined, expectedExt: string): void {
  if (!buildPath) {
    throw new Error('Build path not found. Please set `buildPath` in your taqwright config.');
  }
  if (!REMOTE_BUILD_REF.test(buildPath)) {
    if (!existsSync(buildPath)) {
      throw new Error(`Build file not found: ${buildPath}`);
    }
    const ext = extname(buildPath).toLowerCase();
    if (ext !== expectedExt.toLowerCase()) {
      throw new Error(
        `Build path "${buildPath}" must end in ${expectedExt}, got ${ext || '(no extension)'}`,
      );
    }
  }
}

/**
 * Picks the highest semver build-tools directory from a list. Used to find
 * the right `aapt` binary under $ANDROID_HOME/build-tools.
 */
export function getLatestBuildToolsVersions(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  const cmp = (a: string, b: string) => {
    const pa = a.split('-')[0]!.split('.').map(Number);
    const pb = b.split('-')[0]!.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const av = pa[i] ?? 0;
      const bv = pb[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    // stable; non-rc beats rc on tie
    const aRc = a.includes('-rc');
    const bRc = b.includes('-rc');
    if (aRc !== bRc) return aRc ? -1 : 1;
    return 0;
  };
  return [...versions].sort(cmp).pop();
}
