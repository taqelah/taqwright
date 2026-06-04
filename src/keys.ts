/**
 * Cross-platform key-name maps for `Locator.press` / `Locator.pressSequentially`
 * and `Mobile.press`. Kept separate from `HardwareButton` (in types/) which
 * remains the curated hardware-only enum used by `Mobile.pressButton`.
 *
 * The split is intentional: hardware buttons (HOME / BACK / VOLUME_*) route
 * through different Appium endpoints than keyboard / nav keys, so conflating
 * them under one name would make the dispatch logic unclear.
 */

/**
 * Keys that have a direct Unicode equivalent — sending them via
 * `elementSendKeys` works on both Android and iOS for focused inputs.
 * No platform branching needed.
 */
export const KEY_TO_UNICODE: Readonly<Record<string, string>> = {
  Enter: '\n',
  Tab: '\t',
  Backspace: '\b',
  Space: ' ',
};

/**
 * Android `KeyEvent.KEYCODE_*` values for nav / editing keys that lack a
 * direct Unicode mapping. Sent via `mobile: pressKey`.
 */
export const ANDROID_NAMED_KEYS: Readonly<Record<string, number>> = {
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Delete: 112,
  Escape: 111,
  Home: 122, // KEYCODE_MOVE_HOME — caret-to-line-start, NOT the home button
  End: 123,
  PageUp: 92,
  PageDown: 93,
};

/**
 * iOS named keys accepted by `mobile: keys`. Reliable on simulators with a
 * paired hardware keyboard; real-device support is murky and may throw —
 * surface the error rather than swallow it.
 */
export const IOS_NAMED_KEYS: Readonly<Record<string, string>> = {
  Enter: 'enter',
  Tab: 'tab',
  Backspace: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Escape: 'escape',
};
