import { spawn } from 'node:child_process';
import type { Client as WebDriverClient } from 'webdriver';
import {
  Locator,
  type LocatorContext,
  type ScrollIntoViewOptions,
  type DragOptions,
} from '../locator/index.js';
import { ANDROID_NAMED_KEYS, IOS_NAMED_KEYS } from '../keys.js';
import {
  type BoundingBox,
  type GestureOptions,
  type HardwareButton,
  type LocatorStrategy,
  Platform,
  type ScreenSize,
  type SwipeDirection,
} from '../types/index.js';

export interface ClickPoint {
  x: number;
  y: number;
}

export interface SwipeOptions {
  /** Duration of the swipe gesture in milliseconds. Default: 300. */
  duration?: number;
  /**
   * Travel distance as a fraction of `min(width, height)` (0..1). Default: 0.4.
   * Ignored when `from` and `to` are both provided.
   */
  distance?: number;
  /**
   * Start point as fractions of screen (0..1). Each axis is optional and
   * defaults to the direction-aware center anchor. Use to avoid status bars,
   * notches, or to scroll within a specific region of the screen.
   *
   * Supplying both `from` and `to` makes the gesture a literal point-to-point
   * swipe along the exact line you give. With only one of them (or neither),
   * the native direction-based fling is used and the missing axis defaults to
   * the direction-aware anchor.
   */
  from?: { x?: number; y?: number };
  /**
   * End point as fractions of screen (0..1). When both `from` and `to` are
   * provided the gesture targets this point exactly (a literal point-to-point
   * swipe) and `direction`/`distance` are ignored.
   */
  to?: { x?: number; y?: number };
}

export interface GetByOptions {
  exact?: boolean;
}

export interface LaunchAppOptions {
  noWaitAfter?: boolean;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface NetworkConnection {
  wifi: boolean;
  data: boolean;
  airplane: boolean;
}

export interface DeviceLogEntry {
  timestamp: number;
  level: string;
  message: string;
}

export interface ScreenRecordingOptions {
  /** Format hint passed to `mobile: startRecordingScreen` (e.g. `'mpeg4'`). */
  videoType?: string;
  /** Maximum recording length in seconds before auto-stop. */
  timeLimit?: number;
}

export interface PauseOptions {
  /**
   * If false, don't auto-open the system browser to the inspector URL
   * (helpful in CI / headless / SSH sessions). The URL is still logged.
   * Default: `true`.
   */
  openBrowser?: boolean;
  /**
   * Optional fixed port for the inspector. Default: `0` — OS picks a free
   * port. Set this if a corporate firewall / proxy requires a known port.
   */
  port?: number;
}

/**
 * Public Mobile surface, wrapping a raw Appium / WebDriver client. The
 * flat API on `mobile` (no `mobile.screen.*`) is the defining ergonomic
 * of this package.
 */
export class Mobile {
  private readonly ctx: LocatorContext;

  /** @internal */
  constructor(
    private readonly driver: WebDriverClient,
    private readonly platform: Platform,
    private readonly defaultBundleId: string | undefined,
    defaultTimeout: number,
  ) {
    this.ctx = { driver, platform, defaultTimeout };
  }

  /** @internal */
  static wrap(
    driver: WebDriverClient,
    platform: Platform,
    bundleId: string | undefined,
    timeout: number,
  ): Mobile {
    return new Mobile(driver, platform, bundleId, timeout);
  }

  /** Underlying WebDriver client — escape hatch for advanced use. */
  get raw(): WebDriverClient {
    return this.driver;
  }

  getPlatform(): Platform {
    return this.platform;
  }

  // ─── Locator entry points ──────────────────────────────────────────

  getByText(text: string | RegExp, opts?: GetByOptions): Locator {
    if (typeof text === 'string') {
      const exact = opts?.exact ?? true;
      if (this.platform === Platform.IOS) {
        const escaped = escapeSingleQuotes(text);
        const value = exact
          ? `label == '${escaped}' OR value == '${escaped}' OR name == '${escaped}'`
          : `label CONTAINS '${escaped}' OR value CONTAINS '${escaped}'`;
        return Locator.fromStrategy(this.ctx, { using: '-ios predicate string', value });
      }
      const literal = xpathLiteral(text);
      const xpath = exact ? `//*[@text=${literal}]` : `//*[contains(@text, ${literal})]`;
      return Locator.fromStrategy(this.ctx, { using: 'xpath', value: xpath });
    }
    // RegExp: find candidates broadly, then filter by text in the locator.
    const broad: LocatorStrategy =
      this.platform === Platform.IOS
        ? { using: 'xpath', value: '//*[@label or @value]', textFilter: text }
        : { using: 'xpath', value: '//*[@text]', textFilter: text };
    return Locator.fromStrategy(this.ctx, broad);
  }

  getByLabel(label: string, _opts?: GetByOptions): Locator {
    return Locator.fromStrategy(this.ctx, { using: 'accessibility id', value: label });
  }

