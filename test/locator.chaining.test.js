// Unit tests for Locator chain shaping (first/last/nth/filter/and/or) — the
// index + set logic, observed via count() and which id resolves first.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocator, el, Locator } from './fake-driver.js';

// A driver whose findElements returns a fixed 3-element set [a, b, c]; getText
// echoes the resolved id so we can see which element a chain pins.
function threeElementDriver() {
  return {
    findElements: async () => [el('a'), el('b'), el('c')],
    getElementText: async (id) => id,
  };
}

describe('Locator index selectors', () => {
  test('count() reflects the raw match set', async () => {
    const { el: loc } = makeLocator({}, threeElementDriver());
    assert.equal(await loc.count(), 3);
  });

  test('first() / last() / nth() pin the right element', async () => {
    const { el: loc } = makeLocator({}, threeElementDriver());
    assert.equal(await loc.first().getText(), 'a');
    assert.equal(await loc.last().getText(), 'c');
    assert.equal(await loc.nth(1).getText(), 'b');
    assert.equal(await loc.nth(-1).getText(), 'c'); // Playwright parity
  });

  test('first/last/nth each resolve to a single element', async () => {
    const { el: loc } = makeLocator({}, threeElementDriver());
    assert.equal(await loc.first().count(), 1);
    assert.equal(await loc.nth(0).count(), 1);
  });

  test('nth(non-integer) throws', () => {
    const { el: loc } = makeLocator({}, threeElementDriver());
    assert.throws(() => loc.nth(1.5), /must be an integer/);
  });
});

describe('Locator and() / or() set ops', () => {
  // findElements answers differently per strategy value so the two operands
  // resolve to different id sets: 'A' → {a,b}, 'B' → {b,c}.
  function setDriver() {
    return {
      findElements: async (_using, value) =>
        value === 'A' ? [el('a'), el('b')] : [el('b'), el('c')],
    };
  }

  test('and() intersects the two match sets', async () => {
    const { el: loc, ctx } = makeLocator({ strategy: { using: 'xpath', value: 'A' } }, setDriver());
    const other = Locator.fromStrategy(ctx, { using: 'xpath', value: 'B' });
    assert.equal(await loc.and(other).count(), 1); // {a,b} ∩ {b,c} = {b}
  });

  test('or() unions the two match sets', async () => {
    const { el: loc, ctx } = makeLocator({ strategy: { using: 'xpath', value: 'A' } }, setDriver());
    const other = Locator.fromStrategy(ctx, { using: 'xpath', value: 'B' });
    assert.equal(await loc.or(other).count(), 3); // {a,b} ∪ {b,c} = {a,b,c}
  });
});

describe('Locator.filter', () => {
  test('filter({ hasText }) keeps only matching elements', async () => {
    const { el: loc } = makeLocator(
      {},
      {
        findElements: async () => [el('a'), el('b'), el('c')],
        // only 'b' has the wanted text
        getElementText: async (id) => (id === 'b' ? 'Wi-Fi' : 'Other'),
      },
    );
    assert.equal(await loc.filter({ hasText: 'Wi-Fi' }).count(), 1);
  });

  test('filter({ visible: false }) is rejected', () => {
    const { el: loc } = makeLocator({}, threeElementDriver());
    assert.throws(() => loc.filter({ visible: false }), /not supported/);
  });
});
