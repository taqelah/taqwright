import type { ChildProcess } from 'node:child_process';
import WebDriver from 'webdriver';
import type { Client as WebDriverClient } from 'webdriver';
import {
  Platform,
  type DeviceProvider,
  type TaqwrightUseOptions,
  type DeviceOrientation,
} from '../types/index.js';
import { isPortOpen } from '../auto-appium.js';
import { omitLocalEmulatorCaps } from '../capabilities.js';
import { ensurePlainGlobalDispatcher } from '../undici-dispatcher.js';
import { startAppiumServer, killAppiumOnPort } from '../providers/appium.js';
import { createDeviceProvider } from '../providers/index.js';
import { Recorder, type RecordedAction } from './recorder.js';

/**
 * Apply taqwright's local-connect capability defaults in place. Each default
 * only fills a cap the caller hasn't set explicitly (Extras editor wins):
 * - iOS: `forceSimulatorSoftwareKeyboardPresence` (sims hide the soft keyboard).
 * - Android: `chromedriverAutodownload` (fetch a matching chromedriver on the
 *   first WebView switch) and `nativeWebScreenshot` (fast native screenshot in
 *   WebView contexts instead of the slow chromedriver path).
 * Exported for unit testing — `connectLocal` calls it before `newSession`.
 */
export function applyLocalCapabilityDefaults(
  capabilities: Record<string, unknown>,
  platformName: string,
): void {
  if (
    platformName === 'ios' &&
    !('appium:forceSimulatorSoftwareKeyboardPresence' in capabilities)
  ) {
    capabilities['appium:forceSimulatorSoftwareKeyboardPresence'] = true;
  }
  if (platformName === 'android' && !('appium:chromedriverAutodownload' in capabilities)) {
    capabilities['appium:chromedriverAutodownload'] = true;
  }
  if (platformName === 'android' && !('appium:nativeWebScreenshot' in capabilities)) {
    capabilities['appium:nativeWebScreenshot'] = true;
  }
}

export interface AppiumOpts {
  host: string;
  port: number;
  /** Mount path for Appium (e.g. `/`, `/wd/hub`). */
  path: string;
  /** `http` (default for local) or `https` (cloud hubs). */
  protocol?: 'http' | 'https';
  /** Cloud-only: basic-auth user (e.g. BROWSERSTACK_USERNAME). */
  user?: string;
  /** Cloud-only: basic-auth key (e.g. BROWSERSTACK_ACCESS_KEY). */
  key?: string;
}

export interface InspectorDefaults {
  /** Project name from taqwright.config.ts, if any — for display only. */
  project?: string;
  appium: AppiumOpts;
  capabilities: Record<string, unknown>;
  /**
   * Absolute directory of the user's taqwright.config.ts. `/api/export-script`
   * resolves filenames relative to `<projectRoot>/<testDir>` so a recorded
   * spec lands in the consuming project's test folder.
   */
  projectRoot?: string;
  /** Test directory from `defineConfig({ testDir })`, e.g. `'tests'`. */
  testDir?: string;
  /**
   * Set by `taqwright codegen` (and `taqwright inspect --record`). When true,
   * `session.connect()` flips recording on automatically the moment the
   * WebDriver session is up — the user starts a fresh, ready-to-record
   * session in one click instead of two.
   */
  recordOnConnect?: boolean;
}

/**
 * Cloud-mode connect payload — describes a BrowserStack / LambdaTest target
 * in the same shape `TaqwrightUseOptions` carries it, so the same provider
 * classes the test runner uses can be reused verbatim by the inspector.
 */
export interface CloudConnectRequest {
  provider: 'browserstack' | 'lambdatest';
  user: string;
  key: string;
  platform: 'android' | 'ios';
  deviceName: string;
  osVersion: string;
  orientation?: DeviceOrientation;
  /** Already-uploaded build, e.g. `bs://…` or `lt://…`. Required. */
  appUrl: string;
  appBundleId?: string;
  /** Extra capabilities merged on top of the provider's defaults. */
  capabilities?: Record<string, unknown>;
  /** Project name for the cloud build/session label. */
  projectName?: string;
}

/**
 * Connect request — either local (raw Appium endpoint + caps) or cloud
 * (handed off to `createDeviceProvider` from `src/providers/index.ts`,
 * the same factory the test runner uses).
 */
export interface ConnectRequest {
  appium?: AppiumOpts;
  capabilities?: Record<string, unknown>;
  cloud?: CloudConnectRequest;
}

