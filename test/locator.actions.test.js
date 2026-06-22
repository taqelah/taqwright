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

// A stateful editable field. `mode` decides how send-keys mutates it —
// 'append' (iOS / WebView / Flutter) or 'replace' (standard UiAutomator2
// setText). `mask` reports the value as bullets of the right length, mimicking
// an Android password field (the value is never readable, only its length).
// pressSequentially picks its strategy by probing this behaviour, so asserting
// the *resulting* value is the real regression test for issue #76.
function makeField({ mode, mask = false } = {}) {
  let value = '';
  const driver = {
    elementClick: async () => {},
    elementClear: async () => {
      value = '';
    },
    elementSendKeys: async (_id, text) => {
      value = mode === 'append' ? value + text : text;
    },
    getElementAttribute: async (_id, name) =>
      name === 'text' ? (mask ? '•'.repeat(value.length) : value) : null,
    getElementText: async () => (mask ? '•'.repeat(value.length) : value),
  };
  return {
    driver,
    get value() {
      return value;
    },
  };
}

describe('Locator.pressSequentially', () => {
  test('Android native standard field — replace path yields the exact text', async () => {
    const field = makeField({ mode: 'replace' });
    const { el: loc } = makeLocator(
      { platform: Platform.ANDROID },
      { getAppiumContext: async () => 'NATIVE_APP', ...field.driver },
    );
    await loc.pressSequentially('abc');
    assert.equal(field.value, 'abc');
  });

  test('Android native Flutter/append field — no duplication (issue #76)', async () => {
    const field = makeField({ mode: 'append' });
    const { el: loc } = makeLocator(
      { platform: Platform.ANDROID },
      { getAppiumContext: async () => 'NATIVE_APP', ...field.driver },
    );
    await loc.pressSequentially('hello');
    // The bug produced 'hhehelhellhello'; the fix must yield exactly 'hello'.
    assert.equal(field.value, 'hello');
  });

  test('Android native masked password field — append detected via length', async () => {
    const field = makeField({ mode: 'append', mask: true });
    const { el: loc } = makeLocator(
      { platform: Platform.ANDROID },
      { getAppiumContext: async () => 'NATIVE_APP', ...field.driver },
    );
    await loc.pressSequentially('10203040');
    assert.equal(field.value, '10203040');
  });

  test('Android WebView — append path yields the exact text', async () => {
    const field = makeField({ mode: 'append' });
    const { el: loc } = makeLocator(
      { platform: Platform.ANDROID },
      { getAppiumContext: async () => 'WEBVIEW_com.x', ...field.driver },
    );
    await loc.pressSequentially('abc');
    assert.equal(field.value, 'abc');
  });

  test('iOS — append path yields the exact text', async () => {
    const field = makeField({ mode: 'append' });
    const { el: loc } = makeLocator(
      { platform: Platform.IOS },
      { getAppiumContext: async () => 'NATIVE_APP', ...field.driver },
    );
    await loc.pressSequentially('xy');
    assert.equal(field.value, 'xy');
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
