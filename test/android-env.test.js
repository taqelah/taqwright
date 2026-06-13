// Unit tests for the AVD-aware Android SDK selection: androidEnvForAvd picks the
// managed SDK by default but transparently falls back to the user's system SDK
// when the target AVD's system image lives there (the "I picked my own emulator
// during init" case), and avdBootPreflightError only errors when neither SDK has
// the image. Build fake managed/system SDK trees + an AVD config.ini in a tmpdir.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { androidEnvForAvd, avdBootPreflightError, resolveAvdSdk } from '../dist/setup/avd.js';

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
const IMAGE = 'system-images/android-37.0/google_apis_playstore_ps16k/x86_64';
const AVD = 'Pixel_10_Pro_XL';

let root;
let managedHome; // taqwrightHome() → manifest + android-sdk live here
let managedSdk;
let systemSdk;
let avdHome;
const savedEnv = {};

function touch(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
}

/** Make managedEnv() resolve: manifest + adb + java must all exist. */
function writeManagedToolchain() {
  managedSdk = path.join(managedHome, 'android-sdk');
  const javaHome = path.join(managedHome, 'jdk');
  touch(path.join(managedSdk, 'platform-tools', exe('adb')));
  touch(path.join(javaHome, 'bin', exe('java')));
  writeFileSync(
    path.join(managedHome, 'manifest.json'),
    JSON.stringify({ androidHome: managedSdk, javaHome }),
  );
}

function writeAvdConfig(image) {
  const cfg = path.join(avdHome, `${AVD}.avd`, 'config.ini');
  mkdirSync(path.dirname(cfg), { recursive: true });
  writeFileSync(cfg, `image.sysdir.1=${image}\n`);
}

/** Create the image directory under a given SDK home so isAvdImageInstalled passes. */
function installImage(sdkHome) {
  mkdirSync(path.join(sdkHome, IMAGE), { recursive: true });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'taqw-andenv-'));
  managedHome = path.join(root, 'managed');
  systemSdk = path.join(root, 'system-sdk');
  avdHome = path.join(root, 'avd');
  mkdirSync(systemSdk, { recursive: true });
  mkdirSync(avdHome, { recursive: true });

  for (const k of [
    'TAQWRIGHT_HOME',
    'TAQWRIGHT_SYSTEM_ANDROID_HOME',
    'ANDROID_AVD_HOME',
    'ANDROID_HOME',
  ]) {
    savedEnv[k] = process.env[k];
  }
  process.env.TAQWRIGHT_HOME = managedHome;
  process.env.TAQWRIGHT_SYSTEM_ANDROID_HOME = systemSdk;
  process.env.ANDROID_AVD_HOME = avdHome;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('androidEnvForAvd', () => {
  test('no managed toolchain → undefined (nothing to override)', async () => {
    // No manifest written under TAQWRIGHT_HOME.
    assert.equal(await androidEnvForAvd(AVD), undefined);
  });

  test('no avdName → managed env unchanged', async () => {
    writeManagedToolchain();
    const env = await androidEnvForAvd(undefined);
    assert.equal(env.ANDROID_HOME, managedSdk);
  });

  test('image present in managed SDK → managed env', async () => {
    writeManagedToolchain();
    installImage(managedSdk);
    writeAvdConfig(IMAGE);
    const env = await androidEnvForAvd(AVD);
    assert.equal(env.ANDROID_HOME, managedSdk);
  });

  test('image only in system SDK → falls back to system SDK, keeps managed JDK', async () => {
    writeManagedToolchain();
    installImage(systemSdk); // managed SDK does NOT have it
    writeAvdConfig(IMAGE);
    const env = await androidEnvForAvd(AVD);
    assert.equal(env.ANDROID_HOME, systemSdk);
    assert.equal(env.ANDROID_SDK_ROOT, systemSdk);
    assert.equal(env.JAVA_HOME, path.join(managedHome, 'jdk')); // managed JDK retained
    assert.ok(env.APPIUM_HOME, 'managed APPIUM_HOME retained');
    assert.ok(env.PATH.includes(path.join(systemSdk, 'emulator')), 'system emulator on PATH');
  });

  test('image in neither SDK → managed env (preflight/boot will error)', async () => {
    writeManagedToolchain();
    writeAvdConfig(IMAGE); // image dir created in no SDK
    const env = await androidEnvForAvd(AVD);
    assert.equal(env.ANDROID_HOME, managedSdk);
  });
});

describe('avdBootPreflightError', () => {
  test('image in system SDK → no error (transparent fallback)', async () => {
    writeManagedToolchain();
    installImage(systemSdk);
    writeAvdConfig(IMAGE);
    assert.equal(await avdBootPreflightError(AVD, managedSdk), null);
  });

  test('image in managed SDK → no error', async () => {
    writeManagedToolchain();
    installImage(managedSdk);
    writeAvdConfig(IMAGE);
    assert.equal(await avdBootPreflightError(AVD, managedSdk), null);
  });

  test('image in neither SDK → actionable error', async () => {
    writeManagedToolchain();
    writeAvdConfig(IMAGE);
    const err = await avdBootPreflightError(AVD, managedSdk);
    assert.ok(err && err.includes(`Cannot boot AVD "${AVD}"`));
    assert.ok(err.includes('manifest.json'), 'mentions the managed-toolchain fixes');
  });
});

describe('resolveAvdSdk', () => {
  // Delete a possibly-inherited shell ANDROID_HOME so candidate roots are exactly
  // the managed (manifest) + system (TAQWRIGHT_SYSTEM_ANDROID_HOME) SDKs.
  beforeEach(() => {
    delete process.env.ANDROID_HOME;
  });

  test('image in managed SDK → sdkRoot = managed', async () => {
    writeManagedToolchain();
    installImage(managedSdk);
    writeAvdConfig(IMAGE);
    assert.deepEqual(await resolveAvdSdk(AVD), { image: IMAGE, sdkRoot: managedSdk });
  });

  test('image only in system SDK → sdkRoot = system', async () => {
    writeManagedToolchain();
    installImage(systemSdk);
    writeAvdConfig(IMAGE);
    assert.deepEqual(await resolveAvdSdk(AVD), { image: IMAGE, sdkRoot: systemSdk });
  });

  test('image in no SDK → image known, sdkRoot undefined', async () => {
    writeManagedToolchain();
    writeAvdConfig(IMAGE);
    assert.deepEqual(await resolveAvdSdk(AVD), { image: IMAGE, sdkRoot: undefined });
  });

  test('unknown image (no config) → {}', async () => {
    writeManagedToolchain();
    assert.deepEqual(await resolveAvdSdk(AVD), {});
  });
});
