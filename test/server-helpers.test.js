// Unit tests for the pure helpers exported from the inspector server.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, readJson, resolveLocatorDescriptor } from '../dist/inspector/server.js';

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
