// Unit tests for the WebView/CSS candidate path of the locator suggester —
// generateCandidates(..., isWeb=true) routes to the web generator, which
// emits CSS selectors + a lowercased positional xpath fallback.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCandidates,
  selectBestPerCategory,
  pickRecommended,
  WEB_CATEGORY_ORDER,
  Platform,
} from './helpers.js';

// In the web path `platform` is irrelevant (the DOM is the same) — use ANDROID.
const web = (attrs, xpath = '') => generateCandidates(Platform.ANDROID, attrs, xpath, true);
const byCat = (list, cat) => list.filter((c) => c.category === cat);
const cssValues = (list) => byCat(list, 'css').map((c) => c.value);

describe('WEB_CATEGORY_ORDER', () => {
  test('css first, xpath fallback', () => {
    assert.deepEqual(WEB_CATEGORY_ORDER, ['css', 'xpath']);
  });
});

describe('generateCandidates(isWeb=true) — CSS', () => {
  test('data-testid is the top CSS candidate', () => {
    const list = web({ __tag: 'button', 'data-testid': 'submit' });
    const css = byCat(list, 'css');
    assert.ok(css.length >= 1);
    assert.equal(css[0].using, 'css selector');
    assert.equal(css[0].value, '[data-testid="submit"]');
    assert.equal(css[0].code, 'mobile.getByCss("[data-testid=\\"submit\\"]")');
  });

  test('data-test-id and data-test variants are recognized', () => {
    assert.ok(cssValues(web({ __tag: 'a', 'data-test-id': 'x' })).includes('[data-test-id="x"]'));
    assert.ok(cssValues(web({ __tag: 'a', 'data-test': 'y' })).includes('[data-test="y"]'));
  });

  test('simple id → #id; non-ident id → attribute selector', () => {
    assert.ok(cssValues(web({ __tag: 'div', id: 'header' })).includes('#header'));
    // dots/colons are legal in HTML ids but break the # form → attr selector
    assert.ok(cssValues(web({ __tag: 'div', id: 'a.b:c' })).includes('[id="a.b:c"]'));
  });

  test('name attribute → [name="…"]', () => {
    assert.ok(cssValues(web({ __tag: 'input', name: 'email' })).includes('[name="email"]'));
  });

  test('class tokens → tag.class chain (only simple tokens)', () => {
    const vals = cssValues(web({ __tag: 'button', class: 'btn primary' }));
    assert.ok(vals.includes('button.btn.primary'));
  });

  test('no usable attrs → no CSS candidate, only positional xpath', () => {
    const list = web({ __tag: 'span' }, '/HTML/BODY/SPAN[1]');
    assert.equal(byCat(list, 'css').length, 0);
    assert.equal(byCat(list, 'xpath').length, 1);
  });
});

describe('generateCandidates(isWeb=true) — positional xpath', () => {
  test('element-name segments are lowercased; indices untouched', () => {
    const xp = byCat(web({ __tag: 'div' }, '/HTML/BODY/DIV[2]/SPAN[1]'), 'xpath')[0];
    assert.equal(xp.using, 'xpath');
    assert.equal(xp.value, '/html/body/div[2]/span[1]');
    assert.equal(xp.code, 'mobile.getByXpath("/html/body/div[2]/span[1]")');
  });

  test('no xpath given → no xpath candidate', () => {
    assert.equal(byCat(web({ __tag: 'div', id: 'x' }), 'xpath').length, 0);
  });
});

describe('web selection helpers', () => {
  test('selectBestPerCategory(isWeb) keeps the unique CSS + xpath in web order', () => {
    const verified = web({ __tag: 'div', id: 'header' }, '/HTML/BODY/DIV[1]').map((c) => ({
      ...c,
      count: 1,
      unique: true,
    }));
    const best = selectBestPerCategory(Platform.ANDROID, verified, true);
    assert.deepEqual(
      best.map((b) => b.category),
      ['css', 'xpath'],
    );
  });

  test('pickRecommended(isWeb) prefers the unique CSS over the positional xpath', () => {
    const verified = web({ __tag: 'div', id: 'header' }, '/HTML/BODY/DIV[1]').map((c) => ({
      ...c,
      count: 1,
      unique: true,
    }));
    const rec = pickRecommended(Platform.ANDROID, verified, true);
    assert.equal(rec.category, 'css');
    assert.equal(rec.value, '#header');
  });
});
