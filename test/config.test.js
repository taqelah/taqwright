// Unit tests for src/config.ts `defineConfig` — specifically the
// `outputDir` config property wiring (compiled artifact).
//
// `defineConfig` is pure: it maps a TaqwrightConfig onto a Playwright
// TestConfig, stashing the original under TAQWRIGHT_KEY. `outputDir`
// forwarding IS the contract, so these assertions are exact.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defineConfig,
  findParallelMisconfig,
  findAutoStartDeviceMisconfig,
  findAutoDiscoverMisconfig,
  effectiveWorkers,
  resolveCliWorkers,
  withReportDir,
  TAQWRIGHT_REPORT_DIR,
  TAQWRIGHT_KEY,
} from '../dist/config.js';
import { buildCapabilities } from '../dist/capabilities.js';
import { Platform } from '../dist/types/index.js';

// Minimal valid config — defineConfig throws without >=1 project. Shallow
// merge so a case can override top-level fields or replace `projects`.
function mkConfig(overrides = {}) {
  return {
    projects: [
      {
        name: 'android',
        use: { platform: Platform.ANDROID, device: { provider: 'emulator' } },
      },
    ],
    ...overrides,
  };
}

describe('withReportDir — html reporter outputFolder', () => {
  test('bare "html" string → tuple with our outputFolder', () => {
    assert.deepEqual(withReportDir('html'), ['html', { outputFolder: TAQWRIGHT_REPORT_DIR }]);
  });

  test('["html", opts] without outputFolder → injected, opts preserved', () => {
    assert.deepEqual(withReportDir(['html', { open: 'never' }]), [
      'html',
      { open: 'never', outputFolder: TAQWRIGHT_REPORT_DIR },
    ]);
  });

  test('explicit outputFolder is respected (untouched)', () => {
    assert.deepEqual(withReportDir(['html', { outputFolder: 'custom' }]), [
      'html',
      { outputFolder: 'custom' },
    ]);
  });

  test('list form: html entry gets injected, non-html left alone', () => {
    assert.deepEqual(withReportDir([['list'], ['html', { open: 'never' }]]), [
      ['list'],
      ['html', { open: 'never', outputFolder: TAQWRIGHT_REPORT_DIR }],
    ]);
  });

  test('undefined reporter is passed through', () => {
    assert.equal(withReportDir(undefined), undefined);
  });

  test('defineConfig injects the report dir into the html reporter', () => {
    const pw = defineConfig(mkConfig({ reporter: [['list'], ['html', { open: 'never' }]] }));
    assert.deepEqual(pw.reporter, [
      ['list'],
      ['html', { open: 'never', outputFolder: TAQWRIGHT_REPORT_DIR }],
    ]);
  });
});

describe('defineConfig — outputDir', () => {
  test('top-level outputDir is forwarded onto the Playwright config', () => {
    const pw = defineConfig(mkConfig({ outputDir: './test-results' }));
    assert.equal(pw.outputDir, './test-results');
  });

  test('omitted outputDir → undefined (no defaulting)', () => {
    const pw = defineConfig(mkConfig());
    assert.equal(pw.outputDir, undefined);
  });

  test('per-project outputDir is forwarded onto each Playwright project', () => {
    const pw = defineConfig(
      mkConfig({
        projects: [
          {
            name: 'with',
            outputDir: './proj-out',
            use: { platform: Platform.ANDROID, device: { provider: 'emulator' } },
          },
          {
            name: 'without',
            use: { platform: Platform.IOS, device: { provider: 'emulator' } },
          },
        ],
      }),
    );
    assert.equal(pw.projects[0].outputDir, './proj-out');
    assert.equal(pw.projects[1].outputDir, undefined);
  });

  test('top-level and per-project outputDir are independent', () => {
    const pw = defineConfig(
      mkConfig({
        outputDir: './top',
        projects: [
          {
            name: 'override',
            outputDir: './proj',
            use: { platform: Platform.ANDROID, device: { provider: 'emulator' } },
          },
          {
            name: 'inherit',
            use: { platform: Platform.IOS, device: { provider: 'emulator' } },
          },
        ],
      }),
    );
    assert.equal(pw.outputDir, './top');
    assert.equal(pw.projects[0].outputDir, './proj');
    assert.equal(pw.projects[1].outputDir, undefined);
  });

  test('outputDir does not leak into the per-project `use` block', () => {
    const pw = defineConfig(mkConfig({ outputDir: './test-results' }));
    // The embedding trick: `use` carries ONLY the project name; the real
    // use-options (and outputDir) are re-read from the stashed config.
    assert.deepEqual(pw.projects[0].use, { taqwrightProject: 'android' });
  });

  test('embedded taqwright config (TAQWRIGHT_KEY) retains outputDir', () => {
    const pw = defineConfig(mkConfig({ outputDir: './test-results' }));
    assert.equal(pw[TAQWRIGHT_KEY].outputDir, './test-results');
  });
});

