import type { Client as WebDriverClient } from 'webdriver';
import {
  type BoundingBox,
  type ElementRef,
  type LocatorDescriptor,
  type LocatorStrategy,
  Platform,
  type ScrollDirection,
  type SerializedFilter,
  type SerializedText,
  W3C_ELEMENT_KEY,
} from '../types/index.js';
import { ANDROID_NAMED_KEYS, IOS_NAMED_KEYS, KEY_TO_UNICODE } from '../keys.js';

const DEFAULT_TIMEOUT = 30_000;
const POLL_INTERVAL = 200;

export interface ActionOptions {
  timeout?: number;
}

export interface WaitForOptions extends ActionOptions {
  state?: 'visible' | 'hidden' | 'attached' | 'enabled' | 'disabled';
}

export interface LongPressOptions extends ActionOptions {
  /** Duration in milliseconds. Default: 1000. */
  duration?: number;
}

export interface DragOptions extends ActionOptions {
  /**
   * Press-and-hold duration before the drag begins, in ms. Default: 500.
   * Long enough to trigger native drag-mode for iOS reorderable lists; if too
   * short the gesture is interpreted as a swipe.
   *
   * For the iOS native path (`mobile: dragFromToForDuration`), this is the
   * total gesture duration (converted to seconds internally).
   */
  duration?: number;
  /**
   * Move-phase duration in ms — gesture fallback only. Default: 300. Native
   * iOS uses `duration` (total) and native Android uses `speed`, so this
   * field is ignored when those paths succeed. Slower moves let apps that
   * watch intermediate `pointerMove` events react.
   */
  moveDuration?: number;
  /**
   * Android `mobile: dragGesture` speed in pixels/sec. Default: 2500.
   */
  speed?: number;
  /**
   * `dragTo` only — start point as fractions of source bbox. Default center.
   */
  from?: { x?: number; y?: number };
  /**
   * `dragTo` only — end point as fractions of target bbox. Default center.
   */
  to?: { x?: number; y?: number };
}

export interface ElementSwipeOptions {
  /** Gesture duration in ms. Default: 300. */
  duration?: number;
  /**
   * Travel distance for the gesture fallback as a fraction of the element's
   * smallest dimension (0..1). Default: 0.4. Also passed to native Android
   * `mobile: swipeGesture` as its `percent` argument when no coordinate
   * overrides are present.
   */
  distance?: number;
  /**
   * Start point as fractions of the element's bounding box (0..1). Each axis
   * is optional. When set, forces the gesture fallback (skips native).
   */
  from?: { x?: number; y?: number };
  /**
   * End point as fractions of the element's bounding box (0..1). When set,
   * forces the gesture fallback.
   */
  to?: { x?: number; y?: number };
}

export interface ScrollIntoViewOptions {
  /**
   * Direction to look for the element — content reveal direction, NOT finger
   * direction. `'down'` keeps revealing content below (finger swipes up),
   * `'up'` reveals content above (finger swipes down). Default: `'down'`.
   */
  direction?: ScrollDirection;
  /** Maximum gesture-fallback attempts before giving up. Default: 10. */
  maxAttempts?: number;
  /** Per-attempt visibility check timeout in ms. Default: 500. */
  visibleTimeout?: number;
  /** Gesture duration per swipe in ms. Default: 300. */
  duration?: number;
  /** Travel distance per swipe as fraction of `min(width, height)`. Default: 0.4. */
  distance?: number;
  /** Start point as fractions of screen (0..1). */
  from?: { x?: number; y?: number };
  /** End point as fractions of screen (0..1). Overrides direction+distance when set. */
  to?: { x?: number; y?: number };
  /**
   * Force the gesture-based fallback even when a native scroll command is
   * available. Useful for platforms / drivers where native scroll misbehaves.
   */
  forceGesture?: boolean;
  /**
   * After the element is on-screen, keep nudging it upward until its bottom
   * edge sits at least this fraction of the screen height above the bottom
   * (e.g. `0.2` = 20%). Best-effort — useful when an element lands at, or
   * behind, the bottom edge / a bottom bar where `isVisible()` passes but the
   * element isn't actually usable. The nudge swipes along the `from.x` column
   * (default centre) and stops early if there's no more room to scroll.
   * Default: `0` (no nudge — behaviour unchanged).
   */
  bottomMargin?: number;
}

export interface LocatorContext {
  driver: WebDriverClient;
  platform: Platform;
  defaultTimeout: number;
}

/**
 * Input shape for `Locator.selectOption(...)`. A bare `string` is shorthand
 * for `{ label }`. Pickers ignore fields they don't understand — e.g.
 * passing `date` to a `Spinner` throws with a clear error.
 */
export interface SelectOptionInput {
  /** Spinner / PickerWheel / menu: option label. */
  label?: string;
  /** PickerWheel: 0-indexed row. */
  index?: number;
  /** DatePicker: ISO `'YYYY-MM-DD'`. */
  date?: string;
  /** TimePicker: 24-hour `'HH:mm'`. */
  time?: string;
}

export interface PressSequentiallyOptions extends ActionOptions {
  /** Delay between characters, in ms. Default `0`. */
  delay?: number;
}

/**
 * Options accepted by `Locator.filter(...)`. All fields AND together. Multiple
 * `filter()` calls compose as additional AND clauses.
 *
 * - `has` / `hasNot` — child Locator must (or must not) resolve under each
 *   candidate. Uses scoped `findElementsFromElement` rooted at the candidate.
 * - `hasText` / `hasNotText` — `string` is treated as substring match; `RegExp`
 *   is tested against the element's text / value / accessibility label.
 * - `visible: true` — drop candidates not currently displayed.
 *   `visible: false` is **not** supported (throws) — use `assertHidden` or
 *   `filter({ hasNot: ... })` instead.
 */
export interface LocatorFilterOptions {
  has?: Locator;
  hasNot?: Locator;
  hasText?: string | RegExp;
  hasNotText?: string | RegExp;
  visible?: boolean;
}

interface IndexSelector {
  kind: 'first' | 'last' | 'nth';
  /** Only meaningful for `kind === 'nth'`. Negative values count from the end. */
  n?: number;
}

type ChainOp =
  | { kind: 'filter'; filter: LocatorFilterOptions }
  | { kind: 'and'; other: Locator }
  | { kind: 'or'; other: Locator };

interface LocatorChainState {
  parent?: Locator;
  chainOps: ChainOp[];
  indexSelector?: IndexSelector;
}

/**
 * Public Locator surface, built on a raw WebDriver (Appium) client.
 * Each action re-resolves the element so the locator remains stable
 * across navigations.
 *
 * Chain state (parent / filters / index selector) lives on the instance;
 * `strategy` is the leaf WebDriver find call.
 */
export class Locator {
  private readonly state: LocatorChainState;
  /**
   * When set, `resolveAll()` short-circuits and returns these element ids
   * directly without calling `findElements`. Used internally to scope a
   * `has` / `hasNot` child locator at a specific parent id.
   */
  private readonly pinnedIds?: readonly string[];

  /** @internal */
  constructor(
    private readonly ctx: LocatorContext,
    private readonly strategy: LocatorStrategy,
    state?: LocatorChainState,
    pinnedIds?: readonly string[],
  ) {
    this.state = state ?? { chainOps: [] };
    this.pinnedIds = pinnedIds;
  }

  /** @internal */
  static fromStrategy(ctx: LocatorContext, strategy: LocatorStrategy): Locator {
    return new Locator(ctx, strategy);
  }

  /** @internal — bypass `findElements` and return these ids verbatim. */
  private static pinnedToIds(ctx: LocatorContext, ids: readonly string[]): Locator {
    return new Locator(ctx, { using: 'xpath', value: '__pinned__' }, { chainOps: [] }, ids);
  }

  private derive(patch: Partial<LocatorChainState>): Locator {
    return new Locator(this.ctx, this.strategy, {
      parent: 'parent' in patch ? patch.parent : this.state.parent,
      chainOps: patch.chainOps ?? this.state.chainOps,
      indexSelector: 'indexSelector' in patch ? patch.indexSelector : this.state.indexSelector,
    });
  }

  /**
   * Returns a copy of this Locator with its root parent replaced. Used by
   * `locator()` to splice an outer parent under a child's existing chain.
   * Recurses into `state.parent` so chains like `A.locator(B.locator(C))`
   * rebase the deepest leaf, not just the topmost.
   */
  private rebaseRoot(newRoot: Locator): Locator {
    if (!this.state.parent) {
      return this.derive({ parent: newRoot });
    }
    return this.derive({ parent: this.state.parent.rebaseRoot(newRoot) });
  }

  // ─── Actions ───────────────────────────────────────────────────────

  async click(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    await this.ctx.driver.elementClick(id);
  }

  /** Alias for `click` — matches the more common mobile term. */
  async tap(opts?: ActionOptions): Promise<void> {
    return this.click(opts);
  }

