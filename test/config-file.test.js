// #145 — `--config <file>` must reach every place that re-reads the config, not
// only Playwright. Each test builds a directory holding BOTH a default-named
// taqwright.config.mjs (first project on LambdaTest, as in the report) and a
// taqwright.local.config.mjs (a local emulator project), then checks that the
// loader, the discovery globalSetup and Appium auto-start read the file they
// were given rather than the default sibling.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getUseOptions,
  loadTaqwrightConfig,
  loadTaqwrightConfigFrom,
  missingProjectMessage,
} from '../dist/config.js';
import autoDiscoverGlobalSetup from '../dist/discovery-setup.js';
import { maybeAutoStartAppium } from '../dist/auto-appium.js';

const configUrl = pathToFileURL(join(process.cwd(), 'dist/config.js')).href;

const DEFAULT_CONFIG = `
import { defineConfig } from '${configUrl}';
export default defineConfig({
  telemetry: false,
  projects: [
    { name: 'android', use: { platform: 'android', appBundleId: 'com.example.app',
      device: { provider: 'lambdatest', name: 'Pixel 8', osVersion: '14' } } },
  ],
});
`;

const LOCAL_CONFIG = `
import { defineConfig } from '${configUrl}';
export default defineConfig({
  telemetry: false,
  projects: [
    { name: 'android-local', use: { platform: 'android', appBundleId: 'com.example.app',
      buildPath: '/abs/path/app.apk',
      device: { provider: 'emulator', udid: 'emulator-5554' } } },
  ],
});
`;

let dir;
let defaultFile;
let localFile;
let brokenFile;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'taqwright-145-'));
  defaultFile = join(dir, 'taqwright.config.mjs');
  localFile = join(dir, 'taqwright.local.config.mjs');
  brokenFile = join(dir, 'taqwright.broken.config.mjs');
  writeFileSync(defaultFile, DEFAULT_CONFIG);
  writeFileSync(localFile, LOCAL_CONFIG);
  writeFileSync(brokenFile, 'export default {{ not javascript');
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe('loadTaqwrightConfigFrom', () => {
  test('reads exactly the given file, not the default-named sibling', async () => {
    const cfg = await loadTaqwrightConfigFrom(localFile);
    assert.deepEqual(
      cfg.projects.map((p) => p.name),
      ['android-local'],
    );
  });

  test('a relative path resolves against the cwd', async () => {
    const cfg = await loadTaqwrightConfigFrom(relative(process.cwd(), localFile));
    assert.equal(cfg.projects[0].name, 'android-local');
  });

  test('without a file, walks up from cwd to the default-named file', async () => {
    const cfg = await loadTaqwrightConfigFrom(undefined, dir);
    assert.equal(cfg.projects[0].name, 'android');
    // loadTaqwrightConfig (the public `loadConfig`) keeps that behaviour.
    assert.equal((await loadTaqwrightConfig(dir)).projects[0].name, 'android');
  });

  test('an empty string (Playwright with no config file) falls back like undefined', async () => {
    const cfg = await loadTaqwrightConfigFrom('', dir);
    assert.equal(cfg.projects[0].name, 'android');
  });

  test('a broken config file throws instead of resolving to nothing', async () => {
    await assert.rejects(loadTaqwrightConfigFrom(brokenFile));
  });
});

describe('the reported scenario', () => {
  test('android-local resolves from the local config, and is NOT silently the cloud project', async () => {
    const local = await loadTaqwrightConfigFrom(localFile);
    assert.equal(getUseOptions(local, 'android-local').device.provider, 'emulator');

    // What the fixture used to do: read the default file, then fall back to
    // projects[0] — the LambdaTest project. It must now find nothing.
    const wrong = await loadTaqwrightConfigFrom(undefined, dir);
    assert.equal(getUseOptions(wrong, 'android-local'), undefined);
  });
});

describe('missingProjectMessage', () => {
  const cfg = { projects: [{ name: 'android' }, { name: 'ios' }] };

  test('names the file actually read and the projects it has', () => {
    assert.equal(
      missingProjectMessage(cfg, 'android-local', '/x/taqwright.config.ts'),
      'taqwright: no project named "android-local" in taqwright.config.ts. Projects there: "android", "ios".',
    );
  });

  test('a file without a taqwright config says to use defineConfig', () => {
    assert.match(
      missingProjectMessage(undefined, 'a', '/x/playwright.config.ts'),
      /playwright\.config\.ts has no taqwright config — export defineConfig/,
    );
  });

  test('no file at all says how to create or pass one', () => {
    assert.match(missingProjectMessage(undefined, 'a', undefined), /no taqwright config found/);
  });

  test('a config with no projects says so', () => {
    assert.match(
      missingProjectMessage({ projects: [] }, undefined, '/x/c.ts'),
      /defines no projects/,
    );
  });
});

// The broken file proves which file was read: before #145, these loaded the
// default-named sibling (or walked up from the cwd) and never touched it.
describe('call sites read the file they are given', () => {
  test('discovery globalSetup reads Playwright config.configFile', async () => {
    await assert.rejects(autoDiscoverGlobalSetup({ configFile: brokenFile }));
    // A valid alternate config with no autoDiscover project is a no-op.
    await autoDiscoverGlobalSetup({ configFile: localFile });
  });

  test('Appium auto-start reads --config, not the default file beside it', async () => {
    await assert.rejects(maybeAutoStartAppium(brokenFile));
    // The local config has no appium.autoStart, so nothing is spawned.
    assert.deepEqual(await maybeAutoStartAppium(localFile), []);
  });
});
