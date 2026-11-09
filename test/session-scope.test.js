// Unit tests for `sessionScope: 'file'`: the FileSessionCache behind the
// fixture (src/fixture/session-scope.ts) and its config-load check
// `findSessionScopeMisconfig` (src/config.ts). The fixture wiring itself needs a
// real device and is not unit-covered.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FileSessionCache } from '../dist/fixture/session-scope.js';
import { defineConfig, findSessionScopeMisconfig } from '../dist/config.js';
import { Platform } from '../dist/types/index.js';

// A cache whose open/close calls are recorded, with sessions numbered in open order.
function mkCache({ failOpen = false, failClose = false } = {}) {
  const calls = [];
  let n = 0;
  const cache = new FileSessionCache({
    open: async (file) => {
      calls.push(['open', file]);
      if (failOpen) throw new Error('no device');
      return { id: ++n };
    },
    close: async (session, summary) => {
      calls.push(['close', session.id, { ...summary }]);
      if (failClose) throw new Error('session gone');
    },
  });
  return { cache, calls };
}

describe('FileSessionCache', () => {
  test('reuses the session for tests from the same file', async () => {
    const { cache, calls } = mkCache();
    const a = await cache.acquire('/specs/a.spec.ts');
    const b = await cache.acquire('/specs/a.spec.ts');
    assert.equal(a.isNew, true);
    assert.equal(b.isNew, false);
    assert.equal(b.session, a.session);
    assert.deepEqual(calls, [['open', '/specs/a.spec.ts']]);
  });

  test('closes the old session before opening one for a new file', async () => {
    const { cache, calls } = mkCache();
    await cache.acquire('/specs/a.spec.ts');
    cache.record({ status: 'passed' });
    const next = await cache.acquire('/specs/b.spec.ts');
    assert.equal(next.isNew, true);
    assert.equal(next.session.id, 2);
    assert.deepEqual(
      calls.map((c) => c.slice(0, 2)),
      [
        ['open', '/specs/a.spec.ts'],
        ['close', 1],
        ['open', '/specs/b.spec.ts'],
      ],
    );
    assert.equal(cache.file, '/specs/b.spec.ts');
  });

  test('release closes the open session once and empties the cache', async () => {
    const { cache, calls } = mkCache();
    await cache.acquire('/specs/a.spec.ts');
    await cache.release();
    await cache.release();
    assert.equal(calls.filter((c) => c[0] === 'close').length, 1);
    assert.equal(cache.file, undefined);
  });

  test('summary counts tests and is failed if any test failed, keeping the first reason', async () => {
    const { cache, calls } = mkCache();
    await cache.acquire('/specs/a.spec.ts');
    cache.record({ status: 'passed' });
    cache.record({ status: 'skipped' });
    cache.record({ status: 'failed', error: 'Order not confirmed' });
    cache.record({ status: 'timedOut' });
    await cache.release();
    assert.deepEqual(calls.at(-1)[2], {
      file: '/specs/a.spec.ts',
      tests: 4,
      failed: true,
      reason: 'Order not confirmed',
    });
  });

  test('summary for an all-passing file is not failed and has no reason', async () => {
    const { cache, calls } = mkCache();
    await cache.acquire('/specs/a.spec.ts');
    cache.record({ status: 'passed' });
    cache.record({ status: 'passed' });
    await cache.release();
    assert.deepEqual(calls.at(-1)[2], { file: '/specs/a.spec.ts', tests: 2, failed: false });
  });

  test('a failure without an error message uses the status as the reason', async () => {
    const { cache, calls } = mkCache();
    await cache.acquire('/specs/a.spec.ts');
    cache.record({ status: 'interrupted' });
    await cache.release();
    assert.equal(calls.at(-1)[2].reason, 'interrupted');
  });

  test('each file gets its own summary', async () => {
    const { cache, calls } = mkCache();
    await cache.acquire('/specs/a.spec.ts');
    cache.record({ status: 'failed', error: 'boom' });
    await cache.acquire('/specs/b.spec.ts');
    cache.record({ status: 'passed' });
    await cache.release();
    const closes = calls.filter((c) => c[0] === 'close').map((c) => c[2]);
    assert.equal(closes[0].failed, true);
    assert.deepEqual(closes[1], { file: '/specs/b.spec.ts', tests: 1, failed: false });
  });

  test('a failing close does not block opening the next file', async () => {
    const { cache } = mkCache({ failClose: true });
    await cache.acquire('/specs/a.spec.ts');
    const next = await cache.acquire('/specs/b.spec.ts');
    assert.equal(next.isNew, true);
    await assert.doesNotReject(() => cache.release());
  });

  test('a failing open throws and leaves the cache empty', async () => {
    const { cache } = mkCache({ failOpen: true });
    await assert.rejects(() => cache.acquire('/specs/a.spec.ts'), /no device/);
    assert.equal(cache.file, undefined);
  });

  test('record with no open session is a no-op', () => {
    const { cache } = mkCache();
    assert.doesNotThrow(() => cache.record({ status: 'failed' }));
  });
});

