// Unit tests for InspectorSession: the capability-defaulting helper, the
// device mutex (runExclusive), and context list/switch over a fake driver.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InspectorSession, applyLocalCapabilityDefaults } from '../dist/inspector/session.js';
import { Platform } from '../dist/types/index.js';
import { makeFakeDriver } from './fake-driver.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkSession = () =>
  new InspectorSession({ appium: { host: 'localhost', port: 4723, path: '/' }, capabilities: {} });

describe('applyLocalCapabilityDefaults', () => {
  test('android adds chromedriverAutodownload + nativeWebScreenshot', () => {
    const caps = { platformName: 'Android' };
    applyLocalCapabilityDefaults(caps, 'android');
    assert.equal(caps['appium:chromedriverAutodownload'], true);
    assert.equal(caps['appium:nativeWebScreenshot'], true);
    assert.equal('appium:forceSimulatorSoftwareKeyboardPresence' in caps, false);
  });

  test('ios adds the software-keyboard cap only', () => {
    const caps = { platformName: 'iOS' };
    applyLocalCapabilityDefaults(caps, 'ios');
    assert.equal(caps['appium:forceSimulatorSoftwareKeyboardPresence'], true);
    assert.equal('appium:chromedriverAutodownload' in caps, false);
  });

  test('explicit caps are never overwritten', () => {
    const caps = {
      'appium:chromedriverAutodownload': false,
      'appium:nativeWebScreenshot': false,
    };
    applyLocalCapabilityDefaults(caps, 'android');
    assert.equal(caps['appium:chromedriverAutodownload'], false);
    assert.equal(caps['appium:nativeWebScreenshot'], false);
  });
});

describe('InspectorSession.runExclusive', () => {
  test('serializes overlapping work (no interleave)', async () => {
    const s = mkSession();
    const order = [];
    const a = s.runExclusive(async () => {
      await sleep(40);
      order.push('a-end');
    });
    const b = s.runExclusive(async () => {
      order.push('b-start');
    });
    await Promise.all([a, b]);
    // b must not start until a finished.
    assert.deepEqual(order, ['a-end', 'b-start']);
  });

  test('a rejecting task does not wedge the lock', async () => {
    const s = mkSession();
    await assert.rejects(
      s.runExclusive(async () => {
        throw new Error('boom');
      }),
    );
    const ok = await s.runExclusive(async () => 42);
    assert.equal(ok, 42);
  });
});

describe('InspectorSession — contexts over a fake driver', () => {
  test('listContexts throws when not connected', async () => {
    await assert.rejects(() => mkSession().listContexts(), /not connected/);
  });

  test('listContexts returns contexts + current', async () => {
    const s = mkSession();
    s.attachDriver(
      makeFakeDriver({
        getAppiumContexts: async () => ['NATIVE_APP', 'WEBVIEW_com.x'],
        getAppiumContext: async () => 'WEBVIEW_com.x',
      }),
      Platform.ANDROID,
    );
    const { contexts, current } = await s.listContexts();
    assert.deepEqual(contexts, ['NATIVE_APP', 'WEBVIEW_com.x']);
    assert.equal(current, 'WEBVIEW_com.x');
  });

  test('switchContext updates state and records when recording', async () => {
    const s = mkSession();
    const switched = [];
    s.attachDriver(
      makeFakeDriver({
        switchAppiumContext: async (name) => {
          switched.push(name);
        },
      }),
      Platform.ANDROID,
    );
    s.recording = true;
    await s.switchContext('WEBVIEW_com.x');
    assert.deepEqual(switched, ['WEBVIEW_com.x']);
    assert.equal(s.currentContext, 'WEBVIEW_com.x');
    const recorded = s.recorder.list();
    assert.equal(recorded.at(-1).kind, 'switchContext');
    assert.equal(recorded.at(-1).context, 'WEBVIEW_com.x');
  });
});

describe('InspectorSession.cancelConnect', () => {
  test('tears down a session that already committed (cancel raced completion)', async () => {
    const s = mkSession();
    let deleted = 0;
    // Simulate connect having just stored the driver.
    s.driver = makeFakeDriver({
      deleteSession: async () => {
        deleted++;
      },
    });
    s.platform = Platform.ANDROID;

    s.cancelConnect();
    // disconnect() is fired without await inside cancelConnect — let it settle.
    await sleep(0);

    assert.equal(deleted, 1, 'deleteSession should be called to free the device');
    assert.equal(s.isConnected(), false, 'session should be disconnected after cancel');
  });

  test('with no driver yet, only arms the abort flag (no throw)', () => {
    const s = mkSession();
    assert.doesNotThrow(() => s.cancelConnect());
    assert.equal(s.isConnected(), false);
  });
});
