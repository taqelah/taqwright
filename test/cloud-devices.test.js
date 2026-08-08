// Unit tests for cloud-provider pure logic — device parsers, capability builders
// (LambdaTest + Digital.ai), and the shared cloud engine helpers. Network IO
// (fetchCloudDevices, newSession) is not covered here.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { omitLocalEmulatorCaps } from '../dist/capabilities.js';
import {
  buildCapabilities as buildLambdatestCaps,
  parseLambdatestDevices,
} from '../dist/providers/lambdatest/index.js';
import {
  buildCapabilities as buildDigitalaiCaps,
  parseDigitalAiDevices,
  reportStatusCommand,
  DigitalAiDeviceProvider,
} from '../dist/providers/digitalai/index.js';
import {
  buildCapabilities as buildPcloudyCaps,
  parsePcloudyDevices,
  parseDeviceFullName,
  buildDeviceFullName,
  getAuthToken,
  __resetPcloudyTokenCache,
  pcloudySpec,
  DEFAULT_CLOUD_URL,
} from '../dist/providers/pcloudy/index.js';
import {
  basicAuth,
  cloudAuthHeader,
  resolveCloudHub,
  buildCloudConnection,
} from '../dist/providers/cloud.js';

const DIGITALAI_ACCESS_KEY_ENV = 'DIGITALAI_ACCESS_KEY';
const PCLOUDY_USERNAME_ENV = 'PCLOUDY_USERNAME';
const PCLOUDY_API_KEY_ENV = 'PCLOUDY_API_KEY';
const PCLOUDY_CLOUD_URL_ENV = 'PCLOUDY_CLOUD_URL';

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

