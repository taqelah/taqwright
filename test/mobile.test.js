// Unit tests for Mobile: the pure getBy* locator factories (the strategy
// they build, observed via the resolver's findElements call), context
// helpers, and swipe coordinate math.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMobile } from './fake-driver.js';
import { Platform } from '../dist/index.js';

// Resolve a locator (count() → resolveAll → findElements) and return the
// (using, value) the strategy produced.
async function strategyOf(mobile, makeLoc, capture) {
  await makeLoc(mobile).count();
  return capture.last;
}
function findCapture() {
  const cap = { last: null };
  return {
    cap,
    findElements: async (using, value) => {
      cap.last = { using, value };
      return [];
    },
  };
}

describe('Mobile.getBy* factories', () => {
  test('Android getByText exact → xpath @text', async () => {
    const { findElements, cap } = findCapture();
    const { mobile } = makeMobile(Platform.ANDROID, { findElements });
    assert.deepEqual(await strategyOf(mobile, (m) => m.getByText('Hi'), cap), {
      using: 'xpath',
      value: "//*[@text='Hi']",
    });
  });

  test('Android getByText non-exact → contains(@text)', async () => {
    const { findElements, cap } = findCapture();
    const { mobile } = makeMobile(Platform.ANDROID, { findElements });
    assert.deepEqual(await strategyOf(mobile, (m) => m.getByText('Hi', { exact: false }), cap), {
      using: 'xpath',
      value: "//*[contains(@text, 'Hi')]",
    });
  });

  test('iOS getByText exact → predicate over label/value/name', async () => {
    const { findElements, cap } = findCapture();
    const { mobile } = makeMobile(Platform.IOS, { findElements });
    assert.deepEqual(await strategyOf(mobile, (m) => m.getByText('Hi'), cap), {
      using: '-ios predicate string',
      value: "label == 'Hi' OR value == 'Hi' OR name == 'Hi'",
    });
  });

  test('getById → id (Android) / accessibility id (iOS)', async () => {
    const a = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: a.findElements }).mobile,
        (m) => m.getById('foo'),
        a.cap,
      ),
      { using: 'id', value: 'foo' },
    );
    const i = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.IOS, { findElements: i.findElements }).mobile,
        (m) => m.getById('foo'),
        i.cap,
      ),
      { using: 'accessibility id', value: 'foo' },
    );
  });

  test('getByType → class name verbatim', async () => {
    const { findElements, cap } = findCapture();
    const { mobile } = makeMobile(Platform.ANDROID, { findElements });
    assert.deepEqual(await strategyOf(mobile, (m) => m.getByType('android.widget.Button'), cap), {
      using: 'class name',
      value: 'android.widget.Button',
    });
  });
});

describe('Mobile context helpers', () => {
  test('getContexts returns the driver contexts', async () => {
    const { mobile } = makeMobile(Platform.ANDROID, {
      getAppiumContexts: async () => ['NATIVE_APP', 'WEBVIEW_com.x'],
    });
    assert.deepEqual(await mobile.getContexts(), ['NATIVE_APP', 'WEBVIEW_com.x']);
  });

  test('switchToWebView with explicit name switches to it', async () => {
    const switched = [];
    const { mobile } = makeMobile(Platform.ANDROID, {
      switchAppiumContext: async (n) => {
        switched.push(n);
      },
    });
    assert.equal(await mobile.switchToWebView('WEBVIEW_x'), 'WEBVIEW_x');
    assert.deepEqual(switched, ['WEBVIEW_x']);
  });

  test('switchToWebView auto-picks the first WEBVIEW context', async () => {
    const switched = [];
    const { mobile } = makeMobile(Platform.ANDROID, {
      getAppiumContexts: async () => ['NATIVE_APP', 'WEBVIEW_com.a', 'WEBVIEW_com.b'],
      switchAppiumContext: async (n) => {
        switched.push(n);
      },
    });
    assert.equal(await mobile.switchToWebView(), 'WEBVIEW_com.a');
    assert.deepEqual(switched, ['WEBVIEW_com.a']);
  });

  test('switchToWebView throws a helpful error when none exist', async () => {
    const { mobile } = makeMobile(Platform.ANDROID, {
      getAppiumContexts: async () => ['NATIVE_APP'],
    });
    await assert.rejects(() => mobile.switchToWebView(), /No WebView context available/);
  });
});

describe('Mobile.swipe — Android native gesture', () => {
  test("default 'up' swipe computes the 40–60% Y band at x=50%", async () => {
    let call = null;
    const { mobile } = makeMobile(Platform.ANDROID, {
      getWindowRect: async () => ({ x: 0, y: 0, width: 1000, height: 2000 }),
      executeScript: async (cmd, args) => {
        call = { cmd, args };
      },
    });
    await mobile.swipe('up');
    assert.equal(call.cmd, 'mobile: swipeGesture');
    const r = call.args[0];
    assert.equal(r.direction, 'up');
    assert.equal(r.left, 500); // floor(1000 * 0.5)
    assert.equal(r.top, 800); // floor(2000 * 0.4)
    assert.equal(r.width, 2); // xLow==xHigh → clamped to min 2
    assert.equal(r.height, 399); // floor(2000 * (0.6 - 0.4)); float → 399, not 400
  });
});
