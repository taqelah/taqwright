// Unit tests for src/inspector/locator-suggester.ts (compiled artifact).
//
// Structure: one `describe` per function under test, so user-fed cases
// slot cleanly. The "regression backbone" blocks are the already-verified
// scenarios from the recommendation feature — they must never go red.
//
// Assertion style: assert RELATIVE outcomes (which candidate wins, by
// identity/category/subLabel; category ordering; arithmetic derived from
// input) rather than hardcoded priority integers, so intentional tuning of
// the priority constants doesn't cause false failures. Exact values are
// asserted only for function contracts (nth's -100 delta, descriptor
// shape, count/unique invariants).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Platform,
  generateCandidates,
  selectBestPerCategory,
  makeNthSuggestion,
  isPositional,
  pickRecommended,
  CATEGORY_ORDER,
  mkSug,
  mkNth,
} from './helpers.js';

// ─── pickRecommended ──────────────────────────────────────────────

describe('pickRecommended — regression backbone', () => {
  test('Username scenario: positional className.nth loses to unique non-positional hint xpath', () => {
    const hintXpath = mkSug({
      category: 'xpath',
      subLabel: 'hint',
      priority: 640,
      unique: true,
      code: `mobile.getByXpath("//*[@hint='Username']")`,
      value: "//*[@hint='Username']",
    });
    const classBase = mkSug({
      category: 'uiautomator',
      subLabel: 'class',
      priority: 700,
      unique: false,
      count: 3,
    });
    const classNth = mkNth(classBase, 0); // priority 600, descriptor.kind === 'nth'

    const rec = pickRecommended(Platform.ANDROID, [classNth, hintXpath]);

    assert.equal(rec, hintXpath); // winner by identity, not by number
    assert.equal(isPositional(rec), false);
  });

  test('resource-id (id, top priority) outranks unique hint xpath', () => {
    const id = mkSug({ category: 'id', subLabel: 'resource-id', priority: 1000, unique: true });
    const hintXpath = mkSug({ category: 'xpath', subLabel: 'hint', priority: 640, unique: true });
    assert.equal(pickRecommended(Platform.ANDROID, [id, hintXpath]), id);
  });

  test('nothing unique → undefined', () => {
    const a = mkSug({ unique: false, count: 4 });
    const b = mkSug({ category: 'uiautomator', unique: false, count: 2 });
    assert.equal(pickRecommended(Platform.ANDROID, [a, b]), undefined);
  });

  test('empty verified array → undefined', () => {
    assert.equal(pickRecommended(Platform.ANDROID, []), undefined);
  });
});

describe('pickRecommended — ranking rules', () => {
  test('non-positional unique beats higher-priority positional unique (robust pool wins)', () => {
    const robustLow = mkSug({ category: 'xpath', subLabel: 'hint', priority: 300, unique: true });
    const positionalHigh = mkNth(
      mkSug({ category: 'uiautomator', subLabel: 'class', priority: 900, unique: false, count: 2 }),
      1,
    ); // priority 800, positional
    const rec = pickRecommended(Platform.ANDROID, [positionalHigh, robustLow]);
    assert.equal(rec, robustLow);
  });

  test('robust pool empty → falls back to a positional unique', () => {
    const nthA = mkNth(mkSug({ subLabel: 'class', priority: 700, unique: false, count: 2 }), 0);
    const nthB = mkNth(mkSug({ subLabel: 'class', priority: 500, unique: false, count: 2 }), 1);
    const rec = pickRecommended(Platform.ANDROID, [nthB, nthA]);
    assert.equal(rec, nthA); // higher base priority (600 vs 400)
    assert.equal(isPositional(rec), true);
  });

  test('equal priority across categories → lower CATEGORY_ORDER index wins (Android: uiautomator before xpath)', () => {
    const xp = mkSug({ category: 'xpath', priority: 500, unique: true });
    const ua = mkSug({ category: 'uiautomator', priority: 500, unique: true });
    // Input order puts xpath first to prove it's not just "first wins".
    assert.equal(pickRecommended(Platform.ANDROID, [xp, ua]), ua);
  });

  test('equal priority AND category → earliest in array (stable)', () => {
    const first = mkSug({ category: 'xpath', subLabel: 'a', priority: 500, unique: true });
    const second = mkSug({ category: 'xpath', subLabel: 'b', priority: 500, unique: true });
    assert.equal(pickRecommended(Platform.ANDROID, [first, second]), first);
  });

  test('non-unique entries are never selected', () => {
    const loud = mkSug({ category: 'id', priority: 1000, unique: false, count: 5 });
    const quiet = mkSug({ category: 'xpath', priority: 200, unique: true });
    assert.equal(pickRecommended(Platform.ANDROID, [loud, quiet]), quiet);
  });

  test('iOS: id outranks predicate', () => {
    const id = mkSug({ category: 'id', priority: 1000, unique: true });
    const pred = mkSug({ category: 'predicate', priority: 950, unique: true });
    assert.equal(pickRecommended(Platform.IOS, [pred, id]), id);
  });
});

