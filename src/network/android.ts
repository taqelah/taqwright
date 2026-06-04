/**
 * adb helpers for the network capture feature on Android emulators.
 *
 * Two responsibilities:
 *
 * 1. **AVD type detection.** Google Play AVDs ship `ro.build.tags=release-keys`
 *    and refuse `adb root`; userdebug AVDs are `dev-keys` / `test-keys`.
 *    Real devices: `ro.boot.qemu=1` is set on emulators, empty on hardware.
 *    Both checks together tell us if this is an emulator we can root.
 *
 * 2. **System-CA install + proxy redirect.** On userdebug AVDs, push our
 *    root CA into `/system/etc/security/cacerts/<hash>.0` and set the
 *    device-wide HTTP proxy to the host running mitm (`10.0.2.2:<port>`
 *    is the standard emulator-NAT alias for the host loopback).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execP = promisify(exec);

export type AndroidDeviceType = 'userdebug-emulator' | 'play-emulator' | 'real-device' | 'unknown';

export async function detectAndroidDeviceType(udid: string): Promise<AndroidDeviceType> {
  // `ro.boot.qemu` (alias `ro.kernel.qemu`) is set on emulators only.
  const qemu = (await getProp(udid, 'ro.boot.qemu')) || (await getProp(udid, 'ro.kernel.qemu'));
  const tags = await getProp(udid, 'ro.build.tags');

  if (qemu !== '1') {
    // Cross-check via `ro.build.characteristics` for older images that
    // don't surface qemu props but still self-identify.
    const chars = await getProp(udid, 'ro.build.characteristics');
    if (!/emulator/i.test(chars)) return 'real-device';
  }

  if (tags === 'release-keys') return 'play-emulator';
  if (tags === 'dev-keys' || tags === 'test-keys') return 'userdebug-emulator';
  return 'unknown';
}

/**
 * Push the CA into the AVD's system trust store. Returns `true` on success,
 * `false` on any failure (caller should fall back to "no HAR for this test").
 * Idempotent: if the same `hashName` already exists at the destination, the
 * push overwrites it (cheap on subsequent runs).
 *
 * The verity-disable / reboot dance is unfortunate but unavoidable on
 * API 30+ AVDs. We cache disable in the caller (see `ca.ts` neighborhood)
 * so it only happens once per AVD per machine.
 */
export async function installSystemCa(
  udid: string,
  certPemPath: string,
  hashName: string,
): Promise<boolean> {
  try {
    await adb(udid, 'root');
    // `adb root` reconnects asynchronously; give it a moment.
    await sleep(500);
    await waitForDevice(udid);

    // Try to remount /system rw. If it complains about verity, disable it,
    // reboot, and retry. We do not roll verity back on teardown — the AVD
    // is a dev artifact; the user can wipe it.
    let remountOut = '';
    try {
      remountOut = (await adb(udid, 'remount')).stdout + (await adb(udid, 'remount')).stderr;
    } catch (e) {
      remountOut = String((e as { stderr?: string }).stderr ?? e);
    }
    if (/verity/i.test(remountOut)) {
      await adb(udid, 'disable-verity').catch(() => undefined);
      await adb(udid, 'reboot').catch(() => undefined);
      await waitForDevice(udid, 60_000);
      await adb(udid, 'root').catch(() => undefined);
      await sleep(500);
      await waitForDevice(udid);
      await adb(udid, 'remount');
    }

    const dest = `/system/etc/security/cacerts/${hashName}.0`;
    await adb(udid, 'push', certPemPath, dest);
    await adb(udid, 'shell', `chmod 644 ${dest}`);
    return true;
  } catch {
    return false;
  }
}

export async function setHttpProxy(udid: string, host: string, port: number): Promise<void> {
  await adb(udid, 'shell', `settings put global http_proxy ${host}:${port}`);
}

export async function clearHttpProxy(udid: string): Promise<void> {
  // The literal string `:0` is the canonical "unset" value Android accepts
  // for the http_proxy global setting; `null` is rejected.
  await adb(udid, 'shell', 'settings put global http_proxy :0');
}

async function getProp(udid: string, name: string): Promise<string> {
  try {
    const { stdout } = await adb(udid, 'shell', `getprop ${name}`);
    return stdout.trim();
  } catch {
    return '';
  }
}

async function waitForDevice(udid: string, timeoutMs = 20_000): Promise<void> {
  // `adb -s <udid> wait-for-device` hangs forever; cap with our own timer.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execP(`adb -s ${shellQuote(udid)} get-state`, { timeout: 5_000 });
      if (stdout.trim() === 'device') return;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
}

async function adb(udid: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const cmd = ['adb', '-s', shellQuote(udid), ...args.map(shellQuote)].join(' ');
  return execP(cmd, { maxBuffer: 16 * 1024 * 1024 });
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./=:,@%+]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
