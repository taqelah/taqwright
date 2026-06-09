// Unit tests for src/bin/init.ts pure-logic helpers + templates (compiled
// artifact). These cover the regressions hardened in the init review:
//   * toPackageName  — npm-name sanitization (item 5)
//   * isValidTestDir — reject slashes / `..` / absolute (item 10)
//   * configTemplate — gate the managed-AVD pin on `demoAvd` (item 1)
//   * exampleTestTemplate / scoping — Android-only selectors never wired to
//     iOS in a `both` scaffold (item 2)
//
// The device-driving / prompt / npm-spawn paths in init.ts are intentionally
// not unit-covered (they need a TTY, network, and a real npm).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPackageName,
  isValidTestDir,
  configTemplate,
  exampleTestTemplate,
} from '../dist/bin/init.js';

describe('toPackageName', () => {
  test('lowercases and replaces spaces/invalid runs with a single dash', () => {
    assert.equal(toPackageName('My Tests'), 'my-tests');
    assert.equal(toPackageName('Foo  Bar!!Baz'), 'foo-bar-baz');
  });

  test('strips a leading dot / underscore / dash', () => {
    assert.equal(toPackageName('.hidden'), 'hidden');
    assert.equal(toPackageName('_private'), 'private');
    assert.equal(toPackageName('---weird'), 'weird');
  });

  test('falls back to taqwright-tests when nothing valid remains', () => {
    assert.equal(toPackageName('...'), 'taqwright-tests');
    assert.equal(toPackageName(''), 'taqwright-tests');
  });

  test('leaves an already-valid name unchanged', () => {
    assert.equal(toPackageName('my-cool-tests'), 'my-cool-tests');
  });
});

describe('isValidTestDir', () => {
  test('accepts a plain folder name', () => {
    assert.equal(isValidTestDir('tests'), true);
    assert.equal(isValidTestDir('e2e'), true);
  });

  test('rejects slashes, traversal, absolute paths and empties', () => {
    assert.equal(isValidTestDir('a/b'), false);
    assert.equal(isValidTestDir('a\\b'), false);
    assert.equal(isValidTestDir('..'), false);
    assert.equal(isValidTestDir('.'), false);
    assert.equal(isValidTestDir('/abs'), false);
    assert.equal(isValidTestDir(''), false);
  });
});

describe('configTemplate — managed-AVD gating (item 1)', () => {
  test('demo APK but no emulator: wires buildPath, does NOT pin/auto-boot the AVD', () => {
    const cfg = configTemplate(['android'], 'tests', {
      demoApp: true,
      demoAvd: false,
      scoped: false,
    });
    assert.ok(cfg.includes("buildPath: './app/"), 'buildPath should be wired');
    assert.ok(cfg.includes('resetBetweenTests: true'), 'reset should be wired');
    assert.ok(
      !cfg.includes("name: 'taqwright_api34'"),
      'must not pin an AVD that was never created',
    );
    assert.ok(!/^\s*autoStartDevice: true,/m.test(cfg), 'must not auto-boot a non-existent AVD');
  });

  test('demo APK + emulator: pins and auto-boots the managed AVD', () => {
    const cfg = configTemplate(['android'], 'tests', {
      demoApp: true,
      demoAvd: true,
      scoped: false,
    });
    assert.ok(cfg.includes("name: 'taqwright_api34'"), 'should pin the managed AVD');
    assert.ok(/^\s*autoStartDevice: true,/m.test(cfg), 'should auto-boot the AVD');
    assert.ok(cfg.includes("buildPath: './app/"), 'buildPath still wired');
  });
});

describe('both + demo scoping (item 2)', () => {
  test('iOS example body never uses Android-only selectors', () => {
    const ios = exampleTestTemplate(false);
    assert.ok(!ios.includes('getByUiSelector'), 'generic stub must not use UiSelector');
    assert.ok(ios.includes('getScreenSize'), 'generic stub is the platform-agnostic test');
  });

  test('scoped config gives each project its own testMatch subfolder', () => {
    const cfg = configTemplate(['android', 'ios'], 'tests', {
      demoApp: true,
      demoAvd: false,
      scoped: true,
    });
    assert.ok(cfg.includes("testMatch: ['**/android/**']"), 'android scoped to its folder');
    assert.ok(cfg.includes("testMatch: ['**/ios/**']"), 'ios scoped to its folder');
  });

  test('unscoped config leaves testMatch commented', () => {
    const cfg = configTemplate(['android'], 'tests', {
      demoApp: true,
      demoAvd: true,
      scoped: false,
    });
    assert.ok(
      cfg.includes("// testMatch: ['**/android/*.spec.ts'],"),
      'single-project scaffold keeps the commented placeholder',
    );
  });
});
