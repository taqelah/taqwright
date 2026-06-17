// Unit tests for the pure HAR 1.2 builder in src/network/har.ts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarBuilder } from '../dist/network/har.js';

const req = (over = {}) => ({
  method: 'GET',
  url: 'http://example.com/api?page=1&size=10',
  httpVersion: 'HTTP/1.1',
  headers: [{ name: 'User-Agent', value: 'test' }],
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...over,
});

describe('createHarBuilder.toJson', () => {
  test('emits a valid empty HAR 1.2 log', () => {
    const har = createHarBuilder({ creator: 'taqwright' });
    const { log } = har.toJson();
    assert.equal(log.version, '1.2');
    assert.equal(log.creator.name, 'taqwright');
    assert.equal(log.creator.version, '0'); // defaulted
    assert.deepEqual(log.entries, []);
    assert.equal('comment' in log, false);
  });

  test('addComment joins lines into log.comment', () => {
    const har = createHarBuilder({ creator: 'taqwright', version: '1.2.3' });
    har.addComment('first');
    har.addComment('second');
    assert.equal(har.toJson().log.comment, 'first\nsecond');
    assert.equal(har.toJson().log.creator.version, '1.2.3');
  });
});

describe('createHarBuilder.startEntry', () => {
  test('parses the query string from the request URL', () => {
    const har = createHarBuilder({ creator: 'taqwright' });
    har.startEntry(req());
    const qs = har.toJson().log.entries[0].request.queryString;
    assert.deepEqual(qs, [
      { name: 'page', value: '1' },
      { name: 'size', value: '10' },
    ]);
  });

  test('a malformed URL yields an empty query string (no throw)', () => {
    const har = createHarBuilder({ creator: 'taqwright' });
    har.startEntry(req({ url: 'not a url' }));
    assert.deepEqual(har.toJson().log.entries[0].request.queryString, []);
  });

  test('request body sets postData with mimeType from the (case-insensitive) Content-Type header', () => {
    const har = createHarBuilder({ creator: 'taqwright' });
    har.startEntry(
      req({
        method: 'POST',
        headers: [{ name: 'CONTENT-TYPE', value: 'application/json' }],
        bodyText: '{"a":1}',
      }),
    );
    const { postData } = har.toJson().log.entries[0].request;
    assert.equal(postData.mimeType, 'application/json');
    assert.equal(postData.text, '{"a":1}');
  });

  test('onResponse records status, timing, body and Location redirectURL', () => {
    const har = createHarBuilder({ creator: 'taqwright' });
    const handle = har.startEntry(req());
    handle.onResponse({
      status: 302,
      statusText: 'Found',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'Location', value: '/next' }],
      mimeType: 'text/html',
      bodyBytes: 12,
      bodyText: 'hello world',
      endedAt: new Date('2026-01-01T00:00:00.050Z'),
    });
    const entry = har.toJson().log.entries[0];
    assert.equal(entry.response.status, 302);
    assert.equal(entry.time, 50);
    assert.equal(entry.timings.wait, 50);
    assert.equal(entry.response.content.text, 'hello world');
    assert.equal(entry.response.redirectURL, '/next');
  });

  test('negative elapsed time clamps to 0', () => {
    const har = createHarBuilder({ creator: 'taqwright' });
    const handle = har.startEntry(req({ startedAt: new Date('2026-01-01T00:00:00.100Z') }));
    handle.onResponse({
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [],
      mimeType: 'text/plain',
      endedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    assert.equal(har.toJson().log.entries[0].time, 0);
  });

  test('onError attaches the error to the entry', () => {
    const har = createHarBuilder({ creator: 'taqwright' });
    har.startEntry(req()).onError('ECONNREFUSED');
    assert.equal(har.toJson().log.entries[0]._error, 'ECONNREFUSED');
  });
});
