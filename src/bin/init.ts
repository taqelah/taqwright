import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync, lstatSync, statSync } from 'node:fs';
import { resolve, join, basename, relative, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { runSetup } from '../setup/index.js';
import { download } from '../setup/archive.js';
import { spawnTool } from '../setup/spawn-tool.js';
import { detectAndroidToolchain, listAvds, type AndroidToolchainStatus } from '../doctor.js';

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
  const scripted =
    argDir !== undefined &&
    opts.testDir !== undefined &&
    opts.platform !== undefined &&
    opts.install !== undefined;
  // Only prompt when there's a real TTY and the run isn't already fully
  // specified by flags. No TTY (CI, piped stdin) → resolve everything from
  // flags + their documented defaults rather than hang on readline or
  // silently take a default mid-prompt. Partial flags + a TTY still prompt.
  const interactive = Boolean(stdin.isTTY) && !scripted;
  // iOS local testing needs macOS (Xcode + simulators), so off-Mac we only offer
  // Android and reject a requested iOS/both — see platformChoices/platformSupportError.
  const isMac = process.platform === 'darwin';

  console.log('\ntaqwright init — scaffold a new project\n');

  let targetDir: string;
  let testDir: string;
  let platforms: Platform[];
  let install: boolean;
  let installToolchain: boolean;
  let withAvd: boolean;
  let demoApp: boolean;
  // Set (interactive, Android) when we point the sample config at the user's own
  // AVD instead of the managed one. undefined → keep the commented placeholder.
  let deviceAvdName: string | undefined;
  // The toolchain probe result (interactive, Android); undefined otherwise. Read
  // by the post-scaffold guidance so it respects a detected toolchain / AVD.
  let detected: AndroidToolchainStatus | undefined;

  if (!interactive) {
    const dirInput = argDir ?? './taqwright-tests';
    targetDir = resolve(process.cwd(), dirInput);
    const locErr = projectLocationError(targetDir);
    if (locErr) {
      console.error(`error: ${locErr}.`);
      process.exit(1);
    }
    if (existsSync(targetDir) && (await isNonEmpty(targetDir)) && !opts.yes) {
      console.error(
        `error: "${targetDir}" is not empty. Re-run with --yes to write into it anyway.`,
      );
      process.exit(1);
    }
    testDir = opts.testDir ?? 'tests';
    if (!isValidTestDir(testDir)) {
      console.error(`error: invalid --test-dir "${testDir}" — ${TEST_DIR_HINT}.`);
      process.exit(1);
    }
    platforms =
      opts.platform === 'both' ? ['android', 'ios'] : [(opts.platform ?? 'android') as Platform];
    install = opts.install ?? true;
    // Scripted/CI: never auto-download (toolchain ~700 MB; demo app ~58 MB)
    // unless explicitly opted in — keeps CI deterministic + offline.
    installToolchain = opts.installToolchain ?? false;
    // The emulator lives inside the managed SDK, so it only makes sense when
    // the toolchain installs. Scripted/CI: opt-in only (~1 GB system image).
    withAvd = (opts.withAvd ?? false) && installToolchain;
    demoApp = (opts.demoApp ?? false) && platforms.includes('android');
    if (!stdin.isTTY && !scripted) {
      console.log(
        `(no TTY — running non-interactively: dir=${dirInput}, testDir=${testDir}, ` +
          `platform=${opts.platform ?? 'android'}, install=${install})\n`,
      );
    }
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    console.log('Press Enter to accept the default shown in (parentheses).\n');
    try {
      targetDir = await askProjectDir(rl, argDir);

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

      testDir = opts.testDir ?? (await askTestDir(rl));
      if (!isValidTestDir(testDir)) {
        console.error(`error: invalid --test-dir "${testDir}" — ${TEST_DIR_HINT}.`);
        process.exit(1);
      }
      const platformInput =
        opts.platform ??
        ((await askChoice(rl, 'Platform', platformChoices(isMac), 'android')) as
          | 'android'
          | 'ios'
          | 'both');
      platforms = platformInput === 'both' ? ['android', 'ios'] : [platformInput as Platform];
      // npm install is mandatory (the scaffold is useless without deps) — no
      // prompt. `--no-install` is the explicit escape hatch for CI/offline.
      install = opts.install ?? true;
      // Opt-in (default no — it's a ~700 MB download) and only meaningful for
      // Android. Probe first: if a complete supported toolchain is already
      // present (system or a prior `taqwright install`), skip the prompt; else
      // show what's missing and offer the managed bundle. `--install-toolchain`
      // (an explicit flag) always wins.
      if (opts.installToolchain !== undefined) {
        installToolchain = opts.installToolchain;
      } else if (!platforms.includes('android')) {
        installToolchain = false;
      } else {
        detected = await detectAndroidToolchain();
        printAndroidToolchainStatus(detected);
        if (detected.ready) {
          console.log('  → detected a working Android toolchain — skipping install.');
          if (!detected.avd) {
            console.log(
              '    (no AVD found — add one with `taqwright install --with-avd`, or use a device/cloud)',
            );
          }
          installToolchain = false;
        } else {
          installToolchain = await yesNo(
            rl,
            'Auto-install the Android toolchain now? (~700 MB: JDK + Android SDK + Appium — ' +
              "a complete self-contained set; won't touch your system tools)",
            false,
          );
        }
      }
      // The emulator lives inside the managed SDK, so this only applies when the
      // toolchain is installing. If the user already has an AVD, default No (and
      // name theirs) so we don't push a redundant ~1 GB managed image.
      if (opts.withAvd !== undefined) {
        withAvd = opts.withAvd;
      } else if (!installToolchain) {
        withAvd = false;
      } else if (detected?.avd) {
        withAvd = await yesNo(
          rl,
          `You already have an AVD (${detected.avdNames.join(', ')}) — ` +
            'create the managed taqwright_api34 too? (~1 GB: system image + AVD)',
          false,
        );
      } else {
        withAvd = await yesNo(
          rl,
          'Also create an Android emulator now? (~1 GB: system image + AVD). ' +
            'Skip and no emulator is created — boot the example test on a physical ' +
            'device, or add one later with `taqwright install --with-avd`',
          true,
        );
      }
      // When we're not creating the managed AVD but the user has their own,
      // point the sample config at it (auto for one, pick for several).
      if (platforms.includes('android') && !withAvd && detected?.avd) {
        deviceAvdName =
          detected.avdNames.length === 1
            ? detected.avdNames[0]
            : await askAvdChoice(rl, detected.avdNames);
      }
      // Auto-download for Android (no prompt) — the example test is a no-op stub
      // without it. No iOS demo build (it's an .apk); --no-demo-app opts out
      // (CI/offline); the download degrades gracefully on failure.
      demoApp = (opts.demoApp ?? true) && platforms.includes('android');
    } finally {
      rl.close();
    }
  }

  // Refuse iOS/both off-Mac (covers a --platform flag in either branch) — the
  // local iOS path can't run on Windows/Linux, so fail rather than scaffold dead.
  const platErr = platformSupportError(isMac, platforms);
  if (platErr) {
    console.error(`error: ${platErr}.`);
    process.exit(1);
  }

  const projectName = basename(targetDir);
  const pkgName = toPackageName(projectName);
  // The folder name is kept verbatim but the package.json "name" must be a
  // valid npm name — if they diverge (e.g. spaces), say so up front so the
  // mismatch (and the `cd "name with spaces"` quoting) isn't a surprise.
  if (projectName !== pkgName) {
    console.log(
      `note: folder "${projectName}" kept as-is, but the package name was normalized to "${pkgName}".`,
    );
  }

  // Project location was already validated (reserved name / exists-as-file) by
  // projectLocationError in both entry paths; an unwritable location (e.g. /usr
  // on macOS) can't be pre-checked, so guard the mkdir and fail with a clear
  // message rather than a raw stack.
  try {
    await mkdir(join(targetDir, testDir), { recursive: true });
  } catch (err) {
    console.error(
      `error: cannot create "${targetDir}": ${(err as Error).message}\n` +
        '  Check the path and your write permissions, then try again.',
    );
    process.exit(1);
  }

  // Fetch the demo APK *before* composing templates so the config +
  // example are only wired to it when it actually landed (a buildPath
  // pointing at a missing file would fail `taqwright test` confusingly).
  let demoAppReady = false;
  if (demoApp) {
    const apkPath = join(targetDir, 'app', DEMO_APK_FILENAME);
    process.stdout.write(`\nDownloading the demo app (${DEMO_APK_FILENAME})… `);
    try {
      // Bound a stalled connection so it can't hang the whole scaffold — the
      // catch below degrades gracefully, but only fires on an error/abort.
      await download(DEMO_APK_URL, apkPath, AbortSignal.timeout(120_000));
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

  // The demo example uses Android-only selectors (UiSelector/xpath), so it must
  // never run against an iOS project. For a `both` scaffold with the demo,
  // scope each project to its own subfolder; otherwise one shared
  // example.spec.ts is fine (the generic stub is platform-agnostic).
  const scopeForBoth = platforms.length === 2 && demoAppReady;
  // Only pin + auto-boot the managed AVD when the emulator was actually
  // requested — otherwise the config references an AVD that was never created.
  const demoAvdReady = demoAppReady && withAvd;

  const files: Array<[string, string]> = [
    ['package.json', packageJsonTemplate(pkgName)],
    ['.npmrc', npmrcTemplate()],
    ['tsconfig.json', tsconfigTemplate(testDir)],
    [
      'taqwright.config.ts',
      configTemplate(platforms, testDir, {
        demoApp: demoAppReady,
        demoAvd: demoAvdReady,
        scoped: scopeForBoth,
        deviceName: deviceAvdName,
      }),
    ],
  ];
  if (scopeForBoth) {
    files.push([join(testDir, 'android', 'example.spec.ts'), exampleTestTemplate(true)]);
    files.push([join(testDir, 'ios', 'example.spec.ts'), exampleTestTemplate(false)]);
  } else {
    files.push([join(testDir, 'example.spec.ts'), exampleTestTemplate(demoAppReady)]);
  }
  files.push(['.gitignore', gitignoreTemplate()]);

  // --yes always overwrites. Otherwise, an interactive user who chose to write
  // into a non-empty dir still has conflicting files skipped — offer to overwrite
  // them here instead of forcing a re-run with --yes. Default No (safe).
  let overwrite = !!opts.yes;
  if (!overwrite && interactive) {
    const conflicts = files.filter(([rel]) => existsSync(join(targetDir, rel)));
    if (conflicts.length > 0) {
      const rl2 = createInterface({ input: stdin, output: stdout });
      try {
        overwrite = await yesNo(
          rl2,
          `${conflicts.length} file(s) already exist — overwrite them?`,
          false,
        );
      } finally {
        rl2.close();
      }
    }
  }

  const written: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of files) {
    const dest = join(targetDir, rel);
    // Don't clobber a file the user already has unless --yes / they chose to.
    if (existsSync(dest) && !overwrite) {
      skipped.push(rel);
      continue;
    }
    try {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
    } catch (err) {
      console.error(`error: failed writing ${rel}: ${(err as Error).message}`);
      process.exit(1);
    }
    written.push(rel);
  }

  const showRoot = relative(process.cwd(), targetDir) || '.';
  if (written.length) {
    console.log('\nCreated:');
    for (const rel of written) console.log('  ' + join(showRoot, rel));
    if (demoAppReady) console.log('  ' + join(showRoot, 'app', DEMO_APK_FILENAME));
  }
  if (skipped.length) {
    console.log('\nSkipped (already exist — re-run with --yes to overwrite):');
    for (const rel of skipped) console.log('  ' + join(showRoot, rel));
  }

  const cdHint = relative(process.cwd(), targetDir) || '.';

  if (install) {
    const linkedDev = await isTaqwrightGloballyLinked();
    if (linkedDev) {
      console.log(
        '\nDetected globally-linked taqwright — will `npm link @taqwright/taqwright` after install (instead of fetching from the registry).',
      );
    }

    console.log('\nRunning npm install …');
    const code = await runNpm(['install'], targetDir);
    if (code !== 0) {
      console.error(`\nnpm install exited with code ${code}.`);
      if (!linkedDev) {
        console.error(
          '\n@taqwright/taqwright installs from public npm — a failure here is usually a',
        );
        console.error('network/registry issue. Retry, or check your npm registry settings.');
        console.error('To use a local taqwright build instead:');
        console.error('  cd /path/to/taqwright && npm link');
        console.error(`  cd ${cdHint} && npm install && npm link @taqwright/taqwright`);
      }
      process.exit(code);
    }

    // Link LAST — `npm install` reconciles node_modules against the npm
    // devDependency and would otherwise clobber an earlier symlink.
    if (linkedDev) {
      const linkCode = await runNpm(['link', '@taqwright/taqwright'], targetDir);
      if (linkCode !== 0) {
        console.error('npm link @taqwright/taqwright failed.');
        process.exit(linkCode);
      }
    }
  }

  let toolchainInstalled = false;
  if (installToolchain && platforms.includes('android')) {
    console.log(
      (withAvd
        ? '\nInstalling the Android toolchain + emulator — this can take several minutes…'
        : '\nInstalling the Android toolchain — this can take a few minutes…') +
        "\n(installs under taqwright's own dir — your shell's JAVA_HOME/PATH stays as-is)\n",
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
  if (platforms.includes('android')) {
    // Prefer the probe result; otherwise a cheap FS scan (covers non-interactive)
    // so we never tell a user with an emulator to create one (`--with-avd`).
    const hasAvd = detected?.avd ?? (await listAvds()).length > 0;
    if (toolchainInstalled && !withAvd && !hasAvd) {
      // Toolchain installed but no emulator anywhere — show how to add one.
      console.log(
        '  npx taqwright install --with-avd   # add an Android emulator (~1 GB), or use a physical device',
      );
    } else if (!toolchainInstalled && !detected?.ready) {
      // Toolchain genuinely missing (non-interactive, or detected not-ready and
      // the user declined). A detected-ready toolchain prints nothing here.
      console.log(
        hasAvd
          ? '  npx taqwright install   # Android toolchain (JDK + SDK + Appium) — you already have an emulator'
          : '  npx taqwright install --with-avd   # Android toolchain + emulator (JDK + SDK + Appium + AVD); drop --with-avd to skip the ~1 GB emulator',
      );
    }
  }
  // The objective of the whole sequence — listed last so any prerequisites
  // (npm install / toolchain install) come before it.
  console.log('  npx taqwright test');
  console.log('\nCommands:');
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
  if (demoAppReady && !demoAvdReady) {
    if (deviceAvdName) {
      console.log(
        `\nThe config targets the "${deviceAvdName}" AVD — taqwright boots it automatically\n` +
          'when you run the test above (or uses it if already running).',
      );
    } else if (detected?.avd) {
      console.log(
        '\nBoot one of your emulators (or connect a device) and set device.name in\n' +
          'taqwright.config.ts before running the test above.',
      );
    } else {
      console.log(
        '\nNo emulator was found — run `npx taqwright install --with-avd` to create one (or\n' +
          'connect a device), then set device.name + autoStartDevice in taqwright.config.ts.',
      );
    }
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

// Numbered picker for AVD names. (askChoice lowercases input and matches the
// original-case choices, so mixed-case AVD names like `Pixel_10_Pro_XL` would
// never match — hence a dedicated index-based prompt.) Returns the chosen name,
// or undefined for the trailing "leave placeholder" option.
async function askAvdChoice(
  rl: ReturnType<typeof createInterface>,
  avds: string[],
): Promise<string | undefined> {
  const placeholder = avds.length + 1;
  console.log('  Detected AVDs:');
  avds.forEach((a, i) => console.log(`    ${i + 1}) ${a}`));
  console.log(`    ${placeholder}) leave placeholder (edit the config later)`);
  while (true) {
    const raw = (
      await ask(rl, `Which AVD should the config target? (1-${placeholder})`, '1')
    ).trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= avds.length) return avds[n - 1];
    if (n === placeholder) return undefined;
    console.log(`  please enter a number 1-${placeholder}`);
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

// Names the test dir may not take: Windows reserved device names, plus dirs the
// scaffold / tooling own (a test dir there would collide).
const RESERVED_DIR_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
  'app',
  'node_modules',
  'playwright-report',
  'dist',
]);

// Shared so the interactive and non-interactive error copy can't drift.
const TEST_DIR_HINT =
  'use letters, digits, dot, dash or underscore (no spaces/special chars), ' +
  'and avoid reserved names like "app" or "node_modules"';

// A reserved/collision folder name (Windows device name, or a dir the scaffold
// / tooling owns) — disallowed for both the test dir and the project root.
export function isReservedDirName(name: string): boolean {
  return RESERVED_DIR_NAMES.has(name.toLowerCase());
}

// iOS local testing needs macOS (Xcode + simulators), so off-Mac only Android is
// offered and a requested iOS/both is refused. Pure for unit testing.
export function platformChoices(isMac: boolean): string[] {
  return isMac ? ['android', 'ios', 'both'] : ['android'];
}
export function platformSupportError(isMac: boolean, platforms: Platform[]): string | null {
  if (!isMac && platforms.includes('ios')) {
    return 'iOS testing requires macOS (Xcode + simulators). On Windows/Linux, use --platform android';
  }
  return null;
}

// Print a compact ✓/✗ view of the probed Android toolchain before the install
// prompt, so the user sees exactly what they already have.
function printAndroidToolchainStatus(tc: AndroidToolchainStatus): void {
  const mark = (ok: boolean): string => (ok ? '✓' : '✗');
  const jv = tc.jdkVersion ? ` v${tc.jdkVersion}` : '';
  const jdkLine =
    tc.jdk === 'ok'
      ? `✓ JDK (java${jv})`
      : tc.jdk === 'too-old'
        ? `⚠ JDK${jv} — too old, need 17+`
        : tc.jdk === 'unknown'
          ? '⚠ JDK (java) — version unreadable'
          : '✗ JDK (java) — not found';
  const av = tc.appiumVersion ? ` (v${tc.appiumVersion})` : '';
  const appiumLine =
    tc.appium === 'recommended'
      ? `✓ Appium 3.x${av}`
      : tc.appium === 'best-effort'
        ? `⚠ Appium 2.x${av} — best-effort, not the supported version`
        : tc.appium === 'unsupported'
          ? `✗ Appium${av} — unsupported version`
          : '✗ Appium — not found';
  console.log('\nAndroid toolchain:');
  console.log(`  ${jdkLine}`);
  console.log(`  ${mark(tc.sdk)} Android SDK (adb)`);
  console.log(`  ${appiumLine}`);
  console.log(`  ${mark(tc.uiautomator2)} uiautomator2 driver`);
  console.log(
    tc.avd
      ? `  ✓ Android emulator (AVD): ${tc.avdNames.join(', ')}`
      : '  ✗ Android emulator (AVD) — none',
  );
}

// A reason the project location can't be used, or null. The project root may be
// an absolute / nested path and (with a note) may carry spaces, so it isn't held
// to the strict test-dir charset — but its basename can't be a reserved/collision
// name, and it can't point at an existing non-directory. Composes the tested pure
// helpers; the statSync IO keeps it out of the unit-tested set.
function projectLocationError(targetDir: string): string | null {
  const name = basename(targetDir);
  if (isReservedDirName(name)) {
    return `"${name}" is a reserved name — choose a different project folder`;
  }
  const exists = existsSync(targetDir);
  const t = projectTargetError(exists, exists && statSync(targetDir).isDirectory());
  if (t) return `"${targetDir}" ${t}`;
  return null;
}

// Loop the project-location prompt until the answer resolves to a usable target,
// mirroring askTestDir. An arg-provided dir can't be re-prompted, so it
// errors+exits; a typed answer re-prompts with a hint.
async function askProjectDir(
  rl: ReturnType<typeof createInterface>,
  argDir: string | undefined,
): Promise<string> {
  while (true) {
    const dirInput = argDir ?? (await ask(rl, 'Project location', './taqwright-tests'));
    const targetDir = resolve(process.cwd(), dirInput);
    const err = projectLocationError(targetDir);
    if (!err) return targetDir;
    if (argDir !== undefined) {
      console.error(`error: ${err}.`);
      process.exit(1);
    }
    console.log(`  ${err} — try another.`);
  }
}

// A safe, single-segment folder name. The allowlist (letters/digits/dot/dash/
// underscore, must start alphanumeric or underscore) rejects spaces, quotes,
// backticks, `${`, path separators, leading dot/dash and every Windows-illegal
// char in one rule — so the raw `testDir` interpolations in the generated
// tsconfig/config can never produce a broken file, and the name is valid on
// Windows too.
export function isValidTestDir(name: string): boolean {
  if (!name) return false;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(name)) return false;
  if (isReservedDirName(name)) return false;
  return true;
}

async function askTestDir(rl: ReturnType<typeof createInterface>): Promise<string> {
  while (true) {
    const name = await ask(rl, 'Test folder name', 'tests');
    if (isValidTestDir(name)) return name;
    console.log(`  please ${TEST_DIR_HINT}`);
  }
}

// `basename` can be anything the filesystem allows, but `package.json` "name"
// must be a valid npm name: lowercase, no spaces, no leading dot/underscore.
// Pure check for whether a resolved project location is usable. Returns a
// human-readable reason to refuse, or null if it's fine. The `statSync` IO that
// feeds it stays in `runInit` so this stays unit-testable. Permission/IO errors
// (an unwritable dir) surface from the `mkdir` itself, not here.
export function projectTargetError(exists: boolean, isDirectory: boolean): string | null {
  if (exists && !isDirectory) return 'exists and is not a directory';
  return null;
}

export function toPackageName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/-+$/, '');
  return cleaned || 'taqwright-tests';
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
    const p = join(stdout.trim(), '@taqwright', 'taqwright');
    // Only a real `npm link` (a symlink to a dev checkout) counts. A plain
    // `npm i -g @taqwright/taqwright` is a real directory of the published,
    // dist-only package — linking that would trigger its `prepare` build and
    // fail (no src/tsc). For a global install we want the registry path instead.
    return existsSync(p) && lstatSync(p).isSymbolicLink();
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
      // Installed from public npm.
      '@taqwright/taqwright': 'latest',
      '@types/node': '^24.0.0',
      typescript: '^5.4.0',
    },
    engines: {
      // Require Node 24 or newer: taqwright runs in the consumer project (the
      // `taqwright test` runtime). Minimum 24, no upper bound.
      node: '>=24.0.0',
    },
    // @wdio/config (a transitive dep via webdriver) still pins the deprecated
    // glob@10; taqwright never uses its glob-based spec resolution (Playwright is
    // the runner), so force a non-deprecated glob to keep `npm install` clean.
    overrides: {
      '@wdio/config': {
        glob: '^13',
      },
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

export interface ConfigTemplateOpts {
  /** Demo APK landed → wire buildPath/resetBetweenTests to it. */
  demoApp: boolean;
  /** Emulator was created → safe to pin + auto-boot the managed AVD. */
  demoAvd: boolean;
  /** `both` + demo → scope each project to its own test subfolder. */
  scoped: boolean;
  /** The user's existing AVD to target (Android) when not creating the managed one. */
  deviceName?: string;
}

export function configTemplate(
  platforms: Platform[],
  testDir: string,
  opts: ConfigTemplateOpts,
): string {
  const projects = platforms
    .map((p) =>
      projectBlock(p, {
        demoApp: opts.demoApp,
        demoAvd: opts.demoAvd,
        deviceName: opts.deviceName,
        // Point each project at its own subfolder so the Android-only demo
        // spec never runs against the iOS project (its selectors throw on iOS).
        scopedTestMatch: opts.scoped ? `'**/${p}/**'` : undefined,
      }),
    )
    .join(',\n');
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

interface ProjectBlockOpts {
  demoApp: boolean;
  demoAvd: boolean;
  /** The user's existing AVD to target (Android) when not pinning the managed one. */
  deviceName?: string;
  // Uncommented `testMatch` glob literal (a quoted glob like '**/android/**'),
  // or undefined to leave the commented placeholder.
  scopedTestMatch?: string;
}

function projectBlock(p: Platform, opts: ProjectBlockOpts): string {
  const { demoApp, demoAvd, deviceName, scopedTestMatch } = opts;
  const isAndroid = p === 'android';
  // `demoWired` controls buildPath/reset (device-agnostic); `demoAvdWired`
  // controls pinning + auto-booting the managed AVD — only safe when the
  // emulator was actually created, else the config references a missing AVD.
  const demoWired = isAndroid && demoApp;
  const demoAvdWired = isAndroid && demoAvd;
  const platformConst = isAndroid ? 'Platform.ANDROID' : 'Platform.IOS';
  const projectName = isAndroid ? 'android' : 'ios';
  const deviceNameLine = demoAvdWired
    ? `          name: '${DEMO_AVD_NAME}',          // AVD from \`taqwright install --with-avd\``
    : isAndroid && deviceName
      ? `          name: '${deviceName}',          // your detected AVD`
      : demoWired
        ? '          // name: /Pixel/,   // no managed AVD — bring a running device, or `taqwright install --with-avd`'
        : isAndroid
          ? '          // name: /Pixel/,'
          : '          name: /iPhone/,';
  const autoStartDeviceLine = demoAvdWired
    ? `          autoStartDevice: true,   // cold-boots the ${DEMO_AVD_NAME} AVD`
    : isAndroid && deviceName
      ? `          autoStartDevice: true,   // cold-boots the ${deviceName} AVD`
      : '          // autoStartDevice: true,';
  const exampleUdid = isAndroid ? "'emulator-5554'" : "'00000000-0000-0000-0000-000000000000'";
  const exampleOsVersion = isAndroid ? "'14'" : "'17'";
  const examplePath = isAndroid ? "'/absolute/path/to/app.apk'" : "'/absolute/path/to/MyApp.app'";
  const exampleBundleId = isAndroid ? "'com.example.app'" : "'com.example.MyApp'";
  // The per-project test-runner `testMatch` line: uncommented + scoped when a
  // `both`+demo scaffold needs to isolate each project to its own subfolder,
  // otherwise the usual commented placeholder.
  const testMatchLine = scopedTestMatch
    ? `      testMatch: [${scopedTestMatch}],`
    : `      // testMatch: ['**/${projectName}/*.spec.ts'],`;
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
${testMatchLine}
    }`;
}

export function exampleTestTemplate(demoApp: boolean): string {
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
  // @taqwright/taqwright is published to public npm, so no registry config or
  // auth token is needed — a plain `npm install` works.
  return `# @taqwright/taqwright installs from public npm — no registry config or token needed.
`;
}
