// Unit tests for src/capabilities.ts — the non-autoStartDevice paths
// (config.test.js already covers AVD/autoStartDevice). Focus: base caps,
// app / bundle / version wiring, RegExp device names, udid passthrough,
// user-cap overrides, and appiumRemoteOptions.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilities, appiumRemoteOptions } from '../dist/capabilities.js';
import { Platform } from '../dist/types/index.js';

const android = (use = {}) => ({
  platform: Platform.ANDROID,
  device: { provider: 'local-device', ...(use.device ?? {}) },
  ...use,
});
const ios = (use = {}) => ({
  platform: Platform.IOS,
  device: { provider: 'local-device', ...(use.device ?? {}) },
  ...use,
});

describe('buildCapabilities — base', () => {
  test('Android defaults', () => {
    const c = buildCapabilities(android());
    assert.equal(c.platformName, 'Android');
    assert.equal(c['appium:automationName'], 'UiAutomator2');
    assert.equal(c['appium:noReset'], true);
    assert.equal(c['appium:newCommandTimeout'], 240);
  });
  test('iOS defaults', () => {
    const c = buildCapabilities(ios());
    assert.equal(c.platformName, 'iOS');
    assert.equal(c['appium:automationName'], 'XCUITest');
    assert.equal(c['appium:forceSimulatorSoftwareKeyboardPresence'], true);
  });
  test('newCommandTimeout honors the configured value', () => {
    const c = buildCapabilities(android({ appium: { newCommandTimeout: 600 } }));
    assert.equal(c['appium:newCommandTimeout'], 600);
  });
});

describe('buildCapabilities — app / bundle / version / name', () => {
  test('buildPath → appium:app', () => {
    assert.equal(
      buildCapabilities(android({ buildPath: '/tmp/app.apk' }))['appium:app'],
      '/tmp/app.apk',
    );
  });
  test('Android appBundleId → appium:appPackage', () => {
    const c = buildCapabilities(android({ appBundleId: 'com.x' }));
    assert.equal(c['appium:appPackage'], 'com.x');
    assert.equal('appium:bundleId' in c, false);
  });
  test('iOS appBundleId → appium:bundleId', () => {
    const c = buildCapabilities(ios({ appBundleId: 'com.x' }));
    assert.equal(c['appium:bundleId'], 'com.x');
    assert.equal('appium:appPackage' in c, false);
  });
  test('osVersion → appium:platformVersion', () => {
    assert.equal(
      buildCapabilities(android({ device: { osVersion: '14' } }))['appium:platformVersion'],
      '14',
    );
  });
  test('string device.name → appium:deviceName verbatim', () => {
    assert.equal(
      buildCapabilities(android({ device: { name: 'Pixel 7' } }))['appium:deviceName'],
      'Pixel 7',
    );
  });
  test('RegExp device.name → appium:deviceName is the regex source', () => {
    assert.equal(
      buildCapabilities(android({ device: { name: /Pixel.*/ } }))['appium:deviceName'],
      'Pixel.*',
    );
  });
  test('local-device udid is passed through', () => {
    assert.equal(buildCapabilities(android({ device: { udid: 'ZY22' } }))['appium:udid'], 'ZY22');
  });
});

describe('buildCapabilities — user overrides win (merged last)', () => {
  test('user platformName / extra caps override + merge', () => {
    const c = buildCapabilities(
      android({
        capabilities: { 'appium:noReset': false, 'appium:custom': 1 },
      }),
    );
    assert.equal(c['appium:noReset'], false);
    assert.equal(c['appium:custom'], 1);
  });
});

describe('appiumRemoteOptions', () => {
  test('defaults when appium block is absent', () => {
    const o = appiumRemoteOptions(android());
    assert.equal(o.hostname, 'localhost');
    assert.equal(o.port, 4723);
    assert.equal(o.path, '/');
    assert.equal(o.logLevel, 'warn');
    assert.equal(o.capabilities.platformName, 'Android');
  });
  test('honors a configured appium endpoint', () => {
    const o = appiumRemoteOptions(
      android({
        appium: { host: '10.0.0.2', port: 4799, path: '/wd/hub', logLevel: 'info' },
      }),
    );
    assert.deepEqual(
      { hostname: o.hostname, port: o.port, path: o.path, logLevel: o.logLevel },
      { hostname: '10.0.0.2', port: 4799, path: '/wd/hub', logLevel: 'info' },
    );
  });
  test('connectionTimeout maps to wdio connectionRetryTimeout when set', () => {
    const o = appiumRemoteOptions(android({ appium: { connectionTimeout: 300000 } }));
    assert.equal(o.connectionRetryTimeout, 300000);
  });
  test('connectionRetryTimeout is left unset (wdio default) when not configured', () => {
    const o = appiumRemoteOptions(android());
    assert.equal('connectionRetryTimeout' in o, false);
  });
});

describe('buildCapabilities — autoLaunch self-heal', () => {
  const reset = { resetBetweenTests: true, buildPath: './App.apk', appBundleId: 'com.x' };

  test('local Android with resetBetweenTests disables auto-launch', () => {
    const c = buildCapabilities(android(reset));
    assert.equal(c['appium:autoLaunch'], false);
  });

  test('no resetBetweenTests leaves auto-launch default (unset)', () => {
    const c = buildCapabilities(android({ buildPath: './App.apk', appBundleId: 'com.x' }));
    assert.equal('appium:autoLaunch' in c, false);
  });

  test('cloud provider keeps auto-launch (reset block does not run there)', () => {
    const c = buildCapabilities(android({ ...reset, device: { provider: 'browserstack' } }));
    assert.equal('appium:autoLaunch' in c, false);
  });

  test('a user-set appium:autoLaunch wins', () => {
    const c = buildCapabilities(android({ ...reset, capabilities: { 'appium:autoLaunch': true } }));
    assert.equal(c['appium:autoLaunch'], true);
  });
});
