// Page-object decorators (src/pom). Node can't parse decorator syntax, so
// these tests apply the decorators the way the TC39 (2023-05) transform does:
// call `decorator(undefined, context)` to get a field initializer, then run the
// initializers bottom-up with `this` = the instance, threading each result
// into the next. `defineScreen` below is that transform for one class.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMobile, Platform } from './fake-driver.js';
import { Screen, FindBy, AndroidFindBy, iOSFindBy, Locator } from '../dist/index.js';

const fieldContext = (name) => ({ kind: 'field', name, static: false, private: false });

// fields: { name: [topDecorator, ..., bottomDecorator] } — source order.
function defineScreen(className, fields) {
  const inits = Object.entries(fields).map(([name, decorators]) => [
    name,
    decorators.map((d) => d(undefined, fieldContext(name))).reverse(),
  ]);
  const Cls = class extends Screen {
    constructor(mobile) {
      super(mobile);
      for (const [name, chain] of inits) {
        let value;
        for (const init of chain) value = init.call(this, value);
        this[name] = value;
      }
    }
  };
  Object.defineProperty(Cls, 'name', { value: className });
  return Cls;
}

// Resolve a locator against the fake driver and report the primary WebDriver
// strategy (the first lookup — short Android ids then probe a fallback).
async function strategyOf(locator, driverCalls) {
  const start = driverCalls.length;
  await locator.count();
  return driverCalls[start];
}

function mobileFor(platform) {
  const calls = [];
  const { mobile } = makeMobile(platform, {
    findElements: async (using, value) => {
      calls.push({ using, value });
      return [];
    },
  });
  return { mobile, calls };
}

const LoginPage = defineScreen('LoginPage', {
  username: [FindBy({ testId: 'login-user' })],
  password: [
    iOSFindBy({ predicate: "type == 'XCUIElementTypeSecureTextField'" }),
    AndroidFindBy({ id: 'pass' }),
  ],
  picker: [
    AndroidFindBy({ uiAutomator: 'new UiSelector().className("x")' }),
    iOSFindBy({ classChain: '**/XCUIElementTypeDatePicker' }),
  ],
  androidOnly: [AndroidFindBy({ text: 'Back' })],
});

test('Screen exposes mobile and platform', () => {
  const { mobile } = mobileFor(Platform.IOS);
  const page = new LoginPage(mobile);
  assert.equal(page.mobile, mobile);
  assert.equal(page.platform, Platform.IOS);
});

test('FindBy builds the same logical locator on both platforms', async () => {
  for (const [platform, expected] of [
    [Platform.ANDROID, 'id'],
    [Platform.IOS, 'accessibility id'],
  ]) {
    const { mobile, calls } = mobileFor(platform);
    const page = new LoginPage(mobile);
    assert.ok(page.username instanceof Locator);
    const s = await strategyOf(page.username, calls);
    assert.equal(s.using, expected);
    assert.match(s.value, /login-user/);
  }
});

test('stacked platform decorators pick the running platform, in either order', async () => {
  const a = mobileFor(Platform.ANDROID);
  const androidPage = new LoginPage(a.mobile);
  assert.deepEqual(await strategyOf(androidPage.picker, a.calls), {
    using: '-android uiautomator',
    value: 'new UiSelector().className("x")',
  });
  assert.equal((await strategyOf(androidPage.password, a.calls)).using, 'id');

  const i = mobileFor(Platform.IOS);
  const iosPage = new LoginPage(i.mobile);
  assert.deepEqual(await strategyOf(iosPage.picker, i.calls), {
    using: '-ios class chain',
    value: '**/XCUIElementTypeDatePicker',
  });
  assert.deepEqual(await strategyOf(iosPage.password, i.calls), {
    using: '-ios predicate string',
    value: "type == 'XCUIElementTypeSecureTextField'",
  });
});

test('a field with no locator for the platform throws on use, naming the field', async () => {
  const { mobile } = mobileFor(Platform.IOS);
  const page = new LoginPage(mobile);
  assert.throws(
    () => page.androidOnly.click(),
    /LoginPage\.androidOnly has no iOS locator.*@iOSFindBy/,
  );
  // Awaiting or inspecting it is harmless.
  assert.equal(page.androidOnly.then, undefined);
  assert.equal(await page.androidOnly, page.androidOnly);
});