  getById(id: string): Locator {
    if (this.platform === Platform.IOS) {
      return Locator.fromStrategy(this.ctx, { using: 'accessibility id', value: id });
    }
    return Locator.fromStrategy(this.ctx, { using: 'id', value: id });
  }

  /** Alias for getById; matches Playwright naming. */
  getByTestId(id: string): Locator {
    return this.getById(id);
  }

  getByPlaceholder(text: string, opts?: GetByOptions): Locator {
    const exact = opts?.exact ?? true;
    if (this.platform === Platform.IOS) {
      const escaped = escapeSingleQuotes(text);
      const value = exact
        ? `placeholderValue == '${escaped}'`
        : `placeholderValue CONTAINS '${escaped}'`;
      return Locator.fromStrategy(this.ctx, { using: '-ios predicate string', value });
    }
    const literal = xpathLiteral(text);
    const xpath = exact ? `//*[@hint=${literal}]` : `//*[contains(@hint, ${literal})]`;
    return Locator.fromStrategy(this.ctx, { using: 'xpath', value: xpath });
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): Locator {
    // Best-effort role mapping. Roles map onto common widget types.
    const typeMap: Record<string, { android: string; ios: string }> = {
      button: { android: 'android.widget.Button', ios: 'XCUIElementTypeButton' },
      link: { android: 'android.widget.TextView', ios: 'XCUIElementTypeLink' },
      textbox: { android: 'android.widget.EditText', ios: 'XCUIElementTypeTextField' },
      switch: { android: 'android.widget.Switch', ios: 'XCUIElementTypeSwitch' },
      image: { android: 'android.widget.ImageView', ios: 'XCUIElementTypeImage' },
    };
    const cls = typeMap[role.toLowerCase()];
    const using: LocatorStrategy['using'] = 'class name';
    const value = cls ? (this.platform === Platform.IOS ? cls.ios : cls.android) : role;
    return Locator.fromStrategy(this.ctx, { using, value, textFilter: opts?.name });
  }

  getByType(type: string): Locator {
    return Locator.fromStrategy(this.ctx, { using: 'class name', value: type });
  }

