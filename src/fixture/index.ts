import type { ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { test as baseTest } from '@playwright/test';
import WebDriver from 'webdriver';
import type { Client as WebDriverClient } from 'webdriver';
import { Mobile } from '../mobile/index.js';
import {
  Platform,
  type DevicePoolEntry,
  type DeviceProvider,
  type TaqwrightUseOptions,
} from '../types/index.js';
import { getUseOptions, loadTaqwrightConfig } from '../config.js';
import { resolvedPoolEnvKey } from '../discovery.js';
import { appiumRemoteOptions } from '../capabilities.js';
import { isPortOpen } from '../auto-appium.js';
import { startAppiumServer } from '../providers/appium.js';
import {
  resolveAndroidSerial,
  waitForAndroidDeviceReady,
  isTransientDeviceError,
} from '../inspector/devices.js';
import { logger } from '../logger.js';
import { avdBootPreflightError } from '../setup/avd.js';
import { createDeviceProvider, isCloudProvider } from '../providers/index.js';
import { Tracer } from '../tracer/index.js';
import { wrapForTracing } from '../tracer/proxy.js';
import { shouldRetainArtifact } from './artifact-mode.js';
import type { HarLog } from '../network/har.js';
import {
  prepareNetworkProxy,
  configureDeviceForCapture,
  teardownDeviceCapture,
  teardownNetworkProxy,
  extractUdid,
  type NetworkProxyHandle,
} from '../network/index.js';

const DEFAULT_TIMEOUT = 30_000;

// Appium `mobile: startScreenRecording` defaults to ~180s and silently
// truncates longer runs. 1800s is the Appium maximum; the recording's file
// size tracks actual duration, so a high cap never wastes space — it just
// removes the truncation foot-gun for long mobile tests.
const VIDEO_TIME_LIMIT_SECONDS = 1800;

interface TaqwrightFixtures {
  mobile: Mobile;
  rawDriver: WebDriverClient;
  /**
   * Network capture handle for the current test. `null` when `use.network`
   * is `'off'`, the project is on a cloud provider (the hub captures HAR
   * server-side), or no proxy could be started. The `mobile` fixture's
   * teardown writes the HAR artifact through this handle.
   */
  networkProxy: NetworkProxyHandle | null;
}

interface TaqwrightWorkerFixtures {
  taqwrightUse: TaqwrightUseOptions;
  // The cloud DeviceProvider for this worker, or `null` for local/emulator
  // (which take the inline `appiumRemoteOptions` path). Worker-scoped so the
  // provider's one-time `globalSetup()` (creds check + build upload) runs once
  // per worker, not per test.
  deviceProvider: DeviceProvider | null;
}

/** How many times to (re)attempt a local device operation on a transient blip. */
const LOCAL_RETRY_ATTEMPTS = 3;

/**
 * The adb serial for a LOCAL Android target (emulator / local-device), or
 * `undefined` for iOS, cloud, or a target whose serial can't be resolved yet
 * (e.g. an autoStartDevice cold start that Appium will boot). Callers use the
 * `undefined` case to skip the readiness gate and behave exactly as before.
 */
async function localAndroidSerial(use: TaqwrightUseOptions): Promise<string | undefined> {
  const device = use.device as { provider?: string; udid?: string; name?: string | RegExp };
  const isLocal = device.provider === 'emulator' || device.provider === 'local-device';
  if (use.platform !== Platform.ANDROID || !isLocal) return undefined;
  const avdName = typeof device.name === 'string' ? device.name : undefined;
  return resolveAndroidSerial({ udid: device.udid, avdName });
}

/**
 * Run a device operation with a readiness gate + bounded retry. A local Android
 * emulator that was healthy can drop its adb connection mid-run (an "offline"
 * blip under load with multiple emulators), failing session init or the
 * reset-between-tests reinstall/relaunch. Before each attempt we wait
 * (best-effort) for `serial` to be online + PackageManager-ready; on a transient
 * device error we re-wait and retry rather than failing the test. `label` names
 * the operation in the warning log.
 */
async function withDeviceReadyRetry<T>(
  serial: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= LOCAL_RETRY_ATTEMPTS; attempt++) {
    const ready = await waitForAndroidDeviceReady(serial);
    if (!ready) {
      logger.warn(
        `taqwright: ${serial} not reporting ready before ${label} attempt ${attempt}/${LOCAL_RETRY_ATTEMPTS} — trying anyway.`,
      );
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < LOCAL_RETRY_ATTEMPTS && isTransientDeviceError(message)) {
        logger.warn(
          `taqwright: transient device error on ${serial} during ${label} (attempt ${attempt}/${LOCAL_RETRY_ATTEMPTS}), waiting for it to recover and retrying — ${message}`,
        );
        continue;
      }
      throw err;
    }
  }
  // Unreachable in practice (the loop returns or throws), but satisfies control flow.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Create the WebDriver session for a local target, with the readiness gate +
 * retry for Android. iOS / non-resolvable targets fall straight through to a
 * single `newSession` — behaviour is unchanged there.
 */
