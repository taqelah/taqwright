// Unit tests for the pure version classifiers in src/doctor.ts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAppiumVersion,
  isAppiumVersionSupported,
  isNodeVersionSupported,
  normalizeSysImagePath,
} from '../dist/doctor.js';

describe('classifyAppiumVersion', () => {
  test('3.x and newer → recommended', () => {
    assert.equal(classifyAppiumVersion('3.0.0'), 'recommended');
    assert.equal(classifyAppiumVersion('3.3.1'), 'recommended');
    assert.equal(classifyAppiumVersion('10.0.0'), 'recommended');
  });
  test('2.x → best-effort', () => {
    assert.equal(classifyAppiumVersion('2.0.0'), 'best-effort');
    assert.equal(classifyAppiumVersion('2.11.5'), 'best-effort');
  });
  test('1.x → unsupported', () => {
    assert.equal(classifyAppiumVersion('1.22.3'), 'unsupported');
    assert.equal(classifyAppiumVersion('0.9.0'), 'unsupported');
  });
  test('unparseable → unsupported', () => {
    assert.equal(classifyAppiumVersion(''), 'unsupported');
    assert.equal(classifyAppiumVersion('beta'), 'unsupported');
    assert.equal(classifyAppiumVersion('vNext'), 'unsupported');
  });
});

describe('isAppiumVersionSupported', () => {
  test('true for recommended + best-effort', () => {
    assert.equal(isAppiumVersionSupported('3.3.1'), true);
    assert.equal(isAppiumVersionSupported('2.5.0'), true);
  });
  test('false for unsupported', () => {
    assert.equal(isAppiumVersionSupported('1.22.3'), false);
    assert.equal(isAppiumVersionSupported('junk'), false);
  });
});

describe('isNodeVersionSupported', () => {
  test('>= 24 → true (with or without leading v)', () => {
    assert.equal(isNodeVersionSupported('24.0.0'), true);
    assert.equal(isNodeVersionSupported('v24.15.0'), true);
    assert.equal(isNodeVersionSupported('30.1.0'), true);
  });
  test('< 24 → false', () => {
    assert.equal(isNodeVersionSupported('22.12.0'), false);
    assert.equal(isNodeVersionSupported('v20.10.0'), false);
  });
  test('unparseable → false', () => {
    assert.equal(isNodeVersionSupported(''), false);
    assert.equal(isNodeVersionSupported('nope'), false);
  });
});

describe('normalizeSysImagePath', () => {
  test('Windows backslashes + trailing backslash → forward slashes, no trailing', () => {
    assert.equal(
      normalizeSysImagePath('system-images\\android-37.0\\google_apis_playstore_ps16k\\x86_64\\'),
      'system-images/android-37.0/google_apis_playstore_ps16k/x86_64',
    );
  });
  test('POSIX trailing slash is removed', () => {
    assert.equal(
      normalizeSysImagePath('system-images/android-34/google_apis/arm64-v8a/'),
      'system-images/android-34/google_apis/arm64-v8a',
    );
  });
  test('no trailing separator → unchanged', () => {
    assert.equal(
      normalizeSysImagePath('system-images/android-34/google_apis/x86_64'),
      'system-images/android-34/google_apis/x86_64',
    );
  });
  test('mixed separators + surrounding whitespace → canonical forward-slash', () => {
    assert.equal(
      normalizeSysImagePath('  system-images\\android-34/google_apis\\x86_64\\  '),
      'system-images/android-34/google_apis/x86_64',
    );
  });
  test('normalized path maps to a valid sdkmanager package string', () => {
    // Guards the exact Windows regression: the suggested fix command must use
    // `;` separators, not the raw backslashes from config.ini.
    const pkg = normalizeSysImagePath(
      'system-images\\android-37.0\\google_apis_playstore_ps16k\\x86_64\\',
    ).replace(/\//g, ';');
    assert.equal(pkg, 'system-images;android-37.0;google_apis_playstore_ps16k;x86_64');
  });
});