/**
 * Stateful holder for a single inspector session: the optional WebDriver
 * client, the optional Appium child process we may have spawned, and the
 * recorder. The HTTP server reads/writes this object.
 *
 * Created in a "no session" state — the user opens the landing page,
 * starts Appium (if needed), and submits capabilities to connect.
 */
export class InspectorSession {
  driver: WebDriverClient | undefined;
  platform: Platform | undefined;
  appiumProc: ChildProcess | undefined;
  /** Tracks the appium endpoint we've been told to use, regardless of who started it. */
  appium: AppiumOpts | undefined;
  /** Last known capabilities used to open the session — for display. */
  lastCapabilities: Record<string, unknown> | undefined;
  /**
   * The provider that opened the current session. Cloud providers
   * (BrowserStack, LambdaTest) implement `syncTestDetails` for the
   * dashboard status mark on disconnect. Null for local sessions —
   * those still go through the inline WebDriver newSession path.
   */
  activeProvider: DeviceProvider | null = null;
  readonly recorder = new Recorder();
  /**
   * Toggled by `/api/recording/start` and `/api/recording/stop`. When false,
   * action endpoints still drive the device (so the user can poke around)
   * but don't append a line to the recorded script.
   */
  recording = false;

  /**
   * The active Appium automation context. `'NATIVE_APP'` until the user
   * switches into a `WEBVIEW_*` context via `/api/context`. Drives whether
   * `/api/suggest` generates native or CSS locator candidates.
   */
  currentContext = 'NATIVE_APP';

  /**
   * Set by `cancelConnect()` (Cancel button or a connect timeout) while a
   * `connect()` is in flight. `WebDriver.newSession()` can't be interrupted, so
   * the connect path checks this flag the instant a session materializes and
   * tears it down — otherwise a cancelled/timed-out cloud session leaks as
   * "Running" on the grid until idle-timeout.
   */
  private aborting = false;

  /** Serializes device-touching work so snapshot/suggest never interleave. */
  private deviceQueue: Promise<unknown> = Promise.resolve();
  /** Bumped per /api/suggest so a superseded verify loop can bail early. */
  suggestGen = 0;

  /** Run `fn` exclusively against the driver, serialized after prior callers. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.deviceQueue.then(fn, fn);
    // Keep the chain alive even if one op rejects, so the lock never wedges.
    this.deviceQueue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /**
   * True when the session was wired with a pre-existing driver via
   * `attachDriver(...)` — typically from `mobile.pause()`. Attached sessions
   * skip `deleteSession()` on disconnect (the test fixture owns the driver
   * lifecycle) and surface a "Resume" button in the UI.
   */
  attached = false;

  /**
   * Resolves when the user clicks "Resume" in the inspector UI (a POST to
   * `/api/resume`). Created lazily — `mobile.pause()` reads it and awaits.
   */
  private resumeResolver: (() => void) | null = null;
  private _resumeRequested: Promise<void> | null = null;
  get resumeRequested(): Promise<void> {
    if (!this._resumeRequested) {
      this._resumeRequested = new Promise<void>((resolve) => {
        this.resumeResolver = resolve;
      });
    }
    return this._resumeRequested;
  }
  requestResume(): void {
    this.resumeResolver?.();
  }

  /** Append to the recorded script only when recording is active. */
  recordIf(action: RecordedAction): void {
    if (this.recording) this.recorder.push(action);
  }

  /** List available automation contexts and which one is active. */
  async listContexts(): Promise<{ contexts: string[]; current: string }> {
    if (!this.driver) throw new Error('not connected');
    const contexts = (await this.driver.getAppiumContexts()) as unknown as string[];
    try {
      this.currentContext = (await this.driver.getAppiumContext()) as unknown as string;
    } catch {
      // Some drivers omit getCurrentContext; keep our tracked value.
    }
    return { contexts, current: this.currentContext };
  }

  /**
   * Switch the Appium automation context (`'NATIVE_APP'` or a `WEBVIEW_*`
   * handle), record the switch when recording, and remember it so subsequent
   * locator suggestions target the right (native vs. web) strategies.
   */
  async switchContext(name: string): Promise<void> {
    if (!this.driver) throw new Error('not connected');
    await this.driver.switchAppiumContext(name);
    this.currentContext = name;
    this.recordIf({ kind: 'switchContext', context: name });
  }

  constructor(public readonly defaults: InspectorDefaults) {
    this.appium = { ...defaults.appium };
  }

  isConnected(): boolean {
    return !!this.driver;
  }

