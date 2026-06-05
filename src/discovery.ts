import { Platform, type DevicePoolEntry } from './types/index.js';
import { listDevices, type DeviceListing } from './inspector/devices.js';

/**
 * One auto-discovered device slot. Shape-compatible with {@link DevicePoolEntry}
 * (`udid` is always a string), so a resolved list of these can be handed to the
 * fixture's existing `device.pool` partition path unchanged.
 *
 * For Android emulators the `udid` is the live serial when booted, or an
 * `avd:<name>` sentinel when shutdown — the sentinel never reaches Appium
 * because the auto-boot path keys on `appium:avd` (the AVD `name`) and skips
 * `appium:udid` (see `buildCapabilities`).
 */
export interface AssignableSlot {
  udid: string;
  /** Android emulator: the AVD id (drives `appium:avd`). Otherwise the device name. */
  name?: string;
  osVersion?: string;
}

export interface DiscoverOpts {
  platform: Platform;
  provider: 'emulator' | 'local-device';
  /** Project `device.osVersion` filter, when set. */
  osVersion?: string;
  /** Project `device.name` filter, when set (string = exact, RegExp = test). */
  name?: string | RegExp;
}

/**
 * Turn a raw {@link DeviceListing} into a stable-sorted, deduped, filtered list
 * of assignable slots for one project's platform + provider. Pure — no IO — so
 * every worker process (and unit tests) computes the same ordering.
 *
 * Sort keys are deliberately **time-stable**: Android emulators sort by AVD
 * name (never the synthetic udid, which flips between `avd:<name>` and a serial
 * as the device boots); iOS sims and physical devices sort by udid.
 *
 * `local-device` + iOS throws — there is no multi-UDID physical-iOS enumerator
 * yet, so we refuse rather than half-support it.
 */
export function toAssignableSlots(listing: DeviceListing, opts: DiscoverOpts): AssignableSlot[] {
  const { platform, provider } = opts;

  if (provider === 'local-device' && platform === Platform.IOS) {
    throw new Error(
      'taqwright: device.autoDiscover is not supported for local-device + iOS — ' +
        'no multi-device enumerator exists for physical iPhones. Set device.udid or device.pool.',
    );
  }

  let slots: AssignableSlot[];
  if (platform === Platform.ANDROID && provider === 'emulator') {
    // Configured AVDs (running or shutdown). Address by AVD name so Appium
    // cold-boots/attaches via `appium:avd`.
    slots = listing.android
      .filter((d) => !!d.avdName)
      .map((d) => ({ udid: d.udid, name: d.avdName, osVersion: d.osVersion || undefined }));
    slots.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  } else if (platform === Platform.ANDROID && provider === 'local-device') {
    // Physical handsets only — exclude emulators (serial `emulator-*`, or any
    // entry tied to an AVD).
    slots = listing.android
      .filter((d) => !d.avdName && !d.udid.startsWith('emulator-'))
      .map((d) => ({ udid: d.udid, name: d.name, osVersion: d.osVersion }));
    slots.sort((a, b) => a.udid.localeCompare(b.udid));
  } else {
    // iOS + emulator (simulators). Boot happens in globalSetup via `simctl boot`.
    slots = listing.ios.map((d) => ({ udid: d.udid, name: d.name, osVersion: d.osVersion }));
    slots.sort((a, b) => a.udid.localeCompare(b.udid));
  }

  // Defensive dedup by udid (listAndroid already dedups AVD vs serial).
  const seen = new Set<string>();
  slots = slots.filter((s) => (seen.has(s.udid) ? false : (seen.add(s.udid), true)));

  // Name filter: matches the AVD name (Android emulator) or device name.
  if (opts.name !== undefined) {
    const want = opts.name;
    slots = slots.filter((s) => {
      if (s.name === undefined) return false;
      return want instanceof RegExp ? want.test(s.name) : s.name === want;
    });
  }

  // OS-version filter: keep unknown versions (e.g. shutdown AVDs), drop known
  // mismatches. So a user pinning osVersion never silently grabs a wrong-version
  // device, but still gets shutdown AVDs whose version we can't read yet.
  if (opts.osVersion !== undefined) {
    slots = slots.filter((s) => s.osVersion === undefined || s.osVersion === opts.osVersion);
  }

  return slots;
}

/**
 * Fail-fast selector: the first `workers` slots, or a clear throw when fewer
 * devices are available than `workers`. The returned slots are
 * {@link DevicePoolEntry}-shaped, ready to publish to the worker fixture.
 */
export function selectDevicePool(slots: AssignableSlot[], workers: number): DevicePoolEntry[] {
  if (slots.length < workers) {
    throw new Error(
      `taqwright: device.autoDiscover found ${slots.length} ` +
        `device${slots.length === 1 ? '' : 's'} but \`workers\` is ${workers}. ` +
        `Start/connect more devices (or AVDs/simulators), or lower \`workers\`.`,
    );
  }
  return slots.slice(0, workers);
}

/** Thin IO wrapper: enumerate the host's devices and reduce to assignable slots. */
export async function discoverAssignableDevices(opts: DiscoverOpts): Promise<AssignableSlot[]> {
  return toAssignableSlots(await listDevices(), opts);
}

/**
 * Env-var key under which the `globalSetup` hook publishes a project's resolved
 * pool for its worker processes to read (env is inherited across the fork).
 * Non-identifier chars in the project name are flattened to `_`.
 */
export function resolvedPoolEnvKey(projectName: string | undefined): string {
  const safe = (projectName ?? '').replace(/[^A-Za-z0-9_]/g, '_');
  return `TAQWRIGHT_RESOLVED_POOL__${safe}`;
}
