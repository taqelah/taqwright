import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, basename, relative } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { runSetup } from '../setup/index.js';
import { download } from '../setup/archive.js';
import { spawnTool } from '../setup/spawn-tool.js';

const execP = promisify(exec);

type Platform = 'android' | 'ios';

// The Taqelah demo app — a reference APK so a fresh project's example test
// runs out of the box. A published GitHub Release asset (kept out of the
// npm package, which stays lean — ~58 MB, fetched on demand). `init`
// degrades gracefully if it can't be fetched. The same release also ships
// an iOS build (DemoApp-v1.0.0-ios.app.zip) — not wired yet (Android-only).
const DEMO_APK_FILENAME = 'DemoApp-v1.0.0.apk';
const DEMO_APP_BUNDLE_ID = 'com.taqelah.demo_app';
const DEMO_APK_URL =
  'https://github.com/taqelah/demo-app/releases/download/v1.0.0/DemoApp-v1.0.0.apk';
// Must stay in sync with the AVD name `installAvd()` creates in
// src/setup/install-android.ts (`taqwright install --with-avd`). When the
// demo app is wired, the generated Android project auto-boots this AVD.
const DEMO_AVD_NAME = 'taqwright_api34';

export interface InitOptions {
  testDir?: string;
  platform?: 'android' | 'ios' | 'both';
  install?: boolean;
  yes?: boolean;
  /** Run `taqwright install` (Android toolchain) after scaffolding. */
  installToolchain?: boolean;
  /**
   * Also create a system image + Android emulator (`taqwright install
   * --with-avd`). Only honored when the toolchain is being installed — the AVD
   * lives inside that managed SDK.
   */
  withAvd?: boolean;
  /** Download the demo APK into `app/` so the example test runs immediately. */
  demoApp?: boolean;
}