  /**
   * Wire the session to a pre-existing WebDriver client owned by an outside
   * caller (typically the test fixture, via `mobile.pause()`). Skips the
   * usual `/api/connect` boot path; `disconnect()` will skip `deleteSession()`
   * since the external owner controls the driver lifecycle.
   */
  attachDriver(
    driver: WebDriverClient,
    platform: Platform,
    capabilities?: Record<string, unknown>,
  ): void {
    if (this.driver) throw new Error('attachDriver: already connected');
    this.driver = driver;
    this.platform = platform;
    this.lastCapabilities = capabilities ?? {};
    this.activeProvider = null;
    this.attached = true;
    this.currentContext = 'NATIVE_APP';
  }

  /**
   * Probe the configured Appium endpoint; if nothing is listening, spawn an
   * Appium child and wait for it to come up. Idempotent — calling repeatedly
   * with the same endpoint is safe.
   */
  async ensureAppium(opts: AppiumOpts): Promise<{ started: boolean; alreadyRunning: boolean }> {
    this.appium = opts;
    if (await isPortOpen(opts.host, opts.port)) {
      return { started: false, alreadyRunning: true };
    }
    if (this.appiumProc && !this.appiumProc.killed) {
      // We've already spawned it — wait briefly for the port to come up.
      for (let i = 0; i < 60; i++) {
        if (await isPortOpen(opts.host, opts.port)) {
          return { started: true, alreadyRunning: false };
        }
        await sleep(500);
      }
    }
    this.appiumProc = await startAppiumServer('inspector', {
      host: opts.host,
      port: opts.port,
      basePath: opts.path,
    });
    return { started: true, alreadyRunning: false };
  }

  /** Kill any Appium on the target port (ours or external) and start fresh. */
  async restartAppium(opts: AppiumOpts): Promise<{ started: boolean; alreadyRunning: boolean }> {
    // If a session is live it belongs to the server we're about to kill —
    // tear it down cleanly first so we don't leave a dangling driver.
    if (this.isConnected()) {
      await this.disconnect().catch(() => {});
    }
    if (this.appiumProc && !this.appiumProc.killed) {
      this.appiumProc.kill();
    }
    this.appiumProc = undefined;
    await killAppiumOnPort(opts.port);
    // Wait for the socket to actually free up — ensureAppium would otherwise
    // see the dying server as "already running" and skip the respawn.
    for (let i = 0; i < 20; i++) {
      if (!(await isPortOpen(opts.host, opts.port))) break;
      await sleep(250);
    }
    return this.ensureAppium(opts);
  }

  /** Open a WebDriver session against the configured target. */
  async connect(req: ConnectRequest): Promise<void> {
    if (this.driver) {
      throw new Error('already connected — disconnect first');
    }
    this.aborting = false;
    if (req.cloud) {
      await this.connectCloud(req.cloud);
    } else {
      if (!req.appium || !req.capabilities) {
        throw new Error('Local connect requires { appium, capabilities }.');
      }
      await this.connectLocal(req.appium, req.capabilities);
    }
    if (this.defaults.recordOnConnect) {
      this.recorder.clear();
      this.recording = true;
    }
  }

  /** Direct WebDriver newSession against a local Appium server. */
  private async connectLocal(
    appium: AppiumOpts,
    capabilities: Record<string, unknown>,
  ): Promise<void> {
    this.appium = appium;
    const platformName = String(capabilities['platformName'] ?? '').toLowerCase();
    this.platform = platformName === 'ios' ? Platform.IOS : Platform.ANDROID;
    applyLocalCapabilityDefaults(capabilities, platformName);
    this.lastCapabilities = capabilities;
    this.activeProvider = null;
    ensurePlainGlobalDispatcher();
    this.driver = await WebDriver.newSession({
      hostname: appium.host,
      port: appium.port,
      path: appium.path,
      protocol: appium.protocol ?? 'http',
      logLevel: 'warn',
      capabilities,
    });
    this.currentContext = 'NATIVE_APP';
    await this.abortIfCancelled();
  }