// Helper: a project with a given device config.
function proj(name, device, platform = Platform.ANDROID) {
  return { name, use: { platform, device } };
}

describe('defineConfig — parallel/pool validation', () => {
  // ── safe: serial / no workers ──────────────────────────────────
  test('workers unset + no pool → ok', () => {
    assert.equal(findParallelMisconfig(mkConfig()), null);
    assert.doesNotThrow(() => defineConfig(mkConfig()));
  });

  test('workers: 1 + no pool → ok', () => {
    assert.equal(findParallelMisconfig(mkConfig({ workers: 1 })), null);
    assert.doesNotThrow(() => defineConfig(mkConfig({ workers: 1 })));
  });

  test('workers: 0 → treated as safe (no double-booking possible)', () => {
    assert.equal(findParallelMisconfig(mkConfig({ workers: 0 })), null);
  });

  // ── offending: emulator, no pool ───────────────────────────────
  test('workers: 2 + emulator + no pool → throws (no pool)', () => {
    assert.throws(
      () => defineConfig(mkConfig({ workers: 2 })),
      /taqwright: .*`workers` is 2 .*no `device\.pool`/s,
    );
    const msg = findParallelMisconfig(mkConfig({ workers: 2 }));
    assert.match(msg, /project "android"/);
    assert.match(msg, /provider: emulator/);
  });

  // ── offending: under-sized pool ────────────────────────────────
  test('workers: 3 + emulator + pool len 2 → throws (under-sized)', () => {
    const cfg = mkConfig({
      workers: 3,
      projects: [
        proj('android', {
          provider: 'emulator',
          pool: [{ udid: 'emulator-5554' }, { udid: 'emulator-5556' }],
        }),
      ],
    });
    assert.throws(() => defineConfig(cfg), /only 2 entries\. Grow it to at least 3/s);
  });

  // ── safe: pool exactly meets workers ───────────────────────────
  test('workers: 2 + emulator + pool len 2 → ok', () => {
    const cfg = mkConfig({
      workers: 2,
      projects: [
        proj('android', {
          provider: 'emulator',
          pool: [{ udid: 'emulator-5554' }, { udid: 'emulator-5556' }],
        }),
      ],
    });
    assert.equal(findParallelMisconfig(cfg), null);
    assert.doesNotThrow(() => defineConfig(cfg));
  });

  // ── local-device behaves like emulator ─────────────────────────
  test('workers: 2 + local-device + no pool → throws', () => {
    const cfg = mkConfig({
      workers: 2,
      projects: [proj('real-phone', { provider: 'local-device' })],
    });
    assert.throws(() => defineConfig(cfg), /provider: local-device/);
  });

  // ── cloud is excluded (documents scope) ────────────────────────
  test('workers: 2 + browserstack-only → ok (cloud excluded)', () => {
    const cfg = mkConfig({
      workers: 2,
      projects: [
        proj('bs', {
          provider: 'browserstack',
          name: 'Pixel 7',
          osVersion: '13.0',
        }),
      ],
    });
    assert.equal(findParallelMisconfig(cfg), null);
    assert.doesNotThrow(() => defineConfig(cfg));
  });

  // ── mixed: one ok, one bad → throws naming only the bad one ────
  test('workers: 2 + two projects (one good pool, one no pool) → names bad only', () => {
    const cfg = mkConfig({
      workers: 2,
      projects: [
        proj('good', {
          provider: 'emulator',
          pool: [{ udid: 'emulator-5554' }, { udid: 'emulator-5556' }],
        }),
        proj('bad', { provider: 'emulator' }, Platform.IOS),
      ],
    });
    const msg = findParallelMisconfig(cfg);
    assert.match(msg, /project "bad"/);
    assert.doesNotMatch(msg, /project "good"/);
    assert.throws(() => defineConfig(cfg), /project "bad"/);
  });

  // ── message voice matches the runtime fixture guard ────────────
  test('error message uses the `taqwright:` prefix', () => {
    const msg = findParallelMisconfig(mkConfig({ workers: 2 }));
    assert.ok(msg.startsWith('taqwright: '));
  });
});

