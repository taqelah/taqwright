// Unit test for isPortOpen — the TCP reachability probe used to decide
// whether Appium is already listening.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { isPortOpen, autoStartTargets } from '../dist/auto-appium.js';

describe('isPortOpen', () => {
  const server = createServer();

  test('true for a listening port', async () => {
    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    assert.equal(await isPortOpen('127.0.0.1', port), true);
  });

  test('false for a closed port', async () => {
    // Grab an ephemeral port, then close it so nothing is listening.
    const tmp = createServer();
    const port = await new Promise((resolve) => {
      tmp.listen(0, '127.0.0.1', () => resolve(tmp.address().port));
    });
    await new Promise((r) => tmp.close(r));
    assert.equal(await isPortOpen('127.0.0.1', port, 300), false);
  });

  after(() => new Promise((r) => server.close(r)));
});

// Selection logic that decides which projects the CLI pre-starts Appium for.
// Regression: a single-device project must still be pre-started even when a
// pool project sits elsewhere in the same config (a previous global guard
// disabled pre-start for the whole config the moment any project had a pool).
describe('autoStartTargets', () => {
  const appium = { autoStart: true, host: 'localhost', port: 4723, path: '/' };
  const cfg = {
    projects: [
      { name: 'android-single', use: { device: { provider: 'emulator' }, appium } },
      {
        name: 'android-pool-2',
        use: { device: { provider: 'emulator', pool: [{ udid: 'a' }, { udid: 'b' }] }, appium },
      },
      {
        name: 'android-auto',
        use: { device: { provider: 'emulator', autoDiscover: true }, appium },
      },
      { name: 'browserstack', use: { device: { provider: 'browserstack' }, appium } },
    ],
  };

  test('selects the single-device project even when a pool project exists', () => {
    assert.deepEqual(
      autoStartTargets(cfg).map((t) => t.name),
      ['android-single'],
    );
  });

  test('excludes pool, autoDiscover, and cloud projects', () => {
    const names = autoStartTargets(cfg).map((t) => t.name);
    assert.ok(!names.includes('android-pool-2'));
    assert.ok(!names.includes('android-auto'));
    assert.ok(!names.includes('browserstack'));
  });

  test('honors projectFilter', () => {
    assert.deepEqual(autoStartTargets(cfg, ['android-pool-2']), []);
    assert.deepEqual(
      autoStartTargets(cfg, ['android-single']).map((t) => t.name),
      ['android-single'],
    );
  });

  test('dedupes single-device projects sharing a host:port', () => {
    const shared = {
      projects: [
        { name: 'a', use: { device: { provider: 'emulator' }, appium } },
        { name: 'b', use: { device: { provider: 'emulator' }, appium } },
      ],
    };
    assert.equal(autoStartTargets(shared).length, 1);
  });

  test('skips projects without appium.autoStart', () => {
    const off = {
      projects: [
        { name: 'a', use: { device: { provider: 'emulator' }, appium: { autoStart: false } } },
      ],
    };
    assert.deepEqual(autoStartTargets(off), []);
  });
});