  /**
   * Click this locator, and if the screen didn't actually navigate, walk
   * coord probes derived from the element's live bounds until something
   * does. WebDriver reports `click()` as successful even when the
   * underlying view silently ignored the touch (overlay eating the
   * event, click handler that's a no-op, or only part of the text is
   * actually clickable — e.g. only "Log in" in "Already have an
   * account? Log in"). This guards against that.
   *
   * Pipeline:
   *   1. `click({ timeout: opts?.timeout ?? 10_000 })`, then compare
   *      page source before/after with an 800 ms settle. If it changed,
   *      done.
   *   2. If unchanged or the click threw, look the element up once via
   *      `resolveOnce()` (does NOT require `displayed="true"`) and read
   *      `getElementRect(id)`. Walk centre / left 10% / right 90% of
   *      that rect — accurate even when the layout has shifted since
   *      recording.
   *   3. First tap that changes the page wins.
   *
   * No recorded coordinates are needed — the helper resolves the element
   * fresh at replay time. If the element isn't in the page source at
   * all (e.g. wrong screen), the helper gives up cleanly and the next
   * step's `waitFor` surfaces a per-locator error.
   *
   * @param opts.timeout  budget for the initial locator click only;
   *           defaults to 10_000 ms. The fallback walk uses its own
   *           short per-probe budgets.
   */
  async clickWithCoordFallback(opts?: ActionOptions): Promise<void> {
    const driver = this.ctx.driver;
    const snap = async (): Promise<string | null> => {
      try {
        return await driver.getPageSource();
      } catch {
        return null;
      }
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tapAt = async (px: number, py: number) => {
      try {
        await driver.performActions([
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: px, y: py },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ]);
      } finally {
        await driver.releaseActions().catch(() => {});
      }
    };

    // 0. Resolve once up front. The id is needed for both the
    //    text-has-clickable-span probe (Android) and the bounds read
    //    in the coord-walk path. Best-effort — null when the element
    //    isn't in the page source yet; click() below has its own
    //    retry-based resolver so a null here doesn't preclude the
    //    fast path.
    const idEarly = await this.resolveOnce();

    // Detect Android ClickableSpan-only labels: el.click() dispatches
    // via accessibility ACTION_CLICK which does NOT fire ClickableSpan
    // handlers — those listen for synthetic touch events only. When
    // text-has-clickable-span="true", the accessibility click is a
    // guaranteed no-op; skip step 1 and go straight to the coord-walk.
    let hasClickableSpan = false;
    if (idEarly) {
      try {
        const v = await driver.getElementAttribute(idEarly, 'text-has-clickable-span');
        hasClickableSpan = v === 'true';
      } catch {
        // attribute unsupported on this driver / element — proceed normally
      }
    }

    // 1. Locator click with a bounded budget so `displayed="false"`
    // doesn't stall the default timeout. Skipped when
    // text-has-clickable-span="true" makes the accessibility click a no-op.
    if (!hasClickableSpan) {
      const before1 = await snap();
      let clickThrew = false;
      try {
        await this.click({ timeout: opts?.timeout ?? 10_000 });
      } catch {
        clickThrew = true;
      }
      if (!clickThrew && before1 != null) {
        await sleep(800);
        const after = await snap();
        if (after != null && after !== before1) return;
      }
    }

    // 2. Read the element's bounds directly — skip the visibility wait
    //    that boundingBox() does internally so we still work for
    //    displayed="false" elements. Reuse the up-front id when we
    //    have it; re-resolve otherwise (the locator might have
    //    appeared in the page during the click attempt above). Give
    //    up cleanly when the element isn't in the page source at all.
    const id = idEarly ?? (await this.resolveOnce());
    if (!id) return;
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    try {
      rect = await driver.getElementRect(id);
    } catch {
      /* malformed */
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    // 3. Walk centre / left 10% / right 90% of the element's actual
    //    bounds. First tap that changes the page wins.
    const cy = Math.round(rect.y + rect.height * 0.5);
    const probes = [
      { x: Math.round(rect.x + rect.width * 0.5), y: cy },
      { x: Math.round(rect.x + rect.width * 0.1), y: cy },
      { x: Math.round(rect.x + rect.width * 0.9), y: cy },
    ];
    for (const pt of probes) {
      const before = await snap();
      await tapAt(pt.x, pt.y);
      if (before == null) return;
      await sleep(800);
      const after = await snap();
      if (after != null && after !== before) return;
    }
  }

  async doubleClick(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    const driver = this.ctx.driver;

    // Native paths first — two `elementClick` round-trips are too slow to be
    // recognized as a double-tap by either platform.
    if (this.ctx.platform === Platform.IOS) {
      try {
        await driver.executeScript('mobile: doubleTap', [{ elementId: id }]);
        return;
      } catch {
        // fall through
      }
    } else if (this.ctx.platform === Platform.ANDROID) {
      try {
        await driver.executeScript('mobile: doubleClickGesture', [{ elementId: id }]);
        return;
      } catch {
        // fall through
      }
    }

    // Gesture fallback: two taps on the element's center with a short pause.
    const rect = await driver.getElementRect(id);
    const x = Math.floor(rect.x + rect.width / 2);
    const y = Math.floor(rect.y + rect.height / 2);
    try {
      await driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await driver.releaseActions().catch(() => {});
    }
  }

  /** Alias for doubleClick — matches the more common mobile term. */
  async doubleTap(opts?: ActionOptions): Promise<void> {
    return this.doubleClick(opts);
  }

  async longPress(opts?: LongPressOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    const driver = this.ctx.driver;
    const duration = opts?.duration ?? 1_000;
    const rect = await driver.getElementRect(id);
    const x = Math.floor(rect.x + rect.width / 2);
    const y = Math.floor(rect.y + rect.height / 2);
    try {
      await driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await driver.releaseActions().catch(() => {});
    }
  }

  /**
   * Clear the value of a text input. Click-to-focus first so React Native
   * and other framework-controlled inputs see the change.
   *
   * Idempotent: if the field is already empty, the underlying
   * `elementClear` may throw on some drivers — we swallow that and treat
   * the field as already-cleared.
   */
  async clear(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    try {
      await this.ctx.driver.elementClick(id);
    } catch {
      // Best-effort focus.
    }
    try {
      await this.ctx.driver.elementClear(id);
    } catch {
      // Field may already be empty, or the input rejects clear when
      // unfocused. The post-condition (empty field) holds either way.
    }
  }

  async fill(value: string, opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    try {
      await this.typeInto(id, value);
    } catch (err) {
      // "invalid element state" means the resolved node isn't editable. The
      // accessibility label / testID is often attached to a wrapper
      // (ViewGroup, Compose node, RN host view) rather than the inner
      // EditText / text field, so the value write is rejected. Fall back to
      // the first editable descendant before giving up.
      if (!isInvalidElementState(err)) throw err;
      const editableId = await this.findEditableNode(id);
      if (!editableId) throw err;
      await this.typeInto(editableId, value);
    }
  }

  /** Focus → clear → key-event the value into a resolved element id. */
  private async typeInto(id: string, value: string): Promise<void> {
    // 1. Focus the element. React Native, Flutter and other frameworks
    //    that keep their own controlled state for inputs ignore writes to
    //    the underlying view (`mobile: setValue` / `replaceElementValue`)
    //    and re-render from their internal store — visible text appears
    //    blank even though the inspector tree shows the value. The only
    //    universally-reliable path is real input events on a focused
    //    element.
    try {
      await this.ctx.driver.elementClick(id);
    } catch {
      // Best-effort focus; elementSendKeys still works on truly-native
      // EditText fields without an explicit click.
    }
    // 2. Clear any existing value.
    try {
      await this.ctx.driver.elementClear(id);
    } catch {
      // Some inputs throw on clear; continue regardless.
    }
    // 3. Send the new text as actual key events — the framework's
    //    onChangeText / onChange fires and the view repaints.
    await this.ctx.driver.elementSendKeys(id, value);
  }

  /**
   * Find the real editable control when a value write lands on a non-editable
   * node (the label / testID sits on a wrapper or, conversely, on a child of
   * the input). Returns its element id, or null.
   */
  private async findEditableNode(id: string): Promise<string | null> {
    // 1. A descendant editable control — the label is on an outer wrapper.
    const descendant = await this.findEditableDescendant(id);
    if (descendant) return descendant;
    // 2. The focused element. `typeInto` already clicked the labelled node,
    //    which focuses the real input — frequently the *ancestor* EditText
    //    when the label is a child of the field. getActiveElement returns it.
    try {
      const active = (await this.ctx.driver.getActiveElement()) as ElementRef;
      const activeId = active?.[W3C_ELEMENT_KEY];
      if (activeId && activeId !== id && (await this.isEditableElement(activeId))) {
        return activeId;
      }
    } catch {
      // getActiveElement unsupported, or nothing focused — give up.
    }
    return null;
  }

  /** First editable descendant of `id`, or null (scoped XPath). */
  private async findEditableDescendant(id: string): Promise<string | null> {
    const xpath =
      this.ctx.platform === Platform.IOS
        ? './/*[self::XCUIElementTypeTextField or self::XCUIElementTypeSecureTextField]'
        : './/android.widget.EditText';
    const refs = (await this.ctx.driver
      .findElementsFromElement(id, 'xpath', xpath)
      .catch(() => [])) as ElementRef[];
    return refs.length > 0 ? refs[0]![W3C_ELEMENT_KEY] : null;
  }

  /** True iff the element is a text-input class (Android EditText / iOS field). */
  private async isEditableElement(id: string): Promise<boolean> {
    const isIOS = this.ctx.platform === Platform.IOS;
    const cls = await this.ctx.driver
      .getElementAttribute(id, isIOS ? 'type' : 'class')
      .catch(() => null);
    if (!cls) return false;
    return isIOS ? /TextField|SecureTextField/.test(cls) : /EditText/.test(cls);
  }

  /** Alias for `fill`. */
  async sendKeyStrokes(value: string, opts?: ActionOptions): Promise<void> {
    return this.fill(value, opts);
  }

  // ─── Focus / blur ──────────────────────────────────────────────────

  /**
   * Bring focus to this element without modifying its value. Internally a
   * best-effort `elementClick` — same first step as `fill`, but without the
   * subsequent clear / sendKeys. Useful when the test wants to trigger an
   * `onFocus` handler or just bring up the soft keyboard.
   */
  async focus(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    await this.ctx.driver.elementClick(id);
  }

  /**
   * Best-effort blur. Hides the soft keyboard if shown; otherwise taps a
   * corner of the screen. Mobile platforms don't have a clean "blur this
   * element" primitive — both paths are advisory and swallow errors.
   */
  async blur(_opts?: ActionOptions): Promise<void> {
    try {
      if (await this.ctx.driver.isKeyboardShown()) {
        if (this.ctx.platform === Platform.IOS) {
          await this.ctx.driver.executeScript('mobile: hideKeyboard', [{}]).catch(async () => {
            await this.ctx.driver.hideKeyboard().catch(() => {});
          });
        } else {
          await this.ctx.driver.hideKeyboard().catch(() => {});
        }
        return;
      }
    } catch {
      // isKeyboardShown can throw on some drivers — fall through.
    }
    // No keyboard visible: tap a presumed-empty top-left corner.
    try {
      await this.ctx.driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: 1, y: 1 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await this.ctx.driver.releaseActions().catch(() => {});
    }
  }

  // ─── Toggles ───────────────────────────────────────────────────────

  /**
   * True iff this element is in a checked state. Reads the platform-specific
   * "checked" attribute: `checked` on Android (`'true'`/`'false'`), `value`
   * on iOS XCUIElementTypeSwitch (`'1'`/`'0'`). Throws when the element
   * doesn't expose a recognisable checked state.
   */
  async isChecked(opts?: ActionOptions): Promise<boolean> {
    const id = await this.resolveVisible(opts);
    const state = await this.readChecked(id);
    if (state === undefined) {
      throw new Error(
        `isChecked: element (${this.strategy.using}=${this.strategy.value}) is not a checkable control — no readable checked/value attribute`,
      );
    }
    return state;
  }

  /**
   * Idempotently check the toggle: if already checked, no-op; otherwise
   * click and verify the state flipped within the timeout. Throws on
   * verification timeout (the click landed on an unrelated element, the
   * toggle is animating slower than the timeout, etc.).
   */
  async check(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    const current = await this.readChecked(id);
    if (current === true) return;
    if (current === undefined) {
      throw new Error(
        `check: element (${this.strategy.using}=${this.strategy.value}) is not a checkable control`,
      );
    }
    await this.ctx.driver.elementClick(id);
    await this.waitForChecked(true, opts);
  }

  /** Mirror of `check`. */
  async uncheck(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    const current = await this.readChecked(id);
    if (current === false) return;
    if (current === undefined) {
      throw new Error(
        `uncheck: element (${this.strategy.using}=${this.strategy.value}) is not a checkable control`,
      );
    }
    await this.ctx.driver.elementClick(id);
    await this.waitForChecked(false, opts);
  }

  private async readChecked(id: string): Promise<boolean | undefined> {
    if (this.ctx.platform === Platform.ANDROID) {
      const v = await this.ctx.driver.getElementAttribute(id, 'checked').catch(() => null);
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    }
    const v = await this.ctx.driver.getElementAttribute(id, 'value').catch(() => null);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false' || v === '') return false;
    return undefined;
  }

  private async waitForChecked(expected: boolean, opts?: ActionOptions): Promise<void> {
    const timeout = opts?.timeout ?? this.ctx.defaultTimeout;
    const deadline = Date.now() + timeout;
    let last: boolean | undefined;
    while (Date.now() < deadline) {
      const id = await this.resolveOnce();
      if (id) {
        last = await this.readChecked(id);
        if (last === expected) return;
      }
      await sleep(POLL_INTERVAL);
    }
    throw new Error(
      `${expected ? 'check' : 'uncheck'}: toggle did not reach state ${expected} within ${timeout}ms (last observed: ${last ?? '<unknown>'})`,
    );
  }

  // ─── Key input ─────────────────────────────────────────────────────

  /**
   * Press a single key on this (focused) element. Supports:
   *
   * - Single characters (`'a'`, `'1'`) — sent verbatim via `elementSendKeys`.
   * - Unicode-mapped keys (`'Enter'`, `'Tab'`, `'Backspace'`, `'Space'`) —
   *   same path, with the mapped Unicode escape.
   * - Nav / editing keys (`'ArrowUp'`, `'PageDown'`, `'Escape'`, …) —
   *   Android via `mobile: pressKey`, iOS via `mobile: keys`. iOS real
   *   devices may reject these — the underlying error surfaces.
   *
   * Throws on unsupported keys with the list of recognised names.
   */
  async press(key: string, opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    // Best-effort focus — same pattern as `fill`.
    await this.ctx.driver.elementClick(id).catch(() => {});

    const unicode = KEY_TO_UNICODE[key];
    if (unicode !== undefined) {
      await this.ctx.driver.elementSendKeys(id, unicode);
      return;
    }
    if (key.length === 1) {
      await this.ctx.driver.elementSendKeys(id, key);
      return;
    }
    if (this.ctx.platform === Platform.ANDROID) {
      const code = ANDROID_NAMED_KEYS[key];
      if (code !== undefined) {
        await this.ctx.driver.executeScript('mobile: pressKey', [{ keycode: code }]);
        return;
      }
    } else {
      const name = IOS_NAMED_KEYS[key];
      if (name !== undefined) {
        await this.ctx.driver.executeScript('mobile: keys', [{ keys: [{ name }] }]);
        return;
      }
    }
    throw new Error(
      `press: key "${key}" is not supported on ${this.ctx.platform}. ` +
        `Supported: single chars, ${Object.keys(KEY_TO_UNICODE).join(', ')}, ` +
        `${Object.keys(this.ctx.platform === Platform.ANDROID ? ANDROID_NAMED_KEYS : IOS_NAMED_KEYS).join(', ')}.`,
    );
  }

  /**
   * Type `text` one character at a time, with optional `delay` ms between
   * keystrokes. Slow (one Appium round-trip per char) but gives autocomplete
   * and other char-level handlers a chance to react — prefer `fill` for
   * plain value-set.
   */
  async pressSequentially(text: string, opts?: PressSequentiallyOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    await this.ctx.driver.elementClick(id).catch(() => {});
    const delay = opts?.delay ?? 0;

    // To type char-by-char we must know whether each send-keys APPENDS to the
    // field or REPLACES it:
    //   • iOS and Android WebView (chromedriver) APPEND  → send one char at a
    //     time (each keystroke fires the app's per-char handlers).
    //   • Standard Android native (UiAutomator2) does a setText that REPLACES,
    //     so single chars would wipe each previous one → send the growing
    //     prefix ("h","he","hel").
    //   • Flutter (and other apps that drive their own text editor) report as
    //     plain android.widget.EditText yet APPEND like a WebView — the prefix
    //     would then duplicate into "hhehel…" (issue #76).
    // Flutter is indistinguishable from standard native in the page source, so
    // probe the field's actual behaviour rather than guess from the platform.
    const ctx = await this.ctx.driver.getAppiumContext().catch(() => 'NATIVE_APP');
    const androidNative = this.ctx.platform === Platform.ANDROID && String(ctx) === 'NATIVE_APP';
    const appends =
      !androidNative || (text.length > 0 && (await this.detectSendKeysAppends(id, text[0])));

    let acc = '';
    for (const ch of text) {
      acc += ch;
      await this.ctx.driver.elementSendKeys(id, appends ? ch : acc);
      if (delay > 0) await sleep(delay);
    }
  }

  /**
   * Probe whether Android-native send-keys APPENDS or REPLACES on this field.
   * Send the same char twice via separate calls: a replacing field (standard
   * UiAutomator2 setText) stays length 1, an appending field (Flutter et al.)
   * grows to length 2. Length is read from the possibly-masked `text`
   * attribute, so password fields — which report their value as bullet chars of
   * the right length — are handled without ever reading the secret. The field
   * is cleared before and after so the probe leaves no residue. Any failure
   * defaults to REPLACE (the long-standing standard-native behaviour).
   */
  private async detectSendKeysAppends(id: string, probeChar: string): Promise<boolean> {
    try {
      await this.ctx.driver.elementClear(id);
      await this.ctx.driver.elementSendKeys(id, probeChar);
      await this.ctx.driver.elementSendKeys(id, probeChar);
      const len = await this.readValueLength(id);
      await this.ctx.driver.elementClear(id).catch(() => {});
      return len >= 2;
    } catch {
      return false;
    }
  }

  /** Length of the field's current (possibly masked) value, 0 if unreadable. */
  private async readValueLength(id: string): Promise<number> {
    const attr = await this.ctx.driver.getElementAttribute(id, 'text').catch(() => null);
    const text = attr ?? (await this.ctx.driver.getElementText(id).catch(() => ''));
    return typeof text === 'string' ? text.length : 0;
  }

  // ─── Native pickers ────────────────────────────────────────────────

  /**
   * Drive a native picker. Auto-detects the picker type from the element's
   * class / type and dispatches to the appropriate strategy:
   *
   * - **iOS `XCUIElementTypePickerWheel`** — `mobile: setPickerValue`.
   * - **iOS `XCUIElementTypeDatePicker`** — walks child pickerWheels.
   * - **Android `android.widget.Spinner`** — taps open + taps option by text.
   * - **Android `android.widget.DatePicker` / `TimePicker`** — tries
   *   `mobile: setDate` / `setTime`, falls back to wheel scroll.
   * - **Popup menu** — taps option by text inside the open menu.
   *
   * Throws with a clear message on unsupported element types. A bare
   * `string` is shorthand for `{ label: string }`.
   */
  async selectOption(value: string | SelectOptionInput, opts?: ActionOptions): Promise<void> {
    const input: SelectOptionInput = typeof value === 'string' ? { label: value } : value;
    const id = await this.resolveActionable(opts);
    const type = await this.detectPickerType(id);
    switch (type) {
      case 'ios-picker-wheel':
        return this.selectPickerWheel(id, input);
      case 'ios-date-picker':
        return this.selectIosDatePicker(id, input);
      case 'android-spinner':
        return this.selectAndroidSpinner(id, input);
      case 'android-date-picker':
        return this.selectAndroidDatePicker(id, input);
      case 'android-time-picker':
        return this.selectAndroidTimePicker(id, input);
      case 'menu':
        return this.selectMenuOption(id, input);
      default:
        throw new Error(
          `selectOption: element type "${type ?? 'unknown'}" is not a supported picker. ` +
            `Supported: iOS XCUIElementTypePickerWheel / DatePicker, ` +
            `Android Spinner / DatePicker / TimePicker, popup menus.`,
        );
    }
  }

  private async detectPickerType(id: string): Promise<string | undefined> {
    if (this.ctx.platform === Platform.IOS) {
      const t = await this.ctx.driver.getElementAttribute(id, 'type').catch(() => null);
      if (!t) return undefined;
      if (t === 'XCUIElementTypePickerWheel') return 'ios-picker-wheel';
      if (t === 'XCUIElementTypeDatePicker') return 'ios-date-picker';
      if (t === 'XCUIElementTypePicker') return 'ios-date-picker';
      // Heuristic: a popup menu is a generic container that holds tappable
      // text rows. Without a dedicated type, treat anything we don't
      // recognise as `menu` only when the caller passes `label`.
      return undefined;
    }
    const cls = await this.ctx.driver.getElementAttribute(id, 'class').catch(() => null);
    if (!cls) return undefined;
    if (cls.endsWith('Spinner')) return 'android-spinner';
    if (cls.endsWith('DatePicker')) return 'android-date-picker';
    if (cls.endsWith('TimePicker')) return 'android-time-picker';
    if (cls.endsWith('PopupMenu') || cls.endsWith('ListPopupWindow')) return 'menu';
    return undefined;
  }

  private async selectPickerWheel(id: string, input: SelectOptionInput): Promise<void> {
    if (input.label !== undefined) {
      await this.ctx.driver.executeScript('mobile: setPickerValue', [
        { elementId: id, order: 'next', offset: 0.15, value: input.label },
      ]);
      return;
    }
    if (input.index !== undefined) {
      // No native "index" form — walk by repeatedly nudging the wheel.
      // For correctness without knowing absolute row count, we just
      // surface a clear "label preferred" error rather than silently miss.
      throw new Error(
        'selectOption({index}) is not supported for XCUIElementTypePickerWheel; pass {label} instead',
      );
    }
    throw new Error('selectOption: PickerWheel requires {label}');
  }

  private async selectIosDatePicker(id: string, input: SelectOptionInput): Promise<void> {
    const wheels = (await this.ctx.driver.findElementsFromElement(
      id,
      'class name',
      'XCUIElementTypePickerWheel',
    )) as ElementRef[];
    if (!wheels || wheels.length === 0) {
      throw new Error('selectOption: iOS DatePicker has no PickerWheel children — is it open?');
    }
    const parts = parseDateOrTime(input);
    if (parts.length === 0) {
      throw new Error(
        'selectOption: iOS DatePicker requires {date: "YYYY-MM-DD"} or {time: "HH:mm"}',
      );
    }
    if (parts.length > wheels.length) {
      throw new Error(
        `selectOption: ${parts.length} value parts but DatePicker only has ${wheels.length} wheel(s)`,
      );
    }
    for (let i = 0; i < parts.length; i++) {
      const wheelId = wheels[i]![W3C_ELEMENT_KEY];
      await this.ctx.driver.executeScript('mobile: setPickerValue', [
        { elementId: wheelId, order: 'next', offset: 0.15, value: parts[i]! },
      ]);
    }
  }

  private async selectAndroidSpinner(id: string, input: SelectOptionInput): Promise<void> {
    if (input.label === undefined) {
      throw new Error('selectOption: Android Spinner requires {label}');
    }
    await this.ctx.driver.elementClick(id);
    // Wait briefly for the dropdown to render.
    await sleep(200);
    const optionRef = await this.ctx.driver
      .findElement('-android uiautomator', `new UiSelector().text(${JSON.stringify(input.label)})`)
      .catch(() => null);
    if (!optionRef) {
      throw new Error(`selectOption: Spinner option "${input.label}" not found after opening`);
    }
    const optId = (optionRef as ElementRef)[W3C_ELEMENT_KEY];
    await this.ctx.driver.elementClick(optId);
  }

  private async selectAndroidDatePicker(id: string, input: SelectOptionInput): Promise<void> {
    if (!input.date) {
      throw new Error('selectOption: Android DatePicker requires {date: "YYYY-MM-DD"}');
    }
    // Try Appium's native setter first.
    try {
      await this.ctx.driver.executeScript('mobile: setDate', [
        { elementId: id, datestring: input.date },
      ]);
      return;
    } catch {
      // Native setter unavailable on this driver / picker variant.
    }
    throw new Error(
      'selectOption: Android DatePicker — native `mobile: setDate` failed. ' +
        'This picker variant likely requires manual interaction; use locator.click() + wheel-by-wheel scrolling.',
    );
  }

  private async selectAndroidTimePicker(id: string, input: SelectOptionInput): Promise<void> {
    if (!input.time) {
      throw new Error('selectOption: Android TimePicker requires {time: "HH:mm"}');
    }
    try {
      await this.ctx.driver.executeScript('mobile: setTime', [
        { elementId: id, timestring: input.time },
      ]);
      return;
    } catch {
      // fall through
    }
    throw new Error(
      'selectOption: Android TimePicker — native `mobile: setTime` failed. ' +
        'This picker variant likely requires manual interaction.',
    );
  }

  private async selectMenuOption(_id: string, input: SelectOptionInput): Promise<void> {
    if (input.label === undefined) {
      throw new Error('selectOption: menu requires {label}');
    }
    const optionRef = await this.ctx.driver
      .findElement(
        'xpath',
        `//*[@text=${xpathLiteral(input.label)} or @label=${xpathLiteral(input.label)} or @name=${xpathLiteral(input.label)}]`,
      )
      .catch(() => null);
    if (!optionRef) {
      throw new Error(`selectOption: menu option "${input.label}" not found`);
    }
    const optId = (optionRef as ElementRef)[W3C_ELEMENT_KEY];
    await this.ctx.driver.elementClick(optId);
  }

  async screenshot(opts?: ActionOptions): Promise<Buffer> {
    const id = await this.resolveVisible(opts);
    const data = await this.ctx.driver.takeElementScreenshot(id);
    return Buffer.from(data, 'base64');
  }

  /**
   * Scroll until this locator is visible. Prefers native scroll-to-visible on
   * each platform; falls back to repeated gesture swipes.
   *
   * - **iOS (XCUITest)**: uses `mobile: scroll` with `{element, toVisible: true}`
   *   when the element can be resolved (it can be off-screen but must exist
   *   in the accessibility tree).
   * - **Android (UiAutomator2)**: uses `new UiScrollable(...).scrollIntoView(...)`
   *   when the locator is itself a `-android uiautomator` selector.
   * - **Fallback**: repeated swipes with the configured direction / coordinates.
   */
  async scrollIntoView(opts?: ScrollIntoViewOptions): Promise<void> {
    await this.scrollUntilVisible(opts);
    if (opts?.bottomMargin && opts.bottomMargin > 0) {
      await this.nudgeAboveBottom(opts.bottomMargin, opts);
    }
  }

  /**
   * Best-effort: nudge an already-visible element upward until its bottom edge
   * clears the bottom `margin` fraction of the screen. No-throw — stops when
   * cleared, when there's no more scroll room, or after a few attempts.
   */
  private async nudgeAboveBottom(margin: number, opts?: ScrollIntoViewOptions): Promise<void> {
    const driver = this.ctx.driver;
    const xFrac = opts?.from?.x ?? 0.5;
    for (let i = 0; i < 5; i++) {
      const rect = await driver.getWindowRect();
      const box = await this.boundingBox({ timeout: opts?.visibleTimeout ?? 500 }).catch(
        () => null,
      );
      if (!box) return;
      const bottom = box.y + box.height;
      const limit = rect.height * (1 - margin);
      if (bottom <= limit) return; // already clears the bottom margin
      // Reveal content below (finger swipes UP) so the element moves up. Travel
      // ~the overshoot, capped; slow drag to keep it ~1:1 with minimal fling.
      const overshootFrac = Math.min(0.4, (bottom - limit) / rect.height);
      const x = Math.floor(rect.width * xFrac);
      const fromY = Math.floor(rect.height * (0.5 + overshootFrac / 2));
      const toY = Math.floor(rect.height * (0.5 - overshootFrac / 2));
      try {
        await driver.performActions([
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y: fromY },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: opts?.duration ?? 600, x, y: toY },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ]);
      } finally {
        await driver.releaseActions().catch(() => {});
      }
    }
  }

  private async scrollUntilVisible(opts?: ScrollIntoViewOptions): Promise<void> {
    const direction: ScrollDirection = opts?.direction ?? 'down';
    const maxAttempts = opts?.maxAttempts ?? 10;
    const visibleTimeout = opts?.visibleTimeout ?? 500;
    const driver = this.ctx.driver;

    // Native paths first.
    if (!opts?.forceGesture) {
      if (this.ctx.platform === Platform.IOS) {
        const id = await this.resolveOnce();
        if (id) {
          try {
            await driver.executeScript('mobile: scroll', [{ elementId: id, toVisible: true }]);
            return;
          } catch {
            // Fall through to gesture fallback.
          }
        }
      } else if (
        this.ctx.platform === Platform.ANDROID &&
        this.strategy.using === '-android uiautomator'
      ) {
        const wrapped = `new UiScrollable(new UiSelector().scrollable(true).instance(0)).scrollIntoView(${this.strategy.value})`;
        try {
          await driver.findElement('-android uiautomator', wrapped);
          return;
        } catch {
          // Fall through to gesture fallback.
        }
      }
    }

    // Gesture fallback.
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isVisible({ timeout: visibleTimeout })) return;
      const rect = await driver.getWindowRect();
      const cx = Math.floor(rect.width / 2);
      const cy = Math.floor(rect.height / 2);
      const span = Math.floor(Math.min(rect.width, rect.height) * (opts?.distance ?? 0.4));
      // `direction` is the content-reveal direction — invert it for the
      // finger gesture. To reveal content BELOW (`'down'`), the finger
      // must swipe UPWARD (from lower y to upper y). Same logic for the
      // horizontal axis: revealing content to the RIGHT means swiping the
      // finger leftward.
      const defaultFromX =
        direction === 'left' ? cx - span : direction === 'right' ? cx + span : cx;
      const defaultFromY = direction === 'up' ? cy - span : direction === 'down' ? cy + span : cy;
      const defaultToX = direction === 'left' ? cx + span : direction === 'right' ? cx - span : cx;
      const defaultToY = direction === 'up' ? cy + span : direction === 'down' ? cy - span : cy;
      const fromX =
        opts?.from?.x !== undefined ? Math.floor(rect.width * opts.from.x) : defaultFromX;
      const fromY =
        opts?.from?.y !== undefined ? Math.floor(rect.height * opts.from.y) : defaultFromY;
      const toX = opts?.to?.x !== undefined ? Math.floor(rect.width * opts.to.x) : defaultToX;
      const toY = opts?.to?.y !== undefined ? Math.floor(rect.height * opts.to.y) : defaultToY;

      try {
        await driver.performActions([
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: opts?.duration ?? 300, x: toX, y: toY },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ]);
      } finally {
        await driver.releaseActions().catch(() => {});
      }
    }

    // Final visibility check after the last swipe — otherwise a failed scroll
    // returns silently and the next action fails with a less informative error.
    if (await this.isVisible({ timeout: visibleTimeout })) return;
    throw new Error(
      `scrollIntoView: locator (${this.strategy.using}=${this.strategy.value}) did not become visible after ${maxAttempts} ${direction} swipe attempt(s)`,
    );
  }

  /** Swipe leftward inside this element's bounding box. */
  async swipeLeft(opts?: ElementSwipeOptions): Promise<void> {
    return this.swipeElement('left', opts);
  }

  /** Swipe rightward inside this element's bounding box. */
  async swipeRight(opts?: ElementSwipeOptions): Promise<void> {
    return this.swipeElement('right', opts);
  }

  /** Swipe upward inside this element's bounding box. */
  async swipeUp(opts?: ElementSwipeOptions): Promise<void> {
    return this.swipeElement('up', opts);
  }

  /** Swipe downward inside this element's bounding box. */
  async swipeDown(opts?: ElementSwipeOptions): Promise<void> {
    return this.swipeElement('down', opts);
  }

  /**
   * Two-finger pinch-in (zoom out) gesture on this element.
   *
   * Android uses native `mobile: pinchCloseGesture`. iOS synthesizes the
   * gesture via two simultaneous W3C pointer chains — `mobile: pinch` is
   * unreliable on many real apps because the underlying `XCUIElement.pinch`
   * needs the element to have a pinch-recognizer attached, whereas a real
   * two-finger touch is honored by any view in the responder chain.
   *
   * @example
   *   await mobile.getByType('android.widget.ImageView').pinchIn();
   */
  async pinchIn(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    if (this.ctx.platform === Platform.IOS) {
      await this.iosTwoFingerPinch(id, 'in');
    } else {
      await this.ctx.driver.executeScript('mobile: pinchCloseGesture', [
        { elementId: id, percent: 0.75 },
      ]);
    }
  }

  /**
   * Two-finger pinch-out (zoom in) gesture on this element. See `pinchIn`
   * for the iOS gesture-synthesis rationale.
   *
   * @example
   *   await mobile.getByType('android.widget.ImageView').pinchOut();
   */
  async pinchOut(opts?: ActionOptions): Promise<void> {
    const id = await this.resolveActionable(opts);
    if (this.ctx.platform === Platform.IOS) {
      await this.iosTwoFingerPinch(id, 'out');
    } else {
      await this.ctx.driver.executeScript('mobile: pinchOpenGesture', [
        { elementId: id, percent: 0.75 },
      ]);
    }
  }

  /**
   * Synthesize an iOS pinch by driving two pointers along the element's
   * horizontal axis. `mode === 'in'` brings the fingers toward the centre
   * (zoom out); `mode === 'out'` spreads them away (zoom in). The 400ms
   * move duration is slow enough for the gesture recognizer to register
   * but fast enough to feel like a real pinch.
   */
  private async iosTwoFingerPinch(id: string, mode: 'in' | 'out'): Promise<void> {
    const driver = this.ctx.driver;
    const rect = await driver.getElementRect(id);
    const cx = Math.floor(rect.x + rect.width / 2);
    const cy = Math.floor(rect.y + rect.height / 2);
    const span = Math.max(20, Math.floor(Math.min(rect.width, rect.height) * 0.4));
    const close = Math.max(8, Math.floor(span * 0.25));
    const fromOffset = mode === 'in' ? span : close;
    const toOffset = mode === 'in' ? close : span;
    try {
      await driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: cx - fromOffset, y: cy },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration: 400, x: cx - toOffset, y: cy },
            { type: 'pointerUp', button: 0 },
          ],
        },
        {
          type: 'pointer',
          id: 'finger2',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: cx + fromOffset, y: cy },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration: 400, x: cx + toOffset, y: cy },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await driver.releaseActions().catch(() => {
        /* ignore */
      });
    }
  }

  /**
   * Drag this element onto another. Useful for reorderable lists,
   * kanban-style targets, drag-to-fold, etc. The default `duration` of 500ms
   * is tuned to trigger iOS drag-mode; reduce for snappier interactions.
   */
  async dragTo(target: Locator, opts?: DragOptions): Promise<void> {
    const sourceId = await this.resolveActionable(opts);
    const targetId = await target.resolveActionable(opts);
    const driver = this.ctx.driver;

    const sourceRect = await driver.getElementRect(sourceId);
    const targetRect = await driver.getElementRect(targetId);
    const fromX = Math.floor(sourceRect.x + sourceRect.width * (opts?.from?.x ?? 0.5));
    const fromY = Math.floor(sourceRect.y + sourceRect.height * (opts?.from?.y ?? 0.5));
    const toX = Math.floor(targetRect.x + targetRect.width * (opts?.to?.x ?? 0.5));
    const toY = Math.floor(targetRect.y + targetRect.height * (opts?.to?.y ?? 0.5));

    await this.executeDrag({ x: fromX, y: fromY }, { x: toX, y: toY }, opts);
  }

  /**
   * Drag this element to an absolute screen point. The drag starts from the
   * element's center (override with `opts.from` as fractions of the bbox).
   */
  async dragToPoint(point: { x: number; y: number }, opts?: DragOptions): Promise<void> {
    const sourceId = await this.resolveActionable(opts);
    const driver = this.ctx.driver;

    const sourceRect = await driver.getElementRect(sourceId);
    const fromX = Math.floor(sourceRect.x + sourceRect.width * (opts?.from?.x ?? 0.5));
    const fromY = Math.floor(sourceRect.y + sourceRect.height * (opts?.from?.y ?? 0.5));

    await this.executeDrag({ x: fromX, y: fromY }, point, opts);
  }

  // ─── Queries ───────────────────────────────────────────────────────

  async isVisible(opts?: ActionOptions): Promise<boolean> {
    const timeout = opts?.timeout ?? this.ctx.defaultTimeout;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const id = await this.resolveOnce();
      if (id) {
        try {
          if (await this.ctx.driver.isElementDisplayed(id)) return true;
        } catch {
          // element gone — try again
        }
      }
      await sleep(POLL_INTERVAL);
    }
    return false;
  }

  async isEnabled(opts?: ActionOptions): Promise<boolean> {
    const id = await this.resolveActionable(opts);
    return this.ctx.driver.isElementEnabled(id);
  }

  async getText(opts?: ActionOptions): Promise<string> {
    const id = await this.resolveVisible(opts);
    return this.ctx.driver.getElementText(id);
  }

  async getValue(opts?: ActionOptions): Promise<string> {
    const id = await this.resolveVisible(opts);
    if (this.ctx.platform === Platform.ANDROID) {
      // UiAutomator2 typically returns null for `value`; the displayed
      // contents live on the `text` attribute (or getElementText).
      const text = await this.ctx.driver.getElementAttribute(id, 'text');
      if (text !== null && text !== undefined) return text;
      return (await this.ctx.driver.getElementText(id).catch(() => '')) ?? '';
    }
    const attr = await this.ctx.driver.getElementAttribute(id, 'value');
    return attr ?? '';
  }

  async boundingBox(opts?: ActionOptions): Promise<BoundingBox> {
    const id = await this.resolveVisible(opts);
    const rect = await this.ctx.driver.getElementRect(id);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  /**
   * Raw attribute read. Drivers normalise booleans to the strings `'true'` /
   * `'false'`; numeric / structured attributes come back as their string
   * representation. Returns `null` if the attribute is absent or the read
   * throws (matches how `getElementAttribute` behaves in WebDriver clients).
   */
  async getAttribute(name: string, opts?: ActionOptions): Promise<string | null> {
    const id = await this.resolveVisible(opts);
    const v = await this.ctx.driver.getElementAttribute(id, name).catch(() => null);
    return v ?? null;
  }

  /**
   * True iff this element currently has keyboard focus. Reads `'focused'`
   * on Android, `'hasKeyboardFocus'` on iOS (with `'focused'` as fallback —
   * older XCUITest versions exposed it under that name).
   */
  async isFocused(opts?: ActionOptions): Promise<boolean> {
    const id = await this.resolveVisible(opts);
    if (this.ctx.platform === Platform.ANDROID) {
      const v = await this.ctx.driver.getElementAttribute(id, 'focused').catch(() => null);
      return v === 'true';
    }
    const v = await this.ctx.driver.getElementAttribute(id, 'hasKeyboardFocus').catch(() => null);
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    // Fallback for older drivers.
    const alt = await this.ctx.driver.getElementAttribute(id, 'focused').catch(() => null);
    return alt === 'true' || alt === '1';
  }

  /**
   * Heuristic "is editable" check. Mobile has no single canonical attribute
   * for this, so we approximate:
   *
   * - **Android**: class includes `EditText`, AND `enabled === 'true'`.
   * - **iOS**: type is `TextField` / `SecureTextField` / `TextView`, AND
   *   `enabled === 'true'`.
   *
   * Custom input widgets (React Native `TextInput`, Flutter `EditableText`)
   * usually render as one of the above; if your stack uses something else,
   * use `getAttribute(...)` + `assertAttribute(...)` directly.
   */
  async isEditable(opts?: ActionOptions): Promise<boolean> {
    const id = await this.resolveVisible(opts);
    const enabled = await this.ctx.driver.isElementEnabled(id).catch(() => false);
    if (!enabled) return false;
    if (this.ctx.platform === Platform.ANDROID) {
      const cls = await this.ctx.driver.getElementAttribute(id, 'class').catch(() => null);
      return typeof cls === 'string' && cls.includes('EditText');
    }
    const type = await this.ctx.driver.getElementAttribute(id, 'type').catch(() => null);
    return (
      type === 'XCUIElementTypeTextField' ||
      type === 'XCUIElementTypeSecureTextField' ||
      type === 'XCUIElementTypeTextView'
    );
  }

  /**
   * True iff the element's bounding box intersects the device viewport
   * (window rect). Off-screen and zero-area elements return `false`.
   * Waits for the element to be visible first (so an off-screen but
   * scrollable element gets a fair check).
   */
  async isInViewport(opts?: ActionOptions): Promise<boolean> {
    const id = await this.resolveVisible(opts);
    try {
      const [rect, win] = await Promise.all([
        this.ctx.driver.getElementRect(id),
        this.ctx.driver.getWindowRect(),
      ]);
      if (rect.width <= 0 || rect.height <= 0) return false;
      return (
        rect.x < win.width &&
        rect.x + rect.width > 0 &&
        rect.y < win.height &&
        rect.y + rect.height > 0
      );
    } catch {
      return false;
    }
  }

  /**
   * True iff the element has no children and no text. Useful for "the form
   * was cleared" / "the list rendered empty" assertions. Children counted
   * via XPath `./*` on the resolved element; text counted via `getText` +
   * the Android `text`-attribute fallback `getValue` already uses.
   */
  async isEmpty(opts?: ActionOptions): Promise<boolean> {
    const id = await this.resolveVisible(opts);
    try {
      const children = (await this.ctx.driver.findElementsFromElement(
        id,
        'xpath',
        './*',
      )) as ElementRef[];
      if (children && children.length > 0) return false;
    } catch {
      // some drivers reject this xpath on leaf elements — treat as no children
    }
    const text = await this.readElementText(id);
    return text.length === 0;
  }

  // ─── Assertions ────────────────────────────────────────────────────
  // These wrap the state/value methods above so a failed expectation throws
  // with a useful message, matching how Playwright's `expect(...).toBeXxx()`
  // behaves. We can't override Playwright's matchers for taqwright Locators
  // (Playwright dispatches by matcher name and the built-ins are hardcoded
  // to its own Locator class), so we expose plain methods instead.

  /** Assert the element is visible within `opts.timeout` (default ctx default). */
  async assertVisible(opts?: ActionOptions): Promise<void> {
    return this.waitFor({ state: 'visible', timeout: opts?.timeout });
  }
  /** Assert the element is hidden (or detached) within `opts.timeout`. */
  async assertHidden(opts?: ActionOptions): Promise<void> {
    return this.waitFor({ state: 'hidden', timeout: opts?.timeout });
  }
  /** Assert the element is enabled within `opts.timeout`. */
  async assertEnabled(opts?: ActionOptions): Promise<void> {
    return this.waitFor({ state: 'enabled', timeout: opts?.timeout });
  }
  /** Assert the element is disabled within `opts.timeout`. */
  async assertDisabled(opts?: ActionOptions): Promise<void> {
    return this.waitFor({ state: 'disabled', timeout: opts?.timeout });
  }

  /** Assert the toggle is checked within `opts.timeout`. Polls `isChecked`. */
  async assertChecked(opts?: ActionOptions): Promise<void> {
    return this.waitForChecked(true, opts);
  }
  /** Assert the toggle is unchecked within `opts.timeout`. Polls `isChecked`. */
  async assertUnchecked(opts?: ActionOptions): Promise<void> {
    return this.waitForChecked(false, opts);
  }

  /** Assert the element exists in the UI tree (whether or not it's visible). */
  async assertAttached(opts?: ActionOptions): Promise<void> {
    return this.waitFor({ state: 'attached', timeout: opts?.timeout });
  }

  /** Assert this is an editable input. See `isEditable` for the heuristic. */
  async assertEditable(opts?: ActionOptions): Promise<void> {
    await this.pollBooleanQuery('editable', () => this.isEditable(opts), true, opts);
  }
  /** Assert this is NOT editable (disabled, or not an input control). */
  async assertReadonly(opts?: ActionOptions): Promise<void> {
    await this.pollBooleanQuery('editable', () => this.isEditable(opts), false, opts);
  }

  /** Assert the element currently holds keyboard focus. */
  async assertFocused(opts?: ActionOptions): Promise<void> {
    await this.pollBooleanQuery('focused', () => this.isFocused(opts), true, opts);
  }

  /** Assert the element has no children and no text. */
  async assertEmpty(opts?: ActionOptions): Promise<void> {
    await this.pollBooleanQuery('empty', () => this.isEmpty(opts), true, opts);
  }

  /** Assert the element's bounding box intersects the viewport. */
  async assertInViewport(opts?: ActionOptions): Promise<void> {
    await this.pollBooleanQuery('inViewport', () => this.isInViewport(opts), true, opts);
  }

  /**
   * Assert the chain currently matches `expected` elements. Polls `count()`
   * until equality or timeout — pairs with `all()` / `nth()` to make
   * list-shape assertions stable.
   */
  async assertCount(expected: number, opts?: ActionOptions): Promise<void> {
    const timeout = opts?.timeout ?? this.ctx.defaultTimeout;
    const deadline = Date.now() + timeout;
    let last = -1;
    while (Date.now() < deadline) {
      try {
        last = await this.count();
        if (last === expected) return;
      } catch {
        // ignore — list may not be ready yet
      }
      await sleep(POLL_INTERVAL);
    }
    throw new Error(
      `assertCount: expected ${expected} but found ${last} within ${timeout}ms ` +
        `(${this.strategy.using}=${this.strategy.value})`,
    );
  }

  /**
   * Assert an arbitrary attribute matches. `expected` is either a strict
   * equality string or a `RegExp`. The attribute value is read each poll,
   * so the assertion auto-retries until the timeout.
   */
  async assertAttribute(
    name: string,
    expected: string | RegExp,
    opts?: ActionOptions,
  ): Promise<void> {
    const predicate =
      typeof expected === 'string'
        ? (v: string | null) => v === expected
        : (v: string | null) => v !== null && expected.test(v);
    const timeout = opts?.timeout ?? this.ctx.defaultTimeout;
    const deadline = Date.now() + timeout;
    let last: string | null = null;
    while (Date.now() < deadline) {
      const id = await this.resolveOnce();
      if (id) {
        last = await this.ctx.driver.getElementAttribute(id, name).catch(() => null);
        if (predicate(last)) return;
      }
      await sleep(POLL_INTERVAL);
    }
    const expectedStr = expected instanceof RegExp ? expected.toString() : JSON.stringify(expected);
    throw new Error(
      `assertAttribute(${JSON.stringify(name)}): expected ${expectedStr} within ${timeout}ms ` +
        `(got: ${last !== null ? JSON.stringify(last) : '<null>'})`,
    );
  }

  /** Poll a boolean-returning query until it matches `expected` or timeout. */
  private async pollBooleanQuery(
    label: string,
    getter: () => Promise<boolean>,
    expected: boolean,
    opts?: ActionOptions,
  ): Promise<void> {
    const timeout = opts?.timeout ?? this.ctx.defaultTimeout;
    const deadline = Date.now() + timeout;
    let last: boolean | undefined;
    while (Date.now() < deadline) {
      try {
        last = await getter();
        if (last === expected) return;
      } catch {
        // ignore — element may not be resolvable yet
      }
      await sleep(POLL_INTERVAL);
    }
    throw new Error(
      `assert ${label}: expected ${expected} within ${timeout}ms (last: ${last ?? '<unresolved>'})`,
    );
  }

  /**
   * Assert the element's text equals `expected` (string) or matches it
   * (RegExp) within `opts.timeout`. Polls every 200ms; reports the actual
   * text seen on failure.
   */
  async assertText(expected: string | RegExp, opts?: ActionOptions): Promise<void> {
    const predicate =
      typeof expected === 'string'
        ? (v: string) => v === expected
        : (v: string) => expected.test(v);
    await this.assertGetter('text', () => this.getText(), predicate, expected, opts);
  }
  /** Assert the element's text contains `expected` substring within `opts.timeout`. */
  async assertContainsText(expected: string, opts?: ActionOptions): Promise<void> {
    await this.assertGetter(
      'text',
      () => this.getText(),
      (v) => v.includes(expected),
      `contains ${JSON.stringify(expected)}`,
      opts,
    );
  }
  /** Assert the element's value equals `expected` within `opts.timeout`. */
  async assertValue(expected: string | RegExp, opts?: ActionOptions): Promise<void> {
    const predicate =
      typeof expected === 'string'
        ? (v: string) => v === expected
        : (v: string) => expected.test(v);
    await this.assertGetter('value', () => this.getValue(), predicate, expected, opts);
  }

  /** Internal: poll a getter until the predicate passes or timeout. */
  private async assertGetter(
    field: string,
    getter: () => Promise<string>,
    predicate: (v: string) => boolean,
    expected: string | RegExp,
    opts?: ActionOptions,
  ): Promise<void> {
    const timeout = opts?.timeout ?? this.ctx.defaultTimeout;
    const deadline = Date.now() + timeout;
    let last: string | undefined;
    while (Date.now() < deadline) {
      try {
        last = await getter();
        if (predicate(last)) return;
      } catch {
        // ignore — element may not be resolvable yet
      }
      await sleep(POLL_INTERVAL);
    }
    const expectedStr = expected instanceof RegExp ? expected.toString() : JSON.stringify(expected);
    throw new Error(
      `assert ${field}: expected ${expectedStr} within ${timeout}ms ` +
        `(got: ${last !== undefined ? JSON.stringify(last) : '<unresolved>'})`,
    );
  }

  async waitFor(opts?: WaitForOptions): Promise<void> {
    const state = opts?.state ?? 'visible';
    const timeout = opts?.timeout ?? this.ctx.defaultTimeout;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.matchesState(state)) return;
      await sleep(POLL_INTERVAL);
    }
    throw new Error(
      `waitFor: locator (${this.strategy.using}=${this.strategy.value}) did not reach state "${state}" within ${timeout}ms`,
    );
  }

  // ─── Chain shaping ─────────────────────────────────────────────────

  /**
   * Narrow this locator by predicate. All options AND together; multiple
   * `filter()` calls compose as additional AND clauses. See
   * `LocatorFilterOptions` for the supported keys.
   *
   * @example
   *   mobile.getByType('android.widget.TextView')
   *     .filter({ hasText: 'Wi-Fi' })
   *     .filter({ has: mobile.getByType('android.widget.Switch') })
   *     .click();
   */
  filter(opts: LocatorFilterOptions): Locator {
    if (opts.visible === false) {
      throw new Error(
        'filter({ visible: false }) is not supported; use assertHidden or filter({ hasNot: ... }) instead',
      );
    }
    return this.derive({
      chainOps: [...this.state.chainOps, { kind: 'filter', filter: opts }],
    });
  }

  /** Pin to the first match. Overwrites any prior `first/last/nth`. */
  first(): Locator {
    return this.derive({ indexSelector: { kind: 'first' } });
  }

  /** Pin to the last match. Overwrites any prior `first/last/nth`. */
  last(): Locator {
    return this.derive({ indexSelector: { kind: 'last' } });
  }

  /**
   * Pin to the `n`-th match (0-indexed). Negative values count from the end
   * (Playwright parity — `nth(-1)` equals `last()`).
   */
  nth(n: number): Locator {
    if (!Number.isInteger(n)) {
      throw new Error(`Locator.nth(${n}): index must be an integer`);
    }
    return this.derive({ indexSelector: { kind: 'nth', n } });
  }

  /**
   * Chain a child find rooted at this element. Each action re-resolves
   * `this` first, then resolves `child` via `findElementsFromElement`.
   *
   * Throws if `child` was built against a different `Mobile` / session.
   */
  locator(child: Locator | LocatorStrategy): Locator {
    let childLoc: Locator;
    if (child instanceof Locator) {
      if (child.ctx !== this.ctx) {
        throw new Error(
          'locator.locator(): child Locator was created against a different Mobile/session',
        );
      }
      childLoc = child;
    } else {
      childLoc = Locator.fromStrategy(this.ctx, child);
    }
    return childLoc.rebaseRoot(this);
  }

  /**
   * Intersection: matches elements found by both `this` and `other`. Compared
   * by W3C element id, so both sides must resolve within the same Appium
   * session (always true if both come from the same `mobile`).
   */
  and(other: Locator): Locator {
    if (other.ctx !== this.ctx) {
      throw new Error(
        'Locator.and(): other Locator was created against a different Mobile/session',
      );
    }
    return this.derive({
      chainOps: [...this.state.chainOps, { kind: 'and', other }],
    });
  }

  /** Union: matches elements found by either `this` or `other`. */
  or(other: Locator): Locator {
    if (other.ctx !== this.ctx) {
      throw new Error('Locator.or(): other Locator was created against a different Mobile/session');
    }
    return this.derive({
      chainOps: [...this.state.chainOps, { kind: 'or', other }],
    });
  }

  // ─── Bulk resolution ───────────────────────────────────────────────

  /** Number of elements currently matched by the full chain. */
  async count(): Promise<number> {
    return (await this.resolveAll()).length;
  }

  /**
   * Returns one index-pinned locator per current match. Each returned locator
   * re-resolves the chain on every action (no stale element ids), but the
   * index is fixed — if the list mutates between `all()` and the per-element
   * action, indices may shift.
   */
  async all(): Promise<Locator[]> {
    const n = (await this.resolveAll()).length;
    return Array.from({ length: n }, (_, i) => this.nth(i));
  }

  /**
   * Read the visible text of every currently-matched element. On Android,
   * falls back to the `text` attribute when `getElementText` returns empty
   * (matches `getValue`'s behaviour). Errors per element collapse to `''`.
   *
   * On mobile, `allInnerTexts` and `allTextContents` are aliases (no
   * CSS-display analogue).
   */
  async allInnerTexts(): Promise<string[]> {
    const ids = await this.resolveAll();
    return Promise.all(ids.map((id) => this.readElementText(id)));
  }

  /** Alias for `allInnerTexts` — see that method for caveats. */
  async allTextContents(): Promise<string[]> {
    return this.allInnerTexts();
  }

  private async readElementText(id: string): Promise<string> {
    const text = await this.ctx.driver.getElementText(id).catch(() => '');
    if (text) return text;
    if (this.ctx.platform === Platform.ANDROID) {
      const attr = await this.ctx.driver.getElementAttribute(id, 'text').catch(() => null);
      if (attr !== null && attr !== undefined) return attr;
    }
    return '';
  }

  // ─── Internal resolution ───────────────────────────────────────────

  private async matchesState(state: NonNullable<WaitForOptions['state']>): Promise<boolean> {
    const id = await this.resolveOnce();
    if (state === 'attached') return id !== null;
    if (state === 'hidden') {
      if (!id) return true;
      try {
        return !(await this.ctx.driver.isElementDisplayed(id));
      } catch {
        return true;
      }
    }
    if (!id) return false;
    try {
      if (state === 'visible') return await this.ctx.driver.isElementDisplayed(id);
      if (state === 'enabled') return await this.ctx.driver.isElementEnabled(id);
      if (state === 'disabled') return !(await this.ctx.driver.isElementEnabled(id));
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Find all elements matching this locator's full chain (parent → strategy →
   * textFilter → chain ops → index selector). The primitive that every other
   * resolution method funnels through.
   *
   * `pinnedIds` short-circuits when set (used by `has`/`hasNot` scoping).
   */
  private async resolveAll(): Promise<string[]> {
    if (this.pinnedIds !== undefined) {
      return [...this.pinnedIds];
    }

    // 1. Raw candidates — either rooted at each parent id, or global.
    let candidates: string[] = [];
    const shortCircuitFirst =
      this.state.indexSelector?.kind === 'first' &&
      this.state.chainOps.length === 0 &&
      this.strategy.textFilter === undefined;

    if (this.state.parent) {
      let parentIds: string[];
      try {
        parentIds = await this.state.parent.resolveAll();
      } catch {
        parentIds = [];
      }
      const seen = new Set<string>();
      outer: for (const pid of parentIds) {
        try {
          const refs = (await this.ctx.driver.findElementsFromElement(
            pid,
            this.strategy.using,
            this.strategy.value,
          )) as ElementRef[];
          for (const ref of refs ?? []) {
            const id = ref[W3C_ELEMENT_KEY];
            if (!seen.has(id)) {
              seen.add(id);
              candidates.push(id);
              if (shortCircuitFirst) break outer;
            }
          }
        } catch {
          // skip — this parent yielded nothing
        }
      }
    } else {
      try {
        const refs = (await this.ctx.driver.findElements(
          this.strategy.using,
          this.strategy.value,
        )) as ElementRef[];
        candidates = (refs ?? []).map((r) => r[W3C_ELEMENT_KEY]);
      } catch {
        candidates = [];
      }
    }

    // 2. Strategy-level textFilter (legacy path used by getByText(RegExp)).
    if (this.strategy.textFilter !== undefined) {
      candidates = await this.filterIdsByText(candidates, this.strategy.textFilter, true);
    }

    // 3. Chain ops, in declaration order. Each op narrows the candidate set.
    for (const op of this.state.chainOps) {
      if (candidates.length === 0) break;
      if (op.kind === 'filter') {
        candidates = await this.applyFilterOp(candidates, op.filter);
      } else if (op.kind === 'and') {
        const otherIds = new Set(await op.other.resolveAll());
        candidates = candidates.filter((id) => otherIds.has(id));
      } else if (op.kind === 'or') {
        const others = await op.other.resolveAll();
        const seen = new Set(candidates);
        for (const id of others) {
          if (!seen.has(id)) {
            seen.add(id);
            candidates.push(id);
          }
        }
      }
    }

    // 4. Index selector.
    if (this.state.indexSelector) {
      const sel = this.state.indexSelector;
      if (sel.kind === 'first') {
        return candidates.length > 0 ? [candidates[0]!] : [];
      }
      if (sel.kind === 'last') {
        return candidates.length > 0 ? [candidates[candidates.length - 1]!] : [];
      }
      // nth
      const picked = candidates.at(sel.n!);
      return picked !== undefined ? [picked] : [];
    }

    return candidates;
  }

  /** Find the first element matching the full chain, or `null`. */
  private async resolveOnce(): Promise<string | null> {
    try {
      const ids = await this.resolveAll();
      return ids[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Per-element text probe — checks `getElementText`, the `value` attribute,
   * and the platform-specific accessibility-label attribute (`name` on iOS,
   * `content-desc` on Android). For strings: `exact` controls strict-equality
   * vs substring. For RegExp: always `.test(...)`.
   */
  private async elementMatchesText(
    id: string,
    pattern: string | RegExp,
    exact: boolean,
  ): Promise<boolean> {
    const matchOne = (s: string | null | undefined): boolean => {
      if (s === null || s === undefined) return false;
      if (typeof pattern === 'string') {
        return exact ? s === pattern : s.includes(pattern);
      }
      return pattern.test(s);
    };
    const labelAttr = this.ctx.platform === Platform.IOS ? 'name' : 'content-desc';
    const probes = await Promise.all([
      this.ctx.driver.getElementText(id).catch(() => null),
      this.ctx.driver.getElementAttribute(id, 'value').catch(() => null),
      this.ctx.driver.getElementAttribute(id, labelAttr).catch(() => null),
    ]);
    return probes.some(matchOne);
  }

  private async filterIdsByText(
    ids: string[],
    pattern: string | RegExp,
    exact: boolean,
  ): Promise<string[]> {
    const out: string[] = [];
    for (const id of ids) {
      if (await this.elementMatchesText(id, pattern, exact)) out.push(id);
    }
    return out;
  }

  private async applyFilterOp(
    candidates: string[],
    filter: LocatorFilterOptions,
  ): Promise<string[]> {
    if (filter.visible === false) {
      throw new Error(
        'filter({ visible: false }) is not supported; use assertHidden or filter({ hasNot: ... }) instead',
      );
    }
    const out: string[] = [];
    for (const id of candidates) {
      // visible: true
      if (filter.visible === true) {
        const ok = await this.ctx.driver.isElementDisplayed(id).catch(() => false);
        if (!ok) continue;
      }
      // hasText (substring/regex semantics — Playwright-style)
      if (filter.hasText !== undefined) {
        if (!(await this.elementMatchesText(id, filter.hasText, false))) continue;
      }
      // hasNotText
      if (filter.hasNotText !== undefined) {
        if (await this.elementMatchesText(id, filter.hasNotText, false)) continue;
      }
      // has — child must resolve under this candidate
      if (filter.has) {
        if (!(await this.existsUnder(id, filter.has))) continue;
      }
      // hasNot — child must not resolve under this candidate
      if (filter.hasNot) {
        if (await this.existsUnder(id, filter.hasNot)) continue;
      }
      out.push(id);
    }
    return out;
  }

  /**
   * Returns true iff `child` resolves to ≥1 element rooted at `parentId`.
   * Rebases child's root parent to a pinned locator over `[parentId]` so the
   * child's full chain (filters, nested parents, index selector) still applies.
   */
  private async existsUnder(parentId: string, child: Locator): Promise<boolean> {
    const pinned = Locator.pinnedToIds(this.ctx, [parentId]);
    const rooted = child.rebaseRoot(pinned);
    const ids = await rooted.resolveAll();
    return ids.length > 0;
  }

  /** Wait until visible, then return the element id. */
  private async resolveVisible(opts?: ActionOptions): Promise<string> {
    await this.waitFor({ state: 'visible', timeout: opts?.timeout });
    const id = await this.resolveOnce();
    if (!id) {
      throw new Error(
        `Element (${this.strategy.using}=${this.strategy.value}) disappeared after being found`,
      );
    }
    return id;
  }

  /** Wait until visible AND enabled, then return the element id. */
  private async resolveActionable(opts?: ActionOptions, retried = false): Promise<string> {
    const id = await this.resolveVisible(opts);
    try {
      const enabled = await this.ctx.driver.isElementEnabled(id);
      if (enabled) return id;
      throw new Error(
        `Element (${this.strategy.using}=${this.strategy.value}) is visible but not enabled`,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('not enabled')) throw err;
      // isElementEnabled can throw on stale references — re-resolve once,
      // re-running the enabled check (don't silently return a disabled id).
      if (retried) throw err;
      return this.resolveActionable(opts, true);
    }
  }

  private async swipeElement(
    direction: 'left' | 'right' | 'up' | 'down',
    opts?: ElementSwipeOptions,
  ): Promise<void> {
    const id = await this.resolveActionable();
    const driver = this.ctx.driver;
    const hasOverride = opts?.from !== undefined || opts?.to !== undefined;

    // Native paths first, unless the user gave coordinate overrides we'd lose.
    if (!hasOverride) {
      if (this.ctx.platform === Platform.IOS) {
        // `mobile: swipe` doesn't honor a distance/percent argument, so if
        // the user passed `distance` we skip native to keep that intent.
        if (opts?.distance === undefined) {
          try {
            await driver.executeScript('mobile: swipe', [{ elementId: id, direction }]);
            return;
          } catch {
            // fall through
          }
        }
      } else if (this.ctx.platform === Platform.ANDROID) {
        try {
          await driver.executeScript('mobile: swipeGesture', [
            { elementId: id, direction, percent: opts?.distance ?? 0.4 },
          ]);
          return;
        } catch {
          // fall through
        }
      }
    }

    // Gesture fallback inside the element's bounding box.
    const rect = await driver.getElementRect(id);
    const cx = Math.floor(rect.x + rect.width / 2);
    const cy = Math.floor(rect.y + rect.height / 2);
    const span = Math.floor(Math.min(rect.width, rect.height) * (opts?.distance ?? 0.4));
    const defaultFromX = direction === 'left' ? cx + span : direction === 'right' ? cx - span : cx;
    const defaultFromY = direction === 'up' ? cy + span : direction === 'down' ? cy - span : cy;
    const defaultToX = direction === 'left' ? cx - span : direction === 'right' ? cx + span : cx;
    const defaultToY = direction === 'up' ? cy - span : direction === 'down' ? cy + span : cy;
    const fromX =
      opts?.from?.x !== undefined ? Math.floor(rect.x + rect.width * opts.from.x) : defaultFromX;
    const fromY =
      opts?.from?.y !== undefined ? Math.floor(rect.y + rect.height * opts.from.y) : defaultFromY;
    const toX =
      opts?.to?.x !== undefined ? Math.floor(rect.x + rect.width * opts.to.x) : defaultToX;
    const toY =
      opts?.to?.y !== undefined ? Math.floor(rect.y + rect.height * opts.to.y) : defaultToY;

    try {
      await driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerMove', duration: opts?.duration ?? 300, x: toX, y: toY },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await driver.releaseActions().catch(() => {});
    }
  }

  private async executeDrag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    opts?: DragOptions,
  ): Promise<void> {
    const driver = this.ctx.driver;
    const holdMs = opts?.duration ?? 500;

    if (this.ctx.platform === Platform.IOS) {
      try {
        await driver.executeScript('mobile: dragFromToForDuration', [
          {
            duration: holdMs / 1000,
            fromX: from.x,
            fromY: from.y,
            toX: to.x,
            toY: to.y,
          },
        ]);
        return;
      } catch {
        // fall through to gesture
      }
    } else if (this.ctx.platform === Platform.ANDROID) {
      try {
        await driver.executeScript('mobile: dragGesture', [
          {
            startX: from.x,
            startY: from.y,
            endX: to.x,
            endY: to.y,
            speed: opts?.speed ?? 2500,
          },
        ]);
        return;
      } catch {
        // fall through to gesture
      }
    }

    const moveMs = opts?.moveDuration ?? 300;
    try {
      await driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: from.x, y: from.y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: holdMs },
            { type: 'pointerMove', duration: moveMs, x: to.x, y: to.y },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await driver.releaseActions().catch(() => {});
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when a WebDriver error is the "invalid element state" raised by
 * UiAutomator2 / XCUITest when a value write hits a non-editable node
 * (e.g. the accessibility wrapper instead of the inner EditText).
 */
function isInvalidElementState(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? String(err);
  return /invalid element state|Cannot set the element/i.test(msg);
}

/**
 * Split a `SelectOptionInput` carrying a `date` or `time` into the per-wheel
 * string values an iOS DatePicker expects:
 *
 *   `{ date: '2024-03-15' }` → `['2024', 'March', '15']` (3 wheels)
 *   `{ time: '14:30' }`      → `['14', '30']`            (2 wheels)
 *
 * iOS PickerWheel labels for months are localised English month names by
 * default; the wheel's `setPickerValue` call also accepts numeric strings
 * for apps that render numeric pickers. We emit the textual month form
 * first; the caller's app may need to override to numeric.
 */
function parseDateOrTime(input: { date?: string; time?: string }): string[] {
  if (input.date) {
    const m = input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      throw new Error(`selectOption: invalid date "${input.date}" — expected YYYY-MM-DD`);
    }
    const monthIdx = Number(m[2]) - 1;
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return [m[1]!, monthNames[monthIdx] ?? m[2]!, m[3]!];
  }
  if (input.time) {
    const m = input.time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
      throw new Error(`selectOption: invalid time "${input.time}" — expected HH:mm`);
    }
    return [m[1]!, m[2]!];
  }
  return [];
}

/**
 * Build an XPath literal for a string that may contain quotes. Mirrors the
 * helper in `src/mobile/index.ts`; kept local to avoid cross-module reach.
 */
function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  const parts = s.split("'");
  const pieces: string[] = [];
  parts.forEach((part, i) => {
    if (i > 0) pieces.push(`"'"`);
    if (part.length > 0) pieces.push(`'${part}'`);
  });
  return `concat(${pieces.join(', ')})`;
}

export { DEFAULT_TIMEOUT as DEFAULT_LOCATOR_TIMEOUT };

/**
 * Reconstruct a `Locator` from a wire-format `LocatorDescriptor`. The
 * inverse of the inspector's serialization — used server-side to drive
 * the device for chained locator actions posted from the inspector UI.
 */
export function buildLocatorFromDescriptor(ctx: LocatorContext, desc: LocatorDescriptor): Locator {
  switch (desc.kind) {
    case 'leaf': {
      const strategy: LocatorStrategy = { using: desc.using, value: desc.value };
      const tf = deserializeText(desc.textFilter);
      if (tf !== undefined) strategy.textFilter = tf;
      return Locator.fromStrategy(ctx, strategy);
    }
    case 'first':
      return buildLocatorFromDescriptor(ctx, desc.on).first();
    case 'last':
      return buildLocatorFromDescriptor(ctx, desc.on).last();
    case 'nth':
      return buildLocatorFromDescriptor(ctx, desc.on).nth(desc.n);
    case 'filter': {
      const base = buildLocatorFromDescriptor(ctx, desc.on);
      return base.filter(deserializeFilter(ctx, desc.filter));
    }
    case 'child': {
      const parent = buildLocatorFromDescriptor(ctx, desc.parent);
      const child = buildLocatorFromDescriptor(ctx, desc.child);
      return parent.locator(child);
    }
    case 'and': {
      const left = buildLocatorFromDescriptor(ctx, desc.left);
      const right = buildLocatorFromDescriptor(ctx, desc.right);
      return left.and(right);
    }
    case 'or': {
      const left = buildLocatorFromDescriptor(ctx, desc.left);
      const right = buildLocatorFromDescriptor(ctx, desc.right);
      return left.or(right);
    }
  }
}

function deserializeText(t: SerializedText | undefined): string | RegExp | undefined {
  if (t === undefined) return undefined;
  if (typeof t === 'string') return t;
  return new RegExp(t.regex, t.flags);
}

function deserializeFilter(ctx: LocatorContext, f: SerializedFilter): LocatorFilterOptions {
  const out: LocatorFilterOptions = {};
  if (f.has) out.has = buildLocatorFromDescriptor(ctx, f.has);
  if (f.hasNot) out.hasNot = buildLocatorFromDescriptor(ctx, f.hasNot);
  const ht = deserializeText(f.hasText);
  if (ht !== undefined) out.hasText = ht;
  const hnt = deserializeText(f.hasNotText);
  if (hnt !== undefined) out.hasNotText = hnt;
  if (f.visible !== undefined) out.visible = f.visible;
  return out;
}
