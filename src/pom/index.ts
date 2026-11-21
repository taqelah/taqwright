// Cross-platform page objects with Appium-Java-style locator decorators.
//
//   class LoginPage extends Screen {
//     @iOSFindBy({ accessibility: 'login-user' })
//     @AndroidFindBy({ id: 'com.app:id/user' })
//     accessor username!: Locator;
//   }
//
// These are standard (TC39) accessor/field decorators — what TypeScript 5 emits without
// `experimentalDecorators`, and what Playwright's own transform compiles spec
// files with. Each decorator returns a field initializer that runs per
// instance, reads the platform off `this.mobile`, and either builds the
// Locator or passes through the value from the decorator below it. Locators
// are lazy (they resolve on every action), so building them at construction
// time is safe — there is no PageFactory proxy and no stale element.

import type { Locator } from '../locator/index.js';
import type { Mobile } from '../mobile/index.js';
import { Platform } from '../types/index.js';

/**
 * Base class for decorated page objects. Holds the `mobile` the decorated
 * fields resolve against. Extending it is required: its constructor assigns
 * `mobile` before the subclass's field initializers (and so the decorators)
 * run.
 */
export abstract class Screen {
  constructor(readonly mobile: Mobile) {}

  /** The platform of the session this screen is bound to. */
  get platform(): Platform {
    return this.mobile.getPlatform();
  }
}

/**
 * One locator strategy. Exactly one key per decorator; each maps onto the
 * matching `mobile.getBy*` method.
 */
export type FindBySelector =
  /** resource-id (Android) / accessibility id (iOS) — `getById`. */
  | { id: string }
  /** Alias of `id` — `getByTestId`. */
  | { testId: string }
  /** Accessibility id / content-desc — `getByLabel`. Appium Java's name. */
  | { accessibility: string }
  /** Alias of `accessibility` — `getByLabel`. */
  | { label: string }
  /** Visible text — `getByText`. `exact` defaults to true. */
  | { text: string | RegExp; exact?: boolean }
  /** Input placeholder / hint — `getByPlaceholder`. */
  | { placeholder: string; exact?: boolean }
  /** Class / type name — `getByType`. */
  | { className: string }
  /** XPath — `getByXpath`. */
  | { xpath: string }
  /** Android UiSelector — `getByUiSelector`. Android only. */
  | { uiAutomator: string }
  /** iOS NSPredicate — `getByPredicate`. iOS only. */
  | { predicate: string }
  /** iOS class chain — `getByClassChain`. iOS only. */
  | { classChain: string };

type StrategyKey =
  | 'id'
  | 'testId'
  | 'accessibility'
  | 'label'
  | 'text'
  | 'placeholder'
  | 'className'
  | 'xpath'
  | 'uiAutomator'
  | 'predicate'
  | 'classChain';

const STRATEGY_KEYS: readonly StrategyKey[] = [
  'id',
  'testId',
  'accessibility',
  'label',
  'text',
  'placeholder',
  'className',
  'xpath',
  'uiAutomator',
  'predicate',
  'classChain',
];
const OPTION_KEYS = new Set(['exact']);
const ANDROID_ONLY = new Set<StrategyKey>(['uiAutomator']);
const IOS_ONLY = new Set<StrategyKey>(['predicate', 'classChain']);

type Target = 'android' | 'ios' | 'any';

const DECORATOR_NAME: Record<Target, string> = {
  android: 'AndroidFindBy',
  ios: 'iOSFindBy',
  any: 'FindBy',
};

/**
 * What every `*FindBy` returns. It decorates an auto-accessor
 * (`accessor name!: Locator`, the recommended form) or a plain field
 * (`name!: Locator`). A plain field fails to compile under Playwright 1.65+
 * whenever the tsconfig makes `useDefineForClassFields` true (the default for
 * an ES2022+ `target`): Babel rejects a decorated `!` field with "Definitely
 * assigned fields cannot be initialized here". An `accessor` compiles under
 * either setting.
 */
export interface LocatorDecorator {
  <This extends Screen>(
    value: ClassAccessorDecoratorTarget<This, Locator>,
    context: ClassAccessorDecoratorContext<This, Locator>,
  ): ClassAccessorDecoratorResult<This, Locator>;
  <This extends Screen>(
    value: undefined,
    context: ClassFieldDecoratorContext<This, Locator>,
  ): (this: This, initial: Locator) => Locator;
}

