// Unit tests for the inspector Recorder — push/list/clear bookkeeping and
// the renderAction → toSpec source generation. Fully pure (no driver).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Recorder } from '../dist/inspector/recorder.js';

// Render a single action through toSpec and return just its source line.
function render(action) {
  const r = new Recorder();
  r.push(action);
  const spec = r.toSpec();
  // The action line is the indented line between the test(...) opener and `});`.
  const line = spec.split('\n').find((l) => l.startsWith('  ') && !l.includes('// (no actions'));
  return line.trim();
}

describe('Recorder — bookkeeping', () => {
  test('push / list / clear', () => {
    const r = new Recorder();
    assert.deepEqual(r.list(), []);
    r.push({ kind: 'locatorClick', code: 'mobile.getByText("A")' });
    r.push({ kind: 'comment', text: 'hi' });
    assert.equal(r.list().length, 2);
    // list() returns a copy — mutating it must not affect the recorder.
    r.list().push({ kind: 'comment', text: 'x' });
    assert.equal(r.list().length, 2);
    r.clear();
    assert.deepEqual(r.list(), []);
  });
});

describe('Recorder — toSpec scaffolding', () => {
  test('empty recording emits the placeholder comment + wrapper', () => {
    const spec = new Recorder().toSpec();
    assert.match(spec, /^import \{ test, expect \} from '@taqwright\/taqwright';/);
    assert.match(spec, /test\("recorded test", async \(\{ mobile \}\) => \{/);
    assert.match(spec, /\/\/ \(no actions recorded yet/);
    assert.match(spec, /\}\);\n$/);
  });

  test('custom test name is JSON-quoted', () => {
    assert.match(new Recorder().toSpec('my "spec"'), /test\("my \\"spec\\"",/);
  });
});

describe('Recorder — renderAction (one line per kind)', () => {
  const cases = [
    [{ kind: 'tap', x: 10, y: 20 }, 'await mobile.click({ x: 10, y: 20 });'],
    [
      { kind: 'sendKeys', text: 'hi' },
      'await mobile.raw.execute(\'mobile: type\', [{ text: "hi" }]);',
    ],
    [{ kind: 'switchContext', context: 'NATIVE_APP' }, 'await mobile.switchToNative();'],
    [{ kind: 'switchContext', context: 'WEBVIEW_com.x' }, 'await mobile.switchToWebView();'],
    [{ kind: 'screenScroll', direction: 'down' }, 'await mobile.scroll("down");'],
    [{ kind: 'screenScroll', direction: 'left' }, 'await mobile.swipe("left");'],
    [
      { kind: 'screenScroll', direction: 'down', fromY: 0.75, toY: 0.25 },
      'await mobile.scroll("down", { from: { y: 0.75 }, to: { y: 0.25 } });',
    ],
    [{ kind: 'locatorClick', code: 'L' }, 'await L.click();'],
    [{ kind: 'locatorDoubleTap', code: 'L' }, 'await L.doubleTap();'],
    [{ kind: 'locatorLongPress', code: 'L' }, 'await L.longPress();'],
    [{ kind: 'locatorFill', code: 'L', text: 'abc' }, 'await L.fill("abc");'],
    [{ kind: 'locatorClear', code: 'L' }, 'await L.clear();'],
    [{ kind: 'locatorSwipe', code: 'L', direction: 'up' }, 'await L.swipeUp();'],
    [{ kind: 'locatorScrollIntoView', code: 'L' }, 'await L.scrollIntoView();'],
    [{ kind: 'locatorPinch', code: 'L', direction: 'in' }, 'await L.pinchIn();'],
    [{ kind: 'locatorPinch', code: 'L', direction: 'out' }, 'await L.pinchOut();'],
    [{ kind: 'locatorDragTo', code: 'L', targetCode: 'T' }, 'await L.dragTo(T);'],
    [{ kind: 'locatorCheck', code: 'L' }, 'await L.check();'],
    [{ kind: 'locatorUncheck', code: 'L' }, 'await L.uncheck();'],
    [{ kind: 'locatorFocus', code: 'L' }, 'await L.focus();'],
    [{ kind: 'locatorBlur', code: 'L' }, 'await L.blur();'],
    [{ kind: 'locatorPress', code: 'L', key: 'Enter' }, 'await L.press("Enter");'],
    [
      { kind: 'locatorPressSequentially', code: 'L', text: 'hi' },
      'await L.pressSequentially("hi");',
    ],
    [
      { kind: 'locatorPressSequentially', code: 'L', text: 'hi', delay: 50 },
      'await L.pressSequentially("hi", { delay: 50 });',
    ],
    [{ kind: 'locatorSelectOption', code: 'L', value: 'Red' }, 'await L.selectOption("Red");'],
    [
      { kind: 'locatorSelectOption', code: 'L', value: { label: 'Red', index: 2 } },
      'await L.selectOption({ label: "Red", index: 2 });',
    ],
    [{ kind: 'assertVisible', code: 'L' }, 'await expect(L).toBeVisible();'],
    [{ kind: 'assertHidden', code: 'L' }, 'await expect(L).toBeHidden();'],
    [{ kind: 'assertEnabled', code: 'L' }, 'await expect(L).toBeEnabled();'],
    [{ kind: 'assertDisabled', code: 'L' }, 'await expect(L).toBeDisabled();'],
    [
      { kind: 'assertText', code: 'L', expected: 'Hi', mode: 'exact' },
      'await expect(L).toHaveText("Hi");',
    ],
    [
      { kind: 'assertText', code: 'L', expected: 'Hi', mode: 'contains' },
      'await expect(L).toContainText("Hi");',
    ],
    [{ kind: 'assertValue', code: 'L', expected: 'v' }, 'await expect(L).toHaveValue("v");'],
    [{ kind: 'assertChecked', code: 'L' }, 'await expect(L).toBeChecked();'],
    [{ kind: 'assertUnchecked', code: 'L' }, 'await expect(L).not.toBeChecked();'],
    [{ kind: 'assertEditable', code: 'L' }, 'await expect(L).toBeEditable();'],
    [{ kind: 'assertReadonly', code: 'L' }, 'await expect(L).not.toBeEditable();'],
    [{ kind: 'assertFocused', code: 'L' }, 'await expect(L).toBeFocused();'],
    [{ kind: 'assertAttached', code: 'L' }, 'await expect(L).toBeAttached();'],
    [{ kind: 'assertEmpty', code: 'L' }, 'await expect(L).toBeEmpty();'],
    [{ kind: 'assertInViewport', code: 'L' }, 'await expect(L).toBeInViewport();'],
    [{ kind: 'assertCount', code: 'L', expected: 3 }, 'await expect(L).toHaveCount(3);'],
    [
      { kind: 'assertAttribute', code: 'L', name: 'role', expected: 'btn' },
      'await expect(L).toHaveAttribute("role", "btn");',
    ],
    [{ kind: 'comment', text: 'note' }, '// note'],
  ];

  for (const [action, expected] of cases) {
    test(`${action.kind}${action.direction ? ':' + action.direction : ''}${action.mode ? ':' + action.mode : ''}`, () => {
      assert.equal(render(action), expected);
    });
  }

  test('swipe renders a raw pointer sequence with the recorded coords', () => {
    const line = render({ kind: 'swipe', x1: 5, y1: 6, x2: 7, y2: 8, durationMs: 300 });
    assert.match(line, /performActions/);
    assert.match(line, /x: 5, y: 6/);
    assert.match(line, /duration: 300, x: 7, y: 8/);
  });

  test('trimNum keeps short decimals and drops float noise', () => {
    const line = render({ kind: 'screenScroll', direction: 'up', fromY: 0.1 + 0.2 });
    // 0.1 + 0.2 === 0.30000000000000004 → trimmed to 0.3
    assert.match(line, /from: \{ y: 0.3 \}/);
  });
});
