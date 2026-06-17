// Unit tests for Locator action/gesture methods (tap, doubleClick/doubleTap,
// longPress, focus, blur) — observed via the driver calls they emit on the
// fake WebDriver harness.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocator, Platform } from './fake-driver.js';

describe('Locator tap / focus', () => {
  test('tap clicks the resolved element', async () => {
    const clicked = [];
    const { el } = makeLocator({}, { elementClick: async (id) => clicked.push(id) });
    await el.tap();
    assert.equal(clicked.length, 1);
  });

  test('focus clicks the resolved element', async () => {
    const clicked = [];
    const { el } = makeLocator({}, { elementClick: async (id) => clicked.push(id) });
    await el.focus();
    assert.equal(clicked.length, 1);
  });
});

describe('Locator.doubleClick / doubleTap', () => {
  test('Android uses the native doubleClickGesture', async () => {
    let call = null;
    const { el } = makeLocator(
      { platform: Platform.ANDROID },
      { executeScript: async (cmd, args) => (call = { cmd, args }) },
    );
    await el.doubleTap();
    assert.equal(call.cmd, 'mobile: doubleClickGesture');
    assert.ok('elementId' in call.args[0]);
  });

  test('iOS uses the native doubleTap', async () => {
    let call = null;
    const { el } = makeLocator(
      { platform: Platform.IOS },
      { executeScript: async (cmd, args) => (call = { cmd, args }) },
    );
    await el.doubleClick();
    assert.equal(call.cmd, 'mobile: doubleTap');
  });

  test('falls back to a two-tap W3C gesture when the native call throws', async () => {
    let performed = null;
    let released = false;
    const { el } = makeLocator(
      { platform: Platform.ANDROID },
      {
        executeScript: async () => {
          throw new Error('unsupported');
        },
        performActions: async (seq) => (performed = seq),
        releaseActions: async () => {
          released = true;
        },
      },
    );
    await el.doubleClick();
    const actions = performed[0].actions;
    // Two down/up pairs separated by a pause.
    assert.equal(actions.filter((a) => a.type === 'pointerDown').length, 2);
    assert.ok(actions.some((a) => a.type === 'pause'));
    assert.equal(released, true);
  });
});

describe('Locator.longPress', () => {
  test('emits a press-pause-release pointer sequence and releases actions', async () => {
    let performed = null;
    let released = false;
    const { el } = makeLocator(
      {},
      {
        getElementRect: async () => ({ x: 0, y: 0, width: 100, height: 40 }),
        performActions: async (seq) => (performed = seq),
        releaseActions: async () => {
          released = true;
        },
      },
    );
    await el.longPress({ duration: 1500 });
    const actions = performed[0].actions;
    const pause = actions.find((a) => a.type === 'pause');
    assert.equal(pause.duration, 1500);
    // Press centre of the 100x40 rect.
    const move = actions.find((a) => a.type === 'pointerMove');
    assert.equal(move.x, 50);
    assert.equal(move.y, 20);
    assert.equal(released, true);
  });
});

describe('Locator pinch', () => {
  test('Android pinchIn / pinchOut use the native gestures', async () => {
    const inCall = [];
    await makeLocator(
      { platform: Platform.ANDROID },
      { executeScript: async (cmd, args) => inCall.push({ cmd, args }) },
    ).el.pinchIn();
    assert.equal(inCall[0].cmd, 'mobile: pinchCloseGesture');
    assert.equal(inCall[0].args[0].percent, 0.75);

    const outCall = [];
    await makeLocator(
      { platform: Platform.ANDROID },
      { executeScript: async (cmd, args) => outCall.push({ cmd, args }) },
    ).el.pinchOut();
    assert.equal(outCall[0].cmd, 'mobile: pinchOpenGesture');
  });

  test('iOS synthesizes a two-finger pointer pinch', async () => {
    let performed = null;
    let released = false;
    const { el } = makeLocator(
      { platform: Platform.IOS },
      {
        getElementRect: async () => ({ x: 0, y: 0, width: 200, height: 200 }),
        performActions: async (seq) => (performed = seq),
        releaseActions: async () => {
          released = true;
        },
      },
    );
    await el.pinchOut();
    assert.equal(performed.length, 2); // two fingers
    assert.equal(performed[0].id, 'finger1');
    assert.equal(performed[1].id, 'finger2');
    assert.equal(released, true);
  });
});

describe('Locator.dragToPoint', () => {
  test('Android drags from the element centre to the point via dragGesture', async () => {
    let call = null;
    const { el } = makeLocator(
      { platform: Platform.ANDROID },
      {
        getElementRect: async () => ({ x: 0, y: 0, width: 100, height: 40 }),
        executeScript: async (cmd, args) => (call = { cmd, args }),
      },
    );
    await el.dragToPoint({ x: 300, y: 400 });
    assert.equal(call.cmd, 'mobile: dragGesture');
    assert.deepEqual(
      {
        startX: call.args[0].startX,
        startY: call.args[0].startY,
        endX: call.args[0].endX,
        endY: call.args[0].endY,
      },
      { startX: 50, startY: 20, endX: 300, endY: 400 },
    );
  });
});

describe('Locator.blur', () => {
  test('Android hides the keyboard when shown', async () => {
    let hidden = false;
    const { el } = makeLocator(
      { platform: Platform.ANDROID },
      {
        isKeyboardShown: async () => true,
        hideKeyboard: async () => {
          hidden = true;
        },
      },
    );
    await el.blur();
    assert.equal(hidden, true);
  });

  test('is a no-op (no throw) when no keyboard is shown', async () => {
    const { el } = makeLocator({}, { isKeyboardShown: async () => false });
    await el.blur();
  });
});
