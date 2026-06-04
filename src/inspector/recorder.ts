export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export type RecordedAction =
  // Coordinate-targeted screen actions
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs: number }
  | {
      kind: 'screenScroll';
      direction: SwipeDirection;
      fromX?: number;
      toX?: number;
      fromY?: number;
      toY?: number;
    }
  // Element-targeted actions (rendered via the locator)
  | { kind: 'locatorClick'; code: string }
  | { kind: 'locatorDoubleTap'; code: string }
  | { kind: 'locatorLongPress'; code: string }
  | { kind: 'locatorFill'; code: string; text: string }
  | { kind: 'locatorClear'; code: string }
  | { kind: 'assertVisible'; code: string }
  | { kind: 'assertHidden'; code: string }
  | { kind: 'assertEnabled'; code: string }
  | { kind: 'assertDisabled'; code: string }
  | { kind: 'assertText'; code: string; expected: string; mode: 'exact' | 'contains' }
  | { kind: 'assertValue'; code: string; expected: string }
  | { kind: 'locatorSwipe'; code: string; direction: SwipeDirection }
  | { kind: 'locatorScrollIntoView'; code: string }
  | { kind: 'locatorPinch'; code: string; direction: 'in' | 'out' }
  | { kind: 'locatorDragTo'; code: string; targetCode: string }
  | { kind: 'locatorCheck'; code: string }
  | { kind: 'locatorUncheck'; code: string }
  | { kind: 'locatorFocus'; code: string }
  | { kind: 'locatorBlur'; code: string }
  | { kind: 'locatorPress'; code: string; key: string }
  | { kind: 'locatorPressSequentially'; code: string; text: string; delay?: number }
  | { kind: 'locatorSelectOption'; code: string; value: SelectOptionInput | string }
  | { kind: 'assertChecked'; code: string }
  | { kind: 'assertUnchecked'; code: string }
  | { kind: 'assertEditable'; code: string }
  | { kind: 'assertReadonly'; code: string }
  | { kind: 'assertFocused'; code: string }
  | { kind: 'assertAttached'; code: string }
  | { kind: 'assertEmpty'; code: string }
  | { kind: 'assertInViewport'; code: string }
  | { kind: 'assertCount'; code: string; expected: number }
  | { kind: 'assertAttribute'; code: string; name: string; expected: string }
  | { kind: 'sendKeys'; text: string }
  | { kind: 'switchContext'; context: string }
  | { kind: 'comment'; text: string };

/** Mirrors `SelectOptionInput` in `src/locator/index.ts`. */
export interface SelectOptionInput {
  label?: string;
  index?: number;
  date?: string;
  time?: string;
}

/**
 * In-memory recording of inspector-driven actions. Renders to a complete
 * taqwright test source on demand.
 */
export class Recorder {
  private readonly actions: RecordedAction[] = [];

  push(a: RecordedAction): void {
    this.actions.push(a);
  }

  list(): RecordedAction[] {
    return [...this.actions];
  }

  clear(): void {
    this.actions.length = 0;
  }

  /** Render the recording as a complete taqwright spec file. */
  toSpec(testName = 'recorded test'): string {
    const lines: string[] = [
      `import { test, expect } from '@taqwright/taqwright';`,
      ``,
      `test(${jsString(testName)}, async ({ mobile }) => {`,
    ];
    if (this.actions.length === 0) {
      lines.push(`  // (no actions recorded yet — interact with the device in the inspector)`);
    } else {
      for (const a of this.actions) {
        lines.push('  ' + renderAction(a));
      }
    }
    lines.push(`});`, ``);
    return lines.join('\n');
  }
}

