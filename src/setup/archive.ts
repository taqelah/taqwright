import { createWriteStream, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

/**
 * Stream a URL to a file (follows redirects — Adoptium/Google CDN both 302).
 * Pass `signal` (e.g. `AbortSignal.timeout(ms)`) to bound a stalled connection;
 * an abort surfaces as a rejection the caller can degrade on.
 */
export async function download(url: string, destFile: string, signal?: AbortSignal): Promise<void> {
  mkdirSync(path.dirname(destFile), { recursive: true });
  const res = await fetch(url, { redirect: 'follow', signal });
  if (!res.ok || !res.body) {
    throw new Error(`download failed (HTTP ${res.status}) — ${url}`);
  }
  // res.body is a web ReadableStream; Node's Readable.fromWeb consumes it.
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(destFile),
  );
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (code) => resolve(code ?? 1));
    p.on('error', reject);
  });
}

/**
 * Extract `.tar.gz`/`.tgz` (JDK on mac/linux) or `.zip` (Android
 * cmdline-tools everywhere; JDK on Windows). No runtime dependency added:
 * `tar` is ubiquitous (mac/linux GNU/BSD, Windows 10+ bsdtar); for `.zip`
 * prefer `unzip`, fall back to bsdtar (`tar -xf` extracts zip on mac/win).
 */
export async function extract(archiveFile: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  const lower = archiveFile.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    if ((await run('tar', ['-xzf', archiveFile, '-C', destDir])) !== 0) {
      throw new Error(`tar extraction failed for ${archiveFile}`);
    }
    return;
  }
  if (lower.endsWith('.zip')) {
    try {
      if ((await run('unzip', ['-q', archiveFile, '-d', destDir])) === 0) return;
    } catch {
      /* `unzip` not on PATH — fall through to bsdtar */
    }
    if ((await run('tar', ['-xf', archiveFile, '-C', destDir])) === 0) return;
    throw new Error(
      `could not unzip ${archiveFile} — install \`unzip\` ` +
        '(Linux: `sudo apt-get install unzip`) and re-run `taqwright install`.',
    );
  }
  throw new Error(`unsupported archive type: ${archiveFile}`);
}
