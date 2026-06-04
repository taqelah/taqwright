// Unit tests for config.ts gaps not covered by config.test.js:
// getUseOptions lookup + the TAQWRIGHT_KEY embedding contract.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defineConfig, getUseOptions, TAQWRIGHT_KEY } from '../dist/config.js';
import { Platform } from '../dist/types/index.js';

const cfg = {
  projects: [
    { name: 'android', use: { platform: Platform.ANDROID, device: { provider: 'emulator' } } },
    { name: 'ios', use: { platform: Platform.IOS, device: { provider: 'emulator' } } },
  ],
};

describe('getUseOptions', () => {
  test('undefined config → undefined', () => {
    assert.equal(getUseOptions(undefined), undefined);
    assert.equal(getUseOptions(undefined, 'android'), undefined);
  });
  test('by project name', () => {
    assert.equal(getUseOptions(cfg, 'ios').platform, Platform.IOS);
  });
  test('no name → first project', () => {
    assert.equal(getUseOptions(cfg).platform, Platform.ANDROID);
  });
  test('unknown name → falls back to first project', () => {
    assert.equal(getUseOptions(cfg, 'nope').platform, Platform.ANDROID);
  });
});

describe('defineConfig — TAQWRIGHT_KEY embedding', () => {
  test('embeds the original taqwright config under the key', () => {
    const pw = defineConfig(cfg);
    assert.equal(pw[TAQWRIGHT_KEY].projects.length, 2);
    assert.equal(pw[TAQWRIGHT_KEY].projects[0].name, 'android');
  });
  test('per-project use carries ONLY { taqwrightProject } (no rich use options)', () => {
    const pw = defineConfig(cfg);
    assert.deepEqual(pw.projects[0].use, { taqwrightProject: 'android' });
    assert.deepEqual(pw.projects[1].use, { taqwrightProject: 'ios' });
  });
  test('serial-by-default: workers 1, fullyParallel false', () => {
    const pw = defineConfig(cfg);
    assert.equal(pw.workers, 1);
    assert.equal(pw.fullyParallel, false);
  });
});