export async function runInit(argDir: string | undefined, opts: InitOptions = {}): Promise<void> {
  const fullyScripted =
    argDir !== undefined &&
    opts.testDir !== undefined &&
    opts.platform !== undefined &&
    opts.install !== undefined;

  console.log('\ntaqwright init — scaffold a new project\n');

  let targetDir: string;
  let testDir: string;
  let platforms: Platform[];
  let install: boolean;
  let installToolchain: boolean;
  let withAvd: boolean;
  let demoApp: boolean;

  if (fullyScripted) {
    targetDir = resolve(process.cwd(), argDir!);
    if (existsSync(targetDir) && (await isNonEmpty(targetDir)) && !opts.yes) {
      console.error(
        `error: "${targetDir}" is not empty. Re-run with --yes to write into it anyway.`,
      );
      process.exit(1);
    }
    testDir = opts.testDir!;
    platforms = opts.platform === 'both' ? ['android', 'ios'] : [opts.platform as Platform];
    install = opts.install!;
    // Scripted/CI: never auto-download (toolchain ~700 MB; demo app a few
    // MB) unless explicitly opted in — keeps CI deterministic + offline.
    installToolchain = opts.installToolchain ?? false;
    // The emulator lives inside the managed SDK, so it only makes sense when
    // the toolchain installs. Scripted/CI: opt-in only (~1 GB system image).
    withAvd = (opts.withAvd ?? false) && installToolchain;
    demoApp = (opts.demoApp ?? false) && platforms.includes('android');
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const dirInput = argDir ?? (await ask(rl, 'Project location', './taqwright-tests'));
      targetDir = resolve(process.cwd(), dirInput);

      if (existsSync(targetDir) && (await isNonEmpty(targetDir)) && !opts.yes) {
        const proceed = await yesNo(
          rl,
          `Directory "${targetDir}" is not empty — continue and write into it?`,
          false,
        );
        if (!proceed) {
          console.log('aborted.');
          return;
        }
      }

      testDir = opts.testDir ?? (await ask(rl, 'Test folder name', 'tests'));
      const platformInput =
        opts.platform ??
        ((await askChoice(rl, 'Platform', ['android', 'ios', 'both'], 'android')) as
          | 'android'
          | 'ios'
          | 'both');
      platforms = platformInput === 'both' ? ['android', 'ios'] : [platformInput as Platform];
      install = opts.install ?? (await yesNo(rl, 'Run npm install now?', true));
      // Opt-in (default no — it's a ~700 MB download) and only meaningful
      // for Android; `taqwright install` doesn't provision the iOS stack.
      installToolchain =
        opts.installToolchain ??
        (platforms.includes('android')
          ? await yesNo(
              rl,
              'Auto-install the Android toolchain now? (~700 MB: JDK + Android SDK + Appium)',
              false,
            )
          : false);
      // Only meaningful when the toolchain is installing (the emulator lives
      // inside the managed SDK). Default yes — the user already opted into the
      // toolchain, so this completes a bootable setup; the prompt spells out
      // the skip consequence.
      withAvd =
        opts.withAvd ??
        (installToolchain
          ? await yesNo(
              rl,
              'Also create an Android emulator now? (~1 GB: system image + AVD). ' +
                'Skip and no emulator is created — boot the example test on a physical ' +
                'device, or add one later with `taqwright install --with-avd`',
              true,
            )
          : false);
      // Default yes — it's a small APK and makes the example test runnable
      // immediately. Android-only (it's an .apk; no iOS demo build).
      demoApp =
        opts.demoApp ??
        (platforms.includes('android')
          ? await yesNo(
              rl,
              'Download the demo app so the example test runs out of the box? (~few MB)',
              true,
            )
          : false);
    } finally {
      rl.close();
    }
  }
  const projectName = basename(targetDir);

  await mkdir(join(targetDir, testDir), { recursive: true });

  // Fetch the demo APK *before* composing templates so the config +
  // example are only wired to it when it actually landed (a buildPath
  // pointing at a missing file would fail `taqwright test` confusingly).
  let demoAppReady = false;
  if (demoApp) {
    const apkPath = join(targetDir, 'app', DEMO_APK_FILENAME);
    process.stdout.write(`\nDownloading the demo app (${DEMO_APK_FILENAME})… `);
    try {
      await download(DEMO_APK_URL, apkPath);
      demoAppReady = true;
      console.log('done.');
    } catch (err) {
      console.log('failed.');
      console.error(
        `  Could not fetch the demo app (${(err as Error).message}).\n` +
          '  Scaffolding continues — drop an APK in app/ and set buildPath/appBundleId,\n' +
          `  or download it manually from ${DEMO_APK_URL}`,
      );
    }
  }

  const files: Array<[string, string]> = [
    ['package.json', packageJsonTemplate(projectName)],
    ['.npmrc', npmrcTemplate()],
    ['tsconfig.json', tsconfigTemplate(testDir)],
    ['taqwright.config.ts', configTemplate(platforms, testDir, demoAppReady)],
    [join(testDir, 'example.spec.ts'), exampleTestTemplate(demoAppReady)],
    ['.gitignore', gitignoreTemplate()],
  ];

  for (const [rel, content] of files) {
    await writeFile(join(targetDir, rel), content);
  }

  console.log('\nCreated:');
  for (const [rel] of files) {
    console.log('  ' + join(relative(process.cwd(), targetDir) || '.', rel));
  }
  if (demoAppReady) {
    console.log('  ' + join(relative(process.cwd(), targetDir) || '.', 'app', DEMO_APK_FILENAME));
  }

  const cdHint = relative(process.cwd(), targetDir) || '.';

  if (install) {
    const linkedDev = await isTaqwrightGloballyLinked();
    if (linkedDev) {
      console.log(
        '\nDetected globally-linked taqwright — using `npm link @taqwright/taqwright` instead of fetching from the registry.',
      );
      const linkCode = await runNpm(['link', '@taqwright/taqwright'], targetDir);
      if (linkCode !== 0) {
        console.error('npm link @taqwright/taqwright failed.');
        process.exit(linkCode);
      }
    }

    console.log('\nRunning npm install …');
    const code = await runNpm(['install'], targetDir);
    if (code !== 0) {
      console.error(`\nnpm install exited with code ${code}.`);
      if (!linkedDev) {
        console.error(
          '\n@taqwright/taqwright installs from git+ssh://git@github.com/taqelah/taqwright.git,',
        );
        console.error(
          'so a failure here usually means no SSH access to the private taqelah/taqwright repo.',
        );
        console.error('Verify your GitHub SSH key with:  ssh -T git@github.com');
        console.error('To use a local taqwright build instead:');
        console.error('  cd /path/to/taqwright && npm link');
        console.error(`  cd ${cdHint} && npm link @taqwright/taqwright && npm install`);
      }
      process.exit(code);
    }
  }

  let toolchainInstalled = false;
  if (installToolchain && platforms.includes('android')) {
    console.log(
      withAvd
        ? '\nInstalling the Android toolchain + emulator — this can take several minutes…\n'
        : '\nInstalling the Android toolchain — this can take a few minutes…\n',
    );
    try {
      await runSetup({ withAvd });
      toolchainInstalled = true;
    } catch (err) {
      console.error(`\ntaqwright install failed: ${(err as Error).message}`);
      console.error('Scaffolding succeeded; retry the toolchain later with: npx taqwright install');
    }
  } else if (installToolchain && !platforms.includes('android')) {
    console.log(
      '\n(Skipping --install-toolchain: `taqwright install` provisions the Android stack, ' +
        'but this project is iOS-only.)',
    );
  }

  console.log('\nNext steps:');
  console.log(`  cd ${cdHint}`);
  if (!install) console.log('  npm install');
  if (platforms.includes('android') && !toolchainInstalled) {
    console.log(
      '  npx taqwright install --with-avd   # Android toolchain + emulator (JDK + SDK + Appium + AVD); drop --with-avd to skip the ~1 GB emulator',
    );
  } else if (platforms.includes('android') && !withAvd) {
    // Toolchain installed but the emulator was skipped — show how to add one.
    console.log(
      '  npx taqwright install --with-avd   # add an Android emulator (~1 GB), or use a physical device',
    );
  }
  console.log('\nCommands:');
  console.log('  npx taqwright init');
  console.log('  npx taqwright doctor');
  console.log('  npx taqwright codegen');
  console.log('  npx taqwright test');
  console.log('  npx taqwright show-report');
  if (!demoAppReady && platforms.includes('android')) {
    console.log(
      '\nNo demo app was added — the example test is a no-op stub. Drop an APK in\n' +
        'app/ and set buildPath/appBundleId in taqwright.config.ts, or re-run\n' +
        '`npx taqwright init --demo-app` to fetch the demo app.',
    );
  }
  console.log('');
}

