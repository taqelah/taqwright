// Unit tests for the pure helpers exported from the inspector server.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withTimeout,
  readJson,
  resolveLocatorDescriptor,
  findCandidateRefs,
} from '../dist/inspector/server.js';
import { Platform } from '../dist/types/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal async-iterable stand-in for an http IncomingMessage body.
function fakeReq(body) {
  return {
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body, 'utf8');
    },
  };
}

describe('withTimeout', () => {
  test('resolves with the value when it settles in time', async () => {
    assert.equal(await withTimeout(Promise.resolve(7), 100, 'x'), 7);
  });
  test('rejects with a labelled error after the deadline', async () => {
    await assert.rejects(
      () =>
        withTimeout(
          sleep(200).then(() => 'late'),
          30,
          'screenshot',
        ),
      /device timeout: screenshot/,
    );
  });
});

describe('readJson', () => {
  test('parses a JSON body', async () => {
    assert.deepEqual(await readJson(fakeReq('{"a":1,"b":"x"}')), { a: 1, b: 'x' });
  });
  test('empty body → {}', async () => {
    assert.deepEqual(await readJson(fakeReq('')), {});
  });
  test('invalid JSON throws', async () => {
    await assert.rejects(() => readJson(fakeReq('{bad')));
  });
});

describe('resolveLocatorDescriptor', () => {
  test('passes through an explicit descriptor', () => {
    const desc = { kind: 'leaf', using: 'id', value: 'x' };
    assert.equal(resolveLocatorDescriptor({ descriptor: desc }), desc);
  });
  test('wraps flat {using,value} into a leaf descriptor', () => {
    assert.deepEqual(resolveLocatorDescriptor({ using: 'xpath', value: '//a' }), {
      kind: 'leaf',
      using: 'xpath',
      value: '//a',
    });
  });
  test('throws when neither shape is present', () => {
    assert.throws(() => resolveLocatorDescriptor({}), /missing both/);
  });
});

// A driver whose findElements answers from a `using|value` → ids table, logging each lookup.
// A value of 'THROW' makes that lookup throw.
function fakeFinder(table) {
  const calls = [];
  return {
    calls,
    async findElements(using, value) {
      calls.push([using, value]);
      const hit = table[`${using}|${value}`];
      if (hit === 'THROW') throw new Error('invalid selector');
      return (hit ?? []).map((id) => ({ 'element-6066-11e4-a52e-4f735466cecf': id }));
    },
  };
}
const RN_FALLBACK = '-android uiautomator|new UiSelector().resourceId("login")';
const ids = (refs) => refs.map((r) => r['element-6066-11e4-a52e-4f735466cecf']);

describe('findCandidateRefs — counts a candidate the way its snippet resolves (#127)', () => {
  test('Android bare id: the prefixed lookup misses, the resourceId fallback counts', async () => {
    const d = fakeFinder({ [RN_FALLBACK]: ['e1'] });
    const refs = await findCandidateRefs(d, Platform.ANDROID, { using: 'id', value: 'login' });
    assert.deepEqual(ids(refs), ['e1']);
    assert.deepEqual(d.calls, [
      ['id', 'login'],
      ['-android uiautomator', 'new UiSelector().resourceId("login")'],
    ]);
  });

  test('Android bare id: a primary hit wins and the fallback is not tried', async () => {
    const d = fakeFinder({ 'id|login': ['n1', 'n2'], [RN_FALLBACK]: ['e1'] });
    const refs = await findCandidateRefs(d, Platform.ANDROID, { using: 'id', value: 'login' });
    assert.deepEqual(ids(refs), ['n1', 'n2']);
    assert.equal(d.calls.length, 1);
  });

  test('Android fully-qualified id: one exact lookup, no fallback', async () => {
    const d = fakeFinder({});
    const refs = await findCandidateRefs(d, Platform.ANDROID, {
      using: 'id',
      value: 'com.app:id/login',
    });
    assert.deepEqual(refs, []);
    assert.deepEqual(d.calls, [['id', 'com.app:id/login']]);
  });

  test('a throwing lookup counts 0 and is never followed by the fallback', async () => {
    const d = fakeFinder({ 'id|login': 'THROW', [RN_FALLBACK]: ['e1'] });
    const refs = await findCandidateRefs(d, Platform.ANDROID, { using: 'id', value: 'login' });
    assert.deepEqual(refs, []);
    assert.equal(d.calls.length, 1);
  });

  test('Android non-id candidates get a single plain lookup', async () => {
    const d = fakeFinder({ 'xpath|//x': ['a'] });
    const refs = await findCandidateRefs(d, Platform.ANDROID, { using: 'xpath', value: '//x' });
    assert.deepEqual(ids(refs), ['a']);
    assert.deepEqual(d.calls, [['xpath', '//x']]);
  });

  test('iOS: the accessibility-id candidate is one lookup, no fallback', async () => {
    const d = fakeFinder({});
    const refs = await findCandidateRefs(d, Platform.IOS, {
      using: 'accessibility id',
      value: 'login',
    });
    assert.deepEqual(refs, []);
    assert.deepEqual(d.calls, [['accessibility id', 'login']]);
  });

  test('iOS: even an id-strategy candidate gets no Android fallback', async () => {
    const d = fakeFinder({});
    await findCandidateRefs(d, Platform.IOS, { using: 'id', value: 'login' });
    assert.deepEqual(d.calls, [['id', 'login']]);
  });
});
