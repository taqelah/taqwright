// Unit tests for Locator read/state queries (isVisible, isEnabled, getText,
// getValue, boundingBox, getAttribute, isFocused, isEditable, isInViewport,
// isEmpty, isChecked) and waitFor — driven by the fake WebDriver harness.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocator, Platform } from './fake-driver.js';

describe('Locator state queries', () => {
  test('isVisible: true when displayed, false (within timeout) when never displayed', async () => {
    assert.equal(
      await makeLocator({}, { isElementDisplayed: async () => true }).el.isVisible(),
      true,
    );
    const hidden = makeLocator({}, { isElementDisplayed: async () => false }).el;
    assert.equal(await hidden.isVisible({ timeout: 60 }), false);
  });

  test('isEnabled reflects the driver for an actionable element', async () => {
    assert.equal(
      await makeLocator({}, { isElementEnabled: async () => true }).el.isEnabled(),
      true,
    );
  });

  test('getText returns the element text', async () => {
    const { el } = makeLocator({}, { getElementText: async () => 'Hello' });
    assert.equal(await el.getText(), 'Hello');
  });

  test('getValue: Android reads text attr then falls back to getElementText', async () => {
    const fromAttr = makeLocator(
      { platform: Platform.ANDROID },
      { getElementAttribute: async (_id, name) => (name === 'text' ? 'typed' : null) },
    ).el;
    assert.equal(await fromAttr.getValue(), 'typed');

    const fallback = makeLocator(
      { platform: Platform.ANDROID },
      { getElementAttribute: async () => null, getElementText: async () => 'fallback' },
    ).el;
    assert.equal(await fallback.getValue(), 'fallback');
  });

  test('getValue: iOS reads the value attribute', async () => {
    const { el } = makeLocator(
      { platform: Platform.IOS },
      { getElementAttribute: async (_id, name) => (name === 'value' ? 'v' : null) },
    );
    assert.equal(await el.getValue(), 'v');
  });

  test('boundingBox maps the element rect', async () => {
    const { el } = makeLocator(
      {},
      { getElementRect: async () => ({ x: 5, y: 6, width: 100, height: 40 }) },
    );
    assert.deepEqual(await el.boundingBox(), { x: 5, y: 6, width: 100, height: 40 });
  });

  test('getAttribute returns the value or null', async () => {
    assert.equal(
      await makeLocator({}, { getElementAttribute: async () => 'true' }).el.getAttribute('checked'),
      'true',
    );
    assert.equal(
      await makeLocator({}, { getElementAttribute: async () => null }).el.getAttribute('nope'),
      null,
    );
  });

  test('isFocused: Android focused="true"', async () => {
    const yes = makeLocator(
      { platform: Platform.ANDROID },
      { getElementAttribute: async () => 'true' },
    ).el;
    assert.equal(await yes.isFocused(), true);
    const no = makeLocator(
      { platform: Platform.ANDROID },
      { getElementAttribute: async () => 'false' },
    ).el;
    assert.equal(await no.isFocused(), false);
  });

  test('isEditable: Android EditText + enabled', async () => {
    const editable = makeLocator(
      { platform: Platform.ANDROID },
      {
        isElementEnabled: async () => true,
        getElementAttribute: async () => 'android.widget.EditText',
      },
    ).el;
    assert.equal(await editable.isEditable(), true);
    const notEditable = makeLocator(
      { platform: Platform.ANDROID },
      {
        isElementEnabled: async () => true,
        getElementAttribute: async () => 'android.widget.TextView',
      },
    ).el;
    assert.equal(await notEditable.isEditable(), false);
  });

  test('isInViewport: on-screen true, off-screen false', async () => {
    const onScreen = makeLocator(
      {},
      {
        getElementRect: async () => ({ x: 0, y: 0, width: 100, height: 40 }),
        getWindowRect: async () => ({ x: 0, y: 0, width: 1000, height: 2000 }),
      },
    ).el;
    assert.equal(await onScreen.isInViewport(), true);
    const offScreen = makeLocator(
      {},
      {
        getElementRect: async () => ({ x: 5000, y: 5000, width: 100, height: 40 }),
        getWindowRect: async () => ({ x: 0, y: 0, width: 1000, height: 2000 }),
      },
    ).el;
    assert.equal(await offScreen.isInViewport(), false);
  });

  test('isEmpty: no children + no text → true; children → false', async () => {
    const empty = makeLocator(
      {},
      { findElementsFromElement: async () => [], getElementText: async () => '' },
    ).el;
    assert.equal(await empty.isEmpty(), true);
    const nonEmpty = makeLocator(
      {},
      { findElementsFromElement: async () => [{ ELEMENT: 'child' }] },
    ).el;
    assert.equal(await nonEmpty.isEmpty(), false);
  });

  test('isChecked: reads the checked state, throws for non-checkable', async () => {
    const checked = makeLocator({}, { getElementAttribute: async () => 'true' }).el;
    assert.equal(await checked.isChecked(), true);
    const notCheckable = makeLocator({}, { getElementAttribute: async () => null }).el;
    await assert.rejects(() => notCheckable.isChecked(), /not a checkable control/);
  });
});

describe('Locator allInnerTexts / allTextContents', () => {
  test('collect text across the resolved set', async () => {
    const { el } = makeLocator({}, { getElementText: async () => 'Row' });
    assert.deepEqual(await el.allInnerTexts(), ['Row']);
    assert.deepEqual(await el.allTextContents(), ['Row']);
  });
});

describe('Locator.waitFor', () => {
  test('resolves once the default (visible) state is met', async () => {
    const { el } = makeLocator({}, { isElementDisplayed: async () => true });
    await el.waitFor();
  });

  test('times out with a helpful message when the state is never reached', async () => {
    const { el } = makeLocator({}, { isElementDisplayed: async () => false });
    await assert.rejects(
      () => el.waitFor({ state: 'visible', timeout: 60 }),
      /did not reach state/,
    );
  });
});
