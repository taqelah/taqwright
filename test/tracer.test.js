// Unit tests for the Tracer (src/tracer/index.ts) and the tracing Proxy
// (src/tracer/proxy.ts), driven by the fake WebDriver harness.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracer } from '../dist/tracer/index.js';
import { wrapForTracing } from '../dist/tracer/proxy.js';
import { createHarBuilder } from '../dist/network/har.js';
import { Locator } from '../dist/index.js';
import { makeFakeDriver, makeMobile, makeLocator, Platform } from './fake-driver.js';

const traceDriver = (over = {}) =>
  makeFakeDriver({
    takeScreenshot: async () => 'QkFTRTY0', // base64-ish
    getPageSource: async () => '<root/>',
    ...over,
  });

describe('Tracer.record', () => {
  test('records a successful action with screenshot + source', async () => {
    const tracer = new Tracer(traceDriver(), Platform.ANDROID);
    const out = await tracer.record('mobile.click', [{ x: 1 }], async () => 'ok');
    assert.equal(out, 'ok');
    const entries = tracer.getEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'mobile.click');
    assert.equal(entries[0].screenshot, 'QkFTRTY0');
    assert.equal(entries[0].source, '<root/>');
    assert.ok(entries[0].durationMs >= 0);
    assert.equal(entries[0].error, undefined);
  });

  test('re-throws and records the error message', async () => {
    const tracer = new Tracer(traceDriver(), Platform.ANDROID);
    await assert.rejects(
      tracer.record('locator.fill', [], async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(tracer.getEntries()[0].error, 'boom');
  });

  test('a failed snapshot degrades to null, not a throw', async () => {
    const driver = traceDriver({
      takeScreenshot: async () => {
        throw new Error('no screen');
      },
      getPageSource: async () => {
        throw new Error('no source');
      },
    });
    const tracer = new Tracer(driver, Platform.ANDROID);
    await tracer.record('mobile.swipe', [], async () => undefined);
    assert.equal(tracer.getEntries()[0].screenshot, null);
    assert.equal(tracer.getEntries()[0].source, null);
  });

  test('serializes Locator and object args without throwing', async () => {
    const tracer = new Tracer(traceDriver(), Platform.ANDROID);
    const { el } = makeLocator();
    await tracer.record('locator.click', [el], async () => undefined);
    await tracer.record('mobile.tap', [{ x: 10, y: 20 }], async () => undefined);
    const [a, b] = tracer.getEntries();
    assert.equal(typeof a.args, 'string');
    assert.equal(typeof b.args, 'string');
    assert.match(b.args, /10/);
  });

  test('getStartTs is a number', () => {
    const tracer = new Tracer(traceDriver(), Platform.ANDROID);
    assert.equal(typeof tracer.getStartTs(), 'number');
  });
});

describe('Tracer.toHtml', () => {
  test('renders a self-contained page with the title and status (escaped)', async () => {
    const tracer = new Tracer(traceDriver(), Platform.ANDROID);
    await tracer.record('mobile.click', [], async () => undefined);
    const html = tracer.toHtml({
      title: 'Login A & B',
      status: 'passed',
      duration: 1234,
      project: { name: 'android' },
    });
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 500);
    assert.ok(html.includes('passed'));
    assert.ok(html.includes('A &amp; B')); // escHtml applied
  });

  test('embeds a HAR network panel when har is provided', async () => {
    const tracer = new Tracer(traceDriver(), Platform.ANDROID);
    await tracer.record('mobile.click', [], async () => undefined);
    const har = createHarBuilder({ creator: 'taqwright' });
    har.startEntry({
      method: 'GET',
      url: 'http://example.com/x',
      httpVersion: 'HTTP/1.1',
      headers: [],
      startedAt: new Date(),
    });
    const withHar = tracer.toHtml({ title: 't', status: 'passed' }, { har: har.toJson() });
    const withoutHar = tracer.toHtml({ title: 't', status: 'passed' });
    assert.equal(typeof withHar, 'string');
    assert.notEqual(withHar.length, withoutHar.length);
  });

  test('works with no recorded entries and a missing status', () => {
    const tracer = new Tracer(traceDriver(), Platform.ANDROID);
    const html = tracer.toHtml({ title: 'empty' });
    assert.ok(html.includes('unknown')); // status defaulted
  });
});

describe('wrapForTracing', () => {
  function spyTracer() {
    const recorded = [];
    return {
      recorded,
      record(action, _args, fn) {
        recorded.push(action);
        return Promise.resolve().then(fn);
      },
    };
  }

  test('passes through raw + getPlatform without recording', () => {
    const { mobile, driver } = makeMobile(Platform.ANDROID);
    const tracer = spyTracer();
    const wrapped = wrapForTracing(mobile, tracer);
    assert.equal(wrapped.raw, driver);
    assert.equal(wrapped.getPlatform(), Platform.ANDROID);
    assert.deepEqual(tracer.recorded, []);
  });

  test('records mobile async methods', async () => {
    const { mobile } = makeMobile(Platform.ANDROID);
    const tracer = spyTracer();
    const wrapped = wrapForTracing(mobile, tracer);
    await wrapped.getContexts();
    assert.ok(tracer.recorded.includes('mobile.getContexts'));
  });

  test('returns a Locator from getByX and traces its actions but not chain shapers', async () => {
    const { mobile } = makeMobile(Platform.ANDROID);
    const tracer = spyTracer();
    const wrapped = wrapForTracing(mobile, tracer);

    const loc = wrapped.getByText('hi');
    assert.ok(loc instanceof Locator);
    assert.deepEqual(tracer.recorded, []); // getByText itself isn't recorded

    const chained = loc.first();
    assert.ok(chained instanceof Locator);
    assert.deepEqual(tracer.recorded, []); // .first() is a chain shaper

    await loc.click();
    assert.ok(tracer.recorded.includes('locator.click'));
  });

  test('re-wraps the Locator[] returned by all()', async () => {
    const { mobile } = makeMobile(Platform.ANDROID);
    const tracer = spyTracer();
    const wrapped = wrapForTracing(mobile, tracer);
    const arr = await wrapped.getByText('hi').all();
    assert.ok(Array.isArray(arr));
    arr.forEach((l) => assert.ok(l instanceof Locator));
  });
});