test('platform-specific decorator wins over FindBy regardless of order', async () => {
  for (const order of ['specific-first', 'findby-first']) {
    const specific = AndroidFindBy({ xpath: '//a/special' });
    const shared = FindBy({ id: 'shared' });
    const Page = defineScreen('P', {
      f: order === 'specific-first' ? [specific, shared] : [shared, specific],
    });

    const a = mobileFor(Platform.ANDROID);
    assert.equal((await strategyOf(new Page(a.mobile).f, a.calls)).value, '//a/special', order);
    const i = mobileFor(Platform.IOS);
    assert.equal((await strategyOf(new Page(i.mobile).f, i.calls)).value, 'shared', order);
  }
});

test('selector keys map onto the matching getBy* method', async () => {
  const cases = [
    [Platform.ANDROID, { accessibility: 'Login' }, 'accessibility id', 'Login'],
    [Platform.ANDROID, { label: 'Login' }, 'accessibility id', 'Login'],
    [
      Platform.ANDROID,
      { className: 'android.widget.Button' },
      'class name',
      'android.widget.Button',
    ],
    [Platform.ANDROID, { xpath: '//a/b[2]' }, 'xpath', '//a/b[2]'],
    [Platform.ANDROID, { text: 'Hi', exact: false }, 'xpath', "//*[contains(@text, 'Hi')]"],
    [Platform.ANDROID, { placeholder: 'Email' }, 'xpath', "//*[@hint='Email']"],
    [
      Platform.IOS,
      { text: 'Hi' },
      '-ios predicate string',
      "label == 'Hi' OR value == 'Hi' OR name == 'Hi'",
    ],
  ];
  for (const [platform, selector, using, value] of cases) {
    const Page = defineScreen('P', { f: [FindBy(selector)] });
    const { mobile, calls } = mobileFor(platform);
    assert.deepEqual(
      await strategyOf(new Page(mobile).f, calls),
      { using, value },
      JSON.stringify(selector),
    );
  }
});

test('selectors are validated when the decorator is created', () => {
  assert.throws(() => FindBy({}), /exactly one locator strategy \(got none\)/);
  assert.throws(() => FindBy({ id: 'a', xpath: '//b' }), /exactly one.*id \+ xpath/);
  assert.throws(() => FindBy({ css: '.x' }), /unknown selector key 'css'/);
  assert.throws(() => FindBy({ id: '' }), /'id' needs a non-empty string/);
  assert.throws(() => FindBy({ id: 'a', exact: true }), /'exact' only applies/);
  assert.throws(() => FindBy({ uiAutomator: 'x' }), /Android-only — put it in @AndroidFindBy/);
  assert.throws(() => iOSFindBy({ uiAutomator: 'x' }), /Android-only/);
  assert.throws(() => AndroidFindBy({ predicate: 'x' }), /iOS-only — put it in @iOSFindBy/);
  assert.throws(() => AndroidFindBy({ classChain: 'x' }), /iOS-only/);
  assert.doesNotThrow(() => FindBy({ text: /sign in/i }));
});

test('decorator rejects misuse with a clear message', () => {
  const d = FindBy({ id: 'a' });
  assert.throws(() => d({}, 'username'), /legacy decorator arguments.*experimentalDecorators/);
  assert.throws(
    () => d(undefined, { kind: 'method', name: 'm' }),
    /only decorate a class field — write `accessor name!: Locator` \(got a method\)/,
  );
  assert.throws(() => d(undefined, { kind: 'field', name: 'f', static: true }), /static field/);
});

test('using a decorator on a class that does not extend Screen explains why', () => {
  const init = FindBy({ id: 'a' })(undefined, fieldContext('f'));
  class NotAScreen {}
  assert.throws(() => init.call(new NotAScreen(), undefined), /NotAScreen must extend Screen/);
});

test('two decorators for the same platform on one field is an error', () => {
  const Page = defineScreen('Dup', { f: [AndroidFindBy({ id: 'a' }), AndroidFindBy({ id: 'b' })] });
  const { mobile } = mobileFor(Platform.ANDROID);
  assert.throws(() => new Page(mobile), /Dup\.f has more than one @AndroidFindBy/);
  // The other platform doesn't care.
  assert.doesNotThrow(() => new Page(mobileFor(Platform.IOS).mobile));
});

// ─── Selector lists (try several strategies) ───────────────────────────

// A fake whose findElements answers per strategy value: { value: [ids] }.
function mobileWithElements(platform, byValue) {
  const calls = [];
  const { mobile } = makeMobile(platform, {
    findElements: async (using, value) => {
      calls.push({ using, value });
      return (byValue[value] ?? []).map((id) => ({
        'element-6066-11e4-a52e-4f735466cecf': id,
        ELEMENT: id,
      }));
    },
    elementClick: async (id) => calls.push({ click: id }),
  });
  return { mobile, calls };
}