// A 2-entry emulator pool — enough for `workers: 2`.
const POOL2 = [{ udid: 'emulator-5554' }, { udid: 'emulator-5556' }];

describe('effectiveWorkers — precedence', () => {
  const cfg = { workers: 4, projects: [] };
  test('project.workers wins over config.workers', () => {
    assert.equal(effectiveWorkers({ name: 'a', workers: 2 }, cfg), 2);
  });
  test('falls back to config.workers when project omits it', () => {
    assert.equal(effectiveWorkers({ name: 'a' }, cfg), 4);
  });
  test('falls back to 1 when neither is set', () => {
    assert.equal(effectiveWorkers({ name: 'a' }, { projects: [] }), 1);
  });
});

describe('defineConfig — global workers = max(effectiveWorkers)', () => {
  test('single project.workers sizes the global pool', () => {
    const pw = defineConfig(
      mkConfig({
        projects: [
          {
            name: 'android',
            workers: 2,
            use: { platform: Platform.ANDROID, device: { provider: 'emulator', pool: POOL2 } },
          },
        ],
      }),
    );
    assert.equal(pw.workers, 2);
  });

  test('global pool = the max across projects', () => {
    const pw = defineConfig(
      mkConfig({
        projects: [
          {
            name: 'a',
            workers: 2,
            use: { platform: Platform.ANDROID, device: { provider: 'emulator', pool: POOL2 } },
          },
          {
            name: 'b',
            workers: 3,
            use: {
              platform: Platform.IOS,
              device: { provider: 'browserstack', name: 'iPhone 15', osVersion: '17' },
            },
          },
        ],
      }),
    );
    assert.equal(pw.workers, 3);
  });

  test('project without workers falls back to top-level for the cap', () => {
    const pw = defineConfig(
      mkConfig({
        workers: 2,
        projects: [proj('android', { provider: 'emulator', pool: POOL2 })],
      }),
    );
    assert.equal(pw.workers, 2);
  });

  test('no workers anywhere → 1', () => {
    assert.equal(defineConfig(mkConfig()).workers, 1);
  });
});

describe('findParallelMisconfig — per-project workers', () => {
  test('project.workers validated against its own pool (throws naming it)', () => {
    const cfg = mkConfig({
      projects: [
        {
          name: 'short',
          workers: 3,
          use: { platform: Platform.ANDROID, device: { provider: 'emulator', pool: POOL2 } },
        },
      ],
    });
    const msg = findParallelMisconfig(cfg);
    assert.match(msg, /project "short"/);
    assert.match(msg, /only 2 entr/);
    assert.throws(() => defineConfig(cfg), /project "short"/);
  });

  test('sibling project with workers: 1 + no pool is exempt', () => {
    const cfg = mkConfig({
      projects: [
        {
          name: 'parallel',
          workers: 2,
          use: { platform: Platform.ANDROID, device: { provider: 'emulator', pool: POOL2 } },
        },
        {
          name: 'serial',
          workers: 1,
          use: { platform: Platform.IOS, device: { provider: 'emulator' } },
        },
      ],
    });
    assert.equal(findParallelMisconfig(cfg), null);
    assert.doesNotThrow(() => defineConfig(cfg));
  });

  test('project.workers: 2 + no pool throws even when top-level is 1 (stricter)', () => {
    const cfg = mkConfig({
      workers: 1,
      projects: [
        {
          name: 'android',
          workers: 2,
          use: { platform: Platform.ANDROID, device: { provider: 'emulator' } },
        },
      ],
    });
    assert.throws(() => defineConfig(cfg), /project "android"/);
  });

  test('top-level workers: 3 but project.workers: 1 → that project exempt', () => {
    const cfg = mkConfig({
      workers: 3,
      projects: [
        {
          name: 'android',
          workers: 1,
          use: { platform: Platform.ANDROID, device: { provider: 'emulator' } },
        },
      ],
    });
    assert.equal(findParallelMisconfig(cfg), null);
  });
});

