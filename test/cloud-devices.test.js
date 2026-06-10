// Unit tests for the shape-tolerant LambdaTest device parser (pure logic).
// The network fetch in fetchCloudDevices is IO and not covered here.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLambdatestDevices } from '../dist/inspector/server.js';

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
