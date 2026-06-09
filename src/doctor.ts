import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { applyManagedEnv, readManifest } from './setup/paths.js';
import { spawnTool } from './setup/spawn-tool.js';
import { avdHomeDir, isAvdImageInstalled, readAvdSystemImage } from './setup/avd.js';

// Re-exported so existing importers (and tests) keep resolving it from here.
export { normalizeSysImagePath } from './setup/avd.js';

export type DoctorStatus = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail?: string;
}

/**
 * Run the same environment checks as `taqwright doctor`. Used by both the CLI
 * and the inspector landing page so the answers stay consistent.
 */
export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  // If `taqwright install` vendored a toolchain, surface it as if exported —
  // so the Android/JDK/adb/driver checks report [ok] without shell edits.
  // No-op otherwise; idempotent with the CLI entry's apply.
  applyManagedEnv();
  const checks: DoctorCheck[] = [];

  checks.push({
    name: 'Node.js 24.x–25.x',
    status: isNodeVersionSupported(process.versions.node) ? 'ok' : 'error',
    detail: isNodeVersionSupported(process.versions.node)
      ? process.version
      : `${process.version} — taqwright requires Node.js 24 or 25 (Node 26+ has a known bug)`,
  });

  const adb = await commandExists('adb');
  checks.push({
    name: 'adb (Android SDK)',
    status: adb ? 'ok' : 'warn',
    detail: adb ? 'on PATH' : 'not found — Android tests will not work',
  });

  checks.push(checkAndroidHome());

  // Only meaningful when `taqwright install` provisioned a managed SDK
  // (so `applyManagedEnv` overrode the user's shell `ANDROID_HOME`). Without
  // a manifest, the user's own SDK has whatever images their AVDs need and
  // this check would be noise. When the managed toolchain is active, an AVD
  // referencing a system image that isn't in the managed SDK silently fails
  // to launch — the Appium log shows a never-resolving "Trying to find
  // <avd>" poll loop. Surface it here so users learn at doctor time.
  const avdImagesCheck = await checkManagedSdkAvdImages();
  if (avdImagesCheck) checks.push(avdImagesCheck);

  if (process.platform === 'darwin') {
    const xcrun = await commandExists('xcrun');
    checks.push({
      name: 'xcrun (Xcode CLT)',
      status: xcrun ? 'ok' : 'warn',
      detail: xcrun ? 'on PATH' : 'not found — iOS tests will not work',
    });

    // macOS-only. `xcrun` can be on PATH while `xcode-select` still points
    // at Command-Line-Tools-only (no full Xcode.app) or the Xcode license
    // isn't accepted — XCUITest needs *full* Xcode, so iOS silently breaks.
    // Soft `warn`, never `error`: Android-on-Mac users don't care.
    if (xcrun) {
      const devDir = (await readCommandOutput('xcode-select', ['-p']))?.trim();
      if (!devDir) {
        checks.push({
          name: 'Xcode (full, for XCUITest)',
          status: 'warn',
          detail:
            'xcode-select path not set — run `sudo xcode-select --switch ' +
            '/Applications/Xcode.app/Contents/Developer`',
        });
      } else if (/CommandLineTools/.test(devDir)) {
        checks.push({
          name: 'Xcode (full, for XCUITest)',
          status: 'warn',
          detail:
            `Command Line Tools only (${devDir}) — XCUITest needs full Xcode. ` +
            'Run `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`',
        });
      } else {
        const xb = await readCommandOutput('xcodebuild', ['-version']);
        const ver = xb?.match(/Xcode\s+([\d.]+)/);
        if (ver) {
          checks.push({
            name: 'Xcode (full, for XCUITest)',
            status: 'ok',
            detail: `Xcode ${ver[1]} (${devDir})`,
          });
        } else if (xb && /license/i.test(xb)) {
          checks.push({
            name: 'Xcode (full, for XCUITest)',
            status: 'warn',
            detail: 'Xcode license not accepted — run `sudo xcodebuild -license accept`',
          });
        } else {
          checks.push({
            name: 'Xcode (full, for XCUITest)',
            status: 'warn',
            detail: `xcodebuild not usable (${devDir}) — check the Xcode install`,
          });
        }
      }
    }

    // macOS-only and deliberately optional: ffmpeg is needed *only* for
    // iOS-simulator screen recording (`use.video` != 'off'). Android,
    // real iOS devices, and cloud record without host ffmpeg, so a
    // missing binary is a soft 'warn', never an 'error', and the detail
    // says why it may not apply. iOS-sim video users are all on macOS,
    // so darwin-gating reaches exactly them without nagging others.
    const ffmpeg = await commandExists('ffmpeg');
    checks.push({
      name: 'ffmpeg (iOS-sim video)',
      status: ffmpeg ? 'ok' : 'warn',
      detail: ffmpeg
        ? 'on PATH'
        : 'not found — optional; only needed for iOS-simulator screen recording (video)',
    });

    // macOS-only and only relevant when `use.network` is enabled and the
    // project targets the iOS Simulator. The network capture feature
    // routes the sim through a local MITM proxy by briefly redirecting
    // the macOS system proxy via `networksetup`; without that binary
    // (or on managed Macs that block it) iOS Sim HAR capture won't work
    // even though Android emulator capture still does. Soft 'warn', not
    // 'error' — Android-only iOS-only-on-cloud users don't care.
    const networksetup = await commandExists('networksetup');
    checks.push({
      name: 'networksetup (iOS-sim network capture)',
      status: networksetup ? 'ok' : 'warn',
      detail: networksetup
        ? 'on PATH'
        : 'not found — optional; only needed for iOS-simulator network capture (network)',
    });

    // macOS-only, coarse counterpart to the iOS WebDriverAgent build gap:
    // with *no usable* iOS simulator runtime, `xcodebuild` has no build
    // destination, WDA never builds, and iOS sessions fail with
    // `connect ECONNREFUSED 127.0.0.1:8100`. This only answers "is there
    // ≥1 usable iOS sim" — it deliberately does NOT try to detect a subtle
    // Xcode/runtime version mismatch (that needs the real WDA build and
    // would false-alarm setups that work on older runtimes). Reuses the
    // simctl-JSON shape parsed in src/inspector/devices.ts.
    if (xcrun) {
      const simJson = await readCommandOutput('xcrun', [
        'simctl',
        'list',
        'devices',
        'available',
        '--json',
      ]);
      if (simJson === undefined) {
        checks.push({
          name: 'iOS simulator (WDA target)',
          status: 'warn',
          detail: 'could not query `xcrun simctl list devices available`',
        });
      } else {
        let count = 0;
        let latest: string | undefined;
        let latestScore = -1;
        try {
          const slice = simJson.slice(simJson.indexOf('{'), simJson.lastIndexOf('}') + 1);
          const parsed = JSON.parse(slice) as {
            devices?: Record<string, Array<{ isAvailable?: boolean }>>;
          };
          for (const [runtime, entries] of Object.entries(parsed.devices ?? {})) {
            const m = runtime.match(/iOS-(\d+)-(\d+)/);
            if (!m) continue;
            const usable = (entries ?? []).filter((e) => e.isAvailable !== false);
            if (usable.length === 0) continue;
            count += usable.length;
            const score = Number(m[1]) * 1000 + Number(m[2]);
            if (score > latestScore) {
              latestScore = score;
              latest = `${m[1]}.${m[2]}`;
            }
          }
        } catch {
          // unparseable — treated as "none found" (warn) below
        }
        if (count > 0) {
          checks.push({
            name: 'iOS simulator (WDA target)',
            status: 'ok',
            detail: `${count} available${latest ? ` (latest iOS ${latest})` : ''}`,
          });
        } else {
          checks.push({
            name: 'iOS simulator (WDA target)',
            status: 'warn',
            detail:
              'none available — WebDriverAgent has no build destination ' +
              '(:8100 ECONNREFUSED). Install one: `xcodebuild -downloadPlatform iOS` ' +
              '(Xcode → Settings → Components).',
          });
        }
      }
    }
  }

  // Cross-platform: the network capture feature uses `node-forge` (a
  // bundled dependency) for CA generation. A failed `node_modules` install
  // would manifest as a runtime error inside the fixture; surface it here
  // so users see it at `doctor` time instead. Soft 'warn' — never blocks
  // tests for users who never enable `use.network`.
  const forgeOk = await canImport('node-forge');
  checks.push({
    name: 'node-forge (network capture)',
    status: forgeOk ? 'ok' : 'warn',
    detail: forgeOk ? 'loaded' : 'failed to import — reinstall dependencies (`npm install`)',
  });

  const java = await commandExists('java');
  if (!java) {
    checks.push({
      name: 'java (JDK for UiAutomator2)',
      status: 'warn',
      detail: 'not found — Appium Android driver may fail',
    });
  } else {
    const jver = await readJavaVersion();
    const level = jver ? classifyJdkVersion(jver) : 'unknown';
    checks.push({
      name: 'java (JDK for UiAutomator2)',
      status: level === 'ok' ? 'ok' : 'warn',
      detail:
        level === 'ok'
          ? `on PATH (v${jver})`
          : level === 'too-old'
            ? `v${jver} is too old — Appium/UiAutomator2 + Android build-tools need JDK ${MIN_JDK_MAJOR}+`
            : 'on PATH but version could not be read',
    });
  }
  checks.push(checkJavaHome());

  const appium = await commandExists('appium');
  if (!appium) {
    checks.push({
      name: 'Appium (test server)',
      status: 'warn',
      detail:
        'not found — install with `npm i -g appium@^3` then `appium driver install uiautomator2`',
    });
  } else {
    const version = await readCommandVersion('appium');
    if (!version) {
      checks.push({
        name: 'Appium (test server)',
        status: 'warn',
        detail: 'on PATH but version could not be read',
      });
    } else {
      const level = classifyAppiumVersion(version);
      if (level === 'recommended') {
        checks.push({
          name: 'Appium (test server)',
          status: 'ok',
          detail: `on PATH (v${version})`,
        });
      } else if (level === 'best-effort') {
        checks.push({
          name: 'Appium (test server)',
          status: 'warn',
          detail:
            `Appium 2.x detected (v${version}) — best-effort, not officially tested. ` +
            'Upgrade for the supported path: `npm i -g appium@^3`.',
        });
      } else {
        checks.push({
          name: 'Appium (test server)',
          status: 'error',
          detail:
            `v${version} is not supported — taqwright targets Appium 3.x ` +
            '(2.x runs best-effort). Upgrade with `npm i -g appium@^3`.',
        });
      }
    }
  }

  // The Appium check above is the *server*; this is the *platform drivers*
  // under it — the symmetric counterpart to the iOS WDA/runtime gap. No
  // driver ⇒ every session on that platform fails. Substring match (not
  // JSON) so it survives Appium output-format changes. `warn` only when
  // *no* relevant driver is installed; a single missing one is reported
  // informationally so Android-only / iOS-only users aren't false-alarmed.
  if (appium) {
    const driverOut = await readCommandOutput('appium', ['driver', 'list', '--installed']);
    if (driverOut === undefined) {
      checks.push({
        name: 'Appium drivers',
        status: 'warn',
        detail: 'could not query `appium driver list --installed`',
      });
    } else {
      const hasUia2 = /uiautomator2/.test(driverOut);
      const hasXcui = /xcuitest/.test(driverOut);
      if (!hasUia2 && !hasXcui) {
        checks.push({
          name: 'Appium drivers',
          status: 'warn',
          detail:
            'no platform driver installed — `appium driver install uiautomator2` ' +
            '(Android) and/or `appium driver install xcuitest` (iOS)',
        });
      } else {
        const installed = [hasUia2 ? 'uiautomator2' : undefined, hasXcui ? 'xcuitest' : undefined]
          .filter(Boolean)
          .join(', ');
        const missing: string[] = [];
        if (!hasUia2) missing.push('uiautomator2 (Android) `appium driver install uiautomator2`');
        if (!hasXcui) missing.push('xcuitest (iOS) `appium driver install xcuitest`');
        checks.push({
          name: 'Appium drivers',
          status: 'ok',
          detail: missing.length ? `${installed}; not installed: ${missing.join('; ')}` : installed,
        });
      }
    }
  }

  return checks;
}

