/**
 * `taqwright telemetry enable|disable` remembers the choice in `~/.taqwright/telemetry.json`
 * as `{ "enabled": false }`. That is the only thing telemetry ever writes to disk — no id, no
 * history. Unreadable or absent means "no choice made".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function telemetryStorePath(home: string = homedir()): string {
  return join(home, '.taqwright', 'telemetry.json');
}

export function readStoredTelemetry(home?: string): boolean | undefined {
  try {
    const v = JSON.parse(readFileSync(telemetryStorePath(home), 'utf8')) as { enabled?: unknown };
    return typeof v.enabled === 'boolean' ? v.enabled : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredTelemetry(enabled: boolean, home?: string): string {
  const file = telemetryStorePath(home);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify({ enabled }) + '\n');
  return file;
}
