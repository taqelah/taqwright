// Unit tests for src/discovery.ts — the PURE auto-discovery logic
// (`toAssignableSlots`, `selectDevicePool`, `resolvedPoolEnvKey`). The IO
// wrapper `discoverAssignableDevices` shells out to adb/emulator/simctl and is
// not unit-covered; all the decision logic lives in the pure functions below,
// which take a `DeviceListing` literal so no real devices are needed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toAssignableSlots, selectDevicePool, resolvedPoolEnvKey } from '../dist/discovery.js';
import { Platform } from '../dist/types/index.js';

// ── DeviceListing literal builders ──────────────────────────────────
function listing({ android = [], ios = [] } = {}) {
  return { android, ios, toolsMissing: {} };
}
function avd(name, { serial, osVersion } = {}) {
  // Booted AVDs carry a serial udid; shutdown ones an `avd:<name>` sentinel.
  return {
    type: 'android',
    udid: serial ?? `avd:${name}`,
    name: name.replaceAll('_', ' '),
    osVersion,
    state: serial ? 'booted' : 'shutdown',
    avdName: name,
  };
}
function physicalAndroid(serial, { name, osVersion } = {}) {
  return { type: 'android', udid: serial, name: name ?? serial, osVersion, state: 'booted' };
}
function sim(udid, { name = udid, osVersion, state = 'shutdown' } = {}) {
  return { type: 'ios', udid, name, osVersion, state };
}

const ANDROID_EMU = { platform: Platform.ANDROID, provider: 'emulator' };
const ANDROID_LOCAL = { platform: Platform.ANDROID, provider: 'local-device' };
const IOS_EMU = { platform: Platform.IOS, provider: 'emulator' };

describe('toAssignableSlots — android emulator', () => {
  test('lists AVDs (booted + shutdown), sorted by AVD name', () => {
    const slots = toAssignableSlots(
      listing({ android: [avd('Pixel_7_API_34'), avd('Galaxy_S22', { serial: 'emulator-5554' })] }),
      ANDROID_EMU,
    );
    assert.deepEqual(
      slots.map((s) => s.name),
      ['Galaxy_S22', 'Pixel_7_API_34'],
    );
    // The booted AVD keeps its serial; the shutdown one its sentinel.
    assert.equal(slots[0].udid, 'emulator-5554');
    assert.equal(slots[1].udid, 'avd:Pixel_7_API_34');
  });

  test('sort key is the AVD name, not the udid (stable across boot state)', () => {
    // `avd:Apple` would sort before `emulator-5554` by udid, but by avdName
    // `Banana` (booted, serial) must come after `Apple` (shutdown, sentinel).
    const slots = toAssignableSlots(
      listing({ android: [avd('Banana', { serial: 'emulator-5554' }), avd('Apple')] }),
      ANDROID_EMU,
    );
    assert.deepEqual(
      slots.map((s) => s.name),
      ['Apple', 'Banana'],
    );
  });

  test('name filter: exact string matches the AVD id', () => {
    const slots = toAssignableSlots(
      listing({ android: [avd('Pixel_7_API_34'), avd('Galaxy_S22')] }),
      { ...ANDROID_EMU, name: 'Pixel_7_API_34' },
    );
    assert.deepEqual(
      slots.map((s) => s.name),
      ['Pixel_7_API_34'],
    );
  });

  test('name filter: RegExp matches the AVD id', () => {
    const slots = toAssignableSlots(
      listing({ android: [avd('Pixel_7_API_34'), avd('Pixel_6_API_33'), avd('Galaxy_S22')] }),
      { ...ANDROID_EMU, name: /^Pixel_/ },
    );
    assert.deepEqual(
      slots.map((s) => s.name),
      ['Pixel_6_API_33', 'Pixel_7_API_34'],
    );
  });

  test('osVersion filter: keeps unknown versions, drops known mismatches', () => {
    const slots = toAssignableSlots(
      listing({
        android: [
          avd('Shutdown_Unknown'), // no osVersion — kept
          avd('Booted_14', { serial: 'emulator-5554', osVersion: '14' }), // match — kept
          avd('Booted_13', { serial: 'emulator-5556', osVersion: '13' }), // mismatch — dropped
        ],
      }),
      { ...ANDROID_EMU, osVersion: '14' },
    );
    assert.deepEqual(slots.map((s) => s.name).sort(), ['Booted_14', 'Shutdown_Unknown']);
  });
});

describe('toAssignableSlots — local-device android', () => {
  test('keeps physical handsets, excludes emulators', () => {
    const slots = toAssignableSlots(
      listing({
        android: [
          physicalAndroid('AB12CD34'),
          avd('Pixel_7_API_34', { serial: 'emulator-5554' }), // emulator → excluded
          physicalAndroid('ZZ99'),
        ],
      }),
      ANDROID_LOCAL,
    );
    // Sorted by udid (serial).
    assert.deepEqual(
      slots.map((s) => s.udid),
      ['AB12CD34', 'ZZ99'],
    );
  });
});

describe('toAssignableSlots — ios emulator', () => {
  test('lists simulators sorted by udid', () => {
    const slots = toAssignableSlots(
      listing({
        ios: [sim('UUID-B', { name: 'iPhone 15' }), sim('UUID-A', { name: 'iPhone SE' })],
      }),
      IOS_EMU,
    );
    assert.deepEqual(
      slots.map((s) => s.udid),
      ['UUID-A', 'UUID-B'],
    );
  });
});

describe('toAssignableSlots — unsupported combos', () => {
  test('local-device + iOS throws', () => {
    assert.throws(
      () => toAssignableSlots(listing(), { platform: Platform.IOS, provider: 'local-device' }),
      /not supported for local-device \+ iOS/,
    );
  });
});

describe('selectDevicePool — fail-fast & assignment', () => {
  const slots = [
    { udid: 'a', name: 'A' },
    { udid: 'b', name: 'B' },
  ];

  test('returns the first `workers` slots', () => {
    assert.deepEqual(selectDevicePool(slots, 2), slots);
    assert.deepEqual(selectDevicePool([...slots, { udid: 'c' }], 2), slots);
  });

  test('throws with an actionable message on shortfall', () => {
    assert.throws(
      () => selectDevicePool(slots, 3),
      /autoDiscover found 2 devices but `workers` is 3/,
    );
  });

  test('shortfall message singularizes "device" for 1', () => {
    assert.throws(() => selectDevicePool([{ udid: 'a' }], 2), /found 1 device but/);
  });

  test('zero devices for workers: 1 throws', () => {
    assert.throws(() => selectDevicePool([], 1), /found 0 devices but `workers` is 1/);
  });
});

describe('resolvedPoolEnvKey', () => {
  test('prefixes and sanitizes the project name', () => {
    assert.equal(resolvedPoolEnvKey('android'), 'TAQWRIGHT_RESOLVED_POOL__android');
    assert.equal(resolvedPoolEnvKey('my project!'), 'TAQWRIGHT_RESOLVED_POOL__my_project_');
    assert.equal(resolvedPoolEnvKey(undefined), 'TAQWRIGHT_RESOLVED_POOL__');
  });
});