// ─── isPositional ─────────────────────────────────────────────────

describe('isPositional', () => {
  test('flat candidate (no descriptor) → false', () => {
    assert.equal(isPositional(mkSug({ category: 'xpath', subLabel: 'hint' })), false);
  });

  test('descriptor kind "leaf" → false', () => {
    const s = mkSug({ descriptor: { kind: 'leaf', using: 'xpath', value: '//*' } });
    assert.equal(isPositional(s), false);
  });

  test('descriptor kind "filter" → false (only nth counts)', () => {
    const s = mkSug({
      descriptor: {
        kind: 'filter',
        on: { kind: 'leaf', using: 'xpath', value: '//*' },
        filter: { hasText: 'x' },
      },
    });
    assert.equal(isPositional(s), false);
  });

  test('real nth descriptor → true', () => {
    assert.equal(isPositional(mkNth(mkSug({ unique: false }), 1)), true);
  });
});

// ─── makeNthSuggestion ────────────────────────────────────────────

describe('makeNthSuggestion', () => {
  test('priority = base.priority - 100 (derived from input, not a literal)', () => {
    const base = mkSug({ priority: 700 });
    assert.equal(makeNthSuggestion(base, 0).priority, base.priority - 100);
  });

  test('priority may go negative — current contract is documented, not clamped', () => {
    const base = mkSug({ priority: 50 });
    assert.equal(makeNthSuggestion(base, 0).priority, -50);
  });

  test('descriptor shape is exactly nth-over-leaf', () => {
    const base = mkSug({ using: '-android uiautomator', value: 'new UiSelector()' });
    const out = makeNthSuggestion(base, 2);
    assert.deepEqual(out.descriptor, {
      kind: 'nth',
      on: { kind: 'leaf', using: base.using, value: base.value },
      n: 2,
    });
  });

  test('code/subLabel get the .nth(idx) suffix; count/unique forced', () => {
    const base = mkSug({ code: 'mobile.getByX("a")', subLabel: 'class', unique: false, count: 4 });
    const out = makeNthSuggestion(base, 0);
    assert.equal(out.code, 'mobile.getByX("a").nth(0)');
    assert.equal(out.subLabel, 'class + nth(0)');
    assert.equal(out.count, 1);
    assert.equal(out.unique, true);
  });

  test('category/using/value copied unchanged from base', () => {
    const base = mkSug({ category: 'uiautomator', using: '-android uiautomator', value: 'v' });
    const out = makeNthSuggestion(base, 1);
    assert.equal(out.category, base.category);
    assert.equal(out.using, base.using);
    assert.equal(out.value, base.value);
  });
});

// ─── selectBestPerCategory ────────────────────────────────────────

describe('selectBestPerCategory', () => {
  test('empty input → []', () => {
    assert.deepEqual(selectBestPerCategory(Platform.ANDROID, []), []);
  });

  test('missing categories are skipped; output follows CATEGORY_ORDER', () => {
    const id = mkSug({ category: 'id', priority: 1000, unique: true });
    const xp = mkSug({ category: 'xpath', priority: 600, unique: true });
    const out = selectBestPerCategory(Platform.ANDROID, [xp, id]); // shuffled input
    assert.deepEqual(
      out.map((s) => s.category),
      ['id', 'xpath'],
    ); // uiautomator skipped
  });

  test('within a category, a unique candidate beats a higher-priority non-unique one', () => {
    const loud = mkSug({
      category: 'xpath',
      subLabel: 'loud',
      priority: 900,
      unique: false,
      count: 3,
    });
    const quiet = mkSug({ category: 'xpath', subLabel: 'quiet', priority: 100, unique: true });
    const out = selectBestPerCategory(Platform.ANDROID, [loud, quiet]);
    assert.equal(out.length, 1);
    assert.equal(out[0].subLabel, 'quiet');
  });

  test('non-unique-only category falls back to its highest-priority candidate', () => {
    const hi = mkSug({
      category: 'uiautomator',
      subLabel: 'hi',
      priority: 800,
      unique: false,
      count: 2,
    });
    const lo = mkSug({
      category: 'uiautomator',
      subLabel: 'lo',
      priority: 200,
      unique: false,
      count: 2,
    });
    const out = selectBestPerCategory(Platform.ANDROID, [lo, hi]);
    assert.equal(out[0].subLabel, 'hi');
    assert.equal(out[0].unique, false);
  });

  test('iOS emits categories in [id, predicate, classChain, xpath] order', () => {
    const cands = [
      mkSug({ category: 'xpath', priority: 400, unique: true }),
      mkSug({ category: 'classChain', priority: 700, unique: true }),
      mkSug({ category: 'id', priority: 1000, unique: true }),
      mkSug({ category: 'predicate', priority: 900, unique: true }),
    ];
    const out = selectBestPerCategory(Platform.IOS, cands);
    assert.deepEqual(
      out.map((s) => s.category),
      CATEGORY_ORDER[Platform.IOS],
    );
  });
});