describe('parseDigitalAiDevices', () => {
  test('parses the { status, data: [...], code } shape with deviceOs/isEmulator', () => {
    const out = parseDigitalAiDevices({
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
    const out = parseDigitalAiDevices({
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
    assert.deepEqual(parseDigitalAiDevices({ nope: true }), []);
    assert.deepEqual(parseDigitalAiDevices(null), []);
  });

  test('lists ALL devices, flagging connectable ones via `available` + `status`', () => {
    const out = parseDigitalAiDevices({
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

// ─── pCloudy ───────────────────────────────────────────────────

describe('parseDeviceFullName / buildDeviceFullName', () => {
  test('splits <Brand>_<Model>_<OS>_<Version> into picker fields', () => {
    assert.deepEqual(parseDeviceFullName('Samsung_GalaxyTabA_Android_7.1.1'), {
      deviceName: 'Samsung GalaxyTabA',
      osVersion: '7.1.1',
      platform: 'android',
    });
  });

  test('reads the OS token case-insensitively and detects iOS', () => {
    assert.deepEqual(parseDeviceFullName('Apple_iPhone14_ios_16.4.1'), {
      deviceName: 'Apple iPhone14',
      osVersion: '16.4.1',
      platform: 'ios',
    });
  });

  test('keeps every leading segment when the name has more than one', () => {
    const out = parseDeviceFullName('Motorola_Moto_G5_Plus_Android_7.0.0');
    assert.equal(out.deviceName, 'Motorola Moto G5 Plus');
    assert.equal(out.osVersion, '7.0.0');
  });

  test('ignores the per-device id pCloudy appends after the version', () => {
    // Observed live: `Samsung_GalaxyFold_Android_10_d69de`. Counting back from
    // the end would read the id as the version and leave "Android" in the name.
    const out = parseDeviceFullName('Samsung_GalaxyFold_Android_10_d69de');
    assert.deepEqual(out, {
      deviceName: 'Samsung GalaxyFold',
      osVersion: '10',
      platform: 'android',
    });
  });

  test('finds the OS token by value even with an id suffix on iOS', () => {
    const out = parseDeviceFullName('Apple_iPhone14_ios_16.4.1_a1b2c');
    assert.deepEqual(out, { deviceName: 'Apple iPhone14', osVersion: '16.4.1', platform: 'ios' });
  });

  test('returns null when no OS token is present', () => {
    assert.equal(parseDeviceFullName('Samsung_GalaxyFold_10_d69de'), null);
  });

  test('returns null for names too short to carry all three parts', () => {
    assert.equal(parseDeviceFullName('Samsung_Android'), null);
    assert.equal(parseDeviceFullName(''), null);
    assert.equal(parseDeviceFullName('nonsense'), null);
  });

  test('round-trips a parsed name back to the original', () => {
    for (const [name, platform] of [
      ['Samsung_GalaxyTabA_Android_7.1.1', 'android'],
      ['Apple_iPhone14_ios_16.4.1', 'ios'],
    ]) {
      const parsed = parseDeviceFullName(name);
      assert.equal(buildDeviceFullName(parsed.deviceName, parsed.osVersion, platform), name);
    }
  });

  test('collapses runs of whitespace in the device name', () => {
    assert.equal(buildDeviceFullName('  Galaxy   S24 ', '14', 'android'), 'Galaxy_S24_Android_14');
  });
});

describe('parsePcloudyDevices', () => {
  // Fixtures copied verbatim from a live `POST /api/devices` response.
  const ANDROID = {
    index: 1,
    full_name: 'Motorola_MotoG5_Android_7.0.0_ea8b0',
    id: 707,
    alias_name: 'ea8b0',
    model: 'MotoG5',
    display_name: 'Moto G5',
    platform: 'android',
    version: '7.0.0',
    manufacturer: 'Motorola',
    dpi: 'xxhdpi',
    available: true,
  };
  const IOS = {
    index: 1,
    full_name: 'Apple_iPodTouch_Ios_14.0.1_00254',
    id: 782,
    alias_name: '00254',
    model: 'iPodTouch',
    display_name: 'iPod Touch',
    platform: 'ios',
    version: '14.0.1',
    manufacturer: 'Apple',
    available: true,
  };

  test('reads platform and version from their OWN fields', () => {
    const out = parsePcloudyDevices({ result: { models: [ANDROID, IOS] } });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      provider: 'pcloudy',
      platform: 'android',
      deviceName: 'Motorola Moto G5',
      osVersion: '7.0.0',
      realDevice: true,
      available: true,
      fullName: 'Motorola_MotoG5_Android_7.0.0_ea8b0',
    });
  });

  test('an Apple device lands on iOS, not Android', () => {
    // The original bug: every Apple device was mis-filed onto the Android tab
    // because the platform was derived from the name instead of the field.
    const out = parsePcloudyDevices({ result: { models: [IOS] } });
    assert.equal(out[0].platform, 'ios');
    assert.equal(out[0].deviceName, 'Apple iPod Touch');
    assert.equal(out[0].osVersion, '14.0.1');
  });

  test('never surfaces the opaque alias as the OS version', () => {
    const out = parsePcloudyDevices({ result: { models: [ANDROID, IOS] } });
    for (const d of out) {
      assert.notEqual(d.osVersion, 'ea8b0');
      assert.notEqual(d.osVersion, '00254');
      assert.match(d.osVersion, /^\d+\.\d+/);
    }
  });

  test('carries full_name verbatim, alias suffix included', () => {
    // The alias cannot be reconstructed, so the exact catalog string is what
    // the session must reference.
    const out = parsePcloudyDevices({ result: { models: [ANDROID] } });
    assert.equal(out[0].fullName, 'Motorola_MotoG5_Android_7.0.0_ea8b0');
  });

  test('honours per-device availability', () => {
    const out = parsePcloudyDevices({
      result: { models: [{ ...ANDROID, available: false }] },
    });
    assert.equal(out[0].available, false);
    assert.equal(out[0].status, 'In Use');
  });

  test('falls back to the parsed full_name when the explicit fields are absent', () => {
    const out = parsePcloudyDevices({
      result: { models: [{ full_name: 'Apple_iPhone11Pro_Ios_17.5.1_45645' }] },
    });
    assert.equal(out[0].platform, 'ios');
    assert.equal(out[0].deviceName, 'Apple iPhone11Pro');
    assert.equal(out[0].osVersion, '17.5.1');
  });

  test('accepts a bare top-level array and skips nameless entries', () => {
    const out = parsePcloudyDevices([ANDROID, { version: '13' }]);
    assert.equal(out.length, 1);
  });

  test('empty / null / unrecognized -> []', () => {
    assert.deepEqual(parsePcloudyDevices([]), []);
    assert.deepEqual(parsePcloudyDevices(null), []);
    assert.deepEqual(parsePcloudyDevices({}), []);
    assert.deepEqual(parsePcloudyDevices({ nope: 1 }), []);
  });
});

describe('pCloudy buildCapabilities (Appium-2 / W3C shape)', () => {
  let savedUser;
  let savedKey;
  before(() => {
    savedUser = process.env[PCLOUDY_USERNAME_ENV];
    savedKey = process.env[PCLOUDY_API_KEY_ENV];
    process.env[PCLOUDY_USERNAME_ENV] = 'tester@example.com';
    process.env[PCLOUDY_API_KEY_ENV] = 'key-abc';
  });
  after(() => {
    if (savedUser === undefined) delete process.env[PCLOUDY_USERNAME_ENV];
    else process.env[PCLOUDY_USERNAME_ENV] = savedUser;
    if (savedKey === undefined) delete process.env[PCLOUDY_API_KEY_ENV];
    else process.env[PCLOUDY_API_KEY_ENV] = savedKey;
  });

  const androidUse = {
    platform: 'android',
    appBundleId: 'com.acme.app',
    device: { provider: 'pcloudy', name: 'Samsung GalaxyTabA', osVersion: '7.1.1' },
  };

  test('every top-level cap is W3C-valid', () => {
    const caps = buildPcloudyCaps(androidUse, 'proj', 'pcloudy:MyApp.apk');
    for (const k of Object.keys(caps)) {
      assert.ok(
        k === 'platformName' || k.includes(':'),
        `top-level cap "${k}" is not W3C-valid (would be rejected)`,
      );
    }
  });

  test('vendor block carries credentials, device selector and duration', () => {
    const caps = buildPcloudyCaps(androidUse, 'proj', 'pcloudy:MyApp.apk');
    assert.equal(caps.platformName, 'Android');
    assert.equal(caps['appium:automationName'], 'UiAutomator2');
    const v = caps['pCloudy:options'];
    assert.equal(v.pCloudy_Username, 'tester@example.com');
    assert.equal(v.pCloudy_ApiKey, 'key-abc');
    assert.equal(v.pCloudy_DeviceFullName, 'Samsung_GalaxyTabA_Android_7.1.1');
    // Small by default: pCloudy rejects the session outright when the
    // requested window exceeds the account's remaining balance.
    assert.equal(v.pCloudy_DurationInMinutes, 10);
    // The prebuilt scheme is stripped — pCloudy wants the bare filename.
    assert.equal(v.pCloudy_ApplicationName, 'MyApp.apk');
  });

  test('an explicit deviceFullName overrides the reconstructed one', () => {
    const caps = buildPcloudyCaps(
      {
        ...androidUse,
        device: { ...androidUse.device, deviceFullName: 'Samsung_GalaxyS24_Android_14' },
      },
      'proj',
      'pcloudy:MyApp.apk',
    );
    assert.equal(caps['pCloudy:options'].pCloudy_DeviceFullName, 'Samsung_GalaxyS24_Android_14');
  });

  test('durationInMinutes is configurable', () => {
    const caps = buildPcloudyCaps(
      { ...androidUse, device: { ...androidUse.device, durationInMinutes: 90 } },
      'proj',
      'pcloudy:MyApp.apk',
    );
    assert.equal(caps['pCloudy:options'].pCloudy_DurationInMinutes, 90);
  });

  test('no app ref → pCloudy_ApplicationName omitted (session attaches to the device)', () => {
    const caps = buildPcloudyCaps(androidUse, 'proj', '');
    assert.ok(!('pCloudy_ApplicationName' in caps['pCloudy:options']));
  });

  test('iOS: XCUITest + snapshotMaxDepth, platformName iOS', () => {
    const caps = buildPcloudyCaps(
      {
        platform: 'ios',
        appBundleId: 'com.acme.MyApp',
        device: { provider: 'pcloudy', name: 'Apple iPhone14', osVersion: '16.4.1' },
      },
      'proj',
      'pcloudy:MyApp.ipa',
    );
    assert.equal(caps.platformName, 'iOS');
    assert.equal(caps['appium:automationName'], 'XCUITest');
    assert.equal(caps['appium:settings[snapshotMaxDepth]'], 62);
    assert.equal(caps['pCloudy:options'].pCloudy_DeviceFullName, 'Apple_iPhone14_ios_16.4.1');
  });

  test('android omits the iOS-only snapshotMaxDepth setting', () => {
    const caps = buildPcloudyCaps(androidUse, 'proj', 'pcloudy:MyApp.apk');
    assert.ok(!('appium:settings[snapshotMaxDepth]' in caps));
  });

  test('user pCloudy:options deep-merge without wiping defaults', () => {
    const caps = buildPcloudyCaps(
      {
        ...androidUse,
        capabilities: { 'pCloudy:options': { appiumVersion: '2.11.2', pCloudy_EnableVideo: true } },
      },
      'proj',
      'pcloudy:MyApp.apk',
    );
    const v = caps['pCloudy:options'];
    assert.equal(v.appiumVersion, '2.11.2');
    assert.equal(v.pCloudy_EnableVideo, true);
    // Defaults survive the merge.
    assert.equal(v.pCloudy_DeviceFullName, 'Samsung_GalaxyTabA_Android_7.1.1');
    assert.equal(v.pCloudy_Username, 'tester@example.com');
  });

  test('a bare pCloudy_* extras key lands in the vendor block, not appium:options', () => {
    // The inspector's Extras editor only takes flat key/value pairs, so this is
    // the only way to shorten the booking window from the UI.
    const caps = buildPcloudyCaps(
      { ...androidUse, capabilities: { pCloudy_DurationInMinutes: 5 } },
      'proj',
      'pcloudy:MyApp.apk',
    );
    assert.equal(caps['pCloudy:options'].pCloudy_DurationInMinutes, 5);
    assert.ok(!('appium:options' in caps));
  });

  test('bare user caps relocate into appium:options (codegen perm-off)', () => {
    const caps = buildPcloudyCaps(
      {
        ...androidUse,
        capabilities: { autoGrantPermissions: false, 'appium:newCommandTimeout': 300 },
      },
      'proj',
      'pcloudy:MyApp.apk',
    );
    assert.equal(caps['appium:options'].autoGrantPermissions, false);
    // `appium:`-prefixed caps stay at the top level.
    assert.equal(caps['appium:newCommandTimeout'], 300);
    assert.ok(!('autoGrantPermissions' in caps));
  });

  test('no user caps → no empty appium:options block', () => {
    const caps = buildPcloudyCaps(androidUse, 'proj', 'pcloudy:MyApp.apk');
    assert.ok(!('appium:options' in caps));
  });
});

describe('pCloudy auth token exchange', () => {
  let savedFetch;
  let savedUser;
  let savedKey;
  let calls;
  before(() => {
    savedUser = process.env[PCLOUDY_USERNAME_ENV];
    savedKey = process.env[PCLOUDY_API_KEY_ENV];
    process.env[PCLOUDY_USERNAME_ENV] = 'tester@example.com';
    process.env[PCLOUDY_API_KEY_ENV] = 'key-abc';
    savedFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = savedFetch;
    if (savedUser === undefined) delete process.env[PCLOUDY_USERNAME_ENV];
    else process.env[PCLOUDY_USERNAME_ENV] = savedUser;
    if (savedKey === undefined) delete process.env[PCLOUDY_API_KEY_ENV];
    else process.env[PCLOUDY_API_KEY_ENV] = savedKey;
    __resetPcloudyTokenCache();
  });

  const stub = (response) => {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return response;
    };
  };

  test('exchanges Basic credentials for result.token, then serves from cache', async () => {
    __resetPcloudyTokenCache();
    stub({ ok: true, json: async () => ({ result: { token: 'tok-1' } }) });
    assert.equal(await getAuthToken(), 'tok-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${DEFAULT_CLOUD_URL}/api/access`);
    assert.ok(calls[0].init.headers.Authorization.startsWith('Basic '));
    // Second call must not hit the network again.
    assert.equal(await getAuthToken(), 'tok-1');
    assert.equal(calls.length, 1);
  });

  test('accepts a flat { token } envelope', async () => {
    __resetPcloudyTokenCache();
    stub({ ok: true, json: async () => ({ token: 'tok-flat' }) });
    assert.equal(await getAuthToken(), 'tok-flat');
  });

  test('caches per credentials — a different auth header re-exchanges', async () => {
    __resetPcloudyTokenCache();
    stub({ ok: true, json: async () => ({ result: { token: 'tok-x' } }) });
    await getAuthToken('Basic AAA');
    await getAuthToken('Basic BBB');
    assert.equal(calls.length, 2);
  });

  test('a non-OK response throws naming the credential env vars', async () => {
    __resetPcloudyTokenCache();
    stub({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(() => getAuthToken(), /PCLOUDY_USERNAME \/ PCLOUDY_API_KEY/);
  });

  test('a 200 with no token throws and echoes the body', async () => {
    __resetPcloudyTokenCache();
    stub({ ok: true, json: async () => ({ result: {} }) });
    await assert.rejects(() => getAuthToken(), /returned no token/);
  });
});

describe('pCloudy upload + catalog wiring', () => {
  let savedFetch;
  let savedUser;
  let savedKey;
  before(() => {
    savedUser = process.env[PCLOUDY_USERNAME_ENV];
    savedKey = process.env[PCLOUDY_API_KEY_ENV];
    process.env[PCLOUDY_USERNAME_ENV] = 'tester@example.com';
    process.env[PCLOUDY_API_KEY_ENV] = 'key-abc';
    savedFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = savedFetch;
    if (savedUser === undefined) delete process.env[PCLOUDY_USERNAME_ENV];
    else process.env[PCLOUDY_USERNAME_ENV] = savedUser;
    if (savedKey === undefined) delete process.env[PCLOUDY_API_KEY_ENV];
    else process.env[PCLOUDY_API_KEY_ENV] = savedKey;
    __resetPcloudyTokenCache();
  });

  test('urlBody throws — pCloudy has no upload-from-URL API', () => {
    assert.throws(
      () => pcloudySpec.upload.urlBody('https://example.com/app.apk', 'proj'),
      /no upload-by-URL API/,
    );
  });

  test('fileBody carries the token, source_type and filter alongside the file', async () => {
    __resetPcloudyTokenCache();
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ result: { token: 'tok-9' } }),
    });
    const form = await pcloudySpec.upload.fileBody(Buffer.from('zip'), 'MyApp.apk', 'proj');
    assert.equal(form.get('token'), 'tok-9');
    assert.equal(form.get('source_type'), 'raw');
    assert.equal(form.get('filter'), 'apk');
    assert.ok(form.get('file'));
  });

  test('fileBody picks the ipa filter for iOS builds', async () => {
    __resetPcloudyTokenCache();
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: { token: 't' } }) });
    const form = await pcloudySpec.upload.fileBody(Buffer.from('zip'), 'MyApp.IPA', 'proj');
    assert.equal(form.get('filter'), 'ipa');
  });

  test('uploadResponseToAppRef reads result.file and prefixes the scheme', () => {
    const ref = pcloudySpec.uploadResponseToAppRef(
      { result: { file: 'MyApp.apk' } },
      { use: {}, appBundleId: undefined },
    );
    assert.equal(ref, 'pcloudy:MyApp.apk');
  });

  test('uploadResponseToAppRef keeps the timestamped name pCloudy assigns', () => {
    // pCloudy renames uploads: `DemoApp-v1.0.0.apk` is stored as
    // `DemoApp-v1.0.0-1786171090.apk`. Verified against the live service.
    const ref = pcloudySpec.uploadResponseToAppRef(
      { result: { token: 't', code: 200, file: 'DemoApp-v1.0.0-1786171090.apk' } },
      { use: { buildPath: '/tmp/builds/DemoApp-v1.0.0.apk' }, appBundleId: undefined },
    );
    assert.equal(ref, 'pcloudy:DemoApp-v1.0.0-1786171090.apk');
  });

  test('uploadResponseToAppRef never guesses the local basename', () => {
    // The local name is NOT what pCloudy stored, so falling back to it would
    // yield a plausible reference that does not exist on the grid.
    assert.throws(
      () =>
        pcloudySpec.uploadResponseToAppRef(
          {},
          { use: { buildPath: '/tmp/builds/Demo.apk' }, appBundleId: undefined },
        ),
      /did not return a stored file name/,
    );
  });

  test('uploadResponseToAppRef surfaces an error carried in the body', () => {
    assert.throws(
      () =>
        pcloudySpec.uploadResponseToAppRef(
          { result: { error: 'invalid token' } },
          { use: {}, appBundleId: undefined },
        ),
      /invalid token/,
    );
  });

  test('catalog.fetchRaw posts once per platform and merges the models', async () => {
    __resetPcloudyTokenCache();
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/access')) {
        return { ok: true, json: async () => ({ result: { token: 'tok-c' } }) };
      }
      const platform = JSON.parse(init.body).platform;
      return {
        ok: true,
        json: async () => ({ result: { models: [{ full_name: `Dev_${platform}_Android_14` }] } }),
      };
    };
    const raw = await pcloudySpec.catalog.fetchRaw({
      authHeader: 'Basic AAA',
      listUrl: `${DEFAULT_CLOUD_URL}/api/devices`,
    });
    const deviceCalls = calls.filter((c) => c.url.endsWith('/api/devices'));
    assert.equal(deviceCalls.length, 2);
    assert.equal(deviceCalls[0].init.method, 'POST');
    assert.equal(deviceCalls[0].init.headers['Content-Type'], 'application/json');
    // `available_now` must be the STRING 'true' — a boolean is ignored and the
    // catalog then includes already-booked devices.
    assert.equal(JSON.parse(deviceCalls[0].init.body).available_now, 'true');
    assert.deepEqual(
      deviceCalls.map((c) => JSON.parse(c.init.body).platform),
      ['android', 'ios'],
    );
    // The list `duration` is an availability filter, not a booking — keeping it
    // minimal means a nearly-exhausted account can still browse the catalog.
    assert.equal(JSON.parse(deviceCalls[0].init.body).duration, 1);
    // The token rides in the body, never a header.
    assert.equal(JSON.parse(deviceCalls[0].init.body).token, 'tok-c');
    assert.equal(deviceCalls[0].init.headers.Authorization, undefined);
    assert.equal(raw.result.models.length, 2);
  });

  test('catalog.fetchRaw surfaces a non-OK device list WITH pCloudy body', async () => {
    // A bare status code hides the real cause behind "check credentials".
    __resetPcloudyTokenCache();
    globalThis.fetch = async (url) =>
      String(url).endsWith('/api/access')
        ? { ok: true, json: async () => ({ result: { token: 't' } }) }
        : {
            ok: false,
            status: 500,
            text: async () => '{"result":{"error":"session limit reached"}}',
            json: async () => ({}),
          };
    await assert.rejects(
      () =>
        pcloudySpec.catalog.fetchRaw({
          authHeader: 'Basic AAA',
          listUrl: `${DEFAULT_CLOUD_URL}/api/devices`,
        }),
      /returned 500 for android .*session limit reached/s,
    );
  });

  test('an empty 500 body points at the account, not the credentials', async () => {
    // pCloudy 500s with no body when the account is the problem; a BAD TOKEN
    // instead comes back as HTTP 200, so "check credentials" would misdirect.
    __resetPcloudyTokenCache();
    globalThis.fetch = async (url) =>
      String(url).endsWith('/api/access')
        ? { ok: true, json: async () => ({ result: { token: 't' } }) }
        : { ok: false, status: 500, text: async () => '', json: async () => ({}) };
    await assert.rejects(
      () =>
        pcloudySpec.catalog.fetchRaw({
          authHeader: 'Basic AAA',
          listUrl: `${DEFAULT_CLOUD_URL}/api/devices`,
        }),
      /empty body.*remaining device minutes/s,
    );
  });

  test('catalog.fetchRaw treats a 200 carrying result.error as a failure', async () => {
    // pCloudy reports some failures as HTTP 200 with an error in the body.
    __resetPcloudyTokenCache();
    globalThis.fetch = async (url) =>
      String(url).endsWith('/api/access')
        ? { ok: true, json: async () => ({ result: { token: 't' } }) }
        : { ok: true, json: async () => ({ result: { error: 'invalid token' } }) };
    await assert.rejects(
      () =>
        pcloudySpec.catalog.fetchRaw({
          authHeader: 'Basic AAA',
          listUrl: `${DEFAULT_CLOUD_URL}/api/devices`,
        }),
      /device list failed for android: invalid token/,
    );
  });
});

