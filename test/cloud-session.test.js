// Unit tests for src/fixture/cloud-session.ts (compiled artifact) — the
// `taqwright-session` attachment the cloud `rawDriver` fixture adds to every
// test, so a report can link the test to its grid session (and its video)
// exactly, instead of joining on the session NAME the dashboard sync writes.
//
// Pure: importing it pulls in nothing from WebDriver or Playwright.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_SESSION_ATTACHMENT, cloudSessionAttachment } from '../dist/fixture/cloud-session.js';

describe('cloudSessionAttachment', () => {
  test('carries the session id as a small inline text attachment', () => {
    const a = cloudSessionAttachment({
      driver: { sessionId: '930c0fe8-26cc-421b-abdb-725207955fa2' },
    });
    assert.deepEqual(a, {
      name: 'taqwright-session',
      body: '930c0fe8-26cc-421b-abdb-725207955fa2',
      contentType: 'text/plain',
    });
  });

  test('is named what report readers look for', () => {
    // lime-cli report reads exactly this name (src/report.js _sessionFrom).
    assert.equal(CLOUD_SESSION_ATTACHMENT, 'taqwright-session');
  });

  test('nothing to attach without a session id', () => {
    assert.equal(cloudSessionAttachment({ driver: { sessionId: '' } }), null);
    assert.equal(cloudSessionAttachment({ driver: {} }), null);
    assert.equal(cloudSessionAttachment(undefined), null);
  });

  test('an id is trimmed and bounded, never a blob', () => {
    assert.equal(cloudSessionAttachment({ driver: { sessionId: '  abc  ' } }).body, 'abc');
    assert.equal(cloudSessionAttachment({ driver: { sessionId: 'x'.repeat(500) } }), null);
  });
});