function renderAction(a: RecordedAction): string {
  switch (a.kind) {
    case 'tap':
      return `await mobile.click({ x: ${a.x}, y: ${a.y} });`;
    case 'swipe':
      // Inspector-driven swipes are coordinate-based, so we emit a raw
      // pointer sequence — direction-based swipes lose the user's intent.
      return (
        `await mobile.raw.performActions([{ type: 'pointer', id: 'finger1', ` +
        `parameters: { pointerType: 'touch' }, actions: [` +
        `{ type: 'pointerMove', duration: 0, x: ${a.x1}, y: ${a.y1} }, ` +
        `{ type: 'pointerDown', button: 0 }, ` +
        `{ type: 'pointerMove', duration: ${a.durationMs}, x: ${a.x2}, y: ${a.y2} }, ` +
        `{ type: 'pointerUp', button: 0 }] }]);`
      );
    case 'sendKeys':
      return `await mobile.raw.execute('mobile: type', [{ text: ${jsString(a.text)} }]);`;
    case 'switchContext':
      // WEBVIEW handles carry volatile suffixes across runs, so emit the
      // portable no-arg convenience methods rather than a literal handle.
      return /^NATIVE_APP$/i.test(a.context)
        ? `await mobile.switchToNative();`
        : `await mobile.switchToWebView();`;
    case 'screenScroll': {
      // Up/down read naturally as `scroll`; left/right as `swipe`. Both
      // dispatch to the same underlying gesture in taqwright.
      const fn = a.direction === 'left' || a.direction === 'right' ? 'swipe' : 'scroll';
      const fromParts: string[] = [];
      if (a.fromX !== undefined) fromParts.push(`x: ${trimNum(a.fromX)}`);
      if (a.fromY !== undefined) fromParts.push(`y: ${trimNum(a.fromY)}`);
      const toParts: string[] = [];
      if (a.toX !== undefined) toParts.push(`x: ${trimNum(a.toX)}`);
      if (a.toY !== undefined) toParts.push(`y: ${trimNum(a.toY)}`);
      if (fromParts.length === 0 && toParts.length === 0) {
        return `await mobile.${fn}(${jsString(a.direction)});`;
      }
      const optsParts: string[] = [];
      if (fromParts.length) optsParts.push(`from: { ${fromParts.join(', ')} }`);
      if (toParts.length) optsParts.push(`to: { ${toParts.join(', ')} }`);
      return `await mobile.${fn}(${jsString(a.direction)}, { ${optsParts.join(', ')} });`;
    }
    case 'locatorClick':
      return `await ${a.code}.click();`;
    case 'locatorDoubleTap':
      return `await ${a.code}.doubleTap();`;
    case 'locatorLongPress':
      return `await ${a.code}.longPress();`;
    case 'locatorFill':
      return `await ${a.code}.fill(${jsString(a.text)});`;
    case 'locatorClear':
      return `await ${a.code}.clear();`;
    case 'assertVisible':
      return `await expect(${a.code}).toBeVisible();`;
    case 'assertHidden':
      return `await expect(${a.code}).toBeHidden();`;
    case 'assertEnabled':
      return `await expect(${a.code}).toBeEnabled();`;
    case 'assertDisabled':
      return `await expect(${a.code}).toBeDisabled();`;
    case 'assertText':
      return a.mode === 'contains'
        ? `await expect(${a.code}).toContainText(${jsString(a.expected)});`
        : `await expect(${a.code}).toHaveText(${jsString(a.expected)});`;
    case 'assertValue':
      return `await expect(${a.code}).toHaveValue(${jsString(a.expected)});`;
    case 'locatorSwipe': {
      const m = 'swipe' + a.direction[0]!.toUpperCase() + a.direction.slice(1);
      return `await ${a.code}.${m}();`;
    }
    case 'locatorScrollIntoView':
      return `await ${a.code}.scrollIntoView();`;
    case 'locatorPinch':
      return `await ${a.code}.pinch${a.direction === 'in' ? 'In' : 'Out'}();`;
    case 'locatorDragTo':
      return `await ${a.code}.dragTo(${a.targetCode});`;
    case 'locatorCheck':
      return `await ${a.code}.check();`;
    case 'locatorUncheck':
      return `await ${a.code}.uncheck();`;
    case 'locatorFocus':
      return `await ${a.code}.focus();`;
    case 'locatorBlur':
      return `await ${a.code}.blur();`;
    case 'assertChecked':
      return `await expect(${a.code}).toBeChecked();`;
    case 'assertUnchecked':
      return `await expect(${a.code}).not.toBeChecked();`;
    case 'locatorPress':
      return `await ${a.code}.press(${jsString(a.key)});`;
    case 'locatorPressSequentially':
      return a.delay
        ? `await ${a.code}.pressSequentially(${jsString(a.text)}, { delay: ${a.delay} });`
        : `await ${a.code}.pressSequentially(${jsString(a.text)});`;
    case 'locatorSelectOption':
      return `await ${a.code}.selectOption(${formatSelectOptionInput(a.value)});`;
    case 'assertEditable':
      return `await expect(${a.code}).toBeEditable();`;
    case 'assertReadonly':
      return `await expect(${a.code}).not.toBeEditable();`;
    case 'assertFocused':
      return `await expect(${a.code}).toBeFocused();`;
    case 'assertAttached':
      return `await expect(${a.code}).toBeAttached();`;
    case 'assertEmpty':
      return `await expect(${a.code}).toBeEmpty();`;
    case 'assertInViewport':
      return `await expect(${a.code}).toBeInViewport();`;
    case 'assertCount':
      return `await expect(${a.code}).toHaveCount(${a.expected});`;
    case 'assertAttribute':
      return `await expect(${a.code}).toHaveAttribute(${jsString(a.name)}, ${jsString(a.expected)});`;
    case 'comment':
      return `// ${a.text}`;
  }
}

function formatSelectOptionInput(v: SelectOptionInput | string): string {
  if (typeof v === 'string') return jsString(v);
  // Only emit fields that are set, in a stable order.
  const parts: string[] = [];
  if (v.label !== undefined) parts.push(`label: ${jsString(v.label)}`);
  if (v.index !== undefined) parts.push(`index: ${v.index}`);
  if (v.date !== undefined) parts.push(`date: ${jsString(v.date)}`);
  if (v.time !== undefined) parts.push(`time: ${jsString(v.time)}`);
  return `{ ${parts.join(', ')} }`;
}

function jsString(s: string): string {
  return JSON.stringify(s);
}

/** Render a number compactly: 0.75 not 0.7500000000000001, 0 not 0.0. */
function trimNum(n: number): string {
  return Number.isInteger(n) ? n.toFixed(0) : Number(n.toFixed(3)).toString();
}
