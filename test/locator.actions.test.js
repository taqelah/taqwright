// Unit tests for Locator input actions over a fake driver: fill (+ editable
// fallback), clear idempotency, press, and pressSequentially's platform/
// context-aware send strategy (the Android-replace vs append fix).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocator, el, W3C } from './fake-driver.js';
import { Platform } from '../dist/index.js';

// Capture every elementSendKeys(id, text) call.
function sendKeySpy() {
  const calls = [];
  return {
    calls,
    fn: async (id, text) => {
      calls.push({ id, text });
    },
  };
}

describe('Locator.pressSequentially', () => {
  test('Android native sends the GROWING PREFIX (UiAutomator2 setText replaces)', async () => {
    const spy = sendKeySpy();
    const { el: loc } = makeLocator(
      { platform: Platform.ANDROID },
      { getAppiumContext: async () => 'NATIVE_APP', elementSendKeys: spy.fn },
    );
    await loc.pressSequentially('abc');
    assert.deepEqual(
      spy.calls.map((c) => c.text),
      ['a', 'ab', 'abc'],
    );
  });

  test('Android WebView sends ONE CHAR at a time (chromedriver appends)', async () => {
    const spy = sendKeySpy();
    const { el: loc } = makeLocator(
      { platform: Platform.ANDROID },
      { getAppiumContext: async () => 'WEBVIEW_com.x', elementSendKeys: spy.fn },
    );
    await loc.pressSequentially('abc');
    assert.deepEqual(
      spy.calls.map((c) => c.text),
      ['a', 'b', 'c'],
    );
  });

  test('iOS sends one char at a time', async () => {
    const spy = sendKeySpy();
    const { el: loc } = makeLocator(
      { platform: Platform.IOS },
      { getAppiumContext: async () => 'NATIVE_APP', elementSendKeys: spy.fn },
    );
    await loc.pressSequentially('xy');
    assert.deepEqual(
      spy.calls.map((c) => c.text),
      ['x', 'y'],
    );
  });
});

describe('Locator.fill', () => {
  test('happy path: clear then sendKeys the whole value once', async () => {
    const spy = sendKeySpy();
    let clears = 0;
    const { el: loc } = makeLocator(
      {},
      {
        elementClear: async () => {
          clears++;
        },
        elementSendKeys: spy.fn,
      },
    );
    await loc.fill('hello');
    assert.equal(clears, 1);
    assert.deepEqual(
      spy.calls.map((c) => c.text),
      ['hello'],
    );
  });

  test('invalid-element-state → falls back to the editable descendant', async () => {
    const spy = sendKeySpy();
    const { el: loc } = makeLocator(
      {},
      {
        // first id resolves to 'el-1'; the editable descendant is 'edit-1'
        findElementsFromElement: async () => [el('edit-1')],
        elementSendKeys: async (id, text) => {
          if (id === 'el-1') throw new Error('invalid element state');
          spy.calls.push({ id, text });
        },
      },
    );
    await loc.fill('world');
    assert.deepEqual(spy.calls, [{ id: 'edit-1', text: 'world' }]);
  });
});

describe('Locator.clear', () => {
  test('is idempotent — swallows a clear error', async () => {
    const { el: loc } = makeLocator(
      {},
      {
        elementClear: async () => {
          throw new Error('cannot clear');
        },
      },
    );
    await assert.doesNotReject(() => loc.clear());
  });
});

describe('Locator.press', () => {
  test('single character is sent verbatim', async () => {
    const spy = sendKeySpy();
    const { el: loc } = makeLocator({}, { elementSendKeys: spy.fn });
    await loc.press('a');
    assert.deepEqual(
      spy.calls.map((c) => c.text),
      ['a'],
    );
  });
});

// Sanity: the fake driver's elements carry the W3C key the resolver reads.
test('fake element exposes the W3C key', () => {
  assert.equal(el('z')[W3C], 'z');
});
