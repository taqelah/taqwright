// Unit tests for the pure quoting helper in src/setup/spawn-tool.ts.
// The spawn side is intentionally not unit-covered (it drives real processes).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteWin } from '../dist/setup/spawn-tool.js';

describe('quoteWin', () => {
  test('leaves a plain token untouched', () => {
    assert.equal(quoteWin('npm'), 'npm');
    assert.equal(quoteWin('install'), 'install');
    assert.equal(quoteWin('@taqwright/taqwright'), '@taqwright/taqwright');
    assert.equal(quoteWin('-g'), '-g');
  });

  test('quotes a token containing spaces', () => {
    assert.equal(quoteWin('hello world'), '"hello world"');
  });

  test('quotes a Windows path with spaces (Program Files)', () => {
    assert.equal(
      quoteWin('C:\\Program Files\\Android\\sdkmanager.bat'),
      '"C:\\Program Files\\Android\\sdkmanager.bat"',
    );
  });

  test('leaves a space-free Windows path untouched', () => {
    assert.equal(quoteWin('C:\\Android\\sdkmanager.bat'), 'C:\\Android\\sdkmanager.bat');
  });

  test('quotes tokens with shell metacharacters', () => {
    assert.equal(quoteWin('a&b'), '"a&b"');
    assert.equal(quoteWin('x(y)'), '"x(y)"');
    assert.equal(quoteWin('k=v;w'), '"k=v;w"');
  });
});
