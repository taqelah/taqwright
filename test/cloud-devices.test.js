// Unit tests for the shape-tolerant LambdaTest device parser (pure logic).
// The network fetch in fetchCloudDevices is IO and not covered here.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLambdatestDevices } from '../dist/inspector/server.js';
import { omitLocalEmulatorCaps } from '../dist/capabilities.js';
import { buildCapabilities as buildLambdatestCaps } from '../dist/providers/lambdatest/index.js';

describe('parseLambdatestDevices', () => {
  test('parses the { devices: [...] } shape', () => {
    const out = parseLambdatestDevices({
      devices: [{ deviceName: 'Galaxy S23', platformName: 'android', osVersion: '14' }],
    });
    assert.deepEqual(out, [
      {
        provider: 'lambdatest',
        platform: 'android',
        deviceName: 'Galaxy S23',
        osVersion: '14',
        realDevice: true,
      },
    ]);
  });

  test('parses the { data: [...] } shape (LambdaTest wraps under data)', () => {
    const out = parseLambdatestDevices({
      data: [{ deviceName: 'iPhone 15', platformName: 'ios', osVersion: '17' }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].platform, 'ios');
    assert.equal(out[0].deviceName, 'iPhone 15');
    assert.equal(out[0].osVersion, '17');
  });

  test('parses a top-level array with alternate field names', () => {
    const out = parseLambdatestDevices([
      { device: 'Pixel 8', os: 'Android', os_version: '14' },
      { name: 'iPad Pro', osName: 'iOS', version: 17 },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].deviceName, 'Pixel 8');
    assert.equal(out[0].platform, 'android');
    assert.equal(out[1].deviceName, 'iPad Pro');
    assert.equal(out[1].platform, 'ios');
    assert.equal(out[1].osVersion, '17'); // numeric coerced to string
  });

  test('skips entries without a device name', () => {
    const out = parseLambdatestDevices({ devices: [{ platformName: 'android', osVersion: '14' }] });
    assert.deepEqual(out, []);
  });

  test('empty / null / unrecognized → []', () => {
    assert.deepEqual(parseLambdatestDevices({ devices: null }), []);
    assert.deepEqual(parseLambdatestDevices({}), []);
    assert.deepEqual(parseLambdatestDevices([]), []);
    assert.deepEqual(parseLambdatestDevices(null), []);
    assert.deepEqual(parseLambdatestDevices({ unexpected: 1 }), []);
  });
});

describe('omitLocalEmulatorCaps', () => {
  test('drops local emulator caps, keeps the rest', () => {
    const out = omitLocalEmulatorCaps({
      'appium:avd': 'Pixel_10_Pro_XL',
      'appium:avdLaunchTimeout': 120000,
      'appium:avdReadyTimeout': 120000,
      'appium:newCommandTimeout': 240,
      'appium:autoGrantPermissions': true,
    });
    assert.deepEqual(out, {
      'appium:newCommandTimeout': 240,
      'appium:autoGrantPermissions': true,
    });
  });
  test('no local caps → unchanged', () => {
    const caps = { 'appium:newCommandTimeout': 240 };
    assert.deepEqual(omitLocalEmulatorCaps(caps), caps);
  });
});

describe('LambdaTest buildCapabilities (W3C shape)', () => {
  const baseUse = {
    platform: 'android',
    device: { name: 'Galaxy S24', osVersion: '14', orientation: 'portrait' },
  };

  test('every top-level key is W3C-valid (standard or contains ":")', () => {
    const caps = buildLambdatestCaps(baseUse, 'inspector', 'lt://APP');
    for (const k of Object.keys(caps)) {
      assert.ok(
        k === 'platformName' || k.includes(':'),
        `top-level cap "${k}" is not W3C-valid (would be rejected)`,
      );
    }
  });

  test('LambdaTest caps live under lt:options with w3c:true', () => {
    const caps = buildLambdatestCaps(baseUse, 'inspector', 'lt://APP');
    assert.equal(caps.platformName, 'Android');
    assert.equal(caps['appium:automationName'], 'UiAutomator2');
    const lt = caps['lt:options'];
    assert.equal(lt.w3c, true);
    assert.equal(lt.deviceName, 'Galaxy S24');
    assert.equal(lt.platformVersion, '14');
    assert.equal(lt.app, 'lt://APP');
    assert.ok(String(lt.build).length > 0);
    // No bare device/app keys leaked to the top level (the failure mode).
    assert.ok(!('deviceName' in caps) && !('app' in caps) && !('build' in caps));
  });

  test('snapshotMaxDepth is iOS-only', () => {
    const android = buildLambdatestCaps(baseUse, 'p', 'lt://A');
    assert.ok(!('appium:settings[snapshotMaxDepth]' in android));
    const ios = buildLambdatestCaps(
      { platform: 'ios', device: { name: 'iPhone 15', osVersion: '17' } },
      'p',
      'lt://A',
    );
    assert.equal(ios.platformName, 'iOS');
    assert.equal(ios['appium:automationName'], 'XCUITest');
    assert.equal(ios['appium:settings[snapshotMaxDepth]'], 62);
  });

  test('user lt:options deep-merges (does not wipe defaults)', () => {
    const caps = buildLambdatestCaps(
      { ...baseUse, capabilities: { 'lt:options': { appiumVersion: '2.11.0', tunnel: true } } },
      'p',
      'lt://A',
    );
    assert.equal(caps['lt:options'].appiumVersion, '2.11.0'); // overridden
    assert.equal(caps['lt:options'].tunnel, true); // added
    assert.equal(caps['lt:options'].deviceName, 'Galaxy S24'); // default kept
  });
});