  /**
   * Cloud connect — reuses the same `BrowserStackDeviceProvider` /
   * `LambdaTestDeviceProvider` classes the test runner uses, so the
   * inspector and the runner agree on caps, app upload, and session
   * status reporting.
   */
  private async connectCloud(cloud: CloudConnectRequest): Promise<void> {
    if (!cloud.appUrl) {
      throw new Error('Cloud connect requires an app URL (bs://… or lt://…).');
    }
    if (!cloud.user || !cloud.key) {
      throw new Error(`${cloud.provider} username + access key are required.`);
    }
    // Provider classes read credentials from process.env. Set them for
    // the duration of this connect; they get cleared on disconnect so
    // the next mode swap doesn't leak.
    if (cloud.provider === 'browserstack') {
      process.env.BROWSERSTACK_USERNAME = cloud.user;
      process.env.BROWSERSTACK_ACCESS_KEY = cloud.key;
    } else {
      process.env.LAMBDATEST_USERNAME = cloud.user;
      process.env.LAMBDATEST_ACCESS_KEY = cloud.key;
    }
    const platform = cloud.platform === 'ios' ? Platform.IOS : Platform.ANDROID;
    // Codegen is interactive: unlike `taqwright test`, don't auto-accept
    // permission / system alerts (location, gallery, …) so the user can see and
    // record the grant step. Override the providers' true-defaults via
    // use.capabilities (merged last by both providers), using each provider's
    // own key naming. An explicit user value still wins.
    // Strip local-emulator-only caps (appium:avd, …) — the inspector seeds its
    // form from the local config, so a cloud selection can carry them in; they'd
    // be wrong on a cloud provider (which picks the device by name + version).
    const userCloudCaps = omitLocalEmulatorCaps(cloud.capabilities ?? {});
    const permKeys =
      cloud.provider === 'browserstack'
        ? ['appium:autoGrantPermissions', 'appium:autoAcceptAlerts']
        : ['autoGrantPermissions', 'autoAcceptAlerts'];
    const codegenPermOff: Record<string, unknown> = {};
    for (const k of permKeys) {
      if (!(k in userCloudCaps)) codegenPermOff[k] = false;
    }
    const use = {
      platform,
      device: {
        provider: cloud.provider,
        name: cloud.deviceName,
        osVersion: cloud.osVersion,
        orientation: cloud.orientation ?? 'portrait',
      },
      buildPath: cloud.appUrl,
      appBundleId: cloud.appBundleId,
      capabilities: { ...codegenPermOff, ...userCloudCaps },
    } as TaqwrightUseOptions;
    const provider = createDeviceProvider(use, cloud.projectName ?? 'inspector');
    if (provider.globalSetup) await provider.globalSetup();
    const handle = await provider.getDevice();
    this.activeProvider = provider;
    this.driver = handle.driver;
    this.platform = platform;
    // Store only the user's caps; don't leak the codegen-only override.
    this.lastCapabilities = userCloudCaps;
    this.currentContext = 'NATIVE_APP';
    await this.abortIfCancelled();
  }

  /**
   * If a cancel/timeout landed while `newSession`/`getDevice` was in flight,
   * tear the just-opened session down (reusing `disconnect()` so a cloud
   * session is dashboard-synced + deleted, not left "Running") and reject.
   */
  private async abortIfCancelled(): Promise<void> {
    if (!this.aborting) return;
    await this.disconnect();
    throw new Error('connect cancelled');
  }

  /**
   * Abort an in-flight `connect()` — invoked by the Cancel button
   * (`/api/connect/cancel`) or a connect timeout. `newSession` can't be
   * interrupted, so this flags the connect to self-destruct the moment the
   * session materializes; if it already committed (cancel raced completion),
   * disconnect now.
   */
  cancelConnect(): void {
    this.aborting = true;
    if (this.driver) void this.disconnect();
  }

  /**
   * Tear down the WebDriver session (but leave Appium running). For cloud
   * sessions, the active provider's `syncTestDetails` marks the dashboard
   * status as completed first so BrowserStack / LambdaTest don't leave it
   * as "Running" until idle-timeout fires.
   */
  async disconnect(): Promise<void> {
    if (!this.driver) return;
    if (this.activeProvider?.syncTestDetails) {
      try {
        await this.activeProvider.syncTestDetails({
          status: 'passed',
          reason: 'taqwright inspector ended',
        });
      } catch {
        /* best-effort — never block disconnect */
      }
    }
    // Attached sessions don't own the driver — the test fixture does. Skip
    // deleteSession so the in-flight test can keep running after Resume.
    if (!this.attached) {
      try {
        await this.driver.deleteSession();
      } catch {
        // session may already be gone
      }
    }
    this.driver = undefined;
    this.platform = undefined;
    this.lastCapabilities = undefined;
    this.activeProvider = null;
    this.attached = false;
    // Recording state is per-session; reset it so a fresh connect starts clean.
    this.recording = false;
    this.currentContext = 'NATIVE_APP';
  }

  /** Full cleanup: disconnect, then kill any Appium we spawned. */
  async cleanup(): Promise<void> {
    await this.disconnect();
    if (this.appiumProc && !this.appiumProc.killed) {
      this.appiumProc.kill();
      this.appiumProc = undefined;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
