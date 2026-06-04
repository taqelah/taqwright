// Unit tests for Locator.clickWithCoordFallback — the replay-time
// guard that catches "click resolved but the screen didn't navigate"
// and walks centre/left/right (live bounds when available, recorded
// (x, y) ±80 px otherwise) until one tap actually changes the page.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Locator, Platform } from '../dist/index.js';

// Minimal WebDriverClient surface used by clickWithCoordFallback and
// its callees (click → resolveActionable → resolveVisible → waitFor →
// matchesState → resolveOnce → findElements + isElementDisplayed +
// isElementEnabled + elementClick; boundingBox → resolveVisible +
// getElementRect; plus the helper's own getPageSource +
// performActions + releaseActions).
function makeFakeDriver(overrides = {}) {
  return {
    findElements: async () => [{ 'element-6066-11e4-a52e-4f735466cecf': 'el-1' }],
    findElement: async () => ({ 'element-6066-11e4-a52e-4f735466cecf': 'el-1' }),
    isElementDisplayed: async () => true,
    isElementEnabled: async () => true,
    elementClick: async () => {},
    getElementRect: async () => ({ x: 100, y: 200, width: 300, height: 80 }),
    getPageSource: async () => '<unchanged/>',
    performActions: async () => {},
    releaseActions: async () => {},
    getElementText: async () => '',
    getElementAttribute: async () => null,
    ...overrides,
  };
}

function makeLocator(driverOverrides = {}) {
  const driver = makeFakeDriver(driverOverrides);
  const ctx = { driver, platform: Platform.ANDROID, defaultTimeout: 5_000 };
  const el = Locator.fromStrategy(ctx, { using: 'xpath', value: '//*[@text="x"]' });
  return { el, driver };
}