/**
 * Symmetric twin of {@link checkAndroidHome}: Appium's UiAutomator2 driver
 * resolves the JDK via `JAVA_HOME`, not just `java` on PATH. A machine with
 * `java` reachable but `JAVA_HOME` unset (or pointing at a stale dir) passes
 * the `java` check yet fails UiAutomator2 cryptically — same Finder-launch /
 * un-exported-env class of bug as the ANDROID_HOME case. Soft `warn` only.
 */
function checkJavaHome(): DoctorCheck {
  const name = 'JAVA_HOME (UiAutomator2 JDK)';
  const home = process.env.JAVA_HOME;
  if (!home) {
    return {
      name,
      status: 'warn',
      detail:
        "unset — Appium's UiAutomator2 driver may not find the JDK. Export " +
        'JAVA_HOME (e.g. `$(/usr/libexec/java_home -v 21)` on macOS) in the ' +
        'shell that launches taqwright.',
    };
  }
  if (!existsSync(home)) {
    return { name, status: 'warn', detail: `set to ${home} but that directory does not exist` };
  }
  const javaBin = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!existsSync(javaBin)) {
    return {
      name,
      status: 'warn',
      detail: `set to ${home} but ${path.join('bin', 'java')} is missing — not a JDK home`,
    };
  }
  return { name, status: 'ok', detail: `JAVA_HOME=${home}` };
}

