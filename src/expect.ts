import { expect as pwExpect } from '@playwright/test';
import { Locator, type ActionOptions } from './locator/index.js';

// Playwright-style `expect(locator).toBeVisible()` for taqwright's mobile
// Locator. This is deliberately NOT `expect.extend`: Playwright dispatches its
// built-in locator matchers by name against its own hardcoded browser Locator,
// so extending its matcher registry for a non-Playwright Locator misfires (see
// the note this replaced in src/fixture/index.ts). A standalone wrapper has no
// such collision — when the argument is a taqwright Locator we return our own
// matcher object that delegates to the existing auto-retrying `assert*`
// methods; for any other value we fall straight through to Playwright's real
// `expect`, so value assertions (`expect(n).toBeGreaterThan(0)`, …) are
// unchanged. API shape mirrors https://playwright.dev/docs/test-assertions.

interface TimeoutOptions {
  timeout?: number;
}
interface VisibleOptions extends TimeoutOptions {
  visible?: boolean;
}
interface EnabledOptions extends TimeoutOptions {
  enabled?: boolean;
}
interface CheckedOptions extends TimeoutOptions {
  checked?: boolean;
}
interface EditableOptions extends TimeoutOptions {
  editable?: boolean;
}

/**
 * Playwright-named auto-retrying matchers for a taqwright {@link Locator}.
 * Every matcher resolves the element on each poll and rejects (failing the
 * test) on timeout, exactly like the underlying `locator.assert*()` methods.
 */
export interface MobileMatchers {
  toBeVisible(options?: VisibleOptions): Promise<void>;
  toBeHidden(options?: TimeoutOptions): Promise<void>;
  toBeEnabled(options?: EnabledOptions): Promise<void>;
  toBeDisabled(options?: TimeoutOptions): Promise<void>;
  toBeChecked(options?: CheckedOptions): Promise<void>;
  toBeEditable(options?: EditableOptions): Promise<void>;
  toBeFocused(options?: TimeoutOptions): Promise<void>;
  toBeAttached(options?: TimeoutOptions): Promise<void>;
  toBeInViewport(options?: TimeoutOptions): Promise<void>;
  toBeEmpty(options?: TimeoutOptions): Promise<void>;
  toHaveText(expected: string | RegExp, options?: TimeoutOptions): Promise<void>;
  toContainText(expected: string, options?: TimeoutOptions): Promise<void>;
  toHaveValue(value: string | RegExp, options?: TimeoutOptions): Promise<void>;
  toHaveCount(count: number, options?: TimeoutOptions): Promise<void>;
  toHaveAttribute(name: string, value: string | RegExp, options?: TimeoutOptions): Promise<void>;
  /** Negated matchers. Only the clean positive/negative pairs are supported. */
  readonly not: MobileMatchers;
}

// Web-only Playwright matchers that have no native-mobile meaning. Calling any
// of them on a taqwright Locator throws rather than silently doing nothing.
const WEB_ONLY_MATCHERS = [
  'toHaveClass',
  'toContainClass',
  'toHaveCSS',
  'toHaveId',
  'toHaveJSProperty',
  'toHaveValues',
  'toHaveRole',
  'toHaveAccessibleName',
  'toHaveAccessibleDescription',
  'toHaveAccessibleErrorMessage',
  'toHaveScreenshot',
  'toMatchAriaSnapshot',
  'toHaveTitle',
  'toHaveURL',
  'toBeOK',
] as const;

// Playwright option keys taqwright cannot honor on a native element. Silently
// ignoring them would yield a wrong pass/fail, so reject them loudly instead.
const UNSUPPORTED_OPTION_KEYS = ['ignoreCase', 'useInnerText', 'ratio', 'indeterminate'] as const;

function actionOpts(o: TimeoutOptions | undefined): ActionOptions | undefined {
  for (const key of UNSUPPORTED_OPTION_KEYS) {
    if (o && key in o) {
      throw new Error(`expect(locator): option "${key}" is not supported on mobile locators`);
    }
  }
  return o?.timeout === undefined ? undefined : { timeout: o.timeout };
}