  /**
   * Locate via a small subset of XPath:
   *   //type[@attr="value"]   |   //type   |   [@attr="value"]
   * Supported attrs: hint, content-desc, contentDescription,
   * accessibilityLabel, text, resource-id, label, name, value.
   */
  getByXpath(xpath: string): Locator {
    const trimmed = xpath.trim();
    const m = trimmed.match(/^\/\/([\w.]+)?(?:\[@([\w-]+)\s*=\s*"([^"]*)"\])?$/);
    if (m) {
      const [, type, attr, value] = m;
      if (attr && value !== undefined) {
        switch (attr) {
          // Android `hint` and iOS `placeholderValue` are the placeholder text,
          // NOT the accessibility id. They map to getByPlaceholder, which on
          // Android emits the same `//*[@hint=...]` xpath under the hood.
          case 'hint':
          case 'placeholderValue':
            return this.getByPlaceholder(value);
          case 'content-desc':
          case 'contentDescription':
          case 'accessibilityLabel':
          case 'name':
          case 'label':
            return this.getByLabel(value);
          case 'text':
            return this.getByText(value);
          case 'resource-id': {
            const id = value.includes(':id/') ? value.split(':id/')[1]! : value;
            return this.getById(id);
          }
        }
      }
      if (type && !attr) {
        return this.getByType(type);
      }
    }
    // Fall through: use raw xpath.
    return Locator.fromStrategy(this.ctx, { using: 'xpath', value: xpath });
  }

  /**
   * Locate via a CSS selector. Only resolves inside a WebView context — switch
   * with {@link switchToWebView} first. Works on both Android and iOS once the
   * web context is active.
   *
   * @example
   *   await mobile.switchToWebView();
   *   await mobile.getByCss('a.browse-events').click();
   */
  getByCss(selector: string): Locator {
    return Locator.fromStrategy(this.ctx, { using: 'css selector', value: selector });
  }

  /**
   * Locate via an Android UiSelector expression. UiAutomator2 only.
   *
   * @example
   *   mobile.getByUiSelector('new UiSelector().textContains("Sign").clickable(true)')
   *   mobile.getByUiSelector('new UiScrollable(new UiSelector().scrollable(true))' +
   *     '.scrollIntoView(new UiSelector().text("Settings"))')
   */
  getByUiSelector(selector: string): Locator {
    if (this.platform !== Platform.ANDROID) {
      throw new Error(
        'getByUiSelector is Android-only; use getByPredicate or getByClassChain on iOS',
      );
    }
    return Locator.fromStrategy(this.ctx, { using: '-android uiautomator', value: selector });
  }

  /**
   * Locate via an iOS NSPredicate string. XCUITest only. Fastest iOS strategy
   * but cannot traverse the view hierarchy.
   *
   * @example
   *   mobile.getByPredicate("type == 'XCUIElementTypeButton' AND label == 'Login'")
   *   mobile.getByPredicate("name BEGINSWITH 'btn_' AND enabled == 1")
   */
  getByPredicate(predicate: string): Locator {
    if (this.platform !== Platform.IOS) {
      throw new Error('getByPredicate is iOS-only; use getByUiSelector on Android');
    }
    return Locator.fromStrategy(this.ctx, { using: '-ios predicate string', value: predicate });
  }

  /**
   * Locate via an iOS class-chain expression. XCUITest only. Supports
   * hierarchy and is dramatically faster than XPath on large trees.
   *
   * @example
   *   mobile.getByClassChain('**\/XCUIElementTypeButton[`label == "Login"`]')
   *   mobile.getByClassChain('**\/XCUIElementTypeCell[1]/XCUIElementTypeButton')
   */
  getByClassChain(chain: string): Locator {
    if (this.platform !== Platform.IOS) {
      throw new Error('getByClassChain is iOS-only; use getByUiSelector on Android');
    }
    return Locator.fromStrategy(this.ctx, { using: '-ios class chain', value: chain });
  }

  // ─── App lifecycle ─────────────────────────────────────────────────

  async installApp(path: string): Promise<void> {
    await this.driver.executeScript('mobile: installApp', [{ app: path }]);
  }

  async uninstallApp(bundleId?: string): Promise<void> {
    const id = bundleId ?? this.defaultBundleId;
    if (!id) throw new Error('uninstallApp: bundleId not provided and no default configured');
    await this.driver.executeScript('mobile: removeApp', [{ bundleId: id, appId: id }]);
  }

  async launchApp(bundleId?: string, opts?: LaunchAppOptions): Promise<void> {
    const id = bundleId ?? this.defaultBundleId;
    if (!id) throw new Error('launchApp: bundleId not provided and no default configured');
    const arg = this.platform === Platform.IOS ? { bundleId: id } : { appId: id };
    await this.driver.executeScript('mobile: activateApp', [arg]);
    if (!opts?.noWaitAfter) {
      await this.waitForAppForeground(arg);
    }
  }

  // Poll mobile: queryAppState until the app is running (state >= 3).
  // Freshly installed apps can transiently report a lower state; callers that
  // know they are racing the install should pass { noWaitAfter: true }.
  private async waitForAppForeground(arg: { bundleId: string } | { appId: string }): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const state = await this.driver
        .executeScript('mobile: queryAppState', [arg])
        .catch(() => undefined);
      if (typeof state === 'number' && state >= 3) return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async terminateApp(bundleId?: string): Promise<void> {
    const id = bundleId ?? this.defaultBundleId;
    if (!id) throw new Error('terminateApp: bundleId not provided and no default configured');
    const arg = this.platform === Platform.IOS ? { bundleId: id } : { appId: id };
    await this.driver.executeScript('mobile: terminateApp', [arg]);
  }

  async activateApp(bundleId?: string): Promise<void> {
    return this.launchApp(bundleId);
  }

  async close(): Promise<void> {
    try {
      await this.driver.deleteSession();
    } catch {
      // session might already be torn down
    }
  }

  // ─── Screen-level actions ──────────────────────────────────────────

  async click(point: ClickPoint): Promise<void> {
    try {
      await this.driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: point.x, y: point.y },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await this.driver.releaseActions().catch(() => {});
    }
  }

  /** Alias for `click(point)` — matches the more common mobile term. */
  async tap(point: ClickPoint): Promise<void> {
    return this.click(point);
  }

