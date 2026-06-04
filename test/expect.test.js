// Unit tests for the standalone `expect` wrapper (src/expect.ts): it returns
// taqwright mobile matchers for a Locator and otherwise delegates to
// Playwright's expect. Matchers are exercised with a fake driver.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '../dist/index.js';
import { makeLocator } from './fake-driver.js';

describe('expect — dispatch', () => {
  test('non-Locator values fall through to Playwright expect', () => {
    // Playwright value matchers work unchanged.
    expect(2).toBe(2);
    expect([1, 2]).toContain(2);
    assert.throws(() => expect(2).toBe(3));
  });

  test('a Locator yields the mobile matcher set', () => {
    const { el } = makeLocator();
    const m = expect(el);
    assert.equal(typeof m.toBeVisible, 'function');
    assert.equal(typeof m.toHaveText, 'function');
    assert.equal(typeof m.not, 'object');
  });
});

describe('expect(locator) — matchers run the underlying assert*', () => {
  test('toBeVisible resolves when displayed', async () => {
    const { el } = makeLocator({}, { isElementDisplayed: async () => true });
    await expect(el).toBeVisible({ timeout: 500 });
  });

  test('toBeVisible rejects (times out) when never displayed', async () => {
    const { el } = makeLocator({}, { isElementDisplayed: async () => false });
    await assert.rejects(() => expect(el).toBeVisible({ timeout: 150 }));
  });

  test('toHaveText resolves on a matching text', async () => {
    const { el } = makeLocator({}, { getElementText: async () => 'Hello' });
    await expect(el).toHaveText('Hello', { timeout: 500 });
  });

  test('not.toBeVisible → asserts hidden', async () => {
    const { el } = makeLocator(
      {},
      { isElementDisplayed: async () => false, findElements: async () => [] },
    );
    await expect(el).not.toBeVisible({ timeout: 500 });
  });
});

describe('expect(locator) — unsupported surfaces throw clearly', () => {
  test('web-only matcher throws', () => {
    const { el } = makeLocator();
    assert.throws(() => expect(el).toHaveCSS('color', 'red'), /not supported on mobile locators/);
  });

  test('not.toHaveText (unpaired negation) throws', () => {
    const { el } = makeLocator();
    assert.throws(() => expect(el).not.toHaveText('x'), /not supported on mobile locators/);
  });

  test('unsupported option key rejects', async () => {
    const { el } = makeLocator();
    await assert.rejects(
      () => expect(el).toHaveText('x', { ignoreCase: true }),
      /option "ignoreCase" is not supported/,
    );
  });
});