// ─── generateCandidates ───────────────────────────────────────────

describe('generateCandidates — Android', () => {
  test('empty attrs → []', () => {
    assert.deepEqual(generateCandidates(Platform.ANDROID, {}, ''), []);
  });

  test('only class + hint → no id candidate; has uiautomator class + hint xpath', () => {
    const out = generateCandidates(
      Platform.ANDROID,
      { class: 'android.widget.EditText', hint: 'Username' },
      '',
    );
    assert.equal(
      out.some((c) => c.category === 'id'),
      false,
    );
    assert.equal(
      out.some((c) => c.category === 'uiautomator' && /className/.test(c.value)),
      true,
    );
    assert.equal(
      out.some((c) => c.category === 'xpath' && c.value.includes("@hint='Username'")),
      true,
    );
  });

  test('resource-id present → an id candidate exists and has the max priority', () => {
    const out = generateCandidates(
      Platform.ANDROID,
      { 'resource-id': 'com.x:id/login', class: 'android.widget.Button' },
      '',
    );
    const id = out.filter((c) => c.category === 'id');
    assert.equal(id.length >= 1, true);
    const max = Math.max(...out.map((c) => c.priority));
    assert.equal(
      id.some((c) => c.priority === max),
      true,
    );
  });

  test('multiline attr value → xpath uses contains(), not literal newline equality', () => {
    const out = generateCandidates(
      Platform.ANDROID,
      { 'content-desc': 'Boho Wrap Dress\n$69.99' },
      '',
    );
    const xp = out.filter((c) => c.category === 'xpath');
    assert.equal(xp.length >= 1, true);
    assert.equal(
      xp.some((c) => c.value.includes('contains(@content-desc')),
      true,
    );
    assert.equal(
      xp.every((c) => !c.value.includes('\n')),
      true,
    );
  });

  test('xpath stable-attr ordering: resource-id > content-desc > text > hint', () => {
    const out = generateCandidates(
      Platform.ANDROID,
      { 'resource-id': 'rid', 'content-desc': 'cd', text: 'tx', hint: 'hn' },
      '',
    );
    const pri = (needle) => {
      const c = out.find((x) => x.category === 'xpath' && x.value.includes(needle));
      assert.ok(c, `expected an xpath candidate containing ${needle}`);
      return c.priority;
    };
    assert.ok(pri('@resource-id') > pri('@content-desc'));
    assert.ok(pri('@content-desc') > pri('@text'));
    assert.ok(pri('@text') > pri('@hint'));
  });
});

describe('generateCandidates — iOS', () => {
  test('empty attrs → []', () => {
    assert.deepEqual(generateCandidates(Platform.IOS, {}, ''), []);
  });

  test('name → accessibility id (id) + predicate', () => {
    const out = generateCandidates(Platform.IOS, { name: 'loginBtn' }, '');
    assert.equal(
      out.some((c) => c.category === 'id' && c.using === 'accessibility id'),
      true,
    );
    assert.equal(
      out.some((c) => c.category === 'predicate'),
      true,
    );
  });

  test('type only → classChain type-only, no id/predicate-name', () => {
    const out = generateCandidates(Platform.IOS, { type: 'XCUIElementTypeButton' }, '');
    assert.equal(
      out.some((c) => c.category === 'classChain'),
      true,
    );
    assert.equal(
      out.some((c) => c.category === 'id'),
      false,
    );
  });
});