  async swipe(direction: SwipeDirection, opts?: SwipeOptions): Promise<void> {
    const rect = await this.driver.getWindowRect();
    const cx = Math.floor(rect.width / 2);
    const cy = Math.floor(rect.height / 2);
    const span = Math.floor(Math.min(rect.width, rect.height) * (opts?.distance ?? 0.4));

    // Direction-aware default anchors: start "ahead" of center, end "behind"
    // so a single gesture spans ~2*distance of the screen.
    const defaultFromX = direction === 'left' ? cx + span : direction === 'right' ? cx - span : cx;
    const defaultFromY = direction === 'up' ? cy + span : direction === 'down' ? cy - span : cy;
    const defaultToX = direction === 'left' ? cx - span : direction === 'right' ? cx + span : cx;
    const defaultToY = direction === 'up' ? cy - span : direction === 'down' ? cy + span : cy;

    const fromX = opts?.from?.x !== undefined ? Math.floor(rect.width * opts.from.x) : defaultFromX;
    const fromY =
      opts?.from?.y !== undefined ? Math.floor(rect.height * opts.from.y) : defaultFromY;
    const toX = opts?.to?.x !== undefined ? Math.floor(rect.width * opts.to.x) : defaultToX;
    const toY = opts?.to?.y !== undefined ? Math.floor(rect.height * opts.to.y) : defaultToY;

    // When the caller supplies BOTH `from` and `to` they're describing an
    // exact start→end line, not a direction. The native gesture commands
    // below take a region + direction + percent, which collapses a literal
    // line into a bounding box (a vertical swipe where from.x === to.x
    // degenerates to a 2px-wide sliver). So for an explicit line we skip the
    // native path and fall straight through to the W3C pointer line below,
    // which honours the exact pixel coordinates on every platform.
    const hasExplicitLine = opts?.from !== undefined && opts?.to !== undefined;

    // Prefer Appium's native gesture commands when available — raw W3C
    // pointer events at 300ms get classified as a slow drag by UiAutomator2,
    // not a fling, so the page never scrolls. The native gesture API
    // produces a proper velocity-bearing fling that scrollable containers
    // recognize. Fall back to performActions if the driver doesn't expose
    // it (older versions, custom builds).
    if (!hasExplicitLine && this.platform === Platform.ANDROID) {
      // Translate any from/to overrides into a sub-region rectangle. The
      // defaults are deliberately conservative: a 40–60% Y band centered
      // on x=50% — enough to register as a fling in most lists, narrow
      // enough to avoid sticky headers / nav bars / pull-to-refresh.
      const yFrac =
        opts?.from?.y !== undefined || opts?.to?.y !== undefined
          ? [opts?.from?.y ?? opts?.to?.y ?? 0.4, opts?.to?.y ?? opts?.from?.y ?? 0.6]
          : [0.4, 0.6];
      const xFrac =
        opts?.from?.x !== undefined || opts?.to?.x !== undefined
          ? [opts?.from?.x ?? opts?.to?.x ?? 0.5, opts?.to?.x ?? opts?.from?.x ?? 0.5]
          : [0.5, 0.5];
      const yLow = Math.min(yFrac[0]!, yFrac[1]!);
      const yHigh = Math.max(yFrac[0]!, yFrac[1]!);
      const xLow = Math.min(xFrac[0]!, xFrac[1]!);
      const xHigh = Math.max(xFrac[0]!, xFrac[1]!);
      try {
        await this.driver.executeScript('mobile: swipeGesture', [
          {
            left: Math.floor(rect.width * xLow),
            top: Math.floor(rect.height * yLow),
            width: Math.max(2, Math.floor(rect.width * (xHigh - xLow))),
            height: Math.max(2, Math.floor(rect.height * (yHigh - yLow))),
            direction,
            percent: opts?.distance ?? 0.75,
          },
        ]);
        return;
      } catch {
        // Unsupported — fall through to W3C pointer actions below.
      }
    }
    if (!hasExplicitLine && this.platform === Platform.IOS) {
      try {
        await this.driver.executeScript('mobile: swipe', [{ direction }]);
        return;
      } catch {
        // Unsupported — fall through.
      }
    }

    // Exact-line swipe (and the fallback for drivers without native gestures):
    // a true finger swipe — press, move, release, no press-hold. For an
    // explicit `from`/`to` line, `duration` is the caller's speed knob —
    // shorter moves carry more momentum and read as a fling.
    try {
      await this.driver.performActions([
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
      await this.driver.releaseActions().catch(() => {});
    }
  }

  /**
   * Scroll the screen so content in the given direction comes into view —
   * `'down'` reveals content below, `'up'` reveals content above, etc.
   *
   * This is the natural reading: "scroll down" = "see what's below". The
   * finger gesture itself moves in the OPPOSITE direction (e.g. a "scroll
   * down" gesture is a finger swipe upward). For raw finger-direction
   * control use `swipe()` instead.
   */
  async scroll(direction: SwipeDirection = 'down', opts?: SwipeOptions): Promise<void> {
    const fingerDir: Record<SwipeDirection, SwipeDirection> = {
      up: 'down',
      down: 'up',
      left: 'right',
      right: 'left',
    };
    return this.swipe(fingerDir[direction], opts);
  }

  /**
   * Scroll until `locator` is visible. Prefers native scroll-to-visible on
   * each platform when possible, falling back to repeated gesture swipes.
   */
  async scrollIntoView(locator: Locator, opts?: ScrollIntoViewOptions): Promise<void> {
    return locator.scrollIntoView(opts);
  }

  /**
   * Drag from one absolute point to another. Prefers native commands
   * (`mobile: dragFromToForDuration` on iOS, `mobile: dragGesture` on
   * Android) and falls back to a W3C pointer gesture with a press-and-hold
   * before the move.
   *
   * `opts.from` / `opts.to` from `DragOptions` are ignored here — those
   * fractional overrides are only meaningful for `Locator.dragTo`. Use
   * `duration`, `moveDuration`, and `speed` to tune timing.
   */
  async dragAndDrop(from: ClickPoint, to: ClickPoint, opts?: DragOptions): Promise<void> {
    const holdMs = opts?.duration ?? 500;

    if (this.platform === Platform.IOS) {
      try {
        await this.driver.executeScript('mobile: dragFromToForDuration', [
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
        // fall through
      }
    } else if (this.platform === Platform.ANDROID) {
      try {
        await this.driver.executeScript('mobile: dragGesture', [
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
        // fall through
      }
    }

    const moveMs = opts?.moveDuration ?? 300;
    try {
      await this.driver.performActions([
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
      await this.driver.releaseActions().catch(() => {});
    }
  }

  /**
   * Send a global key event (not bound to any focused element). For hardware
   * buttons (HOME / BACK / VOLUME_*), use `pressButton(HardwareButton)` —
   * this routes through different Appium endpoints. Examples:
   *
   *   await mobile.press('Enter');
   *   await mobile.press('ArrowDown');  // Android only
   *
   * Throws on unsupported keys for the current platform.
   */
  async press(key: string): Promise<void> {
    if (this.platform === Platform.ANDROID) {
      const code = ANDROID_NAMED_KEYS[key];
      if (code === undefined) {
        // Enter / Tab / Backspace / Space are nav-keycode-mapped too in some
        // Android builds; fall back to KEYCODE_ENTER for Enter.
        const fallback: Record<string, number> = {
          Enter: 66,
          Tab: 61,
          Backspace: 67,
          Space: 62,
        };
        const fk = fallback[key];
        if (fk === undefined) {
          throw new Error(`mobile.press: unsupported Android key "${key}"`);
        }
        await this.driver.executeScript('mobile: pressKey', [{ keycode: fk }]);
        return;
      }
      await this.driver.executeScript('mobile: pressKey', [{ keycode: code }]);
      return;
    }
    const name = IOS_NAMED_KEYS[key];
    if (name === undefined) {
      throw new Error(`mobile.press: unsupported iOS key "${key}"`);
    }
    await this.driver.executeScript('mobile: keys', [{ keys: [{ name }] }]);
  }

  async pressButton(button: HardwareButton): Promise<void> {
    if (this.platform === Platform.ANDROID) {
      const keycode = ANDROID_KEYCODES[button];
      if (keycode === undefined) {
        throw new Error(`pressButton: unknown Android button "${button}"`);
      }
      await this.driver.executeScript('mobile: pressKey', [{ keycode }]);
      return;
    }
    // iOS
    if (button === 'HOME') {
      await this.driver.executeScript('mobile: pressButton', [{ name: 'home' }]);
      return;
    }
    if (button === 'VOLUME_UP' || button === 'VOLUME_DOWN') {
      await this.driver.executeScript('mobile: pressButton', [
        { name: button === 'VOLUME_UP' ? 'volumeup' : 'volumedown' },
      ]);
      return;
    }
    throw new Error(`pressButton: "${button}" is not supported on iOS`);
  }

  async goBack(): Promise<void> {
    if (this.platform === Platform.ANDROID) {
      await this.driver.back();
      return;
    }
    // iOS has no global back; fall back to a leftward swipe from the edge.
    const rect = await this.driver.getWindowRect();
    try {
      await this.driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: 1, y: Math.floor(rect.height / 2) },
            { type: 'pointerDown', button: 0 },
            {
              type: 'pointerMove',
              duration: 200,
              x: Math.floor(rect.width / 2),
              y: Math.floor(rect.height / 2),
            },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    } finally {
      await this.driver.releaseActions().catch(() => {});
    }
  }

  async screenshot(): Promise<Buffer> {
    const data = await this.driver.takeScreenshot();
    return Buffer.from(data, 'base64');
  }

  async getScreenSize(): Promise<ScreenSize> {
    const rect = await this.driver.getWindowRect();
    return { width: rect.width, height: rect.height };
  }

  async gesture(opts: GestureOptions): Promise<void> {
    const actions = opts.pointers.map((pointerPath, i) => {
      const inner: Array<Record<string, unknown>> = [];
      const first = pointerPath[0];
      if (first) {
        inner.push({ type: 'pointerMove', duration: 0, x: first.x, y: first.y });
        inner.push({ type: 'pointerDown', button: 0 });
        let prevTime = first.time;
        for (let j = 1; j < pointerPath.length; j++) {
          const point = pointerPath[j]!;
          inner.push({
            type: 'pointerMove',
            duration: Math.max(0, point.time - prevTime),
            x: point.x,
            y: point.y,
          });
          prevTime = point.time;
        }
        inner.push({ type: 'pointerUp', button: 0 });
      }
      return {
        type: 'pointer' as const,
        id: `finger${i + 1}`,
        parameters: { pointerType: 'touch' },
        actions: inner as never,
      };
    });
    try {
      await this.driver.performActions(actions);
    } finally {
      await this.driver.releaseActions().catch(() => {});
    }
  }

  /** Full UI tree as an XML string (Appium `getPageSource`). */
  async viewTree(): Promise<string> {
    return this.driver.getPageSource();
  }

  // ─── WebView / context ─────────────────────────────────────────────

  /**
   * All available automation contexts, e.g.
   * `['NATIVE_APP', 'WEBVIEW_com.example']`.
   */
  async getContexts(): Promise<string[]> {
    return (await this.driver.getAppiumContexts()) as unknown as string[];
  }

  /** The currently-active context (e.g. `'NATIVE_APP'`). */
  async getContext(): Promise<string> {
    return (await this.driver.getAppiumContext()) as unknown as string;
  }

  /** Switch to a named context — `'NATIVE_APP'` or a `WEBVIEW_*` handle. */
  async switchContext(name: string): Promise<void> {
    await this.driver.switchAppiumContext(name);
  }

  /**
   * Switch into a WebView context and return its handle. With no argument,
   * picks the first available `WEBVIEW_*` context (the common single-WebView
   * case); pass a handle to target a specific one.
   *
   * On Android a WebView is only automatable when chromedriver is available —
   * enable `appium:chromedriverAutodownload` or set
   * `appium:chromedriverExecutable`.
   */
  async switchToWebView(name?: string): Promise<string> {
    if (name) {
      await this.driver.switchAppiumContext(name);
      return name;
    }
    const ctxs = (await this.driver.getAppiumContexts()) as unknown as string[];
    const web = ctxs.find((c) => /^WEBVIEW/i.test(c));
    if (!web) {
      throw new Error(
        `No WebView context available (found: ${ctxs.join(', ') || 'none'}). ` +
          `On Android a WebView needs chromedriver — enable ` +
          `appium:chromedriverAutodownload or set appium:chromedriverExecutable.`,
      );
    }
    await this.driver.switchAppiumContext(web);
    return web;
  }

  /** Switch back to the native app context. */
  async switchToNative(): Promise<void> {
    await this.driver.switchAppiumContext('NATIVE_APP');
  }

  // ─── Misc ──────────────────────────────────────────────────────────

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Hand the in-flight test off to the inspector for interactive debugging.
   *
   * Boots the inspector server on an OS-assigned port pointed at the *current*
   * `mobile.raw` driver (no new Appium session), opens the user's default
   * browser to its URL, and blocks until the user clicks "Resume" in the
   * inspector UI. Closes the inspector cleanly on resume.
   *
   * Opt-out: setting `PWDEBUG=0` short-circuits to a no-op (committed
   * `mobile.pause()` calls don't break CI runs that explicitly disable it).
   */
  async pause(opts?: PauseOptions): Promise<void> {
    if (process.env.PWDEBUG === '0') return;

    // Lazy-load the inspector server — avoid pulling its module graph (and
    // its bundled HTML) into every test run that doesn't actually pause.
    const { startInspectorServer } = await import('../inspector/server.js');
    const handle = await startInspectorServer({
      defaults: { appium: { host: 'localhost', port: 4723, path: '/' }, capabilities: {} },
      host: 'localhost',
      port: opts?.port ?? 0,
      attach: {
        driver: this.driver,
        platform: this.platform,
        ...(this.defaultBundleId
          ? { capabilities: { 'appium:bundleId': this.defaultBundleId } }
          : {}),
      },
    });

    process.stdout.write(
      `\n  taqwright paused. Inspector: ${handle.url}\n` +
        `  Click "Resume" in the inspector to continue.\n\n`,
    );
    if (opts?.openBrowser !== false) {
      openInBrowser(handle.url);
    }

    // Best-effort SIGINT cleanup so a Ctrl+C during pause doesn't leak the
    // server. Test driver lifecycle is owned by the fixture either way —
    // attached mode skips deleteSession.
    const onSigint = (): void => {
      handle.close().catch(() => {});
      process.exit(130);
    };
    process.once('SIGINT', onSigint);

    try {
      await handle.session.resumeRequested;
    } finally {
      process.removeListener('SIGINT', onSigint);
      await handle.close().catch(() => {});
    }
  }

  /** Click a fractional point inside a bounding box (default: center). */
  async clickByPercent(box: BoundingBox, relX = 0.5, relY = 0.5): Promise<void> {
    return this.click({
      x: Math.floor(box.x + box.width * relX),
      y: Math.floor(box.y + box.height * relY),
    });
  }

  // ─── OS interaction ────────────────────────────────────────────────

  // Orientation

  async setOrientation(orientation: 'portrait' | 'landscape'): Promise<void> {
    await this.driver.setOrientation(orientation.toUpperCase());
  }

  async getOrientation(): Promise<'portrait' | 'landscape'> {
    const o = await this.driver.getOrientation();
    return o.toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
  }

  // Keyboard

  /**
   * Dismiss the soft keyboard. iOS results are flaky across XCUITest versions;
   * if dismiss is critical, prefer `pressButton('ENTER')` or tapping outside
   * the focused field.
   */
  async hideKeyboard(): Promise<void> {
    if (this.platform === Platform.IOS) {
      try {
        await this.driver.executeScript('mobile: hideKeyboard', [{}]);
        return;
      } catch {
        // fall through to standard
      }
    }
    await this.driver.hideKeyboard();
  }

  async isKeyboardShown(): Promise<boolean> {
    return this.driver.isKeyboardShown();
  }

  // OS dialogs

  async acceptAlert(): Promise<void> {
    if (this.platform === Platform.IOS) {
      await this.driver.executeScript('mobile: alert', [{ action: 'accept' }]);
      return;
    }
    await this.driver.acceptAlert();
  }

  async dismissAlert(): Promise<void> {
    if (this.platform === Platform.IOS) {
      await this.driver.executeScript('mobile: alert', [{ action: 'dismiss' }]);
      return;
    }
    await this.driver.dismissAlert();
  }

  async getAlertText(): Promise<string> {
    return this.driver.getAlertText();
  }

  // Background / current app

  /**
   * Send the active app to the background for `seconds`. Pass `-1` (default)
   * to leave it backgrounded indefinitely.
   */
  async backgroundApp(seconds: number = -1): Promise<void> {
    await this.driver.executeScript('mobile: backgroundApp', [{ seconds }]);
  }

  async getCurrentApp(): Promise<{ bundleId: string }> {
    if (this.platform === Platform.IOS) {
      const info = (await this.driver.executeScript('mobile: activeAppInfo', [{}])) as
        | { bundleId?: string }
        | undefined;
      return { bundleId: info?.bundleId ?? '' };
    }
    const pkg = await this.driver.executeScript('mobile: getCurrentPackage', [{}]);
    return { bundleId: typeof pkg === 'string' ? pkg : '' };
  }

  // App state queries

  async isAppInstalled(bundleId?: string): Promise<boolean> {
    const id = bundleId ?? this.defaultBundleId;
    if (!id) {
      throw new Error('isAppInstalled: bundleId not provided and no default configured');
    }
    const result = await this.driver.executeScript('mobile: isAppInstalled', [this.appArg(id)]);
    return result === true;
  }

  async queryAppState(
    bundleId?: string,
  ): Promise<'not_installed' | 'not_running' | 'background' | 'foreground'> {
    const id = bundleId ?? this.defaultBundleId;
    if (!id) {
      throw new Error('queryAppState: bundleId not provided and no default configured');
    }
    const state = await this.driver.executeScript('mobile: queryAppState', [this.appArg(id)]);
    if (state === 0) return 'not_installed';
    if (state === 1) return 'not_running';
    if (state === 2 || state === 3) return 'background';
    if (state === 4) return 'foreground';
    return 'not_running';
  }

  // Deep links

  async openDeepLink(url: string, bundleId?: string): Promise<void> {
    const id = bundleId ?? this.defaultBundleId;
    if (!id) {
      throw new Error('openDeepLink: bundleId not provided and no default configured');
    }
    const arg = this.platform === Platform.IOS ? { url, bundleId: id } : { url, package: id };
    await this.driver.executeScript('mobile: deepLink', [arg]);
  }

  // Clipboard

  async getClipboard(): Promise<string> {
    const cmd = this.platform === Platform.IOS ? 'mobile: getPasteboard' : 'mobile: getClipboard';
    const data = await this.driver.executeScript(cmd, [{}]);
    const b64 = typeof data === 'string' ? data : '';
    return Buffer.from(b64, 'base64').toString('utf-8');
  }

  async setClipboard(text: string): Promise<void> {
    const cmd = this.platform === Platform.IOS ? 'mobile: setPasteboard' : 'mobile: setClipboard';
    await this.driver.executeScript(cmd, [
      { content: Buffer.from(text, 'utf-8').toString('base64') },
    ]);
  }

  // Geolocation

  async setLocation(loc: GeoLocation): Promise<void> {
    await this.driver.setGeoLocation({
      latitude: loc.latitude,
      longitude: loc.longitude,
      altitude: loc.altitude ?? 0,
    });
  }

  async getLocation(): Promise<Required<GeoLocation>> {
    const result = (await this.driver.getGeoLocation()) as {
      latitude: number | string;
      longitude: number | string;
      altitude: number | string;
    };
    return {
      latitude: Number(result.latitude),
      longitude: Number(result.longitude),
      altitude: Number(result.altitude),
    };
  }

  // Permissions (Android-only)

  async setPermission(permission: string, state: 'grant' | 'revoke'): Promise<void> {
    if (this.platform !== Platform.ANDROID) {
      throw new Error(
        'setPermission is Android-only; on iOS, configure permissions via the appium:processArguments / appium:autoAcceptAlerts capability or pre-grant in test setup',
      );
    }
    await this.driver.executeScript('mobile: changePermissions', [
      { action: state, permissions: [permission] },
    ]);
  }

  // Network conditions (Android-only at runtime)

  async setNetworkConnection(opts: Partial<NetworkConnection>): Promise<void> {
    if (this.platform !== Platform.ANDROID) {
      throw new Error(
        'setNetworkConnection is Android-only; on iOS, configure via macOS Network Link Conditioner',
      );
    }
    await this.driver.executeScript('mobile: setConnectivity', [
      {
        ...(opts.wifi !== undefined ? { wifi: opts.wifi } : {}),
        ...(opts.data !== undefined ? { data: opts.data } : {}),
        ...(opts.airplane !== undefined ? { airplaneMode: opts.airplane } : {}),
      },
    ]);
  }

  async getNetworkConnection(): Promise<NetworkConnection> {
    if (this.platform !== Platform.ANDROID) {
      throw new Error('getNetworkConnection is Android-only');
    }
    const result = (await this.driver.executeScript('mobile: getConnectivity', [{}])) as {
      wifi?: boolean;
      data?: boolean;
      airplaneMode?: boolean;
    };
    return {
      wifi: !!result?.wifi,
      data: !!result?.data,
      airplane: !!result?.airplaneMode,
    };
  }

  // Files

  async pushFile(remotePath: string, content: Buffer | string): Promise<void> {
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    await this.driver.executeScript('mobile: pushFile', [
      { remotePath, payload: buf.toString('base64') },
    ]);
  }

  async pullFile(remotePath: string): Promise<Buffer> {
    const data = await this.driver.executeScript('mobile: pullFile', [{ remotePath }]);
    return Buffer.from(typeof data === 'string' ? data : '', 'base64');
  }

  // Device logs

  async getDeviceLogs(type?: 'logcat' | 'syslog' | 'crashlog'): Promise<DeviceLogEntry[]> {
    const logType = type ?? (this.platform === Platform.ANDROID ? 'logcat' : 'syslog');
    const entries = (await this.driver.getLogs(logType)) as Array<{
      timestamp?: number;
      level?: string;
      message?: string;
    }>;
    return entries.map((e) => ({
      timestamp: Number(e.timestamp ?? Date.now()),
      level: String(e.level ?? 'INFO'),
      message: String(e.message ?? ''),
    }));
  }

  async getLogTypes(): Promise<string[]> {
    return this.driver.getLogTypes();
  }

  // Locale / time

  async getDeviceTime(format?: string): Promise<string> {
    const arg = format ? { format } : {};
    const t = await this.driver.executeScript('mobile: getDeviceTime', [arg]);
    return typeof t === 'string' ? t : String(t);
  }

  async setLocale(locale: string): Promise<void> {
    if (this.platform !== Platform.ANDROID) {
      throw new Error(
        'setLocale is Android-only at runtime; on iOS, set via the appium:language and appium:locale capabilities',
      );
    }
    const [language, country] = locale.includes('-') ? locale.split('-') : [locale, undefined];
    await this.driver.executeScript('mobile: setLocale', [
      { language, ...(country ? { country } : {}) },
    ]);
  }

  // Screen recording

  async startScreenRecording(opts?: ScreenRecordingOptions): Promise<void> {
    const arg: Record<string, string> = {};
    if (opts?.videoType) arg.videoType = opts.videoType;
    if (opts?.timeLimit !== undefined) arg.timeLimit = String(opts.timeLimit);
    await this.driver.startRecordingScreen(arg);
  }

  async stopScreenRecording(): Promise<Buffer> {
    const data = await this.driver.stopRecordingScreen();
    return Buffer.from(typeof data === 'string' ? data : '', 'base64');
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  /** Platform-aware app-id arg: `{bundleId}` on iOS, `{appId}` on Android. */
  private appArg(id: string): { bundleId: string } | { appId: string } {
    return this.platform === Platform.IOS ? { bundleId: id } : { appId: id };
  }
}

/**
 * Best-effort `open <url>` per platform — used by `mobile.pause()` to pop the
 * inspector in the user's browser. Detached + unref'd so a parent exit
 * (Ctrl+C, test runner shutdown) doesn't leave a zombie.
 */
function openInBrowser(url: string): void {
  try {
    const cmd =
      process.platform === 'darwin'
        ? { c: 'open', args: [url] }
        : process.platform === 'win32'
          ? { c: 'cmd', args: ['/c', 'start', '""', url] }
          : { c: 'xdg-open', args: [url] };
    const child = spawn(cmd.c, cmd.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      // No browser opener available — URL is already logged to stdout.
    });
    child.unref();
  } catch {
    // never block the test on browser-launch failure
  }
}

const ANDROID_KEYCODES: Partial<Record<HardwareButton, number>> = {
  HOME: 3,
  BACK: 4,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  ENTER: 66,
};

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

// XPath has no string-escape syntax, so a literal containing both quote
// kinds must be expressed as a concat() of single-quoted and double-quoted
// pieces. The result includes its own quoting and is meant to be
// interpolated raw, e.g. `//*[@text=${xpathLiteral(s)}]`.
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