/**
 * Appium's UiAutomator2 driver locates the SDK adb via `ANDROID_HOME` (with
 * `ANDROID_SDK_ROOT` as a fallback). Without it, sessions fail with cryptic
 * "Device <udid> was not in the list of connected devices" errors even when
 * the user's shell adb sees the emulator — usually because the inspector /
 * IDE was launched from Finder and didn't inherit the shell's env exports.
 * Surface this as a clear warning before the user hits Connect.
 */
function checkAndroidHome(): DoctorCheck {
  const name = 'ANDROID_HOME (Appium adb lookup)';
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!home) {
    return {
      name,
      status: 'warn',
      detail:
        'unset — Appium will not find adb. Export ANDROID_HOME (e.g. `~/Library/Android/sdk`) ' +
        'in the shell that launches taqwright.',
    };
  }
  if (!existsSync(home)) {
    return {
      name,
      status: 'warn',
      detail: `set to ${home} but that directory does not exist`,
    };
  }
  const adbBin = path.join(
    home,
    'platform-tools',
    process.platform === 'win32' ? 'adb.exe' : 'adb',
  );
  if (!existsSync(adbBin)) {
    return {
      name,
      status: 'warn',
      detail: `set to ${home} but ${path.join('platform-tools', 'adb')} is missing — install Android SDK platform-tools`,
    };
  }
  const source = process.env.ANDROID_HOME ? 'ANDROID_HOME' : 'ANDROID_SDK_ROOT';
  return { name, status: 'ok', detail: `${source}=${home}` };
}