const ListPage = defineScreen('ListPage', {
  login: [
    iOSFindBy({ accessibility: 'login' }),
    AndroidFindBy([{ id: 'com.app:id/login' }, { text: 'Log in' }, { xpath: '//a/Button[1]' }]),
  ],
});

test('a selector list acts on the first entry that matches', async () => {
  const { mobile, calls } = mobileWithElements(Platform.ANDROID, {
    'com.app:id/login': ['primary'],
    "//*[@text='Log in']": ['by-text'],
  });
  await new ListPage(mobile).login.click();
  assert.deepEqual(
    calls.filter((c) => c.click),
    [{ click: 'primary' }],
  );
});

test('a selector list falls back to later entries when earlier ones find nothing', async () => {
  const { mobile, calls } = mobileWithElements(Platform.ANDROID, { '//a/Button[1]': ['by-xpath'] });
  await new ListPage(mobile).login.click();
  assert.deepEqual(
    calls.filter((c) => c.click),
    [{ click: 'by-xpath' }],
  );
});

test('a selector list de-duplicates an element matched by several entries', async () => {
  const { mobile } = mobileWithElements(Platform.ANDROID, {
    'com.app:id/login': ['same'],
    "//*[@text='Log in']": ['same'],
  });
  assert.equal(await new ListPage(mobile).login.count(), 1);
});

test('the other platform still uses its own decorator next to a list', async () => {
  const { mobile, calls } = mobileWithElements(Platform.IOS, { login: ['ios-el'] });
  await new ListPage(mobile).login.click();
  assert.deepEqual(
    calls.filter((c) => c.click),
    [{ click: 'ios-el' }],
  );
});

test('a single-entry list behaves like a plain selector', async () => {
  const Page = defineScreen('P', { f: [FindBy([{ xpath: '//a/b' }])] });
  const { mobile, calls } = mobileFor(Platform.ANDROID);
  assert.deepEqual(await strategyOf(new Page(mobile).f, calls), { using: 'xpath', value: '//a/b' });
});

test('selector lists are validated entry by entry', () => {
  assert.throws(() => FindBy([]), /selector list is empty/);
  assert.throws(
    () => AndroidFindBy([{ id: 'a' }, { css: '.x' }]),
    /unknown selector key 'css'.*selector #2/,
  );
  assert.throws(() => AndroidFindBy([{ id: 'a' }, { predicate: 'x' }]), /iOS-only.*selector #2/);
  assert.throws(() => FindBy([{ id: 'a', xpath: '//b' }]), /exactly one.*selector #1/);
});

// ─── Auto-accessors (`accessor name!: Locator`) ────────────────────────
// An accessor decorator gets `{ get, set }` and a `kind: 'accessor'` context and
// returns `{ init }`; stacked decorators chain their `init`s bottom-up like
// field initializers.

function defineAccessorScreen(className, fields) {
  const inits = Object.entries(fields).map(([name, decorators]) => [
    name,
    decorators
      .map((d) => d({ get() {}, set() {} }, { ...fieldContext(name), kind: 'accessor' }))
      .reverse(),
  ]);
  const Cls = class extends Screen {
    constructor(mobile) {
      super(mobile);
      for (const [name, chain] of inits) {
        let value;
        for (const result of chain) {
          assert.equal(typeof result.init, 'function', 'accessor decorators return { init }');
          value = result.init.call(this, value);
        }
        this[name] = value;
      }
    }
  };
  Object.defineProperty(Cls, 'name', { value: className });
  return Cls;
}

test('decorators work on auto-accessors, stacked per platform', async () => {
  const Page = defineAccessorScreen('AccessorPage', {
    login: [
      iOSFindBy({ id: 'Login' }),
      AndroidFindBy({ uiAutomator: 'new UiSelector().description("Login")' }),
    ],
    androidOnly: [AndroidFindBy({ id: 'x' })],
  });
  const a = mobileFor(Platform.ANDROID);
  assert.deepEqual(await strategyOf(new Page(a.mobile).login, a.calls), {
    using: '-android uiautomator',
    value: 'new UiSelector().description("Login")',
  });
  const i = mobileFor(Platform.IOS);
  const iosPage = new Page(i.mobile);
  assert.deepEqual(await strategyOf(iosPage.login, i.calls), {
    using: 'accessibility id',
    value: 'Login',
  });
  assert.throws(() => iosPage.androidOnly.click(), /AccessorPage\.androidOnly has no iOS locator/);
});
