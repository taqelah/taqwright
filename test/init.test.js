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
  isReservedDirName,
  projectTargetError,
  platformChoices,
  platformSupportError,
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

describe('projectTargetError', () => {
  test('rejects a path that exists but is not a directory', () => {
    assert.equal(projectTargetError(true, false), 'exists and is not a directory');
  });
  test('allows an existing directory', () => {
    assert.equal(projectTargetError(true, true), null);
  });
  test('allows a path that does not exist yet', () => {
    assert.equal(projectTargetError(false, false), null);
  });
});

describe('platformChoices', () => {
  test('offers all three on macOS', () => {
    assert.deepEqual(platformChoices(true), ['android', 'ios', 'both']);
  });
  test('offers Android only off macOS', () => {
    assert.deepEqual(platformChoices(false), ['android']);
  });
});

describe('platformSupportError', () => {
  test('off macOS, iOS / both is rejected', () => {
    assert.ok(platformSupportError(false, ['ios']));
    assert.ok(platformSupportError(false, ['android', 'ios']));
  });
  test('off macOS, Android-only is fine', () => {
    assert.equal(platformSupportError(false, ['android']), null);
  });
  test('on macOS, iOS is allowed', () => {
    assert.equal(platformSupportError(true, ['ios']), null);
    assert.equal(platformSupportError(true, ['android', 'ios']), null);
  });
});

describe('isReservedDirName', () => {
  test('flags Windows device + scaffold-collision names (case-insensitive)', () => {
    assert.equal(isReservedDirName('app'), true);
    assert.equal(isReservedDirName('node_modules'), true);
    assert.equal(isReservedDirName('playwright-report'), true);
    assert.equal(isReservedDirName('dist'), true);
    assert.equal(isReservedDirName('CON'), true);
    assert.equal(isReservedDirName('con'), true);
    assert.equal(isReservedDirName('NUL'), true);
    assert.equal(isReservedDirName('COM1'), true);
    assert.equal(isReservedDirName('LPT9'), true);
  });
  test('allows ordinary names', () => {
    assert.equal(isReservedDirName('tests'), false);
    assert.equal(isReservedDirName('e2e'), false);
    assert.equal(isReservedDirName('my-project'), false);
  });
});

describe('isValidTestDir', () => {
  test('accepts a plain folder name', () => {
    assert.equal(isValidTestDir('tests'), true);
    assert.equal(isValidTestDir('e2e'), true);
    assert.equal(isValidTestDir('ui-tests'), true);
    assert.equal(isValidTestDir('e2e.spec'), true);
    assert.equal(isValidTestDir('_tmp'), true);
  });

  test('rejects slashes, traversal, absolute paths and empties', () => {
    assert.equal(isValidTestDir('a/b'), false);
    assert.equal(isValidTestDir('a\\b'), false);
    assert.equal(isValidTestDir('..'), false);
    assert.equal(isValidTestDir('.'), false);
    assert.equal(isValidTestDir('/abs'), false);
    assert.equal(isValidTestDir(''), false);
  });

  test('rejects chars that would break the generated config/tsconfig', () => {
    assert.equal(isValidTestDir("test's"), false);
    assert.equal(isValidTestDir('te`st'), false);
    assert.equal(isValidTestDir('te${x}'), false);
    assert.equal(isValidTestDir('te\nst'), false);
  });

  test('rejects spaces, Windows-illegal chars, and leading dot/dash', () => {
    assert.equal(isValidTestDir('my tests'), false);
    assert.equal(isValidTestDir('a:b'), false);
    assert.equal(isValidTestDir('a*b'), false);
    assert.equal(isValidTestDir('a?b'), false);
    assert.equal(isValidTestDir('a|b'), false);
    assert.equal(isValidTestDir('a<b'), false);
    assert.equal(isValidTestDir('.hidden'), false);
    assert.equal(isValidTestDir('-x'), false);
  });

  test('rejects reserved + scaffold-collision names (case-insensitive)', () => {
    assert.equal(isValidTestDir('CON'), false);
    assert.equal(isValidTestDir('con'), false);
    assert.equal(isValidTestDir('NUL'), false);
    assert.equal(isValidTestDir('COM1'), false);
    assert.equal(isValidTestDir('LPT9'), false);
    assert.equal(isValidTestDir('app'), false);
    assert.equal(isValidTestDir('node_modules'), false);
    assert.equal(isValidTestDir('playwright-report'), false);
    assert.equal(isValidTestDir('dist'), false);
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

  test('deviceName: wires the user AVD uncommented and auto-boots it', () => {
    const cfg = configTemplate(['android'], 'tests', {
      demoApp: false,
      demoAvd: false,
      scoped: false,
      deviceName: 'Pixel_10_Pro_XL',
    });
    assert.ok(/^\s*name: 'Pixel_10_Pro_XL',/m.test(cfg), 'should wire the detected AVD name');
    assert.ok(!cfg.includes('// name: /Pixel/'), 'should not leave the commented placeholder');
    assert.ok(
      /^\s*autoStartDevice: true,/m.test(cfg),
      'wired AVD should auto-boot (autoStartDevice: true)',
    );
  });

  test('deviceName is ignored when the managed AVD is pinned', () => {
    const cfg = configTemplate(['android'], 'tests', {
      demoApp: true,
      demoAvd: true,
      scoped: false,
      deviceName: 'Pixel_10_Pro_XL',
    });
    assert.ok(cfg.includes("name: 'taqwright_api34'"), 'managed pin wins');
    assert.ok(!cfg.includes("name: 'Pixel_10_Pro_XL'"), 'user AVD not used when managed pinned');
  });

  test('no deviceName: keeps the commented /Pixel/ placeholder', () => {
    const cfg = configTemplate(['android'], 'tests', {
      demoApp: false,
      demoAvd: false,
      scoped: false,
    });
    assert.ok(cfg.includes('// name: /Pixel/,'), 'placeholder stays when nothing detected');
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
