// Anonymous usage telemetry (src/telemetry/): one event per `taqwright test` run, sent by a
// Playwright reporter after the run. These pin the contract the README documents:
//
//   - what an event can contain (ten fields, each from a fixed set — the server refuses
//     anything else), and that it carries no test name, path, app id, device or error
//   - every way to turn it off (TAQWRIGHT_TELEMETRY=0, DO_NOT_TRACK=1, `telemetry: false`,
//     `taqwright telemetry disable`), and that `--list` and an empty run send nothing
//   - that sending can never fail, slow down past its timeout, or print anything — a run's
//     result and its stdout (which `--reporter json` writes to) are never touched
//   - where it goes: a fixed https endpoint, overridable only to another https or localhost URL

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvent,
  telemetryEnabled,
  telemetryUrl,
  isCi,
  testsBucket,
  durationBucket,
  TELEMETRY_URL,
} from '../dist/telemetry/event.js';
import { sendTelemetry } from '../dist/telemetry/send.js';
import {
  TELEMETRY_REPORTER,
  addTelemetryReporter,
  appendTelemetryReporter,
} from '../dist/telemetry/reporter-path.js';
import TelemetryReporter from '../dist/telemetry/reporter.js';
import { defineConfig } from '../dist/config.js';
import { Platform } from '../dist/types/index.js';

const BASE = {
  version: '1.3.0',
  nodeVersion: '24.4.1',
  osPlatform: 'darwin',
  env: {},
  cmd: 'test',
  projects: [{ platform: 'android', provider: 'lambdatest' }],
  testCount: 12,
  durationMs: 90_000,
  passed: true,
};

describe('buildEvent', () => {
  test('ten fields, every one from a fixed set', () => {
    assert.deepEqual(buildEvent(BASE), {
      v: '1.3.0',
      node: '24',
      os: 'darwin',
      ci: false,
      cmd: 'test',
      platforms: ['android'],
      provider: 'lambdatest',
      tests: '11-50',
      duration: '1-5m',
      passed: true,
    });
  });

  test('platforms in one order, providers named as the server expects', () => {
    const e = buildEvent({
      ...BASE,
      projects: [
        { platform: 'ios', provider: 'local-device' },
        { platform: 'android', provider: 'local-device' },
      ],
    });
    assert.deepEqual(e.platforms, ['android', 'ios']);
    assert.equal(e.provider, 'local');
    assert.equal(
      buildEvent({
        ...BASE,
        projects: [
          { platform: 'android', provider: 'emulator' },
          { platform: 'ios', provider: 'lambdatest' },
        ],
      }).provider,
      'other',
      'mixed providers',
    );
    assert.equal(
      buildEvent({ ...BASE, projects: [{ platform: 'android', provider: 'my-grid' }] }).provider,
      'other',
    );
    assert.equal(buildEvent({ ...BASE, osPlatform: 'freebsd' }).os, 'other');
  });

  test('a run with no tests sends nothing', () => {
    assert.equal(buildEvent({ ...BASE, testCount: 0 }), null);
  });

  test('a version that is not plain semver sends nothing rather than something the server refuses', () => {
    assert.equal(buildEvent({ ...BASE, version: 'local-dev' }), null);
  });

  test('buckets', () => {
    assert.deepEqual([1, 10, 11, 50, 51, 200, 201].map(testsBucket), [
      '1-10',
      '1-10',
      '11-50',
      '11-50',
      '51-200',
      '51-200',
      '200+',
    ]);
    assert.deepEqual([0, 59_999, 60_000, 299_999, 300_000, 899_999, 900_000].map(durationBucket), [
      '<1m',
      '<1m',
      '1-5m',
      '1-5m',
      '5-15m',
      '5-15m',
      '15m+',
    ]);
  });

  test('CI is read from the usual variables', () => {
    assert.equal(isCi({ CI: 'true' }), true);
    assert.equal(isCi({ GITHUB_ACTIONS: 'true' }), true);
    assert.equal(isCi({ CI: 'false' }), false);
    assert.equal(isCi({}), false);
  });
});

describe('turning it off', () => {
  test('on unless something says off', () => {
    assert.equal(telemetryEnabled({ env: {} }), true);
  });
  test('every documented switch turns it off', () => {
    for (const v of ['0', 'false', 'off', 'no', 'FALSE']) {
      assert.equal(telemetryEnabled({ env: { TAQWRIGHT_TELEMETRY: v } }), false, v);
    }
    assert.equal(telemetryEnabled({ env: { DO_NOT_TRACK: '1' } }), false);
    assert.equal(telemetryEnabled({ env: {}, configTelemetry: false }), false);
    assert.equal(telemetryEnabled({ env: {}, stored: false }), false);
  });
  test('an off switch is never overridden by an on one elsewhere', () => {
    assert.equal(telemetryEnabled({ env: { TAQWRIGHT_TELEMETRY: '1', DO_NOT_TRACK: '1' } }), false);
    assert.equal(telemetryEnabled({ env: { TAQWRIGHT_TELEMETRY: '1' }, stored: false }), false);
  });
});