describe('resolveCliWorkers', () => {
  const cfg = {
    workers: 1,
    projects: [
      {
        name: 'a',
        workers: 2,
        use: { platform: Platform.ANDROID, device: { provider: 'emulator', pool: POOL2 } },
      },
      {
        name: 'b',
        workers: 3,
        use: {
          platform: Platform.IOS,
          device: { provider: 'browserstack', name: 'iPhone 15', osVersion: '17' },
        },
      },
    ],
  };

  test('single --project → that project workers', () => {
    assert.equal(resolveCliWorkers(cfg, ['a']), 2);
    assert.equal(resolveCliWorkers(cfg, ['b']), 3);
  });

  test('no filter + single-project config → its workers', () => {
    const one = {
      projects: [
        {
          name: 'only',
          workers: 4,
          use: { platform: Platform.ANDROID, device: { provider: 'emulator' } },
        },
      ],
    };
    assert.equal(resolveCliWorkers(one, []), 4);
  });

  test('ambiguous (no filter, multiple projects) → undefined', () => {
    assert.equal(resolveCliWorkers(cfg, []), undefined);
  });

  test('multiple --project values → undefined', () => {
    assert.equal(resolveCliWorkers(cfg, ['a', 'b']), undefined);
  });

  test('unknown --project name → undefined', () => {
    assert.equal(resolveCliWorkers(cfg, ['nope']), undefined);
  });

  test('explicit user --workers wins (string parsed)', () => {
    assert.equal(resolveCliWorkers(cfg, ['a'], '5'), 5);
    assert.equal(resolveCliWorkers(cfg, [], '8'), 8);
  });

  test('unparseable user --workers → undefined', () => {
    assert.equal(resolveCliWorkers(cfg, ['a'], 'abc'), undefined);
  });

  test('project falling back to top-level workers', () => {
    const fb = {
      workers: 2,
      projects: [
        {
          name: 'a',
          use: { platform: Platform.ANDROID, device: { provider: 'emulator', pool: POOL2 } },
        },
      ],
    };
    assert.equal(resolveCliWorkers(fb, ['a']), 2);
  });
});

// Helper: a project with explicit platform/device + appium.autoStartDevice.
function asdProj(name, { platform = Platform.ANDROID, device, autoStartDevice = true }) {
  return { name, use: { platform, device, appium: { autoStartDevice } } };
}