/**
 * One selector, or several to try in order. A list is combined with
 * `Locator.or()`: every entry is looked up on each resolve, and matches keep
 * list order, so actions hit the first entry's element when it is present and
 * fall back to later entries only when earlier ones find nothing. (Appium
 * Java's `@AndroidFindAll` / `LocatorGroupStrategy.ALL_POSSIBLE`.)
 */
export type FindByInput = FindBySelector | readonly FindBySelector[];

/**
 * Locator for a field on **both** platforms. Use when the app exposes the
 * same id / label / text on Android and iOS. A platform-specific
 * `@AndroidFindBy` / `@iOSFindBy` on the same field takes precedence.
 */
export function FindBy(selector: FindByInput): LocatorDecorator {
  return makeDecorator('any', selector);
}

/** Locator for a field when the session is Android. */
export function AndroidFindBy(selector: FindByInput): LocatorDecorator {
  return makeDecorator('android', selector);
}

/** Locator for a field when the session is iOS. */
export function iOSFindBy(selector: FindByInput): LocatorDecorator {
  return makeDecorator('ios', selector);
}

// Locators produced by a platform-specific decorator — a later FindBy must not
// override them, and a second matching platform decorator is a duplicate.
const specific = new WeakSet<object>();
// Placeholders for "no decorator matched this platform" — replaced by any
// decorator that does match, and throw on use if none does.
const missing = new WeakSet<object>();

function makeDecorator(target: Target, input: FindByInput): LocatorDecorator {
  const name = DECORATOR_NAME[target];
  const selectors = validateInput(name, target, input);

  function decorate(
    _value: unknown,
    context:
      ClassFieldDecoratorContext<Screen, Locator> | ClassAccessorDecoratorContext<Screen, Locator>,
  ): unknown {
    if (typeof context !== 'object' || context === null) {
      throw new Error(
        `@${name}: got legacy decorator arguments. taqwright uses standard decorators — ` +
          'remove "experimentalDecorators" from your tsconfig.',
      );
    }
    const kind = (context as { kind: string }).kind;
    if (kind !== 'field' && kind !== 'accessor') {
      throw new Error(
        `@${name} can only decorate a class field — write \`accessor name!: Locator\` (got a ${kind}).`,
      );
    }
    if (context.static) {
      throw new Error(`@${name} cannot decorate a static field.`);
    }
    const field = String(context.name);
    const init = initializer(field);
    // An auto-accessor takes its initial value through `init`, chained across
    // stacked decorators exactly like a field initializer.
    return kind === 'accessor' ? { init } : init;
  }

  function initializer(field: string) {
    return function (this: Screen, prev: Locator): Locator {
      const owner = (this as object).constructor?.name || 'page object';
      const mobile = (this as { mobile?: Mobile }).mobile;
      if (!mobile || typeof mobile.getPlatform !== 'function') {
        throw new Error(
          `@${name} on ${owner}.${field}: ${owner} must extend Screen and be constructed ` +
            'with the `mobile` fixture (new ' +
            owner +
            '(mobile)).',
        );
      }
      const platform = mobile.getPlatform();
      const hasPrev = prev !== undefined && !missing.has(prev as object);

      if (target !== 'any' && target !== platform) {
        return hasPrev ? prev : missingLocator(owner, field, platform);
      }
      if (target === 'any') {
        // A platform-specific locator already applied wins over FindBy.
        if (hasPrev) return prev;
        return buildAll(mobile, selectors);
      }
      if (hasPrev && specific.has(prev as object)) {
        throw new Error(
          `${owner}.${field} has more than one @${name} — keep exactly one per platform.`,
        );
      }
      const locator = buildAll(mobile, selectors);
      specific.add(locator);
      return locator;
    };
  }

  return decorate as LocatorDecorator;
}

type Parsed = { key: StrategyKey; selector: FindBySelector };