describe('Locator.clickWithCoordFallback', () => {
  test('returns after the locator click when the page changes', async () => {
    let sourceCalls = 0;
    let elementClickCalls = 0;
    let performActionsCalls = 0;
    const { el } = makeLocator({
      elementClick: async () => {
        elementClickCalls++;
      },
      performActions: async () => {
        performActionsCalls++;
      },
      getPageSource: async () => {
        sourceCalls++;
        // before-click → '<a/>'; after-click → '<b/>' (page changed)
        return sourceCalls === 1 ? '<a/>' : '<b/>';
      },
    });

    await el.clickWithCoordFallback();

    assert.equal(elementClickCalls, 1, 'locator click ran once');
    assert.equal(performActionsCalls, 0, 'no coord taps fired');
  });

  test('falls back to live-bounds centre when locator click is a no-op', async () => {
    let sourceCalls = 0;
    const tapped = [];
    let getRectCalls = 0;
    const { el } = makeLocator({
      elementClick: async () => {},
      getPageSource: async () => {
        sourceCalls++;
        // 1: before-click '<a/>'; 2: after-click '<a/>' (unchanged);
        // 3: before-centre-tap '<a/>'; 4: after-centre-tap '<b/>'.
        return sourceCalls < 4 ? '<a/>' : '<b/>';
      },
      getElementRect: async () => {
        getRectCalls++;
        return { x: 100, y: 200, width: 300, height: 80 };
      },
      performActions: async (actions) => {
        const pointer = actions[0].actions.find((a) => a.type === 'pointerMove');
        tapped.push({ x: pointer.x, y: pointer.y });
      },
    });

    await el.clickWithCoordFallback();

    assert.equal(tapped.length, 1, 'only centre probe fired (then page changed)');
    // Centre of {x:100, y:200, w:300, h:80} → x=250, y=240
    assert.equal(tapped[0].x, 250);
    assert.equal(tapped[0].y, 240);
    assert.ok(getRectCalls >= 1, 'live bounds were read');
  });

  test('walks centre → left → right until one tap changes the page', async () => {
    let sourceCalls = 0;
    const tapped = [];
    const { el } = makeLocator({
      elementClick: async () => {},
      // Make 'left' probe the winner: centre unchanged, left changes.
      getPageSource: async () => {
        sourceCalls++;
        // 1: before-click; 2: after-click (unchanged);
        // 3: before-centre; 4: after-centre (unchanged);
        // 5: before-left;  6: after-left (CHANGED).
        if (sourceCalls === 6) return '<b/>';
        return '<a/>';
      },
      performActions: async (actions) => {
        const pointer = actions[0].actions.find((a) => a.type === 'pointerMove');
        tapped.push({ x: pointer.x, y: pointer.y });
      },
    });

    await el.clickWithCoordFallback();

    assert.equal(tapped.length, 2, 'centre + left fired; right was skipped');
    // Centre of {100,200,300,80} → x=250; left 10% → x=130; both y=240.
    assert.equal(tapped[0].x, 250);
    assert.equal(tapped[1].x, 130);
  });

  test('reads bounds via getElementRect even when displayed=false', async () => {
    // The whole point of swapping boundingBox() for resolveOnce() +
    // getElementRect() is that we work for displayed="false" elements.
    // Simulate that: isElementDisplayed returns true for the click()
    // resolveVisible pass (so the click attempt fires), then false
    // forever after. The fallback path bypasses visibility entirely.
    let displayedCalls = 0;
    let sourceCalls = 0;
    const tapped = [];
    const { el } = makeLocator({
      elementClick: async () => {},
      isElementDisplayed: async () => {
        displayedCalls++;
        return displayedCalls === 1;
      },
      getElementRect: async () => ({ x: 100, y: 200, width: 300, height: 80 }),
      getPageSource: async () => {
        sourceCalls++;
        // 1: before-click; 2: after-click unchanged;
        // 3: before-centre; 4: after-centre CHANGED.
        return sourceCalls === 4 ? '<b/>' : '<a/>';
      },
      performActions: async (actions) => {
        const pointer = actions[0].actions.find((a) => a.type === 'pointerMove');
        tapped.push({ x: pointer.x, y: pointer.y });
      },
    });

    await el.clickWithCoordFallback();

    assert.equal(tapped.length, 1, 'centre probe of LIVE bounds fired');
    // Centre of {100,200,300,80} → x=250, y=240.
    assert.deepEqual(tapped[0], { x: 250, y: 240 });
  });

  // Regression: Android ClickableSpan-only labels. When the visible text
  // contains an inline ClickableSpan ("Already have an account? Log in"),
  // Appium's elementClick dispatches via accessibility ACTION_CLICK →
  // View.performClick() which does NOT fire ClickableSpan handlers — only
  // synthetic touch events do. text-has-clickable-span="true" is the
  // a-priori signal: skip the locator click and go straight to coord-walk.
  test('skips elementClick when text-has-clickable-span="true" and goes straight to coord-walk', async () => {
    let elementClickCalls = 0;
    let attrCalls = 0;
    const tapped = [];
    let sourceCalls = 0;
    const { el } = makeLocator({
      elementClick: async () => {
        elementClickCalls++;
      },
      getElementAttribute: async (_id, name) => {
        if (name === 'text-has-clickable-span') {
          attrCalls++;
          return 'true';
        }
        return null;
      },
      getPageSource: async () => {
        sourceCalls++;
        // No pre-click snap because we skip step 1. First snap is the
        // before-centre snap; second is after-centre (CHANGED).
        return sourceCalls === 1 ? '<a/>' : '<b/>';
      },
      performActions: async (actions) => {
        const pointer = actions[0].actions.find((a) => a.type === 'pointerMove');
        tapped.push({ x: pointer.x, y: pointer.y });
      },
    });

    await el.clickWithCoordFallback();

    assert.equal(
      elementClickCalls,
      0,
      'elementClick must NOT fire — accessibility click cannot reach ClickableSpan handlers',
    );
    assert.equal(attrCalls, 1, 'text-has-clickable-span was probed exactly once');
    assert.equal(tapped.length, 1, 'centre probe of live bounds fired immediately');
    // Centre of {x:100, y:200, w:300, h:80} → x=250, y=240
    assert.deepEqual(tapped[0], { x: 250, y: 240 });
  });

  test('still uses elementClick when text-has-clickable-span="false"', async () => {
    let elementClickCalls = 0;
    let sourceCalls = 0;
    const { el } = makeLocator({
      elementClick: async () => {
        elementClickCalls++;
      },
      getElementAttribute: async (_id, name) =>
        name === 'text-has-clickable-span' ? 'false' : null,
      getPageSource: async () => {
        sourceCalls++;
        // before-click → '<a/>'; after-click → '<b/>'.
        return sourceCalls === 1 ? '<a/>' : '<b/>';
      },
    });

    await el.clickWithCoordFallback();

    assert.equal(elementClickCalls, 1, 'fast path kicks in when the attribute is "false"');
  });

  test('gives up cleanly when the element is not in the page source', async () => {
    const tapped = [];
    const { el } = makeLocator({
      // Element never resolves.
      findElements: async () => [],
      findElement: async () => {
        throw new Error('NoSuchElement');
      },
      getPageSource: async () => '<a/>',
      performActions: async (actions) => {
        const pointer = actions[0].actions.find((a) => a.type === 'pointerMove');
        tapped.push({ x: pointer.x, y: pointer.y });
      },
    });

    // Short opts.timeout so the locator click resolution times out quickly.
    await el.clickWithCoordFallback({ timeout: 100 });

    assert.equal(tapped.length, 0, 'no coord taps fired when element is missing');
  });
});