describe('defineConfig — autoStartDevice validation', () => {
  test('android emulator + flag + RegExp name → throws (names project)', () => {
    const cfg = mkConfig({
      projects: [asdProj('android', { device: { provider: 'emulator', name: /Pixel/ } })],
    });
    assert.throws(() => defineConfig(cfg), /autoStartDevice needs a/);
    const msg = findAutoStartDeviceMisconfig(cfg);
    assert.ok(msg.startsWith('taqwright: '));
    assert.match(msg, /project "android"/);
  });

  test('android emulator + flag + no name → throws', () => {
    const cfg = mkConfig({
      projects: [asdProj('a', { device: { provider: 'emulator' } })],
    });
    assert.throws(() => defineConfig(cfg), /no concrete AVD name/);
  });

  test('android emulator + flag + pool entry missing name → throws', () => {
    const cfg = mkConfig({
      projects: [
        asdProj('a', {
          device: {
            provider: 'emulator',
            name: 'Pixel_7_API_34',
            pool: [{ udid: 'emulator-5554', name: 'Pixel_7_API_34' }, { udid: 'emulator-5556' }],
          },
        }),
      ],
    });
    assert.throws(() => defineConfig(cfg), /every .device\.pool. entry/);
  });

  test('android emulator + flag + string name → ok', () => {
    const cfg = mkConfig({
      projects: [asdProj('a', { device: { provider: 'emulator', name: 'Pixel_7_API_34' } })],
    });
    assert.equal(findAutoStartDeviceMisconfig(cfg), null);
    assert.doesNotThrow(() => defineConfig(cfg));
  });

  test('android emulator + flag + pool all string names → ok', () => {
    const cfg = mkConfig({
      projects: [
        asdProj('a', {
          device: {
            provider: 'emulator',
            pool: [
              { udid: 'emulator-5554', name: 'P1' },
              { udid: 'emulator-5556', name: 'P2' },
            ],
          },
        }),
      ],
    });
    assert.equal(findAutoStartDeviceMisconfig(cfg), null);
  });

  test('iOS emulator + flag + RegExp name → ok (XCUITest auto-boots; not gated)', () => {
    const cfg = mkConfig({
      projects: [
        asdProj('ios', {
          platform: Platform.IOS,
          device: { provider: 'emulator', name: /iPhone/ },
        }),
      ],
    });
    assert.equal(findAutoStartDeviceMisconfig(cfg), null);
    assert.doesNotThrow(() => defineConfig(cfg));
  });

  test('local-device + flag + RegExp name → ok (real phone, no-op)', () => {
    const cfg = mkConfig({
      projects: [asdProj('phone', { device: { provider: 'local-device', name: /Pixel/ } })],
    });
    assert.equal(findAutoStartDeviceMisconfig(cfg), null);
  });

  test('flag unset → ok (regression)', () => {
    assert.equal(findAutoStartDeviceMisconfig(mkConfig()), null);
  });

  test('two android projects (one regex-bad, one string-ok) → names only the bad one', () => {
    const cfg = mkConfig({
      projects: [
        asdProj('bad', { device: { provider: 'emulator', name: /Pixel/ } }),
        asdProj('good', { device: { provider: 'emulator', name: 'Pixel_10_Pro_XL' } }),
      ],
    });
    const msg = findAutoStartDeviceMisconfig(cfg);
    assert.match(msg, /project "bad"/);
    assert.doesNotMatch(msg, /project "good"/);
    assert.throws(() => defineConfig(cfg), /project "bad"/);
  });

  test('shipped sample shape: workers:3 + 3-entry string-name pool + flag → both guards pass', () => {
    const cfg = mkConfig({
      workers: 3,
      fullyParallel: true,
      projects: [
        {
          name: 'android',
          use: {
            platform: Platform.ANDROID,
            device: {
              provider: 'emulator',
              pool: [
                { udid: 'emulator-5554', name: 'Pixel_10_Pro_XL' },
                { udid: 'emulator-5556', name: 'Pixel_10_Pro_XL_2' },
                { udid: 'emulator-5558', name: 'Pixel_10_Pro_XL_3' },
              ],
            },
            appium: { autoStartDevice: true },
          },
        },
      ],
    });
    // findParallelMisconfig (pool.length 3 >= workers 3) AND
    // findAutoStartDeviceMisconfig (all pool entries string-named) pass.
    assert.equal(findParallelMisconfig(cfg), null);
    assert.equal(findAutoStartDeviceMisconfig(cfg), null);
    assert.doesNotThrow(() => defineConfig(cfg));
  });
});

