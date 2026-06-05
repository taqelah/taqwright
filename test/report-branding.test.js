// Unit tests for src/bin/report-branding.ts — the pure HTML rewrite that
// brands Playwright's generated report (title + taqwright favicon), and the
// favicon data-URI constant. Imports the compiled dist/ output.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { brandReportHtml } from '../dist/bin/report-branding.js';
import { TAQWRIGHT_FAVICON_DATA_URI } from '../dist/branding-assets.js';

const FIXTURE =
  '<!DOCTYPE html><html><head><title>Playwright Test Report</title></head><body><div id="root"></div></body></html>';

describe('TAQWRIGHT_FAVICON_DATA_URI', () => {
  test('is a base64 png data URI', () => {
    assert.ok(TAQWRIGHT_FAVICON_DATA_URI.startsWith('data:image/png;base64,'));
    assert.ok(TAQWRIGHT_FAVICON_DATA_URI.length > 100);
  });
});

describe('brandReportHtml', () => {
  test('injects sentinel, title, and favicon before </head>', () => {
    const out = brandReportHtml(FIXTURE);
    assert.match(out, /<!--taqwright-branding-->/);
    assert.match(out, /Taqwright Test Report/);
    assert.match(out, /data-tw-icon/);
    assert.match(out, /data:image\/png;base64,/);
    // injection lands inside the head
    const headEnd = out.indexOf('</head>');
    assert.ok(out.indexOf('<!--taqwright-branding-->') < headEnd);
  });

  test('embeds the real favicon data URI', () => {
    const out = brandReportHtml(FIXTURE);
    assert.ok(out.includes(TAQWRIGHT_FAVICON_DATA_URI));
  });

  test('is idempotent — re-branding returns the input unchanged', () => {
    const once = brandReportHtml(FIXTURE);
    const twice = brandReportHtml(once);
    assert.equal(twice, once);
    // exactly one injected script
    assert.equal((twice.match(/<!--taqwright-branding-->/g) || []).length, 1);
  });

  test('no </head> → returned unchanged (no anchor to inject at)', () => {
    const noHead = '<html><body>x</body></html>';
    assert.equal(brandReportHtml(noHead), noHead);
  });

  test('injected script has a matching </script> close (no breakout)', () => {
    const out = brandReportHtml(FIXTURE);
    assert.equal((out.match(/<script>/g) || []).length, (out.match(/<\/script>/g) || []).length);
  });
});
