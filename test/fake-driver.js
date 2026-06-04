// Shared fixtures for unit-testing the device-driven classes (Locator,
// Mobile) with a hand-rolled fake WebDriver `driver`. Tests import the
// COMPILED artifact (build runs first; `dist` is gitignored). This is the
// single place the dist path is referenced for these classes.
//
// NOTE: Node's runner loads every `.js` under `test/`, so this module is a
// zero-test file — it only exports.

import { Mobile, Locator, Platform } from '../dist/index.js';

export { Mobile, Locator, Platform };

/** The W3C element-reference key WebDriver clients use. */
export const W3C = 'element-6066-11e4-a52e-4f735466cecf';

/** Build a W3C element reference for a given id. */
export function el(id) {
  return { [W3C]: id, ELEMENT: id };
}

/**
 * A WebDriver stub with sensible defaults; override any method per test.
 * Covers the surface Locator + Mobile call across actions, assertions,
 * queries, gestures and context switching.
 */
export function makeFakeDriver(overrides = {}) {
  return {
    // resolution
    findElements: async () => [el('el-1')],
    findElement: async () => el('el-1'),
    findElementsFromElement: async () => [el('el-1')],
    getActiveElement: async () => el('el-1'),
    // visibility / state
    isElementDisplayed: async () => true,
    isElementEnabled: async () => true,
    // actions
    elementClick: async () => {},
    elementClear: async () => {},
    elementSendKeys: async () => {},
    performActions: async () => {},
    releaseActions: async () => {},
    executeScript: async () => undefined,
    // reads
    getElementText: async () => '',
    getElementAttribute: async () => null,
    getElementRect: async () => ({ x: 0, y: 0, width: 100, height: 40 }),
    getPageSource: async () => '<root/>',
    getWindowRect: async () => ({ x: 0, y: 0, width: 1000, height: 2000 }),
    // context / keyboard
    getAppiumContext: async () => 'NATIVE_APP',
    getAppiumContexts: async () => ['NATIVE_APP'],
    switchAppiumContext: async () => {},
    isKeyboardShown: async () => false,
    hideKeyboard: async () => {},
    ...overrides,
  };
}

/** Build a Locator over a fake driver. Returns { el, driver, ctx }. */
export function makeLocator(
  {
    platform = Platform.ANDROID,
    defaultTimeout = 1_000,
    strategy = { using: 'xpath', value: '//*[@text="x"]' },
  } = {},
  driverOverrides = {},
) {
  const driver = makeFakeDriver(driverOverrides);
  const ctx = { driver, platform, defaultTimeout };
  const locator = Locator.fromStrategy(ctx, strategy);
  return { el: locator, driver, ctx };
}

/** Build a Mobile over a fake driver. */
export function makeMobile(
  platform = Platform.ANDROID,
  driverOverrides = {},
  { bundleId = undefined, timeout = 1_000 } = {},
) {
  const driver = makeFakeDriver(driverOverrides);
  const mobile = Mobile.wrap(driver, platform, bundleId, timeout);
  return { mobile, driver };
}

/**
 * A recording stub: `s.fn` is an async function that records each call's
 * arguments in `s.calls` and resolves to `returnValue`.
 */
export function spy(returnValue) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return returnValue;
  };
  return {
    fn,
    calls,
    get count() {
      return calls.length;
    },
  };
}