describe('defineConfig — autoDiscover validation', () => {
  const adProj = (name, device, platform = Platform.ANDROID) => ({
    name,
    use: { platform, device },
  });

  test('android emulator + autoDiscover alone → ok', () => {
    const cfg = mkConfig({
      workers: 2,
      projects: [adProj('android', { provider: 'emulator', autoDiscover: true })],
    });
    assert.equal(findAutoDiscoverMisconfig(cfg), null);
    assert.doesNotThrow(() => defineConfig(cfg));
  });

  test('exempts the project from findParallelMisconfig (no pool needed)', () => {
    const cfg = mkConfig({
      workers: 3,
      projects: [adProj('android', { provider: 'emulator', autoDiscover: true })],
    });
    assert.equal(findParallelMisconfig(cfg), null);
  });

  test('exempts from findAutoStartDeviceMisconfig (AVD names resolved at runtime)', () => {
    const cfg = mkConfig({
      projects: [
        {
          name: 'android',
          use: {
            platform: Platform.ANDROID,
            device: { provider: 'emulator', autoDiscover: true },
            appium: { autoStartDevice: true },
          },
        },
      ],
    });
    assert.equal(findAutoStartDeviceMisconfig(cfg), null);
  });

  test('autoDiscover + pool → throws (mutually exclusive)', () => {
    const cfg = mkConfig({
      projects: [
        adProj('android', {
          provider: 'emulator',
          autoDiscover: true,
          pool: [{ udid: 'emulator-5554' }],
        }),
      ],
    });
    assert.throws(() => defineConfig(cfg), /mutually exclusive with `device\.pool`/);
  });

  test('autoDiscover + udid → throws (mutually exclusive)', () => {
    const cfg = mkConfig({
      projects: [adProj('android', { provider: 'emulator', autoDiscover: true, udid: 'x' })],
    });
    assert.throws(() => defineConfig(cfg), /mutually exclusive with `device\.udid`/);
  });

  test('autoDiscover on a cloud provider → throws', () => {
    const cfg = mkConfig({
      projects: [
        adProj('bs', {
          provider: 'browserstack',
          name: 'Pixel 7',
          osVersion: '13.0',
          autoDiscover: true,
        }),
      ],
    });
    assert.throws(() => defineConfig(cfg), /Auto-discovery is for local/);
  });

  test('autoDiscover on local-device + iOS → throws (v1 unsupported)', () => {
    const cfg = mkConfig({
      projects: [adProj('iphone', { provider: 'local-device', autoDiscover: true }, Platform.IOS)],
    });
    assert.throws(() => defineConfig(cfg), /not yet.*supported for local-device \+ iOS/s);
  });

  test('autoDiscover + emulator + autoStartDevice:false → throws', () => {
    const cfg = mkConfig({
      projects: [
        {
          name: 'android',
          use: {
            platform: Platform.ANDROID,
            device: { provider: 'emulator', autoDiscover: true },
            appium: { autoStartDevice: false },
          },
        },
      ],
    });
    assert.throws(() => defineConfig(cfg), /needs `appium\.autoStartDevice`/);
  });

  test('no autoDiscover anywhere → ok (regression) and no globalSetup injected', () => {
    assert.equal(findAutoDiscoverMisconfig(mkConfig()), null);
    const pw = defineConfig(mkConfig());
    assert.equal(pw.globalSetup, undefined);
  });

  test('injects the internal globalSetup when a project opts in', () => {
    const pw = defineConfig(
      mkConfig({
        workers: 2,
        projects: [adProj('android', { provider: 'emulator', autoDiscover: true })],
      }),
    );
    assert.ok(Array.isArray(pw.globalSetup));
    assert.match(pw.globalSetup[0], /discovery-setup\.js$/);
  });

  test('prepends the internal globalSetup before the user-supplied one', () => {
    const pw = defineConfig(
      mkConfig({
        workers: 2,
        globalSetup: './my-setup.js',
        projects: [adProj('android', { provider: 'emulator', autoDiscover: true })],
      }),
    );
    assert.match(pw.globalSetup[0], /discovery-setup\.js$/);
    assert.equal(pw.globalSetup[1], './my-setup.js');
  });
});

