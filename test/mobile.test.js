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

describe('Mobile.getBy* factories — labels, placeholders, roles, xpath, css', () => {
  test('getByLabel → accessibility id (both platforms)', async () => {
    for (const p of [Platform.ANDROID, Platform.IOS]) {
      const { findElements, cap } = findCapture();
      const { mobile } = makeMobile(p, { findElements });
      assert.deepEqual(await strategyOf(mobile, (m) => m.getByLabel('Submit'), cap), {
        using: 'accessibility id',
        value: 'Submit',
      });
    }
  });

  test('Android getByPlaceholder exact / non-exact → @hint xpath', async () => {
    const exact = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: exact.findElements }).mobile,
        (m) => m.getByPlaceholder('Email'),
        exact.cap,
      ),
      { using: 'xpath', value: "//*[@hint='Email']" },
    );
    const partial = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: partial.findElements }).mobile,
        (m) => m.getByPlaceholder('Email', { exact: false }),
        partial.cap,
      ),
      { using: 'xpath', value: "//*[contains(@hint, 'Email')]" },
    );
  });

  test('iOS getByPlaceholder → placeholderValue predicate', async () => {
    const { findElements, cap } = findCapture();
    const { mobile } = makeMobile(Platform.IOS, { findElements });
    assert.deepEqual(await strategyOf(mobile, (m) => m.getByPlaceholder('Email'), cap), {
      using: '-ios predicate string',
      value: "placeholderValue == 'Email'",
    });
  });

  test('getByRole maps known roles per platform and passes unknown roles through', async () => {
    const a = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: a.findElements }).mobile,
        (m) => m.getByRole('button'),
        a.cap,
      ),
      { using: 'class name', value: 'android.widget.Button' },
    );
    const i = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.IOS, { findElements: i.findElements }).mobile,
        (m) => m.getByRole('button'),
        i.cap,
      ),
      { using: 'class name', value: 'XCUIElementTypeButton' },
    );
    const unknown = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: unknown.findElements }).mobile,
        (m) => m.getByRole('marquee'),
        unknown.cap,
      ),
      { using: 'class name', value: 'marquee' },
    );
  });

  test('getByXpath shorthand maps type-only, @text, and @resource-id', async () => {
    const typeOnly = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: typeOnly.findElements }).mobile,
        (m) => m.getByXpath('//android.widget.Button'),
        typeOnly.cap,
      ),
      { using: 'class name', value: 'android.widget.Button' },
    );
    const text = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: text.findElements }).mobile,
        (m) => m.getByXpath('//android.widget.TextView[@text="Hi"]'),
        text.cap,
      ),
      { using: 'xpath', value: "//*[@text='Hi']" },
    );
    const rid = findCapture();
    assert.deepEqual(
      await strategyOf(
        makeMobile(Platform.ANDROID, { findElements: rid.findElements }).mobile,
        (m) => m.getByXpath('//android.widget.EditText[@resource-id="com.app:id/email"]'),
        rid.cap,
      ),
      { using: 'id', value: 'email' },
    );
  });

  test('getByXpath falls through to a raw xpath when it does not match the shorthand', async () => {
    const { findElements, cap } = findCapture();
    const { mobile } = makeMobile(Platform.ANDROID, { findElements });
    assert.deepEqual(await strategyOf(mobile, (m) => m.getByXpath('//*[@text="Hi"]'), cap), {
      using: 'xpath',
      value: '//*[@text="Hi"]',
    });
  });

  test('getByCss → css selector verbatim', async () => {
    const { findElements, cap } = findCapture();
    const { mobile } = makeMobile(Platform.ANDROID, { findElements });
    assert.deepEqual(await strategyOf(mobile, (m) => m.getByCss('a.link'), cap), {
      using: 'css selector',
      value: 'a.link',
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

describe('Mobile.swipe — explicit from/to is an exact point-to-point line', () => {
  // A vertical line where from.x === to.x used to collapse the native
  // swipeGesture region to a 2px-wide sliver at the screen edge and never
  // scroll. With both from and to provided the gesture must be the exact
  // W3C pointer line instead.
  test('Android: explicit line uses W3C pointer coords, not swipeGesture', async () => {
    let script = null;
    let actions = null;
    const { mobile } = makeMobile(Platform.ANDROID, {
      getWindowRect: async () => ({ x: 0, y: 0, width: 1000, height: 2000 }),
      executeScript: async (cmd, args) => {
        script = { cmd, args };
      },
      performActions: async (a) => {
        actions = a;
      },
    });
    await mobile.scroll('down', { from: { x: 0.98, y: 0.6 }, to: { x: 0.98, y: 0.5 } });
    assert.equal(script, null); // native swipeGesture skipped entirely
    const moves = actions[0].actions;
    assert.deepEqual(moves[0], { type: 'pointerMove', duration: 0, x: 980, y: 1200 });
    assert.deepEqual(moves[1], { type: 'pointerDown', button: 0 });
    assert.deepEqual(moves[2], { type: 'pointerMove', duration: 300, x: 980, y: 1000 });
    assert.deepEqual(moves[3], { type: 'pointerUp', button: 0 });
  });

  test('iOS: explicit line uses W3C pointer coords, not mobile: swipe', async () => {
    let script = null;
    let actions = null;
    const { mobile } = makeMobile(Platform.IOS, {
      getWindowRect: async () => ({ x: 0, y: 0, width: 1000, height: 2000 }),
      executeScript: async (cmd, args) => {
        script = { cmd, args };
      },
      performActions: async (a) => {
        actions = a;
      },
    });
    await mobile.scroll('down', { from: { x: 0.98, y: 0.6 }, to: { x: 0.98, y: 0.5 } });
    assert.equal(script, null); // native mobile: swipe skipped entirely
    const moves = actions[0].actions;
    assert.deepEqual(moves[0], { type: 'pointerMove', duration: 0, x: 980, y: 1200 });
    assert.deepEqual(moves[2], { type: 'pointerMove', duration: 300, x: 980, y: 1000 });
  });

  test('partial coords (from only) keep the native region gesture', async () => {
    let call = null;
    const { mobile } = makeMobile(Platform.ANDROID, {
      getWindowRect: async () => ({ x: 0, y: 0, width: 1000, height: 2000 }),
      executeScript: async (cmd, args) => {
        call = { cmd, args };
      },
    });
    await mobile.swipe('up', { from: { y: 0.6 } });
    assert.equal(call.cmd, 'mobile: swipeGesture');
  });
});