describe('where it goes', () => {
  test('a fixed https endpoint', () => {
    assert.equal(telemetryUrl({}), TELEMETRY_URL);
    assert.match(TELEMETRY_URL, /^https:\/\/www\.taqwright\.ai\/api\/telemetry$/);
  });
  test('an override must be https, or http only on this machine; anything else sends nothing', () => {
    assert.equal(
      telemetryUrl({ TAQWRIGHT_TELEMETRY_URL: 'https://lime.example.com/api/telemetry' }),
      'https://lime.example.com/api/telemetry',
    );
    assert.equal(
      telemetryUrl({ TAQWRIGHT_TELEMETRY_URL: 'http://localhost:3000/api/telemetry' }),
      'http://localhost:3000/api/telemetry',
    );
    assert.equal(telemetryUrl({ TAQWRIGHT_TELEMETRY_URL: 'http://evil.example/api' }), null);
    assert.equal(telemetryUrl({ TAQWRIGHT_TELEMETRY_URL: 'file:///etc/passwd' }), null);
    assert.equal(telemetryUrl({ TAQWRIGHT_TELEMETRY_URL: 'not a url' }), null);
  });
});

describe('sendTelemetry never fails a run', () => {
  const event = buildEvent(BASE);

  test('posts the event as JSON with only a user agent', async () => {
    const calls = [];
    await sendTelemetry(event, {
      url: TELEMETRY_URL,
      version: '1.3.0',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), event);
    assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['content-type', 'user-agent']);
    assert.equal(calls[0].init.headers['user-agent'], 'taqwright/1.3.0');
  });

  test('a network error is swallowed', async () => {
    await sendTelemetry(event, {
      url: TELEMETRY_URL,
      fetchImpl: async () => {
        throw new Error('ENOTFOUND');
      },
    });
  });

  test('a server that never answers is abandoned at the timeout', async () => {
    const start = Date.now();
    await sendTelemetry(event, {
      url: TELEMETRY_URL,
      timeoutMs: 50,
      fetchImpl: (_url, init) =>
        new Promise((_res, rej) =>
          init.signal.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
    });
    assert.ok(Date.now() - start < 1000);
  });
});

describe('the reporter', () => {
  const PROJECTS = { android: { platform: Platform.ANDROID, provider: 'lambdatest' } };
  const fakeSuite = (n, names = ['android']) => ({
    allTests: () => Array.from({ length: n }),
    suites: names.map((name) => ({ title: name, project: () => ({ name }) })),
  });
  const run = async (opts, { tests = 3, status = 'passed', argv } = {}) => {
    const sent = [];
    const r = new TelemetryReporter({
      projects: PROJECTS,
      env: {},
      argv: argv ?? ['node', 'cli.js', 'test'],
      fetchImpl: async (_u, init) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, status: 204 };
      },
      ...opts,
    });
    assert.equal(r.printsToStdio(), false, 'never writes to stdout: --reporter json owns it');
    r.onBegin({ configFile: undefined }, fakeSuite(tests));
    await r.onEnd({ status, duration: 30_000 });
    return sent;
  };

  test('sends one event at the end of a run', async () => {
    const [e] = await run({});
    assert.equal(e.tests, '1-10');
    assert.equal(e.duration, '<1m');
    assert.deepEqual(e.platforms, ['android']);
    assert.equal(e.provider, 'lambdatest');
    assert.equal(e.passed, true);
  });

  test('a failed run says so', async () => {
    assert.equal((await run({}, { status: 'failed' }))[0].passed, false);
  });

  test('sends nothing when switched off, for --list, or for an empty run', async () => {
    assert.equal((await run({ env: { TAQWRIGHT_TELEMETRY: '0' } })).length, 0);
    assert.equal((await run({ configTelemetry: false })).length, 0);
    assert.equal((await run({}, { argv: ['node', 'cli.js', 'test', '--list'] })).length, 0);
    assert.equal((await run({}, { tests: 0 })).length, 0);
  });
});

describe('how the reporter is added', () => {
  test('defineConfig adds it beside the default reporter, or the ones the config names', () => {
    const base = {
      projects: [
        {
          name: 'android',
          use: { platform: Platform.ANDROID, device: { provider: 'emulator', name: 'x' } },
        },
      ],
    };
    const none = defineConfig(base).reporter;
    assert.equal(none.at(-1)[0], TELEMETRY_REPORTER);
    assert.equal(none.length, 2, 'the default reporter is kept');
    const html = defineConfig({ ...base, reporter: 'html' }).reporter;
    assert.deepEqual(html, [['html'], [TELEMETRY_REPORTER]]);
    const list = defineConfig({ ...base, reporter: [['json', { outputFile: 'r.json' }]] }).reporter;
    assert.deepEqual(list, [['json', { outputFile: 'r.json' }], [TELEMETRY_REPORTER]]);
  });

  test('defineConfig leaves the reporters alone when the config says telemetry: false', () => {
    const base = {
      projects: [
        {
          name: 'android',
          use: { platform: Platform.ANDROID, device: { provider: 'emulator', name: 'x' } },
        },
      ],
    };
    assert.equal(defineConfig({ ...base, telemetry: false }).reporter, undefined);
    assert.equal(defineConfig({ ...base, telemetry: false, reporter: 'html' }).reporter, 'html');
  });

  test('a --reporter flag replaces the config reporters, so the CLI appends it there too', () => {
    assert.equal(appendTelemetryReporter('json'), `json,${TELEMETRY_REPORTER}`);
    assert.equal(
      appendTelemetryReporter(`json,${TELEMETRY_REPORTER}`),
      `json,${TELEMETRY_REPORTER}`,
      'never twice',
    );
    assert.deepEqual(
      addTelemetryReporter([[TELEMETRY_REPORTER]]),
      [[TELEMETRY_REPORTER]],
      'never twice',
    );
  });
});