function validateInput(name: string, target: Target, input: FindByInput): Parsed[] {
  if (!Array.isArray(input)) {
    const selector = input as FindBySelector;
    return [{ key: validateSelector(name, target, selector), selector }];
  }
  if (input.length === 0) {
    throw new Error(`@${name}: the selector list is empty — give at least one selector.`);
  }
  return input.map((selector, i) => {
    try {
      return { key: validateSelector(name, target, selector), selector };
    } catch (e) {
      throw new Error(`${(e as Error).message} (selector #${i + 1} in the list)`, { cause: e });
    }
  });
}

function buildAll(mobile: Mobile, parsed: readonly Parsed[]): Locator {
  const [first, ...rest] = parsed.map(({ key, selector }) => build(mobile, key, selector));
  return rest.reduce((acc, next) => acc.or(next), first!);
}

function validateSelector(name: string, target: Target, selector: FindBySelector): StrategyKey {
  if (typeof selector !== 'object' || selector === null) {
    throw new Error(`@${name}: expected a selector object like { id: '...' }.`);
  }
  const keys = Object.keys(selector);
  const strategies = keys.filter((k): k is StrategyKey =>
    (STRATEGY_KEYS as readonly string[]).includes(k),
  );
  const unknown = keys.filter((k) => !strategies.includes(k as StrategyKey) && !OPTION_KEYS.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `@${name}: unknown selector key ${unknown.map((k) => `'${k}'`).join(', ')}. ` +
        `Use one of: ${STRATEGY_KEYS.join(', ')}.`,
    );
  }
  if (strategies.length !== 1) {
    throw new Error(
      `@${name}: give exactly one locator strategy (got ${strategies.length === 0 ? 'none' : strategies.join(' + ')}).`,
    );
  }
  const key = strategies[0]!;
  const value = (selector as Record<string, unknown>)[key];
  const okValue =
    key === 'text'
      ? typeof value === 'string' || value instanceof RegExp
      : typeof value === 'string';
  if (!okValue || value === '') {
    throw new Error(
      `@${name}: '${key}' needs a non-empty ${key === 'text' ? 'string or RegExp' : 'string'}.`,
    );
  }
  if ('exact' in selector && key !== 'text' && key !== 'placeholder') {
    throw new Error(`@${name}: 'exact' only applies to 'text' and 'placeholder'.`);
  }
  if (ANDROID_ONLY.has(key) && target !== 'android') {
    throw new Error(`@${name}: '${key}' is Android-only — put it in @AndroidFindBy.`);
  }
  if (IOS_ONLY.has(key) && target !== 'ios') {
    throw new Error(`@${name}: '${key}' is iOS-only — put it in @iOSFindBy.`);
  }
  return key;
}

function build(mobile: Mobile, key: StrategyKey, selector: FindBySelector): Locator {
  const s = selector as Record<string, unknown>;
  const value = s[key];
  const exact = s.exact as boolean | undefined;
  const opts = exact === undefined ? undefined : { exact };
  switch (key) {
    case 'id':
      return mobile.getById(value as string);
    case 'testId':
      return mobile.getByTestId(value as string);
    case 'accessibility':
    case 'label':
      return mobile.getByLabel(value as string);
    case 'text':
      return mobile.getByText(value as string | RegExp, opts);
    case 'placeholder':
      return mobile.getByPlaceholder(value as string, opts);
    case 'className':
      return mobile.getByType(value as string);
    case 'xpath':
      return mobile.getByXpath(value as string);
    case 'uiAutomator':
      return mobile.getByUiSelector(value as string);
    case 'predicate':
      return mobile.getByPredicate(value as string);
    case 'classChain':
      return mobile.getByClassChain(value as string);
  }
}

// A stand-in for a field with no locator on the running platform. Any use
// (`.click()`, `expect(field)…`) throws a message naming the field; `then` and
// symbol lookups return undefined so awaiting it or inspecting it doesn't.
function missingLocator(owner: string, field: string, platform: Platform): Locator {
  const which = platform === Platform.IOS ? 'iOS' : 'Android';
  const hint = platform === Platform.IOS ? 'iOSFindBy' : 'AndroidFindBy';
  const message =
    `${owner}.${field} has no ${which} locator — add @${hint}(...) or @FindBy(...) ` +
    'to the field, or avoid using it on this platform.';
  const stub = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        throw new Error(message);
      },
    },
  );
  missing.add(stub);
  return stub as Locator;
}
