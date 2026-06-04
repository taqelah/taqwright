// Unit tests for the auto-retrying Locator.assert* methods over a fake
// driver — they poll until the state matches or the (short) timeout elapses.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocator, el } from './fake-driver.js';
import { Platform } from '../dist/index.js';

describe('Locator visibility / state asserts', () => {
  test('assertVisible resolves when displayed', async () => {
    const { el: loc } = makeLocator({}, { isElementDisplayed: async () => true });
    await loc.assertVisible({ timeout: 500 });
  });

  test('assertVisible times out and throws when never displayed', async () => {
    const { el: loc } = makeLocator({}, { isElementDisplayed: async () => false });
    await assert.rejects(
      () => loc.assertVisible({ timeout: 150 }),
      /did not reach state "visible"/,
    );
  });

  test('assertHidden resolves when not displayed', async () => {
    const { el: loc } = makeLocator({}, { isElementDisplayed: async () => false });
    await loc.assertHidden({ timeout: 500 });
  });

  test('assertHidden resolves when the element is absent', async () => {
    const { el: loc } = makeLocator({}, { findElements: async () => [] });
    await loc.assertHidden({ timeout: 500 });
  });

  test('assertEnabled / assertDisabled track isElementEnabled', async () => {
    const enabled = makeLocator({}, { isElementEnabled: async () => true }).el;
    await enabled.assertEnabled({ timeout: 500 });
    const disabled = makeLocator({}, { isElementEnabled: async () => false }).el;
    await disabled.assertDisabled({ timeout: 500 });
    await assert.rejects(() => disabled.assertEnabled({ timeout: 150 }));
  });

  test('eventually-visible: flips to displayed mid-poll and passes', async () => {
    let n = 0;
    const { el: loc } = makeLocator({}, { isElementDisplayed: async () => ++n >= 2 });
    await loc.assertVisible({ timeout: 1000 });
    assert.ok(n >= 2);
  });
});

describe('Locator text / value / count asserts', () => {
  test('assertText exact match', async () => {
    const { el: loc } = makeLocator({}, { getElementText: async () => 'Hello' });
    await loc.assertText('Hello', { timeout: 500 });
  });

  test('assertText regex match', async () => {
    const { el: loc } = makeLocator({}, { getElementText: async () => 'Hello World' });
    await loc.assertText(/World/, { timeout: 500 });
  });

  test('assertText mismatch throws after timeout', async () => {
    const { el: loc } = makeLocator({}, { getElementText: async () => 'Nope' });
    await assert.rejects(() => loc.assertText('Hello', { timeout: 150 }), /assert text/);
  });

  test('assertContainsText substring match', async () => {
    const { el: loc } = makeLocator({}, { getElementText: async () => 'abcdef' });
    await loc.assertContainsText('cde', { timeout: 500 });
  });

  test('assertValue reads the text attribute on Android', async () => {
    const { el: loc } = makeLocator(
      { platform: Platform.ANDROID },
      { getElementAttribute: async (_id, name) => (name === 'text' ? 'typed' : null) },
    );
    await loc.assertValue('typed', { timeout: 500 });
  });

  test('assertCount polls count() to the expected number', async () => {
    const three = [el('a'), el('b'), el('c')];
    const { el: loc } = makeLocator({}, { findElements: async () => three });
    await loc.assertCount(3, { timeout: 500 });
    await assert.rejects(() => loc.assertCount(2, { timeout: 150 }));
  });
});