function mkConfig(use = {}, top = {}) {
  return {
    ...top,
    projects: [
      {
        name: 'journeys',
        use: { platform: Platform.ANDROID, device: { provider: 'emulator' }, ...use },
      },
    ],
  };
}

describe('findSessionScopeMisconfig', () => {
  test('default and explicit test scope pass', () => {
    assert.equal(findSessionScopeMisconfig(mkConfig()), null);
    assert.equal(findSessionScopeMisconfig(mkConfig({ sessionScope: 'test' })), null);
  });

  test('file scope on a serial project passes', () => {
    assert.equal(findSessionScopeMisconfig(mkConfig({ sessionScope: 'file' })), null);
    assert.equal(
      findSessionScopeMisconfig(mkConfig({ sessionScope: 'file', network: 'off' })),
      null,
    );
  });

  test('file scope with a top-level fullyParallel passes (defineConfig overrides it)', () => {
    assert.equal(
      findSessionScopeMisconfig(mkConfig({ sessionScope: 'file' }, { fullyParallel: true })),
      null,
    );
  });

  test('file scope with network capture is rejected, naming the project', () => {
    const msg = findSessionScopeMisconfig(mkConfig({ sessionScope: 'file', network: 'on' }));
    assert.match(msg, /project "journeys"/);
    assert.match(msg, /network: 'on'/);
  });

  test('test scope with fullyParallel and network is untouched', () => {
    assert.equal(
      findSessionScopeMisconfig(
        mkConfig({ sessionScope: 'test', network: 'on' }, { fullyParallel: true }),
      ),
      null,
    );
  });

  test('an unknown value is rejected', () => {
    const msg = findSessionScopeMisconfig(mkConfig({ sessionScope: 'spec' }));
    assert.match(msg, /sessionScope: "spec"/);
  });

  test('defineConfig throws on a misconfigured project and accepts a valid one', () => {
    assert.throws(
      () => defineConfig(mkConfig({ sessionScope: 'file', network: 'on' })),
      /sessionScope: 'file'/,
    );
    assert.doesNotThrow(() => defineConfig(mkConfig({ sessionScope: 'file' })));
  });

  test('defineConfig turns fullyParallel off for file-scoped projects only', () => {
    const pw = defineConfig({
      fullyParallel: true,
      projects: [
        {
          name: 'journeys',
          use: {
            platform: Platform.ANDROID,
            device: { provider: 'emulator' },
            sessionScope: 'file',
          },
        },
        { name: 'isolated', use: { platform: Platform.ANDROID, device: { provider: 'emulator' } } },
      ],
    });
    assert.equal(pw.fullyParallel, true);
    assert.equal(pw.projects.find((p) => p.name === 'journeys').fullyParallel, false);
    assert.equal(pw.projects.find((p) => p.name === 'isolated').fullyParallel, undefined);
  });
});
