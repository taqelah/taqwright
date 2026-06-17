// Unit tests for the pure helpers in src/utils.ts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateBuildPath, getLatestBuildToolsVersions } from '../dist/utils.js';

const thisFile = fileURLToPath(import.meta.url); // a real, existing .js file

describe('validateBuildPath', () => {
  test('throws when buildPath is missing', () => {
    assert.throws(() => validateBuildPath(undefined, '.apk'), /Build path not found/);
  });

  test('accepts remote URLs without touching the filesystem', () => {
    for (const url of [
      'http://example.com/app.apk',
      'https://example.com/app.ipa',
      'bs://abc123',
      'lt://abc123',
    ]) {
      assert.doesNotThrow(() => validateBuildPath(url, '.apk'));
    }
  });

  test('throws when a local file does not exist', () => {
    assert.throws(() => validateBuildPath('/no/such/app.apk', '.apk'), /Build file not found/);
  });

  test('throws when an existing file has the wrong extension', () => {
    assert.throws(() => validateBuildPath(thisFile, '.apk'), /must end in \.apk/);
  });

  test('passes for an existing file with the expected extension (case-insensitive)', () => {
    assert.doesNotThrow(() => validateBuildPath(thisFile, '.JS'));
  });
});

describe('getLatestBuildToolsVersions', () => {
  test('returns undefined for an empty list', () => {
    assert.equal(getLatestBuildToolsVersions([]), undefined);
  });

  test('picks the highest version numerically, not lexically', () => {
    assert.equal(getLatestBuildToolsVersions(['30.0.3', '30.0.10', '29.0.2']), '30.0.10');
  });

  test('a stable release beats an rc of the same version', () => {
    assert.equal(getLatestBuildToolsVersions(['34.0.0-rc1', '34.0.0', '33.0.1']), '34.0.0');
  });

  test('single entry returns itself', () => {
    assert.equal(getLatestBuildToolsVersions(['35.0.0']), '35.0.0');
  });
});