// ─── prompt helpers ───────────────────────────────────────────────────

async function ask(
  rl: ReturnType<typeof createInterface>,
  label: string,
  def: string,
): Promise<string> {
  const answer = (await rl.question(`? ${label} (${def}): `)).trim();
  return answer || def;
}

async function askChoice(
  rl: ReturnType<typeof createInterface>,
  label: string,
  choices: string[],
  def: string,
): Promise<string> {
  const list = choices.join('/');
  while (true) {
    const raw = (await rl.question(`? ${label} [${list}]: `)).trim().toLowerCase();
    if (!raw) return def;
    if (choices.includes(raw)) return raw;
    console.log(`  please answer with one of: ${choices.join(', ')}`);
  }
}

async function yesNo(
  rl: ReturnType<typeof createInterface>,
  label: string,
  def: boolean,
): Promise<boolean> {
  const hint = def ? 'Y/n' : 'y/N';
  while (true) {
    const raw = (await rl.question(`? ${label} (${hint}): `)).trim().toLowerCase();
    if (!raw) return def;
    if (['y', 'yes'].includes(raw)) return true;
    if (['n', 'no'].includes(raw)) return false;
    console.log('  please answer y or n');
  }
}

async function isNonEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function runNpm(args: string[], cwd: string): Promise<number> {
  return new Promise((resolve_) => {
    const child = spawnTool('npm', args, { cwd, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (signal) resolve_(128);
      else resolve_(code ?? 0);
    });
    child.on('error', (err) => {
      console.error(`failed to spawn npm ${args.join(' ')}:`, err.message);
      resolve_(1);
    });
  });
}