function makeMobileMatchers(
  loc: Locator,
  negated: boolean,
  message: string | undefined,
): MobileMatchers {
  // Run an underlying assert and, if a custom message was passed to
  // `expect(locator, 'message')`, prefix the thrown error with it.
  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      if (message) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`${message}\n${detail}`, { cause: err });
      }
      throw err;
    }
  };

  const unsupportedNot = (matcher: string): never => {
    throw new Error(
      `expect(locator).not.${matcher}() is not supported on mobile locators — ` +
        `use the positive form or locator.assert*() directly`,
    );
  };

  const matchers: MobileMatchers = {
    toBeVisible: (o) => {
      const want = (o?.visible ?? true) !== negated;
      return run(() => (want ? loc.assertVisible(actionOpts(o)) : loc.assertHidden(actionOpts(o))));
    },
    toBeHidden: (o) =>
      run(() => (negated ? loc.assertVisible(actionOpts(o)) : loc.assertHidden(actionOpts(o)))),
    toBeEnabled: (o) => {
      const want = (o?.enabled ?? true) !== negated;
      return run(() =>
        want ? loc.assertEnabled(actionOpts(o)) : loc.assertDisabled(actionOpts(o)),
      );
    },
    toBeDisabled: (o) =>
      run(() => (negated ? loc.assertEnabled(actionOpts(o)) : loc.assertDisabled(actionOpts(o)))),
    toBeChecked: (o) => {
      const want = (o?.checked ?? true) !== negated;
      return run(() =>
        want ? loc.assertChecked(actionOpts(o)) : loc.assertUnchecked(actionOpts(o)),
      );
    },
    toBeEditable: (o) => {
      const want = (o?.editable ?? true) !== negated;
      return run(() =>
        want ? loc.assertEditable(actionOpts(o)) : loc.assertReadonly(actionOpts(o)),
      );
    },
    toBeFocused: (o) =>
      negated ? unsupportedNot('toBeFocused') : run(() => loc.assertFocused(actionOpts(o))),
    toBeAttached: (o) =>
      negated ? unsupportedNot('toBeAttached') : run(() => loc.assertAttached(actionOpts(o))),
    toBeInViewport: (o) =>
      negated ? unsupportedNot('toBeInViewport') : run(() => loc.assertInViewport(actionOpts(o))),
    toBeEmpty: (o) =>
      negated ? unsupportedNot('toBeEmpty') : run(() => loc.assertEmpty(actionOpts(o))),
    toHaveText: (expected, o) =>
      negated ? unsupportedNot('toHaveText') : run(() => loc.assertText(expected, actionOpts(o))),
    toContainText: (expected, o) =>
      negated
        ? unsupportedNot('toContainText')
        : run(() => loc.assertContainsText(expected, actionOpts(o))),
    toHaveValue: (value, o) =>
      negated ? unsupportedNot('toHaveValue') : run(() => loc.assertValue(value, actionOpts(o))),
    toHaveCount: (count, o) =>
      negated ? unsupportedNot('toHaveCount') : run(() => loc.assertCount(count, actionOpts(o))),
    toHaveAttribute: (name, value, o) =>
      negated
        ? unsupportedNot('toHaveAttribute')
        : run(() => loc.assertAttribute(name, value, actionOpts(o))),
    get not() {
      return makeMobileMatchers(loc, !negated, message);
    },
  };

  // Make every web-only Playwright matcher throw a clear error instead of
  // being silently undefined when someone reaches for it on a mobile locator.
  for (const name of WEB_ONLY_MATCHERS) {
    (matchers as unknown as Record<string, unknown>)[name] = () => {
      throw new Error(`${name}() is not supported on mobile locators`);
    };
  }

  return matchers;
}

/**
 * taqwright's `expect`. Pass a mobile {@link Locator} to get the auto-retrying
 * matcher set (`toBeVisible`, `toHaveText`, …); pass anything else and it
 * delegates to Playwright's `expect` unchanged. `.soft` / `.poll` /
 * `.configure` are Playwright's and remain value-only — for a mobile Locator
 * use `expect(locator)` or `locator.assert*()`.
 */
export type TaqwrightExpect = ((actual: Locator, message?: string) => MobileMatchers) &
  typeof pwExpect;

const expectImpl = ((actual: unknown, message?: string): unknown => {
  if (actual instanceof Locator) {
    return makeMobileMatchers(actual, false, message);
  }
  return (pwExpect as (a: unknown, m?: string) => unknown)(actual, message);
}) as TaqwrightExpect;

// Carry over Playwright's statics (soft, poll, extend, configure, the
// asymmetric matchers, `.not`, …) so the value path is fully unchanged.
Object.assign(expectImpl, pwExpect);

export const expect: TaqwrightExpect = expectImpl;