describe('buildCapabilities — autoStartDevice', () => {
  const androidEmu = (extra = {}) => ({
    platform: Platform.ANDROID,
    device: { provider: 'emulator', name: 'Pixel_7_API_34', ...extra },
    appium: { autoStartDevice: true },
  });

  test('android emulator + string name + flag → appium:avd + timeouts', () => {
    const c = buildCapabilities(androidEmu());
    assert.equal(c['appium:avd'], 'Pixel_7_API_34');
    assert.equal(c['appium:avdLaunchTimeout'], 120000);
    assert.equal(c['appium:avdReadyTimeout'], 120000);
  });

  test('+ device.udid → appium:udid dropped, appium:avd kept', () => {
    const c = buildCapabilities(androidEmu({ udid: 'emulator-5554' }));
    assert.equal('appium:udid' in c, false);
    assert.equal(c['appium:avd'], 'Pixel_7_API_34');
  });

  test('user capabilities appium:udid wins (escape hatch)', () => {
    const u = androidEmu({ udid: 'emulator-5554' });
    u.capabilities = { 'appium:udid': 'emulator-9999' };
    const c = buildCapabilities(u);
    assert.equal(c['appium:udid'], 'emulator-9999');
  });

  test('user appium:avdReadyTimeout not overridden', () => {
    const u = androidEmu();
    u.capabilities = { 'appium:avdReadyTimeout': 300000 };
    assert.equal(buildCapabilities(u)['appium:avdReadyTimeout'], 300000);
  });

  test('RegExp name + flag → no appium:avd (pure fn never throws)', () => {
    const c = buildCapabilities({
      platform: Platform.ANDROID,
      device: { provider: 'emulator', name: /Pixel/ },
      appium: { autoStartDevice: true },
    });
    assert.equal('appium:avd' in c, false);
  });

  test('flag off (explicit false) → no appium:avd (regression)', () => {
    // autoStartDevice defaults ON, so "off" must be an explicit `false` —
    // absence is opt-in, not opt-out.
    const c = buildCapabilities({
      platform: Platform.ANDROID,
      device: { provider: 'emulator', name: 'Pixel_7_API_34' },
      appium: { autoStartDevice: false },
    });
    assert.equal('appium:avd' in c, false);
  });

  test('flag default (no appium block) → avd is set (default-on)', () => {
    const c = buildCapabilities({
      platform: Platform.ANDROID,
      device: { provider: 'emulator', name: 'Pixel_7_API_34' },
    });
    assert.equal(c['appium:avd'], 'Pixel_7_API_34');
  });

  test('android local-device + flag → no appium:avd (real phone)', () => {
    const c = buildCapabilities({
      platform: Platform.ANDROID,
      device: { provider: 'local-device', name: 'Pixel_7_API_34' },
      appium: { autoStartDevice: true },
    });
    assert.equal('appium:avd' in c, false);
  });

  test('iOS emulator + flag → no appium:avd, simulatorStartupTimeout set', () => {
    const c = buildCapabilities({
      platform: Platform.IOS,
      device: { provider: 'emulator', name: 'iPhone 15', osVersion: '17.5' },
      appium: { autoStartDevice: true },
    });
    assert.equal('appium:avd' in c, false);
    assert.equal(c['appium:simulatorStartupTimeout'], 120000);
  });

  test('iOS emulator flag off (explicit false) → no simulatorStartupTimeout', () => {
    const c = buildCapabilities({
      platform: Platform.IOS,
      device: { provider: 'emulator', name: 'iPhone 15' },
      appium: { autoStartDevice: false },
    });
    assert.equal('appium:simulatorStartupTimeout' in c, false);
  });

  test('iOS emulator flag default (no appium block) → simulatorStartupTimeout set', () => {
    const c = buildCapabilities({
      platform: Platform.IOS,
      device: { provider: 'emulator', name: 'iPhone 15' },
    });
    assert.equal(c['appium:simulatorStartupTimeout'], 120000);
  });

  test('iOS → appium:forceSimulatorSoftwareKeyboardPresence true by default', () => {
    const c = buildCapabilities({
      platform: Platform.IOS,
      device: { provider: 'emulator', name: 'iPhone 15' },
    });
    assert.equal(c['appium:forceSimulatorSoftwareKeyboardPresence'], true);
  });

  test('Android → forceSimulatorSoftwareKeyboardPresence not set', () => {
    const c = buildCapabilities({
      platform: Platform.ANDROID,
      device: { provider: 'emulator', name: 'Pixel_7_API_34' },
    });
    assert.equal('appium:forceSimulatorSoftwareKeyboardPresence' in c, false);
  });

  test('iOS + user override → user value wins', () => {
    const c = buildCapabilities({
      platform: Platform.IOS,
      device: { provider: 'emulator', name: 'iPhone 15' },
      capabilities: { 'appium:forceSimulatorSoftwareKeyboardPresence': false },
    });
    assert.equal(c['appium:forceSimulatorSoftwareKeyboardPresence'], false);
  });

  test('pool-partitioned worker shape (slot name + slot udid) → avd from name, udid dropped', () => {
    // Mirrors what the taqwrightUse worker fixture hands buildCapabilities
    // for pool[1]: device.name = slot.name, device.udid = slot.udid. This
    // is exactly the 3-emulator e2e path — pin it as a unit regression.
    const c = buildCapabilities({
      platform: Platform.ANDROID,
      device: {
        provider: 'emulator',
        name: 'Pixel_10_Pro_XL_2', // slot.name (string AVD id)
        udid: 'emulator-5556', // slot.udid — doesn't exist pre-boot
      },
      appium: { autoStartDevice: true },
    });
    assert.equal(c['appium:avd'], 'Pixel_10_Pro_XL_2');
    assert.equal('appium:udid' in c, false);
    assert.equal(c['appium:avdLaunchTimeout'], 120000);
    assert.equal(c['appium:avdReadyTimeout'], 120000);
  });
});
