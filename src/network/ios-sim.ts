/**
 * iOS Simulator network capture helpers. Two responsibilities:
 *
 * 1. **Detect** whether the target UDID is a Simulator (vs. a real device).
 *    sim UDIDs are dashed-UUID form (`xxxxxxxx-xxxx-...`); real-device UDIDs
 *    are 40-hex or 24/25-char alnum.
 * 2. **Install** the taqwright CA into the sim's system keychain via
 *    `xcrun simctl keychain <udid> add-root-cert`. The sim must be booted;
 *    we wait via `simctl bootstatus`.
 *
 * Proxy routing on iOS Simulator is handled by `host-proxy.ts` because the
 * sim shares the host's network stack and URLSession honors macOS system
 * proxy settings, not any per-sim defaults.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execP = promisify(exec);

/**
 * Sim UDIDs are RFC 4122 UUIDs (8-4-4-4-12, dashes). Real-device UDIDs
 * historically were 40-hex; newer iPhones use a 24-char dotted form.
 * Neither has dashes.
 */
export function isSimulatorUdid(udid: string): boolean {
  return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(udid);
}

/** Wait until the sim is fully booted. Hard cap so we never hang the test run. */
export async function waitForBoot(udid: string, timeoutMs = 60_000): Promise<boolean> {
  try {
    await execP(`xcrun simctl bootstatus ${shellQuote(udid)} -b`, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Push the PEM-encoded CA into the simulator's system trust store. URLSession
 * (and any CFNetwork-based stack) will then accept leaf certs the proxy mints.
 * Idempotent — adding the same root twice is a no-op.
 */
export async function installRootCert(udid: string, certPemPath: string): Promise<boolean> {
  try {
    await execP(
      `xcrun simctl keychain ${shellQuote(udid)} add-root-cert ${shellQuote(certPemPath)}`,
      { timeout: 15_000 },
    );
    return true;
  } catch {
    return false;
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./=:,@%+]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