async function createLocalSession(use: TaqwrightUseOptions): Promise<WebDriverClient> {
  const newSession = () => WebDriver.newSession(appiumRemoteOptions(use));
  const serial = await localAndroidSerial(use);
  if (!serial) {
    // No resolved serial → about to cold-boot (or non-resolvable). For a named
    // Android emulator AVD that autoStartDevice will boot, pre-flight its system
    // image so a managed-SDK / system-AVD mismatch fails clearly instead of a
    // cryptic emulator "Broken AVD system path" FATAL.
    const device = use.device as { provider?: string; name?: string | RegExp };
    const avdName = typeof device.name === 'string' ? device.name : undefined;
    if (
      use.platform === Platform.ANDROID &&
      device.provider === 'emulator' &&
      avdName &&
      use.appium?.autoStartDevice !== false
    ) {
      const err = await avdBootPreflightError(avdName);
      if (err) throw new Error(err);
    }
    return newSession();
  }
  return withDeviceReadyRetry(serial, 'session creation', newSession);
}

/**
 * taqwright's `test`. Each test gets a fresh WebDriver session against
 * the configured Appium server and a wrapped `Mobile` ready to drive it.
 */
export const test = baseTest.extend<TaqwrightFixtures, TaqwrightWorkerFixtures>({
  taqwrightUse: [
    async ({}, use, workerInfo) => {
      const config = await loadTaqwrightConfig();
      const projectName = workerInfo.project.name || undefined;
      const useOpts = getUseOptions(config, projectName);
      if (!useOpts) {
        throw new Error(
          `taqwright: no project found in taqwright.config.ts${
            projectName ? ` matching "${projectName}"` : ''
          }`,
        );
      }

      const idx = workerInfo.parallelIndex;
      const dev = useOpts.device as { pool?: DevicePoolEntry[]; autoDiscover?: boolean };
      let pool = dev.pool;

      // Auto-discover: the globalSetup hook resolved the device set before any
      // worker forked and published it as an env var. Hydrate `pool` from it so
      // the partition path below treats it exactly like a hand-written pool.
      if ((!pool || pool.length === 0) && dev.autoDiscover) {
        const resolved = process.env[resolvedPoolEnvKey(projectName)];
        if (!resolved) {
          throw new Error(
            `taqwright: device.autoDiscover is set on project "${projectName ?? ''}" but no ` +
              `resolved device pool was found — the globalSetup hook did not run. Launch via ` +
              `\`taqwright test\` (or Playwright with the generated config).`,
          );
        }
        pool = JSON.parse(resolved) as DevicePoolEntry[];
      }

      // No pool → existing single-device path. Worker fixture is one-shot,
      // no per-worker spawn needed (the CLI already started Appium if
      // `appium.autoStart`).
      if (!pool || pool.length === 0) {
        await use(useOpts);
        return;
      }

      // Pool path: partition by parallelIndex, fail fast on exhaustion.
      if (idx >= pool.length) {
        throw new Error(
          `taqwright: worker #${idx} has no device — pool has ${pool.length} entr${
            pool.length === 1 ? 'y' : 'ies'
          }. Reduce \`workers\` or grow the pool.`,
        );
      }
      const slot = pool[idx]!;
      const baseAppiumPort = useOpts.appium?.port ?? 4723;
      const partitioned: TaqwrightUseOptions = {
        ...useOpts,
        device: {
          ...useOpts.device,
          udid: slot.udid,
          name: slot.name ?? useOpts.device.name,
          osVersion: slot.osVersion ?? useOpts.device.osVersion,
        } as TaqwrightUseOptions['device'],
        appium: { ...useOpts.appium, port: baseAppiumPort + idx },
        capabilities: {
          ...(useOpts.capabilities ?? {}),
          // Driver-specific ports — staggered per worker so two Appiums
          // talking to two devices don't fight over ADB / WDA / chromedriver.
          'appium:systemPort': 8200 + idx,
          'appium:chromedriverPort': 9515 + idx,
          'appium:mjpegServerPort': 7810 + idx,
          'appium:wdaLocalPort': 8100 + idx,
          // iOS only — parallel Xcode/WDA builds would corrupt each
          // other's intermediates if they shared a DerivedData dir.
          'appium:derivedDataPath': `/tmp/wda-${idx}`,
        },
      } as TaqwrightUseOptions;

      // Per-worker Appium spawn (only when autoStart is on and the port
      // isn't already serving). Killed in `finally` when the worker tears
      // down so we never leak children.
      let proc: ChildProcess | undefined;
      if (
        partitioned.appium?.autoStart &&
        partitioned.appium.host &&
        partitioned.appium.port !== undefined &&
        !(await isPortOpen(partitioned.appium.host, partitioned.appium.port))
      ) {
        proc = await startAppiumServer('worker', {
          host: partitioned.appium.host,
          port: partitioned.appium.port,
          basePath: partitioned.appium.path,
        });
      }
      try {
        await use(partitioned);
      } finally {
        if (proc && !proc.killed) proc.kill();
      }
    },
    { scope: 'worker' },
  ],

  // Worker-scoped: build the cloud provider once and run its expensive
  // one-time `globalSetup()` (validate creds, upload the build) a single time
  // per worker (each Playwright worker is its own process, so N workers = N
  // uploads unless the build is already a `bs://`/`lt://` URL). `null` for
  // local/emulator — those still go through `appiumRemoteOptions`. Mirrors
  // the inspector's `connectCloud()` sequence.
  deviceProvider: [
    async ({ taqwrightUse }, use, workerInfo) => {
      const provider = (taqwrightUse.device as { provider?: string }).provider;
      if (!isCloudProvider(provider)) {
        await use(null);
        return;
      }
      const dp = createDeviceProvider(taqwrightUse, workerInfo.project.name || undefined);
      // Let `globalSetup()` throw: a missing-cred / failed-upload error must
      // fail the worker fast with the provider's actionable message rather
      // than surfacing later as a cryptic session error.
      if (dp.globalSetup) await dp.globalSetup();
      await use(dp);
    },
    { scope: 'worker' },
  ],

  // Test-scoped network-capture handle. Ordering: `rawDriver` depends on
  // `networkProxy`, and `mobile` depends on `rawDriver`. Playwright tears
  // down in reverse, so the chain is `mobile → rawDriver → networkProxy`.
  // The MITM proxy is alive during the whole session (including the reset
  // dance in `mobile`), and host-proxy restore happens last — AFTER the
  // WebDriver session is closed. Cloud projects bypass this entirely; the
  // cloud hub captures HAR server-side.
  networkProxy: async ({ taqwrightUse, deviceProvider }, use, testInfo) => {
    const networkMode = taqwrightUse.network ?? 'off';
    if (networkMode === 'off' || deviceProvider !== null) {
      await use(null);
      return;
    }
    let handle: NetworkProxyHandle | null;
    try {
      handle = await prepareNetworkProxy({
        platform: taqwrightUse.platform,
        parallelIndex: testInfo.parallelIndex,
      });
    } catch (err) {
      // Proxy could not start (EADDRINUSE, etc.) — degrade silently so
      // the test still runs. The HAR for this test will simply be absent.
      handle = null;

      console.warn(`taqwright: network capture disabled — ${(err as Error).message}`);
    }
    try {
      await use(handle);
    } finally {
      if (handle) await teardownNetworkProxy(handle);
    }
  },

  rawDriver: async ({ taqwrightUse, deviceProvider, networkProxy }, use, testInfo) => {
    // Local/emulator: unchanged inline-capabilities path.
    if (!deviceProvider) {
      const driver = await createLocalSession(taqwrightUse);
      // Once the session is up, the udid is known. Install the CA + set
      // the device-side proxy now, before any user-test code runs. All
      // failures are recorded on `networkProxy.attemptLog` and produce a
      // stub HAR — they never fail the test.
      if (networkProxy) {
        const udid =
          extractUdid(driver.capabilities) ?? (taqwrightUse.device as { udid?: string }).udid;
        await configureDeviceForCapture(networkProxy, {
          udid,
          platform: taqwrightUse.platform,
        });
      }
      try {
        await use(driver);
      } finally {
        if (networkProxy) {
          // Clear the device proxy BEFORE `deleteSession` — we still have
          // adb access via the device udid; afterwards the proxy entry
          // would stay set on the AVD between tests.
          await teardownDeviceCapture(networkProxy);
        }
        try {
          await driver.deleteSession();
        } catch {
          // session may already be gone
        }
      }
      return;
    }

    // Cloud: the provider owns session creation (https hub + creds baked in).
    // `rawDriver` tears down last among test fixtures (mobile → rawDriver), so
    // `testInfo.status` is settled here and `syncTestDetails` runs before the
    // session is deleted, on the same worker-scoped provider instance that
    // created it. Mirrors the inspector's `disconnect()`.
    const handle = await deviceProvider.getDevice();
    try {
      await use(handle.driver);
    } finally {
      if (deviceProvider.syncTestDetails) {
        try {
          const failed = testInfo.status !== 'passed';
          await deviceProvider.syncTestDetails({
            status: failed ? 'failed' : 'passed',
            reason: testInfo.error?.message ?? (failed ? testInfo.status : 'taqwright test passed'),
            name: testInfo.title,
          });
        } catch {
          // best-effort — never block teardown over a dashboard sync
        }
      }
      try {
        await handle.driver.deleteSession();
      } catch {
        // session may already be gone
      }
    }
  },

  mobile: async ({ rawDriver, taqwrightUse, networkProxy }, use, testInfo) => {
    const platform = taqwrightUse.platform;
    const bundleId = taqwrightUse.appBundleId;
    const timeout = taqwrightUse.expectTimeout ?? DEFAULT_TIMEOUT;
    const isCloud = isCloudProvider((taqwrightUse.device as { provider?: string }).provider);

    // Cloud builds live behind a `bs://` / `lt://` URL — the on-device
    // terminate/reinstall dance can't run (and `mobile: installApp` would
    // throw on a host-local path the on-device driver can't see). Cloud
    // isolation comes from the fresh per-test session + the provider's own
    // reset (BrowserStack sets `appium:fullReset`; LambdaTest real devices
    // reinstall per session).
    if (!isCloud && taqwrightUse.resetBetweenTests && bundleId && taqwrightUse.buildPath) {
      const appRef = platform === Platform.IOS ? { bundleId } : { appId: bundleId };
      const installArg =
        platform === Platform.IOS
          ? { app: taqwrightUse.buildPath }
          : { appPath: taqwrightUse.buildPath };
      // The reinstall/relaunch dance is idempotent (removeApp → installApp), so
      // it's safe to retry as a unit when a local Android emulator drops offline
      // mid-reset. Same gate+retry as session creation; iOS/cloud (no serial)
      // run it once, unguarded — unchanged behaviour.
      const doReset = async () => {
        await rawDriver.executeScript('mobile: terminateApp', [appRef]).catch(() => {});
        await rawDriver.executeScript('mobile: removeApp', [appRef]).catch(() => {});
        await rawDriver.executeScript('mobile: installApp', [installArg]);
        await rawDriver.executeScript('mobile: activateApp', [appRef]);
      };
      const serial = await localAndroidSerial(taqwrightUse);
      if (serial) await withDeviceReadyRetry(serial, 'reset-between-tests', doReset);
      else await doReset();
    }

    const mobile = Mobile.wrap(rawDriver, platform, bundleId, timeout);

    // Video artifact (outer): Appium records on-device for the whole
    // session. Started before the trace branch so it covers the entire
    // test regardless of trace mode, and always stopped in the outer
    // `finally` (even when discarding on a passing on-failure run) so the
    // device-side recorder is never left running between tests.
    const videoMode = taqwrightUse.video ?? 'off';
    // On cloud the provider records server-side (visible on the BrowserStack /
    // LambdaTest dashboard); skip taqwright's own on-device recording rather
    // than produce a redundant artifact (or hang/error against the hub).
    const videoOn = videoMode !== 'off' && !isCloud;
    if (videoOn) {
      // Let start throw: an unsupported driver/config (e.g. some iOS
      // simulators) is a real problem the user should see, not silently
      // swallow into an empty artifact.
      //
      // iOS (XCUITest) defaults `videoType` to `mjpeg`. An MJPEG stream in
      // an MP4 container is a valid file but the HTML report's <video> tag
      // can't decode it — it shows 0:00 and won't play. Force `libx264`
      // (H.264) so the artifact is browser-playable. XCUITest screen
      // recording already requires ffmpeg on the host regardless of codec,
      // so this adds no new dependency. UiAutomator2's screenrecord already
      // produces H.264 MP4 and rejects `videoType`, so Android stays bare.
      const recordOpts: Record<string, string> =
        platform === Platform.IOS
          ? {
              timeLimit: String(VIDEO_TIME_LIMIT_SECONDS),
              videoType: 'libx264',
              videoQuality: 'medium',
            }
          : { timeLimit: String(VIDEO_TIME_LIMIT_SECONDS) };
      await rawDriver.startRecordingScreen(recordOpts);
    }

    // Trace artifact: when enabled, wrap `mobile` in a tracing Proxy that
    // records each action + post-state screenshot. The HTML render itself
    // is moved into the outer `finally` (below) so it runs AFTER the HAR
    // flush — the player UI embeds the HAR inline for time-correlated
    // viewing, so the HAR must be available when we render.
    const traceMode = taqwrightUse.trace ?? 'off';
    let tracer: Tracer | null = null;
    let tracedMobile = mobile;
    if (traceMode !== 'off') {
      tracer = new Tracer(rawDriver, platform);
      tracedMobile = wrapForTracing(mobile, tracer);
    }

    try {
      await use(tracedMobile);
    } finally {
      if (videoOn) {
        // ALWAYS stop the device recorder, even when we won't keep the
        // file — otherwise it leaks into the next test. Wrap stop so a
        // recording failure can never mask the real test result (this
        // `finally` may already be unwinding a test error).
        let data: string | undefined;
        try {
          data = (await rawDriver.stopRecordingScreen()) as string;
        } catch {
          // recording lost — never fail the test over an artifact
        }
        const failed = testInfo.status !== 'passed';
        if (data && shouldRetainArtifact(videoMode, failed)) {
          const buf = Buffer.from(data, 'base64');
          if (buf.length > 0) {
            const path = testInfo.outputPath('screen.mp4');
            await fs.writeFile(path, buf);
            // NOT 'video': Playwright's HTML report reserves the attachment
            // name `video` for its own browser recordings. A distinct name
            // makes the report treat it as a normal video attachment
            // (mirrors the `taqwright-trace` fix).
            await testInfo.attach('taqwright-video', { path, contentType: 'video/mp4' });
          }
        }
      }
      // Flush HAR (always, when we have a proxy at all) — even if we won't
      // attach `network.har` for this test mode, the trace player wants the
      // data for the embedded side panel.
      let har: HarLog | undefined;
      if (networkProxy) {
        try {
          har = (await networkProxy.flush()) as HarLog;
        } catch {
          // best-effort — never fail the test over an artifact
        }
        const networkMode = taqwrightUse.network ?? 'off';
        const failed = testInfo.status !== 'passed';
        if (har && shouldRetainArtifact(networkMode, failed)) {
          const path = testInfo.outputPath('network.har');
          await fs.writeFile(path, JSON.stringify(har, null, 2), 'utf-8');
          // NOT 'har': mirrors the `taqwright-trace` / `taqwright-video`
          // naming convention so the Playwright HTML report treats it as
          // a normal JSON attachment rather than reserving a special slot.
          await testInfo.attach('taqwright-har', {
            path,
            contentType: 'application/json',
          });
        }
      }

      // Trace player HTML (renders AFTER HAR flush so the network panel can
      // be embedded inline). Same attachment name + path as the old vertical-
      // list artifact — only the rendered UI changed.
      if (tracer) {
        const failed = testInfo.status !== 'passed';
        if (shouldRetainArtifact(traceMode, failed)) {
          const path = testInfo.outputPath('trace.html');
          const html = tracer.toHtml(
            {
              title: testInfo.title,
              status: testInfo.status,
              duration: testInfo.duration,
              project: { name: testInfo.project.name },
            },
            { har: har ?? null },
          );
          await fs.writeFile(path, html, 'utf-8');
          // NOT 'trace': Playwright's HTML report reserves the attachment
          // name `trace` for its own .zip traces and routes it to the
          // Playwright Trace Viewer, which can't parse our HTML artifact
          // ("Could not load trace…"). A distinct name makes the report
          // treat it as a normal HTML attachment that opens directly.
          await testInfo.attach('taqwright-trace', { path, contentType: 'text/html' });
        }
      }
    }
  },
});

// `expect` is the taqwright wrapper from src/expect.ts (re-exported by
// src/index.ts), not Playwright's directly. It still avoids `expect.extend`
// for the mobile Locator — a standalone wrapper sidesteps Playwright's
// name-based matcher dispatch — while exposing `expect(locator).toBeVisible()`.
