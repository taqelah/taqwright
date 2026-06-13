// Unit test for findSerialForAvd — the pure mapping from an online-device map
// (serial → { avdName }) to the serial running a given AVD. Used by the
// Android pool pre-boot to locate / confirm a booted emulator.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findSerialForAvd,
  isTransientDeviceError,
  annotateAndroidBootability,
} from '../dist/inspector/devices.js';

describe('findSerialForAvd', () => {
  const online = new Map([
    ['emulator-5554', { avdName: 'Pixel_10_Pro_XL' }],
    ['emulator-5556', { avdName: 'Pixel_10_Pro_XL_2' }],
    ['emulator-5558', {}], // avdName not yet resolved
  ]);

  test('returns the serial running the named AVD', () => {
    assert.equal(findSerialForAvd(online, 'Pixel_10_Pro_XL'), 'emulator-5554');
    assert.equal(findSerialForAvd(online, 'Pixel_10_Pro_XL_2'), 'emulator-5556');
  });

  test('returns undefined when no online device runs the AVD', () => {
    assert.equal(findSerialForAvd(online, 'Pixel_10_Pro_XL_3'), undefined);
  });

  test('returns undefined for an empty map', () => {
    assert.equal(findSerialForAvd(new Map(), 'Pixel_10_Pro_XL'), undefined);
  });
});

describe('isTransientDeviceError', () => {
  test('true for transient adb/device blips worth retrying', () => {
    for (const msg of [
      "Command 'adb -s emulator-5554 install -r app.apk' exited with code 1; Command output: adb: device offline",
      'WebDriverError: Device emulator-5556 was not in the list of connected devices',
      "Cannot start the 'io.appium.settings' application",
      'unknown error: Error executing adbExec. Original error: ...',
      'error: device unauthorized',
    ]) {
      assert.equal(isTransientDeviceError(msg), true, msg);
    }
  });

  test('false for deterministic failures that should surface immediately', () => {
    for (const msg of [
      'expect(locator).toBeVisible() failed: element not found',
      "The application at '/path/DoesNotExist.apk' does not exist or is not accessible",
      'A session is either terminated or not started',
    ]) {
      assert.equal(isTransientDeviceError(msg), false, msg);
    }
  });
});

// annotateAndroidBootability flags a shutdown AVD `bootable:false` only when its
// system image is in NO known SDK (managed / ANDROID_HOME / system). An AVD whose
// image lives in some SDK is left unflagged — taqwright boots it against that SDK.
describe('annotateAndroidBootability', () => {
  const IMAGE = 'system-images/android-37.0/google_apis_playstore_ps16k/x86_64';
  const AVD = 'Pixel_10_Pro_XL';
  let root, managedHome, managedSdk, systemSdk, avdHome;
  const savedEnv = {};

  const shutdown = (avdName, name) => ({
    type: 'android',
    udid: `avd:${avdName}`,
    name: name ?? avdName,
    state: 'shutdown',
    avdName,
  });

  function writeManifest() {
    managedSdk = path.join(managedHome, 'android-sdk');
    mkdirSync(managedSdk, { recursive: true });
    writeFileSync(
      path.join(managedHome, 'manifest.json'),
      JSON.stringify({ androidHome: managedSdk, javaHome: path.join(managedHome, 'jdk') }),
    );
  }
  function writeAvdConfig(avdName) {
    const cfg = path.join(avdHome, `${avdName}.avd`, 'config.ini');
    mkdirSync(path.dirname(cfg), { recursive: true });
    writeFileSync(cfg, `image.sysdir.1=${IMAGE}\n`);
  }
  const installImage = (sdkHome) => mkdirSync(path.join(sdkHome, IMAGE), { recursive: true });

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'taqw-devfilter-'));
    managedHome = path.join(root, 'managed');
    systemSdk = path.join(root, 'system-sdk');
    avdHome = path.join(root, 'avd');
    mkdirSync(managedHome, { recursive: true });
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
    writeManifest();
    process.env.ANDROID_HOME = managedSdk; // managed override is active
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('image only in system SDK → not flagged', async () => {
    installImage(systemSdk);
    writeAvdConfig(AVD);
    const [d] = await annotateAndroidBootability([shutdown(AVD)]);
    assert.notEqual(d.bootable, false);
  });

  test('image in managed SDK → not flagged', async () => {
    installImage(managedSdk);
    writeAvdConfig(AVD);
    const [d] = await annotateAndroidBootability([shutdown(AVD)]);
    assert.notEqual(d.bootable, false);
  });

  test('image in neither SDK → flagged unbootable with a hint', async () => {
    writeAvdConfig(AVD);
    const [d] = await annotateAndroidBootability([shutdown(AVD)]);
    assert.equal(d.bootable, false);
    assert.match(d.bootHint, /not installed in any Android SDK/);
  });

  test('booted device is left untouched even if its image is in no SDK', async () => {
    writeAvdConfig(AVD);
    const booted = { ...shutdown(AVD), state: 'booted', udid: 'emulator-5554' };
    const [d] = await annotateAndroidBootability([booted]);
    assert.notEqual(d.bootable, false);
  });

  test('no managed manifest, image in no SDK → still flagged (runs regardless of manifest)', async () => {
    rmSync(path.join(managedHome, 'manifest.json'));
    writeAvdConfig(AVD);
    const [d] = await annotateAndroidBootability([shutdown(AVD)]);
    assert.equal(d.bootable, false);
  });
});