async function isTaqwrightGloballyLinked(): Promise<boolean> {
  try {
    // exec() always goes through a shell, so `npm` resolves to npm.cmd on Windows.
    const { stdout } = await execP('npm root -g');
    return existsSync(join(stdout.trim(), '@taqwright', 'taqwright'));
  } catch {
    return false;
  }
}

// ─── templates ────────────────────────────────────────────────────────

function packageJsonTemplate(name: string): string {
  const obj = {
    name,
    private: true,
    version: '0.0.1',
    type: 'module',
    scripts: {
      test: 'taqwright test',
      codegen: 'taqwright codegen',
      doctor: 'taqwright doctor',
      devices: 'taqwright devices',
      report: 'taqwright show-report',
    },
    devDependencies: {
      // Temporary (pre-publish): pull taqwright straight from the private repo
      // over SSH so `npm install` needs no GitHub Packages registry/token.
      // Switch to a versioned registry range once @taqwright/taqwright ships.
      '@taqwright/taqwright': 'git+ssh://git@github.com/taqelah/taqwright.git',
      '@types/node': '^24.0.0',
      typescript: '^5.4.0',
    },
    engines: {
      // Taqwright targets the latest Node LTS (24+). Appium itself still
      // accepts 20.19+ / 22.12+, but we keep the engines range tight here
      // so generated projects pin a consistent runtime.
      node: '>=24.0.0',
    },
  };
  return JSON.stringify(obj, null, 2) + '\n';
}

function tsconfigTemplate(testDir: string): string {
  const obj = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      types: ['node'],
    },
    include: [`${testDir}/**/*`, 'taqwright.config.ts'],
  };
  return JSON.stringify(obj, null, 2) + '\n';
}

function configTemplate(platforms: Platform[], testDir: string, demoApp: boolean): string {
  const projects = platforms.map((p) => projectBlock(p, demoApp)).join(',\n');
  return `import { defineConfig, Platform } from '@taqwright/taqwright';

// Every config knob is listed here. Essentials are uncommented; everything
// else is a commented placeholder you can enable by removing the leading
// "// ". Hover any field in your editor for the full type docs.
export default defineConfig({
  testDir: './${testDir}',
  timeout: 60_000,
  expectTimeout: 30_000,
  // 'html' writes playwright-report/ — view it with: npx taqwright show-report
  reporter: [['list'], ['html', { open: 'never', title: 'Taqwright Test Report' }]],

  // ─── Optional top-level overrides ─────────────────────────────────
  // retries: 1,
  // outputDir: './test-results',
  // fullyParallel: false,
  // forbidOnly: !!process.env.CI,
  // testMatch: ['**/*.spec.ts'],
  // testIgnore: ['**/wip/**'],
  // globalSetup: './setup.ts',
  // globalTeardown: './teardown.ts',

  projects: [
${projects},

    // ─── Cloud examples (BrowserStack / LambdaTest) ─────────────────
    // Uncomment a block below to add a cloud project. Set the matching
    // env vars before launching:
    //   BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY
    //   LAMBDATEST_USERNAME    / LAMBDATEST_ACCESS_KEY
    // For now, cloud devices are wired through the inspector
    // ('taqwright inspect'); cloud test-runner support lands separately.
    //
    // {
    //   name: 'browserstack',
    //   use: {
    //     platform: Platform.ANDROID,
    //     device: {
    //       provider: 'browserstack',
    //       name: 'Google Pixel 8',
    //       osVersion: '14.0',
    //       orientation: 'portrait',
    //     },
    //     resetBetweenTests: true,
    //     buildPath: 'bs://<app-id-from-app-upload>',
    //     appBundleId: 'com.example.app',
    //   },
    // },
    // {
    //   name: 'lambdatest',
    //   use: {
    //     platform: Platform.IOS,
    //     device: {
    //       provider: 'lambdatest',
    //       name: 'iPhone 15',
    //       osVersion: '17',
    //     },
    //     resetBetweenTests: true,
    //     buildPath: 'lt://<app-id-from-app-upload>',
    //     appBundleId: 'com.example.MyApp',
    //   },
    // },
  ],
});
`;
}