/** Dynamic-import a module and resolve `true` iff it loads cleanly. */
async function canImport(name: string): Promise<boolean> {
  try {
    await import(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cross-check the user's AVDs against the managed SDK's installed system
 * images. Returns:
 * - `undefined` when no managed install is active (caller skips the line).
 * - `ok` when every discoverable AVD's `image.sysdir.1` resolves under the
 *   managed `ANDROID_HOME`.
 * - `warn` listing each AVD whose image is missing, with the install
 *   command the user can run to repair the managed SDK.
 *
 * AVDs live at `$ANDROID_AVD_HOME` (default `$HOME/.android/avd`) — they
 * are *not* inside `$ANDROID_HOME`, so they survive switching SDKs but
 * their system images do not. That mismatch is the symptom this check
 * exists to catch.
 */
async function checkManagedSdkAvdImages(): Promise<DoctorCheck | undefined> {
  if (!readManifest()) return undefined;
  const androidHome = process.env.ANDROID_HOME;
  if (!androidHome) return undefined;
  const avdHome = avdHomeDir();
  if (!existsSync(avdHome)) return undefined;

  let entries: string[];
  try {
    entries = await fs.readdir(avdHome);
  } catch {
    return undefined;
  }

  const avdNames = entries
    .filter((name) => name.endsWith('.avd'))
    .map((name) => name.slice(0, -'.avd'.length));
  if (avdNames.length === 0) return undefined;

  const missing: Array<{ avd: string; image: string }> = [];
  let total = 0;
  for (const avdName of avdNames) {
    const image = await readAvdSystemImage(avdName, avdHome);
    if (image === undefined) continue; // no config / no image.sysdir.1
    total++;
    if (!isAvdImageInstalled(image, androidHome)) {
      missing.push({ avd: avdName, image });
    }
  }

  if (missing.length === 0) {
    return {
      name: 'Managed SDK AVD images',
      status: 'ok',
      detail: `${total} AVD${total === 1 ? '' : 's'} found, all system images present`,
    };
  }

  const list = missing.map((m) => `${m.avd} → ${m.image}`).join('; ');
  // Convert `system-images/android-37.0/google_apis_playstore_ps16k/arm64-v8a`
  // → `sdkmanager "system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a"`.
  // `m.image` is already canonical forward-slash form (normalizeSysImagePath).
  const sdkmanagerCmds = missing.map((m) => `sdkmanager "${m.image.replace(/\//g, ';')}"`);
  return {
    name: 'Managed SDK AVD images',
    status: 'warn',
    detail:
      `${missing.length} AVD${missing.length === 1 ? '' : 's'} reference a system image not in the managed SDK: ${list}. ` +
      `Fix one of: (a) install the missing image into the managed SDK — \`${sdkmanagerCmds[0]}\` ` +
      `(uses \`${path.join(androidHome, 'cmdline-tools', 'latest', 'bin', 'sdkmanager')}\`); ` +
      `(b) bypass the managed toolchain — \`rm ${path.join(path.dirname(androidHome), 'manifest.json')}\` ` +
      `(falls back to your shell ANDROID_HOME); ` +
      `(c) recreate the AVD against an image present in the managed SDK.`,
  };
}

async function commandExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [name], {
      stdio: 'ignore',
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/** Run `<cmd> --version`, capture stdout, return the first version-shaped token. */
async function readCommandVersion(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawnTool(cmd, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('exit', () => {
      const m = out.match(/(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?/);
      resolve(m ? m[0] : undefined);
    });
    child.on('error', () => resolve(undefined));
  });
}

/** Run `<cmd> <args...>`, capture stdout+stderr, resolve the combined
 *  output (whatever the exit code) or `undefined` if it can't spawn. */
async function readCommandOutput(cmd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawnTool(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout?.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('exit', () => resolve(out));
    child.on('error', () => resolve(undefined));
  });
}

/**
 * Three-state classification of an Appium server version.
 *
 * - `recommended`: 3.x or newer — officially supported.
 * - `best-effort`: 2.x — every `mobile:` command shape we use is identical
 *   between 2.x and 3.x, so taqwright runs on it, but it's not in CI and
 *   may regress without notice.
 * - `unsupported`: 1.x or unparseable — refuse to vouch for it.
 *
 * Contributors adding a 3-only code path should branch on this and surface
 * a clear error before the underlying server complains cryptically.
 */
export type AppiumSupportLevel = 'recommended' | 'best-effort' | 'unsupported';

export function classifyAppiumVersion(version: string): AppiumSupportLevel {
  const m = version.match(/^(\d+)\./);
  if (!m) return 'unsupported';
  const major = Number(m[1]);
  if (!Number.isFinite(major)) return 'unsupported';
  if (major >= 3) return 'recommended';
  if (major === 2) return 'best-effort';
  return 'unsupported';
}

/**
 * JDK adequacy. Appium's UiAutomator2 driver + Android cmdline-tools/build-tools
 * (the managed bundle ships Temurin 21) need a modern JDK; below this floor a
 * `java` on PATH is present but unusable. `unknown` = couldn't read the version.
 */
export type JdkLevel = 'ok' | 'too-old' | 'unknown';
const MIN_JDK_MAJOR = 17;

export function classifyJdkVersion(version: string): JdkLevel {
  // Legacy `1.8.0_372` → major 8; modern `21.0.1` / `17` → major 21 / 17.
  const m = version.match(/(\d+)(?:\.(\d+))?/);
  if (!m) return 'unknown';
  let major = Number(m[1]);
  if (major === 1 && m[2]) major = Number(m[2]);
  if (!Number.isFinite(major)) return 'unknown';
  return major >= MIN_JDK_MAJOR ? 'ok' : 'too-old';
}

/** Per-component view of the Android toolchain — drives init's install prompt. */
export interface AndroidToolchainStatus {
  jdk: JdkLevel | 'missing'; // `java` on PATH, version-classified
  jdkVersion?: string;
  sdk: boolean; // `adb` on PATH
  appium: AppiumSupportLevel | 'missing';
  appiumVersion?: string;
  uiautomator2: boolean; // Appium driver installed
  avd: boolean; // at least one AVD defined
  avdNames: string[]; // the AVD names found
  ready: boolean; // a complete, supported toolchain (AVD excluded — device/cloud is fine)
}

/** Pure: install-skippable only with an adequate JDK + SDK + Appium 3.x + uia2. */
export function androidToolchainReady(s: {
  jdk: JdkLevel | 'missing';
  sdk: boolean;
  appium: AppiumSupportLevel | 'missing';
  uiautomator2: boolean;
}): boolean {
  return s.jdk === 'ok' && s.sdk && s.appium === 'recommended' && s.uiautomator2;
}

// java prints its version to stderr: `openjdk version "21.0.1"` /
// `java version "1.8.0_372"`. `-version` (single dash) works on Java 8 too,
// where `--version` errors. readCommandOutput captures stderr.
async function readJavaVersion(): Promise<string | undefined> {
  const out = await readCommandOutput('java', ['-version']);
  return out?.match(/version "([^"]+)"/)?.[1];
}

/** Cheap, FS-only list of defined AVD names (no subprocess). */
export async function listAvds(): Promise<string[]> {
  try {
    const entries = await fs.readdir(avdHomeDir());
    return entries.filter((e) => e.endsWith('.ini')).map((e) => e.slice(0, -'.ini'.length));
  } catch {
    return [];
  }
}

/**
 * Probe what's already installed (system or a prior `taqwright install`) so init
 * can skip a redundant managed install. Reuses the same primitives as the doctor
 * checks; IO-bound, so not unit-covered (the pure `androidToolchainReady` is).
 */
export async function detectAndroidToolchain(): Promise<AndroidToolchainStatus> {
  applyManagedEnv();
  const [jdkPresent, sdk, appiumPresent] = await Promise.all([
    commandExists('java'),
    commandExists('adb'),
    commandExists('appium'),
  ]);
  let jdk: JdkLevel | 'missing' = 'missing';
  let jdkVersion: string | undefined;
  if (jdkPresent) {
    jdkVersion = await readJavaVersion();
    jdk = jdkVersion ? classifyJdkVersion(jdkVersion) : 'unknown';
  }
  let appium: AppiumSupportLevel | 'missing' = 'missing';
  let appiumVersion: string | undefined;
  let uiautomator2 = false;
  if (appiumPresent) {
    appiumVersion = await readCommandVersion('appium');
    appium = appiumVersion ? classifyAppiumVersion(appiumVersion) : 'unsupported';
    const drivers = await readCommandOutput('appium', ['driver', 'list', '--installed']);
    uiautomator2 = drivers !== undefined && /uiautomator2/.test(drivers);
  }
  const avdNames = await listAvds();
  return {
    jdk,
    jdkVersion,
    sdk,
    appium,
    appiumVersion,
    uiautomator2,
    avd: avdNames.length > 0,
    avdNames,
    ready: androidToolchainReady({ jdk, sdk, appium, uiautomator2 }),
  };
}

/**
 * @deprecated Use `classifyAppiumVersion` instead. Returns `true` for any
 * version `taqwright doctor` accepts — including 2.x, which is best-effort.
 */
export function isAppiumVersionSupported(version: string): boolean {
  const level = classifyAppiumVersion(version);
  return level === 'recommended' || level === 'best-effort';
}

/**
 * Taqwright requires Node 24.x or 25.x. Appium 3 itself also accepts 20.19+ /
 * 22.12+, but we pin tighter so taqwright projects share one consistent runtime
 * baseline — and Node 26+ is excluded because it has a known bug that breaks
 * taqwright. Exported for testing.
 */
export function isNodeVersionSupported(version: string): boolean {
  const m = version.match(/^v?(\d+)\./);
  if (!m) return false;
  const major = Number(m[1]);
  return Number.isFinite(major) && major >= 24 && major < 26;
}
