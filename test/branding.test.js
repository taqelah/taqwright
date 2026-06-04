// Unit tests for src/bin/branding.ts (compiled artifact) — the
// Playwright→taqwright stdout rebranding used by `runPlaywright`.
//
// Pure, side-effect-free module: importing it does NOT run the CLI
// (that's why the logic was extracted out of bin/index.ts, which calls
// program.parseAsync at import).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { brandLine, BrandingBuffer } from '../dist/bin/branding.js';

describe('brandLine', () => {
  test('rewrites the bare command', () => {
    assert.equal(brandLine('playwright show-report'), 'taqwright show-report');
  });

  test('rewrites the real end-of-run hint line (npx prefix + path)', () => {
    assert.equal(
      brandLine('  npx playwright show-report reports/_all/html-report\n'),
      '  npx taqwright show-report reports/_all/html-report\n',
    );
  });

  test('rewrites every occurrence', () => {
    assert.equal(
      brandLine('a playwright show-report; b playwright show-report'),
      'a taqwright show-report; b taqwright show-report',
    );
  });

  test('leaves unrelated Playwright text untouched', () => {
    for (const s of [
      'npx playwright test',
      '🎭 Playwright Run Summary',
      'see playwright-report/ folder',
      'playwright show-trace foo',
    ]) {
      assert.equal(brandLine(s), s);
    }
  });

  test('preserves surrounding ANSI colour codes', () => {
    const ansi = '[36m  npx playwright show-report dir[39m';
    assert.equal(brandLine(ansi), '[36m  npx taqwright show-report dir[39m');
  });

  test('empty string → empty string', () => {
    assert.equal(brandLine(''), '');
  });
});

describe('BrandingBuffer', () => {
  test('a complete line is emitted (rewritten) immediately', () => {
    const b = new BrandingBuffer();
    assert.equal(b.push('npx playwright show-report d\n'), 'npx taqwright show-report d\n');
    assert.equal(b.flush(), '');
  });

  test('a partial line is withheld until its newline arrives', () => {
    const b = new BrandingBuffer();
    assert.equal(b.push('npx playwright show-report d'), ''); // no newline yet
    assert.equal(b.push(' more\n'), 'npx taqwright show-report d more\n');
  });

  test('target split across two chunks is still rewritten (no corruption)', () => {
    const b = new BrandingBuffer();
    assert.equal(b.push('  npx play'), '');
    assert.equal(b.push('wright show-report dir\n'), '  npx taqwright show-report dir\n');
  });

  test('multiple complete lines in one chunk are all rewritten', () => {
    const b = new BrandingBuffer();
    assert.equal(
      b.push('x\nnpx playwright show-report a\ny\n'),
      'x\nnpx taqwright show-report a\ny\n',
    );
  });

  test('emits complete line now, retains trailing partial for flush', () => {
    const b = new BrandingBuffer();
    assert.equal(b.push('done\n  npx playwright show-report tail'), 'done\n');
    assert.equal(b.flush(), '  npx taqwright show-report tail');
  });

  test('flush is idempotent / empty when nothing buffered', () => {
    const b = new BrandingBuffer();
    assert.equal(b.flush(), '');
    b.push('partial'); // withheld (no newline)
    assert.equal(b.flush(), 'partial');
    assert.equal(b.flush(), '');
  });
});