function projectBlock(p: Platform, demoApp: boolean): string {
  const isAndroid = p === 'android';
  // The "demo wired" path (Android + demo APK downloaded) makes the project
  // turnkey: pin the managed AVD + auto-boot it. Without the demo app the
  // user brings their own app *and* device, so keep the commented
  // placeholders rather than forcing taqwright's AVD on them.
  const demoWired = isAndroid && demoApp;
  const platformConst = isAndroid ? 'Platform.ANDROID' : 'Platform.IOS';
  const projectName = isAndroid ? 'android' : 'ios';
  const deviceNameLine = demoWired
    ? `          name: '${DEMO_AVD_NAME}',          // AVD from \`taqwright install --with-avd\``
    : isAndroid
      ? '          // name: /Pixel/,'
      : '          name: /iPhone/,';
  const autoStartDeviceLine = demoWired
    ? `          autoStartDevice: true,   // cold-boots the ${DEMO_AVD_NAME} AVD`
    : '          // autoStartDevice: true,';
  const exampleUdid = isAndroid ? "'emulator-5554'" : "'00000000-0000-0000-0000-000000000000'";
  const exampleOsVersion = isAndroid ? "'14'" : "'17'";
  const examplePath = isAndroid ? "'/absolute/path/to/app.apk'" : "'/absolute/path/to/MyApp.app'";
  const exampleBundleId = isAndroid ? "'com.example.app'" : "'com.example.MyApp'";
  // When the demo APK was downloaded, wire the Android project to it so
  // `npx taqwright test` works immediately; otherwise leave the usual
  // commented placeholders. iOS always stays commented (no demo build).
  const resetBlock =
    isAndroid && demoApp
      ? `        // ─── Reset between tests ────────────────────────────────────
        // Bound to the bundled demo app (app/${DEMO_APK_FILENAME}).
        // resetBetweenTests reinstalls + relaunches it fresh before every
        // test, so each starts from a known state. All three are
        // type-required together.
        resetBetweenTests: true,
        buildPath: './app/${DEMO_APK_FILENAME}',
        appBundleId: '${DEMO_APP_BUNDLE_ID}',`
      : `        // ─── Reset between tests ────────────────────────────────────
        // Uncomment all three lines below to terminate → uninstall →
        // reinstall → relaunch the app before every test. Required if
        // you want each test to start from a known state. The TS type
        // for use enforces all three together.
        //
        // resetBetweenTests: true,
        // buildPath: ${examplePath},
        // appBundleId: ${exampleBundleId},`;
  return `    {
      name: '${projectName}',
      use: {
        platform: ${platformConst},
        device: {
          provider: 'emulator',
${deviceNameLine}
          // osVersion: ${exampleOsVersion},
          // udid: ${exampleUdid},
          // orientation: 'portrait',
          //
          // ─── Parallel runs (optional) ────────────────────────────
          // Declare a pool of devices to fan tests out across, then
          // bump \`workers\` at the top of this config to match. Worker
          // N picks pool[N]; \`workers > pool.length\` fails fast. Each
          // worker gets its own Appium + driver ports auto-staggered.
          // pool: [
          //   { udid: 'emulator-5554', name: 'Pixel_7_API_34' },
          //   { udid: 'emulator-5556', name: 'Pixel_7_API_34_2' },
          //   { udid: 'emulator-5558', name: 'Pixel_7_API_34_3' },
          // ],
          //
          // Or skip the pool entirely and let taqwright discover local
          // devices and partition them across \`workers\` for you — it
          // cold-boots shutdown AVDs/simulators to reach the count and
          // fails fast if too few are available. Mutually exclusive with
          // \`pool\` / \`udid\`.
          // autoDiscover: true,
        },
        // Spawn \`npx appium\` automatically when nothing is listening on
        // the configured host:port. Set \`autoStart: false\` to manage
        // Appium yourself (e.g. an Appium server you start by hand).
        appium: {
          autoStart: true,
          // Boot an offline Android emulator automatically. Needs a
          // string device.name equal to the AVD id (e.g. 'Pixel_7_API_34',
          // see 'emulator -list-avds'); a RegExp name is rejected at
          // config load. iOS simulators boot via XCUITest regardless.
${autoStartDeviceLine}
          host: 'localhost',
          port: 4723,           // Appium 3 default
          path: '/',            // Appium 3 default (Appium 1.x used '/wd/hub')
          // newCommandTimeout: 240,
          // logLevel: 'warn',
        },

${resetBlock}

        // ─── Extra capabilities (escape hatch) ──────────────────────
        // Anything Appium accepts; merged on top of the auto-built caps.
        // capabilities: {
        //   'appium:autoGrantPermissions': true,
        //   'appium:autoAcceptAlerts': true,
        // },

        // ─── Per-project locator-action timeout (ms) ────────────────
        // Overrides the top-level \`expectTimeout\` for this project only.
        // expectTimeout: 30_000,

        // ─── Trace artifact ─────────────────────────────────────────
        // Captures a per-action screenshot + page-source timeline as a
        // self-contained \`trace.html\` under the test's output dir, also
        // attached to the Playwright HTML report. Adds one screenshot +
        // page-source round-trip per action (~100–300ms local, more
        // over USB) — recommended for CI: 'on-failure'.
        //   'off'                — no overhead (default)
        //   'on'                 — every test
        //   'on-failure'         — only failed tests
        //   'retain-on-failure'  — alias of 'on-failure' on mobile
        // trace: 'on-failure',

        // ─── Screen recording (video) ───────────────────────────────
        // Records the device screen via Appium for the whole run and
        // attaches a screen.mp4 to the Playwright HTML report (as
        // 'taqwright-video'). No per-action cost like trace, but every
        // run pays the device recorder + an mp4 transfer at teardown —
        // recommended for CI: 'on-failure'. iOS-simulator support varies.
        //   'off'                — no recording (default)
        //   'on'                 — every test
        //   'on-failure'         — only failed tests
        //   'retain-on-failure'  — alias of 'on-failure' on mobile
        // video: 'on-failure',

        // ─── Network capture (HAR) ──────────────────────────────────
        // Routes app traffic through a local MITM proxy and attaches a
        // HAR 1.2 file to the Playwright HTML report (as 'taqwright-har').
        // Zero-touch on userdebug Android emulators and iOS Simulators —
        // taqwright generates its own CA, installs it on the device, sets
        // the device/host proxy, and tears everything down on teardown
        // (including crash paths). Cloud projects skip this (the hub
        // captures HAR server-side); real devices and Google Play AVDs
        // are skipped with a note in the artifact.
        //   'off'                — no capture (default)
        //   'on'                 — every test
        //   'on-failure'         — only failed tests
        //   'retain-on-failure'  — alias of 'on-failure' on mobile
        // network: 'on-failure',
      },

      // ─── Per-project test-runner overrides ────────────────────────
      // timeout: 90_000,
      // retries: 2,
      // grep: /smoke/,
      // grepInvert: /flaky/,
      // dependencies: ['setup'],
      // testMatch: ['**/${projectName}/*.spec.ts'],
    }`;
}

