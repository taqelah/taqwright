// Unit tests for cloud-provider pure logic — device parsers, capability builders
// (LambdaTest + Digital.ai), and the shared cloud engine helpers. Network IO
// (fetchCloudDevices, newSession) is not covered here.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseLambdatestDevices, parseDigitalaiDevices } from '../dist/inspector/server.js';
import { omitLocalEmulatorCaps } from '../dist/capabilities.js';
import { buildCapabilities as buildLambdatestCaps } from '../dist/providers/lambdatest/index.js';
import {
  buildCapabilities as buildDigitalaiCaps,
  reportStatusCommand,
  DigitalAiDeviceProvider,
} from '../dist/providers/digitalai/index.js';
import {
  basicAuth,
  cloudAuthHeader,
  resolveCloudHub,
  buildCloudConnection,
} from '../dist/providers/cloud.js';

const DIGITALAI_ACCESS_KEY_ENV = 'DIGITALAI_ACCESS_KEY';

describe('parseLambdatestDevices', () => {
  test('parses the { devices: [...] } shape', () => {
    const out = parseLambdatestDevices({
      devices: [{ deviceName: 'Galaxy S23', platformName: 'android', osVersion: '14' }],
    });
    assert.deepEqual(out, [
      {
        provider: 'lambdatest',
        platform: 'android',
        deviceName: 'Galaxy S23',
        osVersion: '14',
        realDevice: true,
      },
    ]);
  });

  test('parses the { data: [...] } shape (LambdaTest wraps under data)', () => {
    const out = parseLambdatestDevices({
      data: [{ deviceName: 'iPhone 15', platformName: 'ios', osVersion: '17' }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].platform, 'ios');
    assert.equal(out[0].deviceName, 'iPhone 15');
    assert.equal(out[0].osVersion, '17');
  });

  test('parses a top-level array with alternate field names', () => {
    const out = parseLambdatestDevices([
      { device: 'Pixel 8', os: 'Android', os_version: '14' },
      { name: 'iPad Pro', osName: 'iOS', version: 17 },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].deviceName, 'Pixel 8');
    assert.equal(out[0].platform, 'android');
    assert.equal(out[1].deviceName, 'iPad Pro');
    assert.equal(out[1].platform, 'ios');
    assert.equal(out[1].osVersion, '17'); // numeric coerced to string
  });

  test('skips entries without a device name', () => {
    const out = parseLambdatestDevices({ devices: [{ platformName: 'android', osVersion: '14' }] });
    assert.deepEqual(out, []);
  });

  test('empty / null / unrecognized → []', () => {
    assert.deepEqual(parseLambdatestDevices({ devices: null }), []);
    assert.deepEqual(parseLambdatestDevices({}), []);
    assert.deepEqual(parseLambdatestDevices([]), []);
    assert.deepEqual(parseLambdatestDevices(null), []);
    assert.deepEqual(parseLambdatestDevices({ unexpected: 1 }), []);
  });
});

describe('omitLocalEmulatorCaps', () => {
  test('drops local emulator caps, keeps the rest', () => {
    const out = omitLocalEmulatorCaps({
      'appium:avd': 'Pixel_10_Pro_XL',
      'appium:avdLaunchTimeout': 120000,
      'appium:avdReadyTimeout': 120000,
      'appium:newCommandTimeout': 240,
      'appium:autoGrantPermissions': true,
    });
    assert.deepEqual(out, {
      'appium:newCommandTimeout': 240,
      'appium:autoGrantPermissions': true,
    });
  });
  test('no local caps → unchanged', () => {
    const caps = { 'appium:newCommandTimeout': 240 };
    assert.deepEqual(omitLocalEmulatorCaps(caps), caps);
  });
});

describe('parseDigitalaiDevices', () => {
  test('parses the { status, data: [...], code } shape with deviceOs/isEmulator', () => {
    const out = parseDigitalaiDevices({
      status: 'SUCCESS',
      data: [
        {
          deviceName: 'Samsung S6 Edge',
          deviceOs: 'Android',
          osVersion: '7.0',
          model: 'SM-G928C',
          isEmulator: false,
        },
      ],
      code: 'OK',
    });
    assert.deepEqual(out, [
      {
        provider: 'digitalai',
        platform: 'android',
        deviceName: 'Samsung S6 Edge',
        osVersion: '7.0',
        realDevice: true,
        available: true, // no status field → treated as available
      },
    ]);
  });

  test('maps iOS + emulator flag, falls back across name/os fields', () => {
    const out = parseDigitalaiDevices({
      data: [
        { modelName: 'iPhone 15', os: 'iOS', version: '17', isEmulator: true },
        { model: 'Pixel', osType: 'Android', osVersion: '14' },
      ],
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      provider: 'digitalai',
      platform: 'ios',
      deviceName: 'iPhone 15',
      osVersion: '17',
      realDevice: false,
      available: true, // no status field → treated as available
    });
    assert.equal(out[1].deviceName, 'Pixel');
    assert.equal(out[1].platform, 'android');
  });

  test('tolerates an unrecognized shape (returns empty)', () => {
    assert.deepEqual(parseDigitalaiDevices({ nope: true }), []);
    assert.deepEqual(parseDigitalaiDevices(null), []);
  });

  test('lists ALL devices, flagging connectable ones via `available` + `status`', () => {
    const out = parseDigitalaiDevices({
      data: [
        {
          deviceName: 'Available Phone',
          deviceOs: 'Android',
          osVersion: '14',
          displayStatus: 'Available',
        },
        { deviceName: 'Busy Phone', deviceOs: 'Android', osVersion: '13', displayStatus: 'In Use' },
        {
          deviceName: 'Dead Phone',
          deviceOs: 'Android',
          osVersion: '12',
          currentStatus: 'offline',
        },
        { deviceName: 'No Status Phone', deviceOs: 'iOS', osVersion: '17' },
      ],
    });
    // Nothing is dropped — the picker shows the full fleet.
    assert.equal(out.length, 4);
    const byName = Object.fromEntries(out.map((d) => [d.deviceName, d]));
    assert.equal(byName['Available Phone'].available, true);
    assert.equal(byName['Available Phone'].status, 'Available');
    assert.equal(byName['Busy Phone'].available, false);
    assert.equal(byName['Busy Phone'].status, 'In Use');
    assert.equal(byName['Dead Phone'].available, false);
    // Absent status → treated as available (tolerant), no status string.
    assert.equal(byName['No Status Phone'].available, true);
    assert.ok(!('status' in byName['No Status Phone']));
  });
});

describe('LambdaTest buildCapabilities (W3C shape)', () => {
  const baseUse = {
    platform: 'android',
    device: { name: 'Galaxy S24', osVersion: '14', orientation: 'portrait' },
  };

  test('every top-level key is W3C-valid (standard or contains ":")', () => {
    const caps = buildLambdatestCaps(baseUse, 'inspector', 'lt://APP');
    for (const k of Object.keys(caps)) {
      assert.ok(
        k === 'platformName' || k.includes(':'),
        `top-level cap "${k}" is not W3C-valid (would be rejected)`,
      );
    }
  });

  test('LambdaTest caps live under lt:options with w3c:true', () => {
    const caps = buildLambdatestCaps(baseUse, 'inspector', 'lt://APP');
    assert.equal(caps.platformName, 'Android');
    assert.equal(caps['appium:automationName'], 'UiAutomator2');
    const lt = caps['lt:options'];
    assert.equal(lt.w3c, true);
    assert.equal(lt.deviceName, 'Galaxy S24');
    assert.equal(lt.platformVersion, '14');
    assert.equal(lt.app, 'lt://APP');
    assert.ok(String(lt.build).length > 0);
    // appiumVersion is intentionally unpinned — the grid picks its supported one.
    assert.ok(!('appiumVersion' in lt));
    // No bare device/app keys leaked to the top level (the failure mode).
    assert.ok(!('deviceName' in caps) && !('app' in caps) && !('build' in caps));
  });

  test('snapshotMaxDepth is iOS-only', () => {
    const android = buildLambdatestCaps(baseUse, 'p', 'lt://A');
    assert.ok(!('appium:settings[snapshotMaxDepth]' in android));
    const ios = buildLambdatestCaps(
      { platform: 'ios', device: { name: 'iPhone 15', osVersion: '17' } },
      'p',
      'lt://A',
    );
    assert.equal(ios.platformName, 'iOS');
    assert.equal(ios['appium:automationName'], 'XCUITest');
    assert.equal(ios['appium:settings[snapshotMaxDepth]'], 62);
  });

  test('bare user caps relocate into lt:options (codegen perm-off)', () => {
    const caps = buildLambdatestCaps(
      { ...baseUse, capabilities: { autoGrantPermissions: false, autoAcceptAlerts: false } },
      'p',
      'lt://A',
    );
    // Not leaked to the top level (the failure mode) ...
    assert.ok(!('autoGrantPermissions' in caps) && !('autoAcceptAlerts' in caps));
    // ... and applied inside lt:options.
    assert.equal(caps['lt:options'].autoGrantPermissions, false);
    assert.equal(caps['lt:options'].autoAcceptAlerts, false);
    // Every top-level key is still W3C-valid.
    for (const k of Object.keys(caps)) {
      assert.ok(k === 'platformName' || k.includes(':'), `bare key "${k}" leaked top-level`);
    }
  });

  test('appium:-prefixed user caps still pass through top-level', () => {
    const caps = buildLambdatestCaps(
      { ...baseUse, capabilities: { 'appium:newCommandTimeout': 300 } },
      'p',
      'lt://A',
    );
    assert.equal(caps['appium:newCommandTimeout'], 300);
  });

  test('user lt:options deep-merges (does not wipe defaults)', () => {
    const caps = buildLambdatestCaps(
      { ...baseUse, capabilities: { 'lt:options': { appiumVersion: '2.11.0', tunnel: true } } },
      'p',
      'lt://A',
    );
    assert.equal(caps['lt:options'].appiumVersion, '2.11.0'); // overridden
    assert.equal(caps['lt:options'].tunnel, true); // added
    assert.equal(caps['lt:options'].deviceName, 'Galaxy S24'); // default kept
  });
});

describe('Digital.ai buildCapabilities (Appium-2 / W3C shape)', () => {
  let savedKey;
  before(() => {
    savedKey = process.env[DIGITALAI_ACCESS_KEY_ENV];
    process.env[DIGITALAI_ACCESS_KEY_ENV] = 'tok-abc';
  });
  after(() => {
    if (savedKey === undefined) delete process.env[DIGITALAI_ACCESS_KEY_ENV];
    else process.env[DIGITALAI_ACCESS_KEY_ENV] = savedKey;
  });

  const androidUse = {
    platform: 'android',
    appBundleId: 'com.acme.app',
    device: { provider: 'digitalai', name: 'Galaxy S24', osVersion: '14' },
  };

  test('Android: package under appium:options, cloud app ref, digitalai:options vendor block', () => {
    const caps = buildDigitalaiCaps(androidUse, 'MyProj', 'cloud:com.acme.app');
    assert.equal(caps.platformName, 'Android');

    const appium = caps['appium:options'];
    assert.equal(appium.appPackage, 'com.acme.app');
    assert.equal(appium.app, 'cloud:com.acme.app');
    assert.ok(!('bundleId' in appium), 'Android must not set bundleId');

    const dai = caps['digitalai:options'];
    assert.equal(dai.accessKey, 'tok-abc');
    assert.equal(dai.testName, 'MyProj android test');
    assert.equal(dai.deviceQuery, "@os='android' and @name='Galaxy S24' and @version='14'");
    // appiumVersion intentionally unpinned.
    assert.ok(!('appiumVersion' in dai));
  });

  test('no app + no bundleId: omits app/appPackage so the session attaches to the device', () => {
    const caps = buildDigitalaiCaps(
      {
        platform: 'android',
        device: { provider: 'digitalai', name: 'Galaxy S24', osVersion: '14' },
      },
      'P',
      '', // no app reference
    );
    const appium = caps['appium:options'];
    assert.ok(!('app' in appium), 'must not set app when there is no app');
    assert.ok(!('appPackage' in appium), 'must not set appPackage when there is no bundle id');
    assert.ok(!('bundleId' in appium));
    assert.equal(
      caps['digitalai:options'].deviceQuery,
      "@os='android' and @name='Galaxy S24' and @version='14'",
    );
  });

  test('cloud:<bundleId> ref + bundle id sets both app and appPackage', () => {
    const caps = buildDigitalaiCaps(androidUse, 'P', 'cloud:com.acme.app');
    assert.equal(caps['appium:options'].app, 'cloud:com.acme.app');
    assert.equal(caps['appium:options'].appPackage, 'com.acme.app');
  });

  test('iOS: references the app by bundleId, platformName iOS', () => {
    const caps = buildDigitalaiCaps(
      {
        platform: 'ios',
        appBundleId: 'com.acme.app',
        device: { provider: 'digitalai', name: 'iPhone 15', osVersion: '17' },
      },
      'P',
      'cloud:com.acme.app',
    );
    assert.equal(caps.platformName, 'iOS');
    const appium = caps['appium:options'];
    assert.equal(appium.bundleId, 'com.acme.app');
    assert.ok(!('appPackage' in appium), 'iOS must not set appPackage');
  });

  test('an explicit deviceQuery overrides the name/osVersion-derived one', () => {
    const caps = buildDigitalaiCaps(
      {
        ...androidUse,
        device: { ...androidUse.device, deviceQuery: "@os='android' and @category='PHONE'" },
      },
      'P',
      'cloud:com.acme.app',
    );
    assert.equal(caps['digitalai:options'].deviceQuery, "@os='android' and @category='PHONE'");
  });

  test('user capabilities deep-merge into the vendor option blocks', () => {
    const caps = buildDigitalaiCaps(
      {
        ...androidUse,
        capabilities: {
          'digitalai:options': { appiumVersion: '2.0.0' },
          'appium:options': { autoGrantPermissions: true },
          'appium:newCommandTimeout': 120,
        },
      },
      'P',
      'cloud:com.acme.app',
    );
    assert.equal(caps['digitalai:options'].appiumVersion, '2.0.0');
    assert.equal(caps['digitalai:options'].accessKey, 'tok-abc');
    assert.equal(caps['appium:options'].autoGrantPermissions, true);
    assert.equal(caps['appium:options'].app, 'cloud:com.acme.app');
    assert.equal(caps['appium:newCommandTimeout'], 120);
  });

  test('bare user caps relocate into appium:options (codegen perm-off)', () => {
    const caps = buildDigitalaiCaps(
      { ...androidUse, capabilities: { autoGrantPermissions: false, autoAcceptAlerts: false } },
      'P',
      'cloud:com.acme.app',
    );
    // Bare Appium caps land under appium:options (W3C-valid; matches Digital.ai docs).
    assert.equal(caps['appium:options'].autoGrantPermissions, false);
    assert.equal(caps['appium:options'].autoAcceptAlerts, false);
    // Not leaked to the top level — the webdriver client would reject bare caps there.
    assert.ok(!('autoGrantPermissions' in caps) && !('autoAcceptAlerts' in caps));
    assert.equal(caps['appium:options'].app, 'cloud:com.acme.app');
    assert.equal(caps['appium:options'].appPackage, 'com.acme.app');
  });
});

describe('Digital.ai reportStatusCommand (setReportStatus mapping)', () => {
  test("maps 'passed' → Passed", () => {
    const cmd = reportStatusCommand({ status: 'passed', reason: 'all good' });
    assert.equal(cmd.script, 'seetest:client.setReportStatus');
    assert.deepEqual(cmd.args, ['Passed', 'all good']);
  });

  test("maps 'failed' → Failed and 'skipped' → Skipped", () => {
    assert.deepEqual(reportStatusCommand({ status: 'failed', reason: 'boom' }).args, [
      'Failed',
      'boom',
    ]);
    assert.deepEqual(reportStatusCommand({ status: 'skipped', reason: 'n/a' }).args, [
      'Skipped',
      'n/a',
    ]);
  });

  test('falls back to name, then a default message', () => {
    assert.deepEqual(reportStatusCommand({ status: 'passed', name: 'Login test' }).args, [
      'Passed',
      'Login test',
    ]);
    assert.deepEqual(reportStatusCommand({ status: 'failed' }).args, [
      'Failed',
      'taqwright test failed',
    ]);
  });
});

describe('DigitalAiDeviceProvider.syncTestDetails (command dispatch)', () => {
  function makeProvider() {
    const use = {
      platform: 'android',
      appBundleId: 'com.acme.app',
      device: { provider: 'digitalai', name: 'Galaxy S24', osVersion: '14' },
    };
    return new DigitalAiDeviceProvider(use, 'com.acme.app', 'proj');
  }

  test('runs setReportStatus on the live driver before deleteSession', async () => {
    const calls = [];
    const provider = makeProvider();
    // `driver`/`sessionId` are normally set in getDevice(); set them directly to
    // exercise teardown without opening a real cloud session.
    provider.driver = {
      executeScript: async (script, args) => {
        calls.push([script, args]);
      },
    };
    provider.sessionId = 'sid-1';

    await provider.syncTestDetails({ status: 'failed', reason: 'assertion failed' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['seetest:client.setReportStatus', ['Failed', 'assertion failed']]);
  });

  test('is a safe no-op when no driver is present', async () => {
    const provider = makeProvider();
    await assert.doesNotReject(provider.syncTestDetails({ status: 'passed' }));
  });

  test('swallows executeScript errors (teardown must not fail)', async () => {
    const provider = makeProvider();
    provider.driver = {
      executeScript: async () => {
        throw new Error('session gone');
      },
    };
    provider.sessionId = 'sid-2';
    await assert.doesNotReject(provider.syncTestDetails({ status: 'passed' }));
  });
});

describe('cloudAuthHeader', () => {
  test('basic (default) builds an HTTP Basic header from [user, key]', () => {
    const spec = { credentialEnv: ['MYGRID_USERNAME', 'MYGRID_ACCESS_KEY'] };
    const env = { MYGRID_USERNAME: 'alice', MYGRID_ACCESS_KEY: 'secret' };
    assert.equal(cloudAuthHeader(spec, env), basicAuth('alice', 'secret'));
  });

  test('bearer builds a Bearer header from the access key alone (no username)', () => {
    const spec = { authScheme: 'bearer', credentialEnv: ['DIGITALAI_ACCESS_KEY'] };
    assert.equal(cloudAuthHeader(spec, { DIGITALAI_ACCESS_KEY: 'tok-123' }), 'Bearer tok-123');
  });

  test('bearer with a missing key yields an empty token (caught by the credential check)', () => {
    const spec = { authScheme: 'bearer', credentialEnv: ['DIGITALAI_ACCESS_KEY'] };
    assert.equal(cloudAuthHeader(spec, {}), 'Bearer ');
  });
});

describe('resolveCloudHub', () => {
  const use = { device: { provider: 'digitalai' }, appium: {} };

  test('returns a static hub object unchanged', () => {
    const hub = { hostname: 'hub.example.com', port: 443, path: '/wd/hub', protocol: 'https' };
    assert.equal(resolveCloudHub(hub, use), hub);
  });

  test('invokes a function hub with `use` (tenant-server resolution)', () => {
    const fn = (u) => ({
      hostname: u.device.provider === 'digitalai' ? 'mycloud.example.com' : 'other',
      port: 443,
      path: '/wd/hub',
      protocol: 'https',
    });
    assert.deepEqual(resolveCloudHub(fn, use), {
      hostname: 'mycloud.example.com',
      port: 443,
      path: '/wd/hub',
      protocol: 'https',
    });
  });
});

describe('buildCloudConnection', () => {
  const SENTINEL_CAPS = { __caps__: true };

  test('basic auth + static hub: carries user/key, spreads the hub, default retry timeout', () => {
    const spec = {
      credentialEnv: ['U', 'K'],
      hub: { hostname: 'hub.example.com', port: 443, path: '/wd/hub', protocol: 'https' },
      buildCapabilities: () => SENTINEL_CAPS,
    };
    const conn = buildCloudConnection(spec, { device: {}, appium: {} }, 'http://app/url', 'proj', {
      U: 'me',
      K: 'secret',
    });
    assert.deepEqual(conn, {
      hostname: 'hub.example.com',
      port: 443,
      path: '/wd/hub',
      protocol: 'https',
      logLevel: 'warn',
      connectionRetryTimeout: 300_000,
      user: 'me',
      key: 'secret',
      capabilities: SENTINEL_CAPS,
    });
  });

  test('bearer + function hub: omits user/key, resolves the tenant hub from `use`', () => {
    const spec = {
      authScheme: 'bearer',
      credentialEnv: ['DIGITALAI_ACCESS_KEY'],
      hub: (u) => ({ hostname: u.appium.host, port: 443, path: '/wd/hub', protocol: 'https' }),
      buildCapabilities: () => SENTINEL_CAPS,
    };
    const conn = buildCloudConnection(
      spec,
      { device: {}, appium: { host: 'mycloud.example.com' } },
      'cloud:com.acme.app',
      'proj',
      { DIGITALAI_ACCESS_KEY: 'tok' },
    );
    assert.equal('user' in conn, false);
    assert.equal('key' in conn, false);
    assert.equal(conn.hostname, 'mycloud.example.com');
    assert.equal(conn.capabilities, SENTINEL_CAPS);
  });

  test('honours an explicit appium.connectionTimeout', () => {
    const spec = {
      credentialEnv: ['U', 'K'],
      hub: { hostname: 'h', port: 443, path: '/wd/hub', protocol: 'https' },
      buildCapabilities: () => SENTINEL_CAPS,
    };
    const conn = buildCloudConnection(
      spec,
      { device: {}, appium: { connectionTimeout: 120_000 } },
      'x',
      'p',
      { U: 'a', K: 'b' },
    );
    assert.equal(conn.connectionRetryTimeout, 120_000);
  });
});
