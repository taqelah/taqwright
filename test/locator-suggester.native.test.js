// Coverage for the native generateCandidates branches (Android UiSelector /
// xpath, iOS predicate / class-chain / xpath). The existing suite covers
// selection; this exercises the per-attribute candidate builders.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCandidates, Platform } from './helpers.js';

const cats = (list) => new Set(list.map((c) => c.category));
const subs = (list) => list.map((c) => c.subLabel);
const valueOf = (list, category, subLabel) =>
  list.find((c) => c.category === category && c.subLabel === subLabel)?.value;

describe('generateCandidates — Android', () => {
  const rich = {
    'resource-id': 'com.app:id/submit',
    'content-desc': 'Submit',
    text: 'OK',
    hint: 'enter value',
    class: 'android.widget.Button',
  };

  test('emits id, uiautomator and xpath categories', () => {
    const list = generateCandidates(Platform.ANDROID, rich, '//android.widget.Button[1]');
    const c = cats(list);
    assert.ok(c.has('id'));
    assert.ok(c.has('uiautomator'));
    assert.ok(c.has('xpath'));
  });

  test('resource-id drives the id candidate and a UiSelector', () => {
    const list = generateCandidates(Platform.ANDROID, rich, '//*');
    assert.equal(valueOf(list, 'id', 'resource-id'), 'com.app:id/submit');
    assert.ok(subs(list).includes('resourceId'));
    assert.ok(subs(list).includes('content-desc'));
    assert.ok(subs(list).includes('class + content-desc'));
  });

  test('multiline content-desc adds a substring UiSelector', () => {
    const list = generateCandidates(
      Platform.ANDROID,
      { 'content-desc': 'first line\nsecond line', class: 'android.view.View' },
      '//*',
    );
    assert.ok(subs(list).includes('content-desc contains'));
  });

  test('a class-only element yields just a className UiSelector', () => {
    const list = generateCandidates(
      Platform.ANDROID,
      { class: 'android.view.View' },
      '//android.view.View[3]',
    );
    assert.deepEqual(subs(list), ['class']);
    assert.equal(list[0].category, 'uiautomator');
  });
});

describe('generateCandidates — iOS', () => {
  const rich = {
    name: 'submitBtn',
    label: 'Submit',
    value: 'v',
    placeholderValue: 'enter',
    type: 'XCUIElementTypeButton',
    class: 'XCUIElementTypeButton',
  };

  test('emits id, predicate, classChain and xpath categories', () => {
    const list = generateCandidates(Platform.IOS, rich, '//XCUIElementTypeButton[1]');
    const c = cats(list);
    assert.ok(c.has('id'));
    assert.ok(c.has('predicate'));
    assert.ok(c.has('classChain'));
    assert.ok(c.has('xpath'));
  });

  test('name drives accessibility id + name predicate', () => {
    const list = generateCandidates(Platform.IOS, rich, '//*');
    assert.equal(valueOf(list, 'id', 'accessibility id'), 'submitBtn');
    assert.ok(subs(list).includes('name'));
    assert.ok(subs(list).includes('label'));
    assert.ok(subs(list).includes('type + name'));
  });
});
