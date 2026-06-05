import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';

/**
 * Wrap a token in double-quotes when it needs it (spaces, shell metacharacters,
 * a `C:\Program Files\…` path, etc.). Required because `shell: true` on Windows
 * runs `cmd.exe /c "<line>"` and does **not** auto-quote the joined arguments.
 * Exported for unit testing — the spawn side is intentionally not unit-covered.
 */
export function quoteWin(tok: string): string {
  return /[\s&()[\]{}^=;!'+,`~]/.test(tok) ? `"${tok}"` : tok;
}

/**
 * Cross-platform replacement for `child_process.spawn` that survives patched
 * Node (CVE-2024-27980): since Node ≥18.20.2 / 20.12.2 / 22 / 24, `spawn`
 * refuses to launch a `.cmd`/`.bat` shim unless `shell: true` is set — it
 * throws `spawn EINVAL`. So on Windows we go through the shell with a single
 * pre-quoted command line (and `PATHEXT` resolves the `.cmd`/`.bat` from the
 * base name); on POSIX we keep the normal argv spawn unchanged.
 */
export function spawnTool(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  if (process.platform === 'win32') {
    const line = [cmd, ...args].map(quoteWin).join(' ');
    return spawn(line, { ...opts, shell: true });
  }
  return spawn(cmd, args, opts);
}
