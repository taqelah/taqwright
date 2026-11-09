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

describe('Locator or() when the first locator matches nothing (#137)', () => {
  // A screen with LOGIN and CANCEL only; every other label is absent. Each
  // lookup is logged so a test can assert what was (not) queried.
  function screenDriver(extra = {}) {
    const lookups = [];
    const screen = { LOGIN: ['login'], CANCEL: ['cancel'] };
    return {
      lookups,
      driver: {
        findElements: async (_using, value) => {
          lookups.push(value);
          return (screen[value] ?? []).map(el);
        },
        getElementText: async (id) => id,
        ...extra,
      },
    };
  }
  function on(screen) {
    const {
      el: first,
      ctx,
      driver,
    } = makeLocator({ strategy: { using: 'accessibility id', value: 'SIGN IN' } }, screen.driver);
    const by = (label) => Locator.fromStrategy(ctx, { using: 'accessibility id', value: label });
    return { first, by, driver };
  }

  test('a.or(b) resolves to b when a is absent', async () => {
    const { first, by } = on(screenDriver());
    const loc = first.or(by('LOGIN'));
    assert.equal(await loc.count(), 1);
    assert.equal(await loc.getText(), 'login');
  });

  test('a.or(b) clicks b when a is absent', async () => {
    const clicked = [];
    const { first, by } = on(screenDriver({ elementClick: async (id) => clicked.push(id) }));
    await first.or(by('LOGIN')).click();
    assert.deepEqual(clicked, ['login']);
  });

  test('a.or(b) matches nothing when both are absent', async () => {
    const { first, by } = on(screenDriver());
    assert.equal(await first.or(by('MISSING')).count(), 0);
  });

  test('an or() after an and() that emptied the set still adds its matches', async () => {
    const { by } = on(screenDriver());
    // (LOGIN ∩ CANCEL) = ∅, then ∪ LOGIN = {login}
    assert.equal(await by('LOGIN').and(by('CANCEL')).or(by('LOGIN')).count(), 1);
  });

  test('a later filter applies to the or() matches', async () => {
    const { first, by } = on(screenDriver());
    const loc = first.or(by('LOGIN')).or(by('CANCEL'));
    assert.equal(await loc.count(), 2);
    assert.equal(await loc.filter({ hasText: 'cancel' }).getText(), 'cancel');
  });

  test('first() picks from the or() matches', async () => {
    const { first, by } = on(screenDriver());
    assert.equal(await first.or(by('LOGIN')).first().getText(), 'login');
  });

  test('and() with an absent first locator still matches nothing, without looking up the other', async () => {
    const screen = screenDriver();
    const { first, by } = on(screen);
    assert.equal(await first.and(by('LOGIN')).count(), 0);
    assert.deepEqual(screen.lookups, ['SIGN IN']);
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

describe('Locator strategy fallback', () => {
  const PRIMARY = { using: 'id', value: 'p' };
  const FALLBACK = { using: 'xpath', value: '//f' };
  const withFallback = { ...PRIMARY, fallback: FALLBACK };

  test('a global primary hit never runs the fallback', async () => {
    const seen = [];
    const { el: loc } = makeLocator(
      { strategy: withFallback },
      {
        findElements: async (using) => {
          seen.push(using);
          return [el('a')];
        },
      },
    );
    assert.equal(await loc.count(), 1);
    assert.deepEqual(seen, ['id']);
  });

  // A W3C findElements answers a miss with [], never a throw, so a throw is a real failure (a
  // dead session, a WEBVIEW context). Falling back past it would spend a second lookup and turn
  // the real error into "element not found" after the full timeout.
  test('a global primary that throws is an error, not a miss: no fallback', async () => {
    const seen = [];
    const { el: loc } = makeLocator(
      { strategy: withFallback },
      {
        findElements: async (using) => {
          seen.push(using);
          if (using === 'id') throw new Error('invalid session id');
          return [el('f1'), el('f2')];
        },
      },
    );
    assert.equal(await loc.count(), 0);
    assert.deepEqual(seen, ['id']);
  });

  test('a parent-scoped miss falls back per parent, de-duplicating ids', async () => {
    const { el: parent } = makeLocator(
      {},
      {
        findElements: async () => [el('p1'), el('p2')],
        findElementsFromElement: async (pid, using) => {
          if (using === 'id') return [];
          return pid === 'p1' ? [el('x'), el('y')] : [el('y'), el('z')];
        },
      },
    );
    assert.equal(await parent.locator(withFallback).count(), 3);
  });

  test('a parent whose primary lookup throws gets no fallback', async () => {
    const seen = [];
    const { el: parent } = makeLocator(
      {},
      {
        findElements: async () => [el('p1'), el('p2')],
        findElementsFromElement: async (pid, using) => {
          seen.push(using);
          if (pid === 'p1') throw new Error('stale parent');
          return [el('c')];
        },
      },
    );
    assert.equal(await parent.locator(withFallback).count(), 1);
    assert.deepEqual(seen, ['id', 'id']);
  });

  test('first() stops at the first parent-scoped fallback hit', async () => {
    let fallbackCalls = 0;
    const { el: parent } = makeLocator(
      {},
      {
        findElements: async () => [el('p1'), el('p2')],
        findElementsFromElement: async (_pid, using) => {
          if (using === 'id') return [];
          fallbackCalls++;
          return [el('x')];
        },
      },
    );
    assert.equal(await parent.locator(withFallback).first().count(), 1);
    assert.equal(fallbackCalls, 1);
  });
});
