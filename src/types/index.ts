import type { Client as WebDriverClient } from 'webdriver';

export enum Platform {
  ANDROID = 'android',
  IOS = 'ios',
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Hardware buttons available to `mobile.pressButton()`. Names mirror Android
 * `KeyEvent.KEYCODE_*` constants (UPPER_SNAKE_CASE) so they can be mapped
 * directly to keycodes; iOS implementations translate them as needed.
 */
export type HardwareButton = 'HOME' | 'BACK' | 'POWER' | 'VOLUME_UP' | 'VOLUME_DOWN' | 'ENTER';

export type DeviceOrientation = 'portrait' | 'landscape';

/**
 * One slot in a parallel-run device pool. Each entry pins one worker's
 * `appium:udid`. `name` / `osVersion` are optional per-device overrides
 * for mixed pools (e.g. a Pixel 6 + a Galaxy S22).
 */
export interface DevicePoolEntry {
  udid: string;
  name?: string;
  osVersion?: string;
}

export interface EmulatorDeviceConfig {
  provider: 'emulator';
  /**
   * Device/avd name. Strings are passed to Appium verbatim; regexes are
   * matched against discovered devices and the resolved name is used.
   */
  name?: string | RegExp;
  /** Optional explicit OS version (e.g. '14', '17.0'). */
  osVersion?: string;
  /** UDID of the emulator/simulator. */
  udid?: string;
  /** Default orientation. Defaults to 'portrait'. */
  orientation?: DeviceOrientation;
  /**
   * Devices to distribute across parallel workers. When set and `workers > 1`,
   * the fixture assigns `pool[parallelIndex]` to each worker and stamps
   * unique `appium:systemPort` / `wdaLocalPort` / `chromedriverPort` /
   * `mjpegServerPort` so concurrent sessions don't fight over driver ports.
   * Worker N with no slot in the pool fails fast with a clear error.
   */
  pool?: DevicePoolEntry[];
  /**
   * Auto-discover local devices and partition them across `workers` instead
   * of hand-writing a `pool`. taqwright enumerates the active-SDK AVDs (and
   * any already-running emulators), cold-boots shutdown ones as needed to
   * reach the `workers` count, assigns one per worker, and **fails fast** if
   * fewer are available than `workers`. Mutually exclusive with `pool` and
   * `udid`. Resolved once at run start (a `globalSetup` hook), so the
   * concrete device set is frozen before any worker forks.
   */
  autoDiscover?: boolean;
}

export interface LocalDeviceConfig {
  provider: 'local-device';
  /**
   * Device name. Strings are passed to Appium verbatim; regexes are matched
   * against discovered devices and the resolved name is used.
   */
  name?: string | RegExp;
  /** Optional explicit udid/serial. */
  udid?: string;
  /** Optional explicit OS version. */
  osVersion?: string;
  /** Default orientation. Defaults to 'portrait'. */
  orientation?: DeviceOrientation;
  /** Same as `EmulatorDeviceConfig.pool` — see that field for docs. */
  pool?: DevicePoolEntry[];
  /**
   * Auto-discover connected physical devices and partition them across
   * `workers`. Android only — enumerates `adb`-online physical devices
   * (emulators excluded), one per worker, and **fails fast** if fewer are
   * connected than `workers`. Physical devices can't be booted, so this only
   * uses what's already plugged in. `local-device` + iOS is not yet
   * supported (no multi-UDID enumerator). Mutually exclusive with `pool` /
   * `udid`. See `EmulatorDeviceConfig.autoDiscover` for the resolution model.
   */
  autoDiscover?: boolean;
}

/** Fields shared by cloud device providers (BrowserStack, LambdaTest, …). */
interface CloudDeviceConfigBase {
  /** Device name as listed by the cloud provider. */
  name: string;
  /** OS version as listed by the cloud provider. */
  osVersion: string;
  /** Default orientation. Defaults to 'portrait'. */
  orientation?: DeviceOrientation;
  /** Whether to enable camera image injection. */
  enableCameraImageInjection?: boolean;
}

export interface BrowserStackDeviceConfig extends CloudDeviceConfigBase {
  provider: 'browserstack';
}

export interface LambdaTestDeviceConfig extends CloudDeviceConfigBase {
  provider: 'lambdatest';
}

export type DeviceConfig =
  | EmulatorDeviceConfig
  | LocalDeviceConfig
  | BrowserStackDeviceConfig
  | LambdaTestDeviceConfig;

/** Live session returned by a `DeviceProvider`. */
export interface DeviceHandle {
  driver: WebDriverClient;
  bundleId?: string;
  options: { expectTimeout: number };
  provider: string;
}

/**
 * Common contract every device provider implements.
 */
export interface DeviceProvider {
  /** One-time setup before any session is created (validate config, upload build, …). */
  globalSetup?(): Promise<void>;
  /** Open an Appium session and return the live device handle. */
  getDevice(): Promise<DeviceHandle>;
  /** Push test status / metadata to a cloud provider. */
  syncTestDetails?(details: { status?: string; reason?: string; name?: string }): Promise<void>;
}

export interface AppiumServerConfig {
  /** Hostname of the Appium server. Default: 'localhost'. */
  host?: string;
  /** Port of the Appium server. Default: 4723. */
  port?: number;
  /** URL path the Appium server is mounted at. Default: '/'. */
  path?: string;
  /** Appium `newCommandTimeout` capability, in seconds. Default: 240. */
  newCommandTimeout?: number;
  /**
   * WebDriver client connection/session-creation timeout, in ms (wdio
   * `connectionRetryTimeout`). Raise it when device allocation is slow — e.g.
   * many parallel BrowserStack sessions queue for real devices and the default
   * (120000) aborts the `/session` request. Applies to local + cloud; cloud
   * defaults to 300000 when unset.
   */
  connectionTimeout?: number;
  /** WebDriver client log level. Default: 'warn'. */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /**
   * If true, taqwright will probe `host:port` before running tests and
   * spawn `npx appium` when nothing is listening. If an **Appium** server is
   * already running on that port, it is stopped and replaced with a fresh
   * instance rooted in the current working directory (so relative `buildPath`
   * values resolve against the active project, not a stale server's cwd). A
   * non-Appium listener on the port is left untouched. Default: false.
   */
  autoStart?: boolean;
  /**
   * If true, taqwright asks Appium to boot the target device when it's
   * offline (the device itself, not the server — that's `autoStart`).
   *
   * - Android `emulator`: the resolved AVD id (a **string** `device.name`,
   *   or each `device.pool` entry's `name`) is passed as `appium:avd` so
   *   the UiAutomator2 driver cold-boots it and waits for readiness. A
   *   RegExp `device.name` can't be booted and is rejected at config load
   *   when this is set **explicitly** to `true`.
   * - iOS `emulator`: the XCUITest driver already auto-boots a matching
   *   simulator from `deviceName` + `platformVersion`; this only raises
   *   the simulator startup timeout.
   * - `local-device` (real phone) and cloud providers: no-op.
   *
   * Default: `true`. Set `false` to opt out (e.g. you start the AVD by
   * hand and don't want taqwright to wait for boot). On Android-emulator
   * projects without a string `device.name`, the boot attempt is silently
   * skipped — the field is harmless to leave at its default.
   */
  autoStartDevice?: boolean;
}

interface TaqwrightUseOptionsBase {
  platform: Platform;
  device: DeviceConfig;
  /** Path to the .apk / .ipa / .app / .app.zip to install. */
  buildPath?: string;
  /** App bundle ID (Android package name / iOS bundle id). */
  appBundleId?: string;
  /** Default timeout for locator actions, in ms. Default: 30_000. */
  expectTimeout?: number;
  /** Appium server connection settings. */
  appium?: AppiumServerConfig;
  /**
   * Extra `appium:*` (or any other) capabilities, merged on top of the
   * defaults — escape hatch for things like `appium:autoGrantPermissions`
   * or `appium:wdaLocalPort`.
   */
  capabilities?: Record<string, unknown>;
  /**
   * Trace artifact mode. When enabled, per-action screenshots + page-source
   * + timing are captured during the test and written to a self-contained
   * HTML under the test's `testInfo.outputPath('trace.html')`, also attached
   * to the Playwright HTML report.
   *
   * - `'off'` (default) — no overhead.
   * - `'on'` — trace every test; HTML always written.
   * - `'on-failure'` — trace every test; HTML written only on failure.
   * - `'retain-on-failure'` — alias of `'on-failure'` on mobile.
   *
   * Each entry adds one `takeScreenshot` + one `getPageSource` round-trip
   * (~100–300ms local, more over USB). Recommended for CI: `'on-failure'`.
   */
  trace?: TraceMode;
  /**
   * Screen-recording video mode. When enabled, the fixture starts an
   * Appium on-device screen recording at session start and stops it at
   * teardown, attaching the resulting `screen.mp4` to the Playwright HTML
   * report as `taqwright-video` (a plain video — NOT the Trace Viewer).
   *
   * - `'off'` (default) — no recording; zero overhead.
   * - `'on'` — record every test; `.mp4` always kept.
   * - `'on-failure'` — record every test; `.mp4` kept only on failure.
   * - `'retain-on-failure'` — alias of `'on-failure'` on mobile.
   *
   * Unlike `trace` there is no per-action cost — Appium records on the
   * device for the whole run. But every run pays the device recorder plus
   * a base64 transfer at teardown, even when the buffer is discarded on a
   * pass (`'on-failure'`/`'retain-on-failure'`). Expect a few MB per
   * minute. iOS-simulator recording support varies by driver.
   */
  video?: VideoMode;
  /**
   * Network capture mode. When enabled, the fixture spins up a local MITM
   * proxy, transparently routes the device/simulator's traffic through it,
   * and attaches a HAR 1.2 file (`taqwright-har`) to the Playwright HTML
   * report. Zero-touch: taqwright generates its own CA, installs it where it
   * can (Android emulator system store, iOS Simulator system keychain), and
   * cleans up on teardown — including crash paths.
   *
   * - `'off'` (default) — no capture.
   * - `'on'` — capture every test; HAR always attached.
   * - `'on-failure'` — capture every test; HAR attached only on failure.
   * - `'retain-on-failure'` — alias of `'on-failure'` on mobile.
   *
   * Supported only for `provider: 'emulator'` (Android AVD + iOS Simulator)
   * on a local Appium. Cloud providers ship their own HAR via their hub;
   * real devices and Google Play AVDs cannot be configured without user
   * action and are skipped with a one-line note in the artifact.
   * Cert-pinned hosts are detected and noted, other hosts continue capturing.
   *
   * iOS Simulator note: the macOS host proxy is briefly redirected to
   * `127.0.0.1:<port>` and restored on teardown (and on `SIGINT`/`SIGTERM`/
   * crash). Host traffic during the test routes through the same proxy.
   */
  network?: NetworkMode;
}

export type TraceMode = 'off' | 'on' | 'on-failure' | 'retain-on-failure';

export type VideoMode = 'off' | 'on' | 'on-failure' | 'retain-on-failure';

export type NetworkMode = 'off' | 'on' | 'on-failure' | 'retain-on-failure';

/**
 * `use` options for an taqwright project. When `resetBetweenTests` is
 * `true`, both `buildPath` and `appBundleId` are required so the fixture
 * can terminate + uninstall + install + launch the app between tests.
 */
export type TaqwrightUseOptions = TaqwrightUseOptionsBase &
  (
    | { resetBetweenTests?: false }
    | { resetBetweenTests: true; buildPath: string; appBundleId: string }
  );

/** Test-runner options shared between top-level and per-project configs. */
interface TestRunnerOptions {
  testDir?: string;
  testMatch?: string | RegExp | Array<string | RegExp>;
  testIgnore?: string | RegExp | Array<string | RegExp>;
  timeout?: number;
  retries?: number;
  outputDir?: string;
}

export interface TaqwrightProjectConfig extends TestRunnerOptions {
  name: string;
  use: TaqwrightUseOptions;
  grep?: RegExp | Array<RegExp>;
  grepInvert?: RegExp | Array<RegExp>;
  dependencies?: string[];
  /**
   * Number of parallel test workers for *this* project — the project's tests
   * are distributed across that many devices. Must be `<= device.pool.length`
   * (or the number of devices `device.autoDiscover` resolves); `defineConfig`
   * throws at config load otherwise. Falls back to the top-level
   * `config.workers ?? 1` when omitted.
   *
   * Because Playwright's worker pool is global, the canonical way to run a
   * per-project worker count is `taqwright test --project=<name>` — the CLI
   * sizes Playwright's global pool to this project's `workers`.
   */
  workers?: number;
}

export interface TaqwrightConfig extends TestRunnerOptions {
  projects: TaqwrightProjectConfig[];
  /**
   * Default expect timeout (ms) applied when a project doesn't specify one.
   * Per-project overrides go in `project.use.expectTimeout`.
   */
  expectTimeout?: number;
  /**
   * Fallback default worker count, applied to any project that omits its own
   * `project.workers`. Defaults to `1` (serial). A worker > 1 needs a
   * `device.pool` (or `device.autoDiscover`) with at least that many entries
   * on every emulator / local-device project it applies to — otherwise
   * `defineConfig` throws at config load (Playwright cannot run two workers
   * against the same Appium + same device safely). Cloud providers manage
   * their own queueing and are exempt.
   *
   * Prefer setting `workers` per project (see `TaqwrightProjectConfig.workers`);
   * this top-level value just supplies a default. The global Playwright pool is
   * sized to the max effective workers across projects.
   */
  workers?: number;
  fullyParallel?: boolean;
  forbidOnly?: boolean;
  reporter?:
    | 'list'
    | 'html'
    | 'json'
    | 'junit'
    | 'line'
    | 'dot'
    | Array<[string] | [string, unknown]>;
  globalSetup?: string | string[];
  globalTeardown?: string | string[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenSize {
  width: number;
  height: number;
}

export interface GesturePointer {
  x: number;
  y: number;
  /** Time offset from start in ms. */
  time: number;
}

export interface GestureOptions {
  pointers: GesturePointer[][];
}

/** Internal: how a Locator describes the element it targets. */
export interface LocatorStrategy {
  using:
    | 'accessibility id'
    | 'id'
    | 'class name'
    | 'xpath'
    | 'name'
    | 'css selector'
    | '-android uiautomator'
    | '-ios predicate string'
    | '-ios class chain';
  value: string;
  /**
   * If set, after `findElement` returns, filter elements whose `text` /
   * `value` / `label` matches this. Used by `getByText` against XPath
   * matches that need extra precision.
   */
  textFilter?: string | RegExp;
}

/** WebDriver's W3C element reference key. */
export const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf' as const;
export type ElementRef = Record<typeof W3C_ELEMENT_KEY, string>;

/**
 * RegExp serialized to a wire-friendly shape: `{ regex, flags }`. Used inside
 * `LocatorDescriptor` so the inspector can post chained locators (with
 * `hasText: /foo/i` style patterns) as JSON.
 */
export type SerializedText = string | { regex: string; flags: string };

/**
 * Wire format for a chained locator. The inspector's `/api/locator-action`
 * endpoint accepts this in the `descriptor` field (with the legacy flat
 * `{ using, value }` shape kept as a back-compat alias for the `leaf` kind).
 *
 * `leaf` is the only kind that carries a `LocatorStrategy`; every other
 * kind composes existing descriptors. Mirrors the chain methods on
 * `Locator`: `first` / `last` / `nth` / `filter` / `locator` / `and` / `or`.
 */
export type LocatorDescriptor =
  | { kind: 'leaf'; using: LocatorStrategy['using']; value: string; textFilter?: SerializedText }
  | { kind: 'first'; on: LocatorDescriptor }
  | { kind: 'last'; on: LocatorDescriptor }
  | { kind: 'nth'; on: LocatorDescriptor; n: number }
  | { kind: 'filter'; on: LocatorDescriptor; filter: SerializedFilter }
  | { kind: 'child'; parent: LocatorDescriptor; child: LocatorDescriptor }
  | { kind: 'and'; left: LocatorDescriptor; right: LocatorDescriptor }
  | { kind: 'or'; left: LocatorDescriptor; right: LocatorDescriptor };

export interface SerializedFilter {
  has?: LocatorDescriptor;
  hasNot?: LocatorDescriptor;
  hasText?: SerializedText;
  hasNotText?: SerializedText;
  visible?: boolean;
}