describe('pCloudy cloud URL resolution', () => {
  let saved;
  before(() => {
    saved = process.env[PCLOUDY_CLOUD_URL_ENV];
  });
  after(() => {
    if (saved === undefined) delete process.env[PCLOUDY_CLOUD_URL_ENV];
    else process.env[PCLOUDY_CLOUD_URL_ENV] = saved;
  });

  test('defaults to the public cloud when the env var is unset', () => {
    delete process.env[PCLOUDY_CLOUD_URL_ENV];
    const hub = pcloudySpec.hub({});
    assert.equal(hub.hostname, 'device.pcloudy.com');
    assert.equal(hub.port, 443);
    // pCloudy mounts Appium off the usual path.
    assert.equal(hub.path, '/appiumcloud/wd/hub');
    assert.equal(pcloudySpec.catalog.listUrl(), `${DEFAULT_CLOUD_URL}/api/devices`);
  });

  test('an enterprise tenant URL overrides host and port', () => {
    process.env[PCLOUDY_CLOUD_URL_ENV] = 'https://acme.pcloudy.com:8443';
    const hub = pcloudySpec.hub({});
    assert.equal(hub.hostname, 'acme.pcloudy.com');
    assert.equal(hub.port, 8443);
  });

  test('a bare hostname is upgraded to https', () => {
    process.env[PCLOUDY_CLOUD_URL_ENV] = 'acme.pcloudy.com';
    assert.equal(
      pcloudySpec.upload.endpoint('app.apk'),
      'https://acme.pcloudy.com/api/upload_file',
    );
  });
});
