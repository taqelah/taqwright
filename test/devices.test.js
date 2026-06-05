// Unit test for findSerialForAvd — the pure mapping from an online-device map
// (serial → { avdName }) to the serial running a given AVD. Used by the
// Android pool pre-boot to locate / confirm a booted emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findSerialForAvd } from '../dist/inspector/devices.js';

describe('findSerialForAvd', () => {
  const online = new Map([
    ['emulator-5554', { avdName: 'Pixel_10_Pro_XL' }],
    ['emulator-5556', { avdName: 'Pixel_10_Pro_XL_2' }],
    ['emulator-5558', {}], // avdName not yet resolved
  ]);

  test('returns the serial running the named AVD', () => {
    assert.equal(findSerialForAvd(online, 'Pixel_10_Pro_XL'), 'emulator-5554');
    assert.equal(findSerialForAvd(online, 'Pixel_10_Pro_XL_2'), 'emulator-5556');
  });

  test('returns undefined when no online device runs the AVD', () => {
    assert.equal(findSerialForAvd(online, 'Pixel_10_Pro_XL_3'), undefined);
  });

  test('returns undefined for an empty map', () => {
    assert.equal(findSerialForAvd(new Map(), 'Pixel_10_Pro_XL'), undefined);
  });
});
