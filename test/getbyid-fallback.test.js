// Android getById's bare-id fallback, beyond the basics in mobile.test.js and
// locator.chaining.test.js: where the fallback is decided (per parent, after the
// chain narrows), what it costs a poll, ids it must escape, and the two inspector
// paths — the suggester and descriptor replay — that have to agree with runtime.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocator, makeMobile, makeFakeDriver, el, W3C } from './fake-driver.js';
import { generateCandidates, Platform } from './helpers.js';
import { buildLocatorFromDescriptor } from '../dist/locator/index.js';

const PRIMARY = { using: 'id', value: 'p' };
const FALLBACK = { using: '-android uiautomator', value: 'new UiSelector().resourceId("p")' };
const withFallback = { ...PRIMARY, fallback: FALLBACK };

describe('getById fallback — where it is decided', () => {
  test('per parent: a primary hit under one parent does not hide the fallback under another', async () => {
    const { el: parent } = makeLocator(
      {},
      {
        findElements: async () => [el('p1'), el('p2')],
        // A list mixing a native row (prefixed id) and an RN row (bare id).
        findElementsFromElement: async (pid, using) => {
          if (pid === 'p1') return using === 'id' ? [el('native')] : [];
          return using === 'id' ? [] : [el('rn')];
        },
      },
    );
    assert.deepEqual(
      (await parent.locator(withFallback).all()).length,
      2,
      'both rows, not just the native one',
    );
  });

  test('after the chain: a primary hit the filter removes still lets the fallback try', async () => {
    const { el: loc } = makeLocator(
      { strategy: withFallback },
      {
        findElements: async (using) => (using === 'id' ? [el('hidden')] : [el('shown')]),
        isElementDisplayed: async (id) => id === 'shown',
      },
    );
    assert.equal(await loc.filter({ visible: true }).count(), 1);
  });
});

describe('getById fallback — what a poll costs', () => {
  test('once the fallback is what matches, the next lookup tries it first', async () => {
    const calls = [];
    const { el: loc } = makeLocator(
      { strategy: withFallback },
      {
        findElements: async (using) => {
          calls.push(using);
          return using === 'id' ? [] : [el('rn')];
        },
      },
    );
    assert.equal(await loc.count(), 1);
    calls.length = 0;
    assert.equal(await loc.count(), 1);
    assert.deepEqual(calls, ['-android uiautomator'], 'one lookup, not two');
  });

  test('and goes back to the primary when the fallback stops matching', async () => {
    let rn = true;
    const { el: loc } = makeLocator(
      { strategy: withFallback },
      {
        findElements: async (using) => {
          if (using === 'id') return rn ? [] : [el('native')];
          return rn ? [el('rn')] : [];
        },
      },
    );
    assert.equal(await loc.count(), 1);
    rn = false;
    assert.equal(await loc.count(), 1);
  });
});

describe('getById fallback — ids it must escape', () => {
  test('a quote or backslash is escaped into the UiSelector, not refused', async () => {
    for (const id of ['say"hi', 'back\\slash']) {
      const calls = [];
      const { mobile } = makeMobile(Platform.ANDROID, {
        findElements: async (using, value) => {
          calls.push({ using, value });
          return [];
        },
      });
      await mobile.getById(id).count();
      assert.deepEqual(calls[1], {
        using: '-android uiautomator',
        value: `new UiSelector().resourceId(${JSON.stringify(id)})`,
      });
    }
  });
});

describe('the inspector agrees with runtime', () => {
  const idCode = (attrs) =>
    generateCandidates(Platform.ANDROID, attrs, '//*').find((c) => c.category === 'id')?.code;

  test("the suggester shortens an id only within the app's own package", () => {
    assert.equal(
      idCode({ 'resource-id': 'com.app:id/submit', package: 'com.app' }),
      'mobile.getById("submit")',
    );
    // Another package's id: getById('title') would look in com.app, then for bare "title".
    assert.equal(
      idCode({ 'resource-id': 'android:id/title', package: 'com.app' }),
      'mobile.getById("android:id/title")',
    );
    assert.equal(
      idCode({ 'resource-id': 'com.google.android.material:id/snackbar_text', package: 'com.app' }),
      'mobile.getById("com.google.android.material:id/snackbar_text")',
    );
    // A bare id (React Native, Compose, Flutter) is used as it is.
    assert.equal(idCode({ 'resource-id': 'login', package: 'com.app' }), 'mobile.getById("login")');
  });

  test('replaying an id descriptor on Android gets the same fallback getById does', async () => {
    const calls = [];
    const driver = makeFakeDriver({
      findElements: async (using) => {
        calls.push(using);
        return using === 'id' ? [] : [{ [W3C]: 'rn' }];
      },
    });
    const loc = buildLocatorFromDescriptor(
      { driver, platform: Platform.ANDROID, defaultTimeout: 1000 },
      { kind: 'leaf', using: 'id', value: 'login' },
    );
    assert.equal(await loc.count(), 1);
    assert.deepEqual(calls, ['id', '-android uiautomator']);
  });
});
