// Unit test for findSerialForAvd — the pure mapping from an online-device map
// (serial → { avdName }) to the serial running a given AVD. Used by the
// Android pool pre-boot to locate / confirm a booted emulator.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findSerialForAvd, isTransientDeviceError } from '../dist/inspector/devices.js';

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

describe('isTransientDeviceError', () => {
  test('true for transient adb/device blips worth retrying', () => {
    for (const msg of [
      "Command 'adb -s emulator-5554 install -r app.apk' exited with code 1; Command output: adb: device offline",
      'WebDriverError: Device emulator-5556 was not in the list of connected devices',
      "Cannot start the 'io.appium.settings' application",
      'unknown error: Error executing adbExec. Original error: ...',
      'error: device unauthorized',
    ]) {
      assert.equal(isTransientDeviceError(msg), true, msg);
    }
  });

  test('false for deterministic failures that should surface immediately', () => {
    for (const msg of [
      'expect(locator).toBeVisible() failed: element not found',
      "The application at '/path/DoesNotExist.apk' does not exist or is not accessible",
      'A session is either terminated or not started',
    ]) {
      assert.equal(isTransientDeviceError(msg), false, msg);
    }
  });
});