function exampleTestTemplate(demoApp: boolean): string {
  if (demoApp) {
    return `import { test, expect } from '@taqwright/taqwright';

// ─── Example tests (demo app) ────────────────────────────────────
// Run against the bundled demo app (app/${DEMO_APK_FILENAME}). The
// config sets resetBetweenTests:true, so taqwright reinstalls +
// relaunches it fresh before each test — every test starts at the
// login screen. \`npx taqwright test\` should pass once a device /
// emulator is up. (Android selectors — the demo app is an APK.)
test('user can log in to the demo app', async ({ mobile }) => {
  await mobile.getByXpath("//*[@hint='Username']").fill('emma@demoapp.com');
  await mobile.getByXpath("//*[@hint='Password']").fill('10203040');
  await mobile.getByUiSelector('new UiSelector().description("Login")').click();
  await expect(mobile.getByUiSelector('new UiSelector().description("View All")')).toBeVisible();
});

test('login fails with invalid username & password', async ({ mobile }) => {
  await mobile.getByXpath("//*[@hint='Username']").fill('invalidusername');
  await mobile.getByXpath("//*[@hint='Password']").fill('invalidpassword');
  await mobile.getByUiSelector('new UiSelector().description("Login")').click();
  await expect(mobile.getByXpath("//*[contains(@content-desc, 'Invalid username or password.')]")).toBeVisible();
});

test('login is blocked without username & password', async ({ mobile }) => {
  await mobile.getByUiSelector('new UiSelector().description("Login")').click();
  await expect(mobile.getByUiSelector('new UiSelector().description("Please enter your username")')).toBeVisible();
  await expect(mobile.getByUiSelector('new UiSelector().description("Please enter your password")')).toBeVisible();
});
`;
  }
  return `import { test, expect } from '@taqwright/taqwright';

// ─── First test ──────────────────────────────────────────────────
// Runs without an app installed — just confirms the device + Appium
// stack is wired up. Fill in your own \`buildPath\` + \`appBundleId\`
// in taqwright.config.ts then write a real test below.
test('screen has positive dimensions', async ({ mobile }) => {
  const size = await mobile.getScreenSize();
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
});

// ─── Realistic-shape example (commented) ─────────────────────────
// Uncomment after pointing the config at your app. Showcases the
// idiomatic taqwright surface:
//
//   * Locator entry points: getById / getByText / getByLabel / getByRole / ...
//   * Chain methods:        .first() / .nth(i) / .filter({ hasText }) / .locator(child) / .all()
//   * Auto-retrying matchers (Playwright-style) on a Locator:
//                           await expect(loc).toBeVisible() / .toHaveText() / .toBeChecked() / .toHaveCount(n) / ...
//   * Plain \`expect(value)\` (no await) for numbers, strings, arrays.
//
// test('login flow', async ({ mobile }) => {
//   await mobile.getById('Username').fill('demo@example.com');
//   await mobile.getById('Password').fill('hunter2');
//   await mobile.getByRole('button', { name: 'Sign in' }).click();
//
//   // Auto-waits up to expectTimeout for the heading to appear.
//   await expect(mobile.getByText('Welcome')).toBeVisible();
//
//   // Chain — disambiguate the 3rd row in a repeating list.
//   await mobile.getByType('XCUIElementTypeCell').nth(2).click();
//
//   // Filter — pick the Wi-Fi row by its label, then tap its switch.
//   await mobile.getByType('android.widget.LinearLayout')
//     .filter({ hasText: 'Wi-Fi' })
//     .locator(mobile.getByType('android.widget.Switch'))
//     .check();
//
//   // Plain-value expect — for non-Locator data.
//   const items = await mobile.getByType('CartItem').all();
//   expect(items).toHaveLength(3);
// });

// ─── Pause for interactive debugging (commented) ─────────────────
// Drop this anywhere in a test to hand off to the inspector. The
// in-flight WebDriver session is attached (no new Appium boot), the
// inspector opens in your browser, and the test resumes when you
// click "Resume" in the UI. Set \`PWDEBUG=0\` in CI to make it a
// no-op without removing the call.
//
// test('paused for inspection', async ({ mobile }) => {
//   await mobile.getById('Login').click();
//   await mobile.pause();      // ← browser opens; click around; click Resume
//   await expect(mobile.getByText('Dashboard')).toBeVisible();
// });
`;
}

function gitignoreTemplate(): string {
  return `node_modules
dist
test-results
playwright-report
.DS_Store
*.log
`;
}

function npmrcTemplate(): string {
  return `@taqwright:registry=https://npm.pkg.github.com
# Auth: GitHub Packages needs a Personal Access Token with read:packages.
# Don't commit the token — put it in your user ~/.npmrc or a CI env var, e.g.:
#   //npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}
`;
}
