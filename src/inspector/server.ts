import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Client as WebDriverClient } from 'webdriver';
import {
  Platform,
  W3C_ELEMENT_KEY,
  type LocatorDescriptor,
  type LocatorStrategy,
} from '../types/index.js';
import { Locator, buildLocatorFromDescriptor, type LocatorContext } from '../locator/index.js';
import type { SwipeDirection, RecordedLocator } from './recorder.js';
import { toStepsPython, toStepsJava } from './codegen-appium.js';
import { runDoctorChecks } from '../doctor.js';
import { isPortOpen } from '../auto-appium.js';
import {
  listDevices,
  startAndroidEmulator,
  stopAndroidEmulator,
  startIosSimulator,
  stopIosSimulator,
} from './devices.js';
import {
  generateCandidates,
  makeNthSuggestion,
  selectBestPerCategory,
  pickRecommended,
  type ElementAttrs,
  type LocatorSuggestion,
} from './locator-suggester.js';
import { INSPECTOR_HTML } from './ui.js';
import { InspectorSession, type InspectorDefaults, type ConnectRequest } from './session.js';

export interface InspectorServerOptions {
  defaults: InspectorDefaults;
  /** Set to 0 to let the OS pick a free port; the chosen port is reflected in `handle.url`. */
  port: number;
  host: string;
  /**
   * Optional pre-existing driver to attach to. When set, the session boots
   * already-connected (no `/api/connect` round-trip) and surfaces a "Resume"
   * button instead of the Connect / Disconnect controls. Used by
   * `mobile.pause()` to hand the live test driver to the inspector.
   */
  attach?: {
    driver: WebDriverClient;
    platform: Platform;
    capabilities?: Record<string, unknown>;
  };
}

export interface InspectorServerHandle {
  url: string;
  /** OS-assigned port if `opts.port === 0`; otherwise the port that was requested. */
  port: number;
  session: InspectorSession;
  close: () => Promise<void>;
}

/**
 * Start the inspector server. The server begins in a "no session" state — the
 * UI lands on a setup page and the user opens a WebDriver session via POST
 * /api/connect. The returned `session` lets the CLI clean up on Ctrl+C.
 */
export async function startInspectorServer(
  opts: InspectorServerOptions,
): Promise<InspectorServerHandle> {
  const session = new InspectorSession(opts.defaults);
  if (opts.attach) {
    session.attachDriver(opts.attach.driver, opts.attach.platform, opts.attach.capabilities);
  }

  const server = createServer((req, res) => {
    handle(req, res, session).catch((err: unknown) => {
      const msg = (err as Error).message ?? String(err);
      console.error('inspector: handler error:', msg);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      try {
        res.end(JSON.stringify({ error: msg }));
      } catch {
        // socket already closed
      }
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });

  // After bind, `address()` reports the actual port (matters when caller
  // requested port 0 for an OS-assigned port — `mobile.pause()` uses this).
  const addr = server.address() as AddressInfo | string | null;
  const boundPort = addr && typeof addr === 'object' ? addr.port : opts.port;
  const url = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${boundPort}`;

  return {
    url,
    port: boundPort,
    session,
    close: () => new Promise<void>((resolveClose) => closeServer(server, resolveClose)),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  session: InspectorSession,
): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // ─── Static ──────────────────────────────────────────────────────
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(INSPECTOR_HTML);
    return;
  }
  if (method === 'GET' && url === '/static/logo.png') {
    try {
      const buf = getLogo();
      res.writeHead(200, {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400',
      });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'logo asset not found' }));
    }
    return;
  }

  // ─── Setup endpoints (no driver required) ───────────────────────
  if (method === 'GET' && url === '/api/status') {
    const appium = session.appium ?? session.defaults.appium;
    const appiumReachable = await isPortOpen(appium.host, appium.port);
    json(res, 200, {
      connected: session.isConnected(),
      attached: session.attached,
      platform: session.platform,
      project: session.defaults.project,
      appium,
      appiumReachable,
      appiumOurs: !!session.appiumProc && !session.appiumProc.killed,
      defaults: session.defaults,
      capabilities: session.lastCapabilities,
      recording: session.recording,
    });
    return;
  }

  if (method === 'GET' && url === '/api/doctor') {
    const checks = await runDoctorChecks();
    json(res, 200, { checks });
    return;
  }

  if (method === 'GET' && url.startsWith('/api/appium/probe')) {
    const u = new URL(url, 'http://x');
    const host = u.searchParams.get('host') ?? session.defaults.appium.host;
    const port = Number(u.searchParams.get('port')) || session.defaults.appium.port;
    const reachable = await isPortOpen(host, port);
    json(res, 200, { reachable, host, port });
    return;
  }

  if (method === 'POST' && url === '/api/appium/start') {
    const body = await readJson<{ host?: string; port?: number; path?: string }>(req);
    const opts = {
      host: body.host ?? session.defaults.appium.host,
      port: body.port ?? session.defaults.appium.port,
      path: body.path ?? session.defaults.appium.path,
    };
    try {
      const r = await session.ensureAppium(opts);
      json(res, 200, { ok: true, ...r, appium: opts });
    } catch (err) {
      json(res, 500, { ok: false, error: (err as Error).message });
    }
    return;
  }

  if (method === 'POST' && url === '/api/appium/restart') {
    const body = await readJson<{ host?: string; port?: number; path?: string }>(req);
    const opts = {
      host: body.host ?? session.defaults.appium.host,
      port: body.port ?? session.defaults.appium.port,
      path: body.path ?? session.defaults.appium.path,
    };
    try {
      const r = await session.restartAppium(opts);
      json(res, 200, { ok: true, ...r, appium: opts });
    } catch (err) {
      json(res, 500, { ok: false, error: (err as Error).message });
    }
    return;
  }

  if (method === 'POST' && url === '/api/connect') {
    const body = await readJson<ConnectRequest>(req);
    const hasLocal = !!(body.appium && body.capabilities);
    const hasCloud = !!body.cloud;
    if (!hasLocal && !hasCloud) {
      json(res, 400, {
        error: 'request must include either { appium, capabilities } or { cloud }',
      });
      return;
    }
    if (session.isConnected()) {
      json(res, 409, { error: 'already connected' });
      return;
    }
    // Bound the connect so a stuck device-provisioning (or a TCP-hung hub)
    // can't spin forever. On any failure, cancelConnect() schedules teardown of
    // a session that materializes after the timeout, so it never leaks as
    // "Running" on the cloud grid. Override the 5-minute default via env.
    const connectMs = Number(process.env.TAQWRIGHT_CONNECT_TIMEOUT_MS) || 300_000;
    try {
      await withTimeout(session.connect(body), connectMs, 'connect');
      json(res, 200, { ok: true, platform: session.platform });
    } catch (err) {
      session.cancelConnect();
      json(res, 502, { ok: false, error: (err as Error).message });
    }
    return;
  }

  // Abort an in-flight connect (Cancel button) — returns immediately; any
  // session that still materializes is torn down by cancelConnect().
  if (method === 'POST' && url === '/api/connect/cancel') {
    session.cancelConnect();
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url === '/api/disconnect') {
    await session.disconnect();
    json(res, 200, { ok: true });
    return;
  }

  // Attached-mode handoff: the in-flight `mobile.pause()` call awaits this.
  if (method === 'POST' && url === '/api/resume') {
    if (!session.attached) {
      json(res, 400, { error: 'resume: not in attached mode' });
      return;
    }
    session.requestResume();
    json(res, 200, { ok: true });
    return;
  }

  // ─── Devices: browse / start / stop simulators & emulators ────
  if (method === 'GET' && url === '/api/devices') {
    json(res, 200, await listDevices());
    return;
  }
  if (method === 'POST' && url === '/api/devices/start') {
    const body = await readJson<{ type: 'android' | 'ios'; avdName?: string; udid?: string }>(req);
    try {
      if (body.type === 'android') {
        if (!body.avdName) throw new Error('avdName is required for Android.');
        await startAndroidEmulator(body.avdName);
      } else {
        if (!body.udid) throw new Error('udid is required for iOS.');
        await startIosSimulator(body.udid);
      }
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { ok: false, error: (err as Error).message });
    }
    return;
  }
  if (method === 'POST' && url === '/api/devices/stop') {
    const body = await readJson<{ type: 'android' | 'ios'; udid: string }>(req);
    try {
      if (body.type === 'android') await stopAndroidEmulator(body.udid);
      else await stopIosSimulator(body.udid);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { ok: false, error: (err as Error).message });
    }
    return;
  }

  // ─── App file: native picker + APK/IPA/.app inspection ────────
  if (method === 'POST' && url === '/api/file-picker') {
    try {
      const path = await openNativeFilePicker();
      if (path) json(res, 200, { ok: true, path });
      else json(res, 200, { ok: false, cancelled: true });
    } catch (err) {
      json(res, 400, { ok: false, error: (err as Error).message });
    }
    return;
  }
  if (method === 'POST' && url === '/api/file-save-picker') {
    const body = await readJson<{ defaultName?: string; defaultLocation?: string }>(req);
    try {
      const path = await openNativeSavePicker({
        defaultName: body.defaultName ?? 'recorded.spec.ts',
        defaultLocation: body.defaultLocation,
      });
      if (path) json(res, 200, { ok: true, path });
      else json(res, 200, { ok: false, cancelled: true });
    } catch (err) {
      json(res, 400, { ok: false, error: (err as Error).message });
    }
    return;
  }
  if (method === 'POST' && url === '/api/inspect-app') {
    const body = await readJson<{ path: string }>(req);
    try {
      const info = await inspectAppFile(body.path);
      json(res, 200, { ok: true, ...info });
    } catch (err) {
      json(res, 400, { ok: false, error: (err as Error).message });
    }
    return;
  }

  // ─── Export the recorded spec into the project's tests/ folder ──
  if (method === 'GET' && url === '/api/export-script/info') {
    const { projectRoot, testDir } = session.defaults;
    if (!projectRoot || !testDir) {
      json(res, 200, {
        ok: false,
        error:
          'No taqwright.config.ts found — cannot resolve a tests folder. ' +
          `Inspector cwd: ${process.cwd()}. Restart the inspector from inside ` +
          `your project (the dir containing taqwright.config.ts).`,
        debug: {
          projectRoot: projectRoot ?? null,
          testDir: testDir ?? null,
          cwd: process.cwd(),
        },
      });
      return;
    }
    const path = await import('node:path');
    json(res, 200, {
      ok: true,
      projectRoot,
      testDir,
      absoluteDir: path.resolve(projectRoot, testDir),
    });
    return;
  }
  if (method === 'POST' && url === '/api/export-script') {
    const body = await readJson<{ filename: string; content?: string; overwrite?: boolean }>(req);
    try {
      const result = await exportScriptToProject(session, body);
      json(res, 200, { ok: true, ...result });
    } catch (err) {
      json(res, 400, { ok: false, error: (err as Error).message });
    }
    return;
  }

  // ─── Cloud devices: env probe + catalog fetch ────────────────
  if (method === 'GET' && url === '/api/cloud/env') {
    json(res, 200, {
      browserstack: {
        user: process.env.BROWSERSTACK_USERNAME ?? '',
        key: process.env.BROWSERSTACK_ACCESS_KEY ?? '',
      },
      lambdatest: {
        user: process.env.LAMBDATEST_USERNAME ?? '',
        key: process.env.LAMBDATEST_ACCESS_KEY ?? '',
      },
      digitalai: {
        // Digital.ai has no username — just the access key + tenant cloud URL.
        key: process.env.DIGITALAI_ACCESS_KEY ?? '',
        cloudServer: process.env.DIGITALAI_CLOUD_SERVER ?? '',
      },
    });
    return;
  }
  if (method === 'POST' && url === '/api/cloud/devices') {
    const body = await readJson<{
      provider: 'browserstack' | 'lambdatest' | 'digitalai';
      user: string;
      key: string;
      cloudServer?: string;
    }>(req);
    try {
      const devices = await fetchCloudDevices(body.provider, body.user, body.key, body.cloudServer);
      json(res, 200, { ok: true, devices });
    } catch (err) {
      json(res, 400, { ok: false, error: (err as Error).message });
    }
    return;
  }

  // ─── Driver-bound endpoints ──────────────────────────────────────
  // From here on, we need a driver. Return 412 (Precondition Failed) if not.
  if (!session.driver || !session.platform) {
    json(res, 412, { error: 'no active session — POST /api/connect first' });
    return;
  }
  const driver = session.driver;
  const platform = session.platform;

  if (method === 'GET' && url === '/api/snapshot') {
    try {
      const [screenshot, source, rect] = await session.runExclusive(() =>
        Promise.all([
          withTimeout(driver.takeScreenshot(), 15000, 'screenshot'),
          withTimeout(driver.getPageSource(), 15000, 'pageSource'),
          withTimeout(driver.getWindowRect(), 10000, 'windowRect'),
        ]),
      );
      json(res, 200, {
        platform,
        project: session.defaults.project ?? '',
        screenshot,
        source,
        viewport: { w: rect.width, h: rect.height },
      });
    } catch (err) {
      json(res, 504, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (method === 'POST' && url === '/api/tap') {
    const { x, y } = await readJson<{ x: number; y: number }>(req);
    await tap(driver, x, y);
    session.recordIf({ kind: 'tap', x, y });
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url === '/api/swipe') {
    const { x1, y1, x2, y2, durationMs } = await readJson<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      durationMs: number;
    }>(req);
    await swipe(driver, x1, y1, x2, y2, durationMs);
    session.recordIf({ kind: 'swipe', x1, y1, x2, y2, durationMs });
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url === '/api/suggest') {
    const { attrs, xpath } = await readJson<{ attrs: ElementAttrs; xpath: string }>(req);
    // In a WebView context the DOM is web — generate CSS candidates, not
    // native UiSelector/predicate ones.
    const isWeb = /WEBVIEW/i.test(session.currentContext);
    const candidates = generateCandidates(platform, attrs, xpath, isWeb);
    // Stamp this request the latest; a newer suggest bumps suggestGen so this
    // loop bails instead of grinding ~14 device commands for an abandoned pick.
    const gen = ++session.suggestGen;

    const out = await session.runExclusive(async () => {
      if (gen !== session.suggestGen) return null; // superseded before we got the lock

      // Look up the target element's W3C id via its positional xpath. Used to
      // compute the .nth(i) index for non-unique candidates (disambiguation).
      // Absent / failing target lookup just means we skip chained suggestions.
      let targetId: string | null = null;
      try {
        const t = await driver.findElement('xpath', xpath);
        if (t && typeof t === 'object') {
          targetId = (t as Record<string, string>)[W3C_ELEMENT_KEY] ?? null;
        }
      } catch {
        // No target id — fall back to flat candidates only.
      }

      const verified: LocatorSuggestion[] = [];
      for (const c of candidates) {
        if (gen !== session.suggestGen) break; // superseded mid-loop — stop issuing commands
        let refs: Array<Record<string, string>> = [];
        try {
          const r = await driver.findElements(c.using, c.value);
          refs = Array.isArray(r) ? (r as Array<Record<string, string>>) : [];
        } catch {
          // Invalid selector for this driver — refs stays empty.
        }
        const count = refs.length;
        verified.push({ ...c, count, unique: count === 1 });

        // If the flat candidate matches > 1 element AND the target is in that
        // set, emit a chain-suffixed candidate that pins it via .nth(i).
        if (count > 1 && targetId !== null) {
          const idx = refs.findIndex((r) => r[W3C_ELEMENT_KEY] === targetId);
          if (idx >= 0) {
            verified.push(makeNthSuggestion(c, idx));
          }
        }
      }

      return {
        best: selectBestPerCategory(platform, verified, isWeb),
        recommended: pickRecommended(platform, verified, isWeb) ?? null,
        all: verified,
      };
    });

    if (!out) {
      json(res, 200, { best: [], recommended: null, all: [], superseded: true });
      return;
    }
    json(res, 200, out);
    return;
  }

  if (method === 'POST' && url === '/api/locator-action') {
    const body = await readJson<LocatorActionBody>(req);
    const result = await runLocatorAction(driver, platform, session, body);
    json(res, 200, { ok: true, ...(result ?? {}) });
    return;
  }

  if (method === 'POST' && url === '/api/screen-action') {
    const body = await readJson<ScreenActionBody>(req);
    await runScreenAction(driver, session, body);
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url === '/api/verify-xpath') {
    // Run a one-off xpath against the live device and report match count.
    // Used by the inspector's "Build relative xpath" feature.
    const { xpath } = await readJson<{ xpath: string }>(req);
    let count = 0;
    try {
      const refs = await driver.findElements('xpath', xpath);
      count = Array.isArray(refs) ? refs.length : 0;
    } catch {
      // Invalid xpath syntax or driver error — count stays 0.
    }
    json(res, 200, { count, unique: count === 1, xpath });
    return;
  }

  if (method === 'GET' && url === '/api/contexts') {
    json(res, 200, await session.listContexts());
    return;
  }

  if (method === 'POST' && url === '/api/context') {
    const { context } = await readJson<{ context: string }>(req);
    try {
      await session.switchContext(context);
      json(res, 200, { ok: true, current: session.currentContext });
    } catch (err) {
      // A WebView switch with no chromedriver fails here — surface it as a
      // clean toast rather than a generic 500.
      json(res, 502, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (method === 'GET' && (url === '/api/recording' || url.startsWith('/api/recording?'))) {
    // ?lang=ts (default) | python | java — TS keeps the full runnable spec;
    // python/java are steps-only Appium-client translations.
    const lang = new URL(url, 'http://x').searchParams.get('lang') ?? 'ts';
    const actions = session.recorder.list();
    const spec =
      lang === 'python'
        ? toStepsPython(actions)
        : lang === 'java'
          ? toStepsJava(actions)
          : session.recorder.toSpec();
    json(res, 200, { spec, recording: session.recording });
    return;
  }

  if (method === 'POST' && url === '/api/recording/start') {
    // Start a fresh recording — clear any leftover lines so the script
    // begins from this moment.
    session.recorder.clear();
    session.recording = true;
    json(res, 200, { ok: true, recording: true });
    return;
  }

  if (method === 'POST' && url === '/api/recording/stop') {
    session.recording = false;
    json(res, 200, { ok: true, recording: false });
    return;
  }

  if (method === 'POST' && url === '/api/recording/clear') {
    session.recorder.clear();
    json(res, 200, { ok: true });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', url, method }));
}

async function tap(driver: ConnectedDriver, x: number, y: number): Promise<void> {
  try {
    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 50 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
  } finally {
    await driver.releaseActions().catch(() => {});
  }
}

async function swipe(
  driver: ConnectedDriver,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  duration: number,
): Promise<void> {
  try {
    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: x1, y: y1 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration, x: x2, y: y2 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
  } finally {
    await driver.releaseActions().catch(() => {});
  }
}

type ConnectedDriver = NonNullable<InspectorSession['driver']>;

// ─── Action body shapes ─────────────────────────────────────────────
type AssertionMatcher =
  | 'visible'
  | 'hidden'
  | 'enabled'
  | 'disabled'
  | 'text'
  | 'value'
  | 'checked'
  | 'unchecked'
  | 'editable'
  | 'readonly'
  | 'focused'
  | 'attached'
  | 'empty'
  | 'inViewport'
  | 'count'
  | 'attribute';

interface SelectOptionInputBody {
  label?: string;
  index?: number;
  date?: string;
  time?: string;
}

/**
 * Locator target wire shape: every action body must include `code` (the
 * rendered taqwright source for the recorder) plus one of:
 *
 *   - `descriptor: LocatorDescriptor` — the new chained shape; preferred.
 *   - `using` / `value` — legacy flat shape; transparently wrapped into a
 *     `{ kind: 'leaf' }` descriptor for back-compat with older clients.
 */
type LocatorTarget = {
  code: string;
  descriptor?: LocatorDescriptor;
  using?: string;
  value?: string;
};

type LocatorActionBody =
  | (LocatorTarget & { kind: 'click' })
  | (LocatorTarget & { kind: 'doubleTap' })
  | (LocatorTarget & { kind: 'longPress' })
  | (LocatorTarget & { kind: 'fill'; text: string })
  | (LocatorTarget & { kind: 'clear' })
  | (LocatorTarget & {
      kind: 'assertion';
      matcher: AssertionMatcher;
      /** For 'text' / 'value' / 'attribute' matchers — the expected string. */
      expected?: string;
      /** For 'count' matcher — the expected match count. */
      expectedCount?: number;
      /** For 'attribute' matcher — which attribute to read. */
      attrName?: string;
      /** For 'text' matcher only — exact (default) or substring contains. */
      mode?: 'exact' | 'contains';
      /** Skip the at-record verification gate; record even if it would fail. */
      force?: boolean;
    })
  | (LocatorTarget & { kind: 'swipe'; direction: SwipeDirection })
  | (LocatorTarget & { kind: 'scrollIntoView' })
  | (LocatorTarget & { kind: 'pinch'; direction: 'in' | 'out' })
  | (LocatorTarget & { kind: 'dragTo'; target: LocatorTarget })
  | (LocatorTarget & { kind: 'check' })
  | (LocatorTarget & { kind: 'uncheck' })
  | (LocatorTarget & { kind: 'focus' })
  | (LocatorTarget & { kind: 'blur' })
  | (LocatorTarget & { kind: 'press'; key: string })
  | (LocatorTarget & { kind: 'pressSequentially'; text: string; delay?: number })
  | (LocatorTarget & { kind: 'selectOption'; value: string | SelectOptionInputBody });

/** What runLocatorAction returns to the caller for the JSON response. */
type LocatorActionResult = {
  recorded?: boolean;
  /** For 'assertion' kind only — whether the matcher would currently pass. */
  verified?: boolean;
  /** For 'text' / 'value' matchers — the actual string read from the device. */
  actual?: string;
};

type ScreenActionBody = {
  kind: 'scroll';
  direction: SwipeDirection;
  fromX?: number;
  toX?: number;
  fromY?: number;
  toY?: number;
};

/**
 * Pull the `LocatorDescriptor` out of the body — prefers the new `descriptor`
 * field; otherwise wraps the legacy flat `{ using, value }` shape into a
 * `{ kind: 'leaf' }` descriptor. Throws if neither shape is present.
 */
export function resolveLocatorDescriptor(body: LocatorTarget): LocatorDescriptor {
  if (body.descriptor) return body.descriptor;
  if (body.using !== undefined && body.value !== undefined) {
    return {
      kind: 'leaf',
      using: body.using as LocatorStrategy['using'],
      value: body.value,
    };
  }
  throw new Error('locator-action: body is missing both `descriptor` and `{using, value}`');
}

/**
 * Snapshot the structured locator off an action body so the recorder can later
 * re-render it against the raw Appium clients (Python/Java), not just the
 * taqwright TS `code` string. Param is named `b` (not `body`) on purpose.
 */
function recordedLoc(b: LocatorTarget): RecordedLocator {
  return { code: b.code, using: b.using, value: b.value, descriptor: b.descriptor };
}

async function runLocatorAction(
  driver: ConnectedDriver,
  platform: Platform,
  session: InspectorSession,
  body: LocatorActionBody,
): Promise<LocatorActionResult | void> {
  // Build a Locator the same way taqwright tests would, so server-side
  // behavior matches what the recorded code will do at test time.
  const ctx: LocatorContext = { driver, platform, defaultTimeout: 30_000 };
  const descriptor = resolveLocatorDescriptor(body);
  const locator = buildLocatorFromDescriptor(ctx, descriptor);

  switch (body.kind) {
    case 'click':
      await locator.click();
      session.recordIf({ kind: 'locatorClick', ...recordedLoc(body) });
      return;
    case 'doubleTap':
      await locator.doubleTap();
      session.recordIf({ kind: 'locatorDoubleTap', ...recordedLoc(body) });
      return;
    case 'longPress':
      await locator.longPress();
      session.recordIf({ kind: 'locatorLongPress', ...recordedLoc(body) });
      return;
    case 'fill':
      await locator.fill(body.text);
      session.recordIf({ kind: 'locatorFill', ...recordedLoc(body), text: body.text });
      return;
    case 'clear':
      await locator.clear();
      session.recordIf({ kind: 'locatorClear', ...recordedLoc(body) });
      return;
    case 'assertion':
      return runAssertion(locator, session, body);
    case 'swipe':
      switch (body.direction) {
        case 'left':
          await locator.swipeLeft();
          break;
        case 'right':
          await locator.swipeRight();
          break;
        case 'up':
          await locator.swipeUp();
          break;
        case 'down':
          await locator.swipeDown();
          break;
      }
      session.recordIf({ kind: 'locatorSwipe', ...recordedLoc(body), direction: body.direction });
      return;
    case 'scrollIntoView':
      await locator.scrollIntoView();
      session.recordIf({ kind: 'locatorScrollIntoView', ...recordedLoc(body) });
      return;
    case 'pinch':
      if (body.direction === 'in') await locator.pinchIn();
      else await locator.pinchOut();
      session.recordIf({ kind: 'locatorPinch', ...recordedLoc(body), direction: body.direction });
      return;
    case 'dragTo': {
      const targetLoc = buildLocatorFromDescriptor(ctx, resolveLocatorDescriptor(body.target));
      await locator.dragTo(targetLoc);
      session.recordIf({
        kind: 'locatorDragTo',
        ...recordedLoc(body),
        targetCode: body.target.code,
        target: recordedLoc(body.target),
      });
      return;
    }
    case 'check':
      await locator.check();
      session.recordIf({ kind: 'locatorCheck', ...recordedLoc(body) });
      return;
    case 'uncheck':
      await locator.uncheck();
      session.recordIf({ kind: 'locatorUncheck', ...recordedLoc(body) });
      return;
    case 'focus':
      await locator.focus();
      session.recordIf({ kind: 'locatorFocus', ...recordedLoc(body) });
      return;
    case 'blur':
      await locator.blur();
      session.recordIf({ kind: 'locatorBlur', ...recordedLoc(body) });
      return;
    case 'press':
      await locator.press(body.key);
      session.recordIf({ kind: 'locatorPress', ...recordedLoc(body), key: body.key });
      return;
    case 'pressSequentially':
      await locator.pressSequentially(body.text, { delay: body.delay });
      session.recordIf({
        kind: 'locatorPressSequentially',
        ...recordedLoc(body),
        text: body.text,
        ...(body.delay !== undefined ? { delay: body.delay } : {}),
      });
      return;
    case 'selectOption':
      await locator.selectOption(body.value);
      session.recordIf({
        kind: 'locatorSelectOption',
        ...recordedLoc(body),
        value: body.value,
      });
      return;
  }
}

const ASSERT_VERIFY_TIMEOUT_MS = 1500;

/**
 * Verify whether the requested assertion would currently pass on the device,
 * record the action when it passes (or when the user explicitly forces it),
 * and report the verification + actual value back to the client.
 *
 * Mirrors the action handlers above: same Locator construction, same
 * session.recordIf gating, but with a short timeout because we want quick
 * feedback at record time rather than the full test-time wait.
 */
async function runAssertion(
  locator: Locator,
  session: InspectorSession,
  body: Extract<LocatorActionBody, { kind: 'assertion' }>,
): Promise<LocatorActionResult> {
  const matcher = body.matcher;
  let verified = false;
  let actual: string | undefined;

  if (
    matcher === 'visible' ||
    matcher === 'hidden' ||
    matcher === 'enabled' ||
    matcher === 'disabled'
  ) {
    try {
      await locator.waitFor({ state: matcher, timeout: ASSERT_VERIFY_TIMEOUT_MS });
      verified = true;
    } catch {
      verified = false;
    }
  } else if (matcher === 'text') {
    try {
      actual = await locator.getText();
      const expected = body.expected ?? '';
      verified = body.mode === 'contains' ? actual.includes(expected) : actual === expected;
    } catch {
      verified = false;
    }
  } else if (matcher === 'value') {
    try {
      actual = await locator.getValue();
      verified = actual === (body.expected ?? '');
    } catch {
      verified = false;
    }
  } else if (matcher === 'checked' || matcher === 'unchecked') {
    try {
      const got = await locator.isChecked();
      actual = String(got);
      verified = matcher === 'checked' ? got === true : got === false;
    } catch {
      verified = false;
    }
  } else if (matcher === 'editable' || matcher === 'readonly') {
    try {
      const got = await locator.isEditable();
      actual = String(got);
      verified = matcher === 'editable' ? got === true : got === false;
    } catch {
      verified = false;
    }
  } else if (matcher === 'focused') {
    try {
      const got = await locator.isFocused();
      actual = String(got);
      verified = got === true;
    } catch {
      verified = false;
    }
  } else if (matcher === 'attached') {
    try {
      await locator.waitFor({ state: 'attached', timeout: ASSERT_VERIFY_TIMEOUT_MS });
      verified = true;
    } catch {
      verified = false;
    }
  } else if (matcher === 'empty') {
    try {
      const got = await locator.isEmpty();
      actual = String(got);
      verified = got === true;
    } catch {
      verified = false;
    }
  } else if (matcher === 'inViewport') {
    try {
      const got = await locator.isInViewport();
      actual = String(got);
      verified = got === true;
    } catch {
      verified = false;
    }
  } else if (matcher === 'count') {
    try {
      const got = await locator.count();
      actual = String(got);
      verified = got === (body.expectedCount ?? -1);
    } catch {
      verified = false;
    }
  } else if (matcher === 'attribute') {
    try {
      const name = body.attrName ?? '';
      actual = (await locator.getAttribute(name)) ?? '';
      verified = actual === (body.expected ?? '');
    } catch {
      verified = false;
    }
  }

  // Record only when the assertion would currently pass, OR when the user
  // explicitly opted in via the toast's "Record anyway" button (force=true).
  let recorded = false;
  if (verified || body.force) {
    switch (matcher) {
      case 'visible':
        session.recordIf({ kind: 'assertVisible', ...recordedLoc(body) });
        break;
      case 'hidden':
        session.recordIf({ kind: 'assertHidden', ...recordedLoc(body) });
        break;
      case 'enabled':
        session.recordIf({ kind: 'assertEnabled', ...recordedLoc(body) });
        break;
      case 'disabled':
        session.recordIf({ kind: 'assertDisabled', ...recordedLoc(body) });
        break;
      case 'text':
        session.recordIf({
          kind: 'assertText',
          ...recordedLoc(body),
          expected: body.expected ?? '',
          mode: body.mode === 'contains' ? 'contains' : 'exact',
        });
        break;
      case 'value':
        session.recordIf({
          kind: 'assertValue',
          ...recordedLoc(body),
          expected: body.expected ?? '',
        });
        break;
      case 'checked':
        session.recordIf({ kind: 'assertChecked', ...recordedLoc(body) });
        break;
      case 'unchecked':
        session.recordIf({ kind: 'assertUnchecked', ...recordedLoc(body) });
        break;
      case 'editable':
        session.recordIf({ kind: 'assertEditable', ...recordedLoc(body) });
        break;
      case 'readonly':
        session.recordIf({ kind: 'assertReadonly', ...recordedLoc(body) });
        break;
      case 'focused':
        session.recordIf({ kind: 'assertFocused', ...recordedLoc(body) });
        break;
      case 'attached':
        session.recordIf({ kind: 'assertAttached', ...recordedLoc(body) });
        break;
      case 'empty':
        session.recordIf({ kind: 'assertEmpty', ...recordedLoc(body) });
        break;
      case 'inViewport':
        session.recordIf({ kind: 'assertInViewport', ...recordedLoc(body) });
        break;
      case 'count':
        session.recordIf({
          kind: 'assertCount',
          ...recordedLoc(body),
          expected: body.expectedCount ?? 0,
        });
        break;
      case 'attribute':
        session.recordIf({
          kind: 'assertAttribute',
          ...recordedLoc(body),
          name: body.attrName ?? '',
          expected: body.expected ?? '',
        });
        break;
    }
    recorded = session.recording;
  }

  return { recorded, verified, actual };
}

async function runScreenAction(
  driver: ConnectedDriver,
  session: InspectorSession,
  body: ScreenActionBody,
): Promise<void> {
  switch (body.kind) {
    case 'scroll': {
      // Match Mobile.scroll semantics: `direction` is the direction content
      // moves toward the viewport (so 'down' reveals content below — finger
      // swipes UP). When the user supplies fromY/toY (fractions 0..1), we
      // delegate to Mobile.swipe via the native gesture path so the gesture
      // is recognized as a fling on Android.
      const rect = await driver.getWindowRect();
      const dir = body.direction;
      const fingerDir =
        dir === 'down'
          ? 'up'
          : dir === 'up'
            ? 'down'
            : dir === 'right'
              ? 'left'
              : dir === 'left'
                ? 'right'
                : dir;

      // The user may supply fromX/toX (the X anchor for a vertical scroll)
      // and/or fromY/toY (the Y range). The inspector translates UI top%/
      // bottom%/x% into direction-aware fractions before sending — fromX
      // and toX are typically the same value for a vertical scroll.
      const { fromX, toX, fromY, toY } = body;

      // Defaults match Mobile.swipe: a 40–60% Y band centered on x=50%.
      const yFrac =
        fromY !== undefined || toY !== undefined
          ? [fromY ?? toY ?? 0.4, toY ?? fromY ?? 0.6]
          : [0.4, 0.6];
      const xFrac =
        fromX !== undefined || toX !== undefined
          ? [fromX ?? toX ?? 0.5, toX ?? fromX ?? 0.5]
          : [0.5, 0.5];
      const yLow = Math.min(yFrac[0]!, yFrac[1]!);
      const yHigh = Math.max(yFrac[0]!, yFrac[1]!);
      const xLow = Math.min(xFrac[0]!, xFrac[1]!);
      const xHigh = Math.max(xFrac[0]!, xFrac[1]!);

      let used = false;
      try {
        await driver.executeScript('mobile: swipeGesture', [
          {
            left: Math.floor(rect.width * xLow),
            top: Math.floor(rect.height * yLow),
            width: Math.max(2, Math.floor(rect.width * (xHigh - xLow))),
            height: Math.max(2, Math.floor(rect.height * (yHigh - yLow))),
            direction: fingerDir,
            percent: 0.75,
          },
        ]);
        used = true;
      } catch {
        // Fall through to W3C performActions below.
      }
      if (!used) {
        const cx = Math.floor(rect.width / 2);
        const cy = Math.floor(rect.height / 2);
        const span = Math.floor(Math.min(rect.width, rect.height) * 0.4);
        const fX =
          fromX !== undefined
            ? Math.floor(rect.width * fromX)
            : fingerDir === 'left'
              ? cx + span
              : fingerDir === 'right'
                ? cx - span
                : cx;
        const fY =
          fromY !== undefined
            ? Math.floor(rect.height * fromY)
            : fingerDir === 'up'
              ? cy + span
              : fingerDir === 'down'
                ? cy - span
                : cy;
        const tX =
          toX !== undefined
            ? Math.floor(rect.width * toX)
            : fingerDir === 'left'
              ? cx - span
              : fingerDir === 'right'
                ? cx + span
                : cx;
        const tY =
          toY !== undefined
            ? Math.floor(rect.height * toY)
            : fingerDir === 'up'
              ? cy - span
              : fingerDir === 'down'
                ? cy + span
                : cy;
        await swipe(driver, fX, fY, tX, tY, 300);
      }
      session.recordIf({ kind: 'screenScroll', direction: dir, fromX, toX, fromY, toY });
      return;
    }
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Reject after `ms` if `p` hasn't settled. Used to time-box device calls so a
 * slow/hung WebView command surfaces an error (and releases the device mutex)
 * instead of freezing the inspector. The underlying command still drains in
 * Appium's own queue; this only frees our side.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('device timeout: ' + label)), ms)),
  ]);
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

// Resolves to dist/images/taqwright_logo.png at runtime (server.js lives in
// dist/inspector/, the asset is copied to dist/images/ by scripts/copy-assets.mjs).
const LOGO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../images/taqwright_logo.png');
let logoBuf: Buffer | undefined;
function getLogo(): Buffer {
  if (!logoBuf) logoBuf = readFileSync(LOGO_PATH);
  return logoBuf;
}

function closeServer(server: Server, done: () => void): void {
  server.close(() => done());
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
}

// ─── Native file picker (macOS only via osascript) ─────────────
async function openNativeFilePicker(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    throw new Error('Native file picker is only available on macOS. Paste the path manually.');
  }
  const { spawn } = await import('node:child_process');
  return new Promise<string | null>((resolveStr) => {
    const script =
      'try\n' +
      '  POSIX path of (choose file with prompt "Select APK / IPA / .app / .app.zip file" of type {"apk","ipa","app","zip"})\n' +
      'on error\n' +
      '  ""\n' +
      'end try';
    const child = spawn('osascript', ['-e', script]);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
    });
    child.on('close', () => {
      const trimmed = buf.trim();
      resolveStr(trimmed.length > 0 ? trimmed : null);
    });
    child.on('error', () => resolveStr(null));
  });
}

// ─── Native save panel (macOS only via osascript) ──────────────
// Returns the absolute path the user picked, or null on cancel.
// `default location` is honored only if the path exists; `osascript`
// silently falls back to the user's home dir if it doesn't.
async function openNativeSavePicker(opts: {
  defaultName: string;
  defaultLocation?: string;
}): Promise<string | null> {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Native save panel is only available on macOS. Use the filename prompt fallback.',
    );
  }
  const { spawn } = await import('node:child_process');
  // Escape double-quotes for AppleScript string literals.
  const escName = opts.defaultName.replace(/"/g, '\\"');
  const escLoc = opts.defaultLocation?.replace(/"/g, '\\"') ?? '';
  const locationClause = escLoc ? `default location POSIX file "${escLoc}"` : '';
  const script =
    'try\n' +
    `  POSIX path of (choose file name with prompt "Save the recorded spec as" default name "${escName}"${locationClause ? ' ' + locationClause : ''})\n` +
    'on error\n' +
    '  ""\n' +
    'end try';
  return new Promise<string | null>((resolveStr) => {
    const child = spawn('osascript', ['-e', script]);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
    });
    child.on('close', () => {
      const trimmed = buf.trim();
      resolveStr(trimmed.length > 0 ? trimmed : null);
    });
    child.on('error', () => resolveStr(null));
  });
}

// ─── App-file inspection (APK / IPA / .app → bundle id) ────────
interface AppInspectResult {
  kind: 'apk' | 'ipa' | 'app' | 'app.zip';
  bundleId: string;
  appActivity?: string;
}

async function inspectAppFile(filePath: string): Promise<AppInspectResult> {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('path is required');
  }
  // Cloud / remote URLs aren't on the local filesystem — the client should
  // skip the round-trip entirely, but guard here too so a stray call doesn't
  // produce a misleading "File not found" error.
  if (/^(bs|lt|https?):\/\//i.test(filePath)) {
    throw new Error(
      'Cloud / remote URLs (bs://, lt://, http(s)://) are not inspected locally — the cloud session resolves them.',
    );
  }
  const { promises: fs } = await import('node:fs');
  await fs.access(filePath).catch(() => {
    throw new Error(`File not found: ${filePath}`);
  });
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.apk')) return inspectApk(filePath);
  // `.app.zip` must be checked before `.app` since both end in `.app` after the
  // `.zip` strip; `endsWith('.app')` is false for `Foo.app.zip` anyway, but the
  // `.zip` branch needs to win over any future `.app`-prefix matching.
  if (lower.endsWith('.zip')) return inspectIosAppZip(filePath);
  if (lower.endsWith('.app')) return inspectIosAppDir(filePath);
  if (lower.endsWith('.ipa')) return inspectIpa(filePath);
  throw new Error('Unsupported file type — expected .apk, .ipa, .app, or .app.zip');
}

async function inspectApk(p: string): Promise<AppInspectResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execP = promisify(execFile);
  // Try `aapt` on PATH first, then under $ANDROID_HOME/build-tools.
  const candidates: string[] = ['aapt'];
  if (process.env.ANDROID_HOME) {
    try {
      const fs = await import('node:fs/promises');
      const { join } = await import('node:path');
      const buildToolsDir = join(process.env.ANDROID_HOME, 'build-tools');
      const entries = await fs.readdir(buildToolsDir);
      const versions = entries
        .filter((e) => /^\d+\.\d+\.\d+/.test(e))
        .sort()
        .reverse();
      for (const v of versions) candidates.push(join(buildToolsDir, v, 'aapt'));
    } catch {
      /* ignore — fall through to PATH-only */
    }
  }
  for (const aapt of candidates) {
    try {
      const { stdout } = await execP(aapt, ['dump', 'badging', p]);
      const pkg = stdout.match(/package: name='([^']+)'/);
      const activity = stdout.match(/launchable-activity: name='([^']+)'/);
      if (pkg) {
        return {
          kind: 'apk',
          bundleId: pkg[1]!,
          appActivity: activity?.[1],
        };
      }
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(
    'aapt not on PATH and no usable copy under $ANDROID_HOME/build-tools — install Android command-line tools to inspect APKs.',
  );
}

async function inspectIosAppDir(p: string): Promise<AppInspectResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { join } = await import('node:path');
  const execP = promisify(execFile);
  const plistPath = join(p, 'Info.plist');
  try {
    const { stdout } = await execP('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plistPath]);
    const id = stdout.trim();
    if (!id) throw new Error('CFBundleIdentifier not found in Info.plist');
    return { kind: 'app', bundleId: id };
  } catch (err) {
    throw new Error(`Failed to read ${plistPath}: ${(err as Error).message}`, { cause: err });
  }
}

// ─── Spec export → consuming project's tests/ folder ──────────
// Accepts EITHER:
//   { filename: 'foo.spec.ts' }          — relative to projectRoot/testDir
//   { absolutePath: '/abs/path/foo.spec.ts' } — explicit, picked via the
//                                              native save panel
async function exportScriptToProject(
  session: InspectorSession,
  body: {
    filename?: string;
    absolutePath?: string;
    content?: string;
    overwrite?: boolean;
  },
): Promise<{ path: string; bytes: number }> {
  const path = await import('node:path');
  const fs = await import('node:fs/promises');

  let absPath: string;
  if (body.absolutePath) {
    const ap = String(body.absolutePath).trim();
    if (!path.isAbsolute(ap)) throw new Error('absolutePath must be absolute.');
    if (!/\.(tsx?|jsx?|py|java)$/i.test(ap)) {
      throw new Error('Path must end in .ts / .tsx / .js / .jsx / .py / .java.');
    }
    absPath = ap;
  } else {
    const { projectRoot, testDir } = session.defaults;
    if (!projectRoot || !testDir) {
      throw new Error(
        'Inspector started without a taqwright.config.ts — no consuming project to export into.',
      );
    }
    const filename = String(body.filename ?? '').trim();
    if (!filename) throw new Error('filename or absolutePath is required');
    if (filename.includes('/') || filename.includes('\\') || filename.startsWith('.')) {
      throw new Error('filename must be a plain file name (no slashes, no leading dot).');
    }
    if (!/\.(tsx?|jsx?|py|java)$/i.test(filename)) {
      throw new Error('filename must end in .ts / .tsx / .js / .jsx / .py / .java.');
    }
    const absDir = path.resolve(projectRoot, testDir);
    absPath = path.join(absDir, filename);
    if (!absPath.startsWith(absDir + path.sep) && absPath !== absDir) {
      throw new Error('Refusing to write outside the configured tests folder.');
    }
  }

  const content =
    typeof body.content === 'string' && body.content.length > 0
      ? body.content
      : session.recorder.toSpec();
  if (!content) throw new Error('Recorded script is empty — record something first.');
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  if (!body.overwrite) {
    const exists = await fs.access(absPath).then(
      () => true,
      () => false,
    );
    if (exists) {
      throw new Error(
        `File already exists at ${absPath}. Re-send with overwrite: true to replace it.`,
      );
    }
  }
  await fs.writeFile(absPath, content, 'utf8');
  return { path: absPath, bytes: Buffer.byteLength(content, 'utf8') };
}

// ─── Cloud device-catalog fetching ─────────────────────────────
export interface CloudDevice {
  provider: 'browserstack' | 'lambdatest' | 'digitalai';
  platform: 'android' | 'ios';
  deviceName: string;
  osVersion: string;
  realDevice: boolean;
  /**
   * Connectable right now. Only set by Digital.ai (real hardware with live
   * status); omitted by the on-demand grids (BrowserStack/LambdaTest), where the
   * UI treats `undefined` as available. Only `Available`/online is connectable.
   */
  available?: boolean;
  /** Human-readable status for display on non-available tiles (e.g. "In Use"). */
  status?: string;
}

/** Device statuses Digital.ai reports as connectable (online + free). */
const DIGITALAI_AVAILABLE_STATUSES = ['available', 'online'];

/**
 * Parse Digital.ai's `GET /api/v1/devices` response into CloudDevices. The list
 * lives under `data` (`{ status, data: [...], code }`); per-device fields are
 * `deviceName`/`modelName`/`model`, `deviceOs`/`os`, `osVersion`, `isEmulator`,
 * and `displayStatus`/`currentStatus`.
 *
 * Unlike on-demand grids (BrowserStack/LambdaTest), Digital.ai devices are real
 * hardware with live status. ALL devices are returned (so the picker shows the
 * full fleet), but each carries `available` — only `Available`/online devices
 * are connectable; In-Use/Offline are shown greyed-out and unselectable. When
 * status is absent it's treated as available, to stay tolerant of shape changes.
 * Shape-tolerant; pure; exported for testing.
 */
export function parseDigitalaiDevices(raw: unknown): CloudDevice[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(r.data)
      ? (r.data as unknown[])
      : Array.isArray(r.devices)
        ? (r.devices as unknown[])
        : [];
  const devices: CloudDevice[] = [];
  for (const item of arr) {
    const d = item as Record<string, unknown>;
    const name = d.deviceName ?? d.modelName ?? d.model ?? d.name;
    if (!name) continue;
    const os = String(d.deviceOs ?? d.os ?? d.osType ?? d.platform ?? '');
    const version = d.osVersion ?? d.version ?? d.platformVersion;
    const rawStatus = String(d.displayStatus ?? d.currentStatus ?? '');
    const lower = rawStatus.toLowerCase();
    const available = lower === '' || DIGITALAI_AVAILABLE_STATUSES.includes(lower);
    devices.push({
      provider: 'digitalai',
      platform: os.toLowerCase().includes('ios') ? 'ios' : 'android',
      deviceName: String(name),
      osVersion: version != null ? String(version) : '',
      realDevice: d.isEmulator === true ? false : true,
      available,
      ...(rawStatus ? { status: rawStatus } : {}),
    });
  }
  return devices;
}

/**
 * Parse LambdaTest's `/mobile-automation/api/v1/list` response into CloudDevices.
 * Shape-tolerant: the array may be top-level, under `devices`, or under `data`
 * (LambdaTest wraps several endpoints under `data`), and per-device field names
 * vary — so we fall back across the common spellings. Pure; exported for testing.
 */
export function parseLambdatestDevices(raw: unknown): CloudDevice[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(r.devices)
      ? (r.devices as unknown[])
      : Array.isArray(r.data)
        ? (r.data as unknown[])
        : [];
  const devices: CloudDevice[] = [];
  for (const item of arr) {
    const d = item as Record<string, unknown>;
    const name = d.deviceName ?? d.device ?? d.name;
    if (!name) continue;
    const os = String(d.platformName ?? d.platform ?? d.os ?? d.osName ?? '');
    const version = d.osVersion ?? d.version ?? d.os_version ?? d.platformVersion;
    devices.push({
      provider: 'lambdatest',
      platform: os.toLowerCase().includes('ios') ? 'ios' : 'android',
      deviceName: String(name),
      osVersion: version != null ? String(version) : '',
      realDevice: true,
    });
  }
  return devices;
}

async function fetchCloudDevices(
  provider: 'browserstack' | 'lambdatest' | 'digitalai',
  user: string,
  key: string,
  cloudServer?: string,
): Promise<CloudDevice[]> {
  // Digital.ai authenticates with a bearer access key against the tenant cloud
  // server — no username, a configurable host.
  if (provider === 'digitalai') {
    if (!key) throw new Error('Digital.ai access key is required.');
    if (!cloudServer) throw new Error('Digital.ai cloud server URL is required.');
    const origin = new URL(
      /^https?:\/\//.test(cloudServer) ? cloudServer : `https://${cloudServer}`,
    ).origin;
    const r = await fetch(`${origin}/api/v1/devices`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      throw new Error(`Digital.ai devices API returned ${r.status} — check the URL + access key.`);
    }
    const raw = await r.json();
    const devices = parseDigitalaiDevices(raw);
    if (devices.length === 0) {
      const keys =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? Object.keys(raw as object).join(', ')
          : typeof raw;
      console.error(
        '[taqwright] Digital.ai device list — unrecognized response:',
        JSON.stringify(raw).slice(0, 800),
      );
      throw new Error(
        `Digital.ai returned 200 but no devices could be parsed (top-level: ${keys}). ` +
          'Check the inspector server logs for the raw response.',
      );
    }
    return devices;
  }
  if (!user || !key) {
    throw new Error(`${provider} username + access key are required.`);
  }
  const auth = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');
  if (provider === 'browserstack') {
    const r = await fetch('https://api-cloud.browserstack.com/app-automate/devices.json', {
      headers: { Authorization: auth },
    });
    if (!r.ok) {
      throw new Error(`BrowserStack devices.json returned ${r.status} — check credentials.`);
    }
    const raw = (await r.json()) as Array<{
      device: string;
      os: string;
      os_version: string;
      realMobile?: string | boolean;
    }>;
    return raw.map((d) => ({
      provider,
      platform: d.os.toLowerCase().includes('ios') ? 'ios' : 'android',
      deviceName: d.device,
      osVersion: d.os_version,
      realDevice: d.realMobile === true || d.realMobile === 'true',
    }));
  }
  // lambdatest
  const r = await fetch(
    'https://mobile-api.lambdatest.com/mobile-automation/api/v1/list?region=us',
    { headers: { Authorization: auth } },
  );
  if (!r.ok) {
    throw new Error(`LambdaTest devices API returned ${r.status} — check credentials.`);
  }
  const raw = await r.json();
  const devices = parseLambdatestDevices(raw);
  if (devices.length === 0) {
    // A 200 with an unrecognized shape used to yield a silent empty list. Surface
    // it instead: log the raw body and return an actionable error to the picker.
    const keys =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.keys(raw).join(', ')
        : typeof raw;
    console.error(
      '[taqwright] LambdaTest device list — unrecognized response:',
      JSON.stringify(raw).slice(0, 800),
    );
    throw new Error(
      `LambdaTest returned 200 but no devices could be parsed (top-level: ${keys}). ` +
        'If your account region is not "us", the us list can be empty. ' +
        'Check the inspector server logs for the raw response.',
    );
  }
  return devices;
}

async function inspectIpa(p: string): Promise<AppInspectResult> {
  return bundleIdFromZippedApp(p, 'ipa');
}

async function inspectIosAppZip(p: string): Promise<AppInspectResult> {
  return bundleIdFromZippedApp(p, 'app.zip');
}

// Shared unzip → plutil path for both `.ipa` (app bundle under `Payload/`) and a
// zipped `.app` (`.app.zip`, where the bundle typically sits at the archive root).
// The regex matches either layout: it finds the first `*.app/Info.plist` entry and
// extracts only that single plist into a temp dir to read CFBundleIdentifier.
async function bundleIdFromZippedApp(
  p: string,
  kind: 'ipa' | 'app.zip',
): Promise<AppInspectResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { join } = await import('node:path');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const execP = promisify(execFile);
  const label = kind === 'ipa' ? 'IPA' : '.app.zip';
  // Find the app bundle's Info.plist entry as it appears in the archive —
  // `Payload/Foo.app/Info.plist` (ipa) or `Foo.app/Info.plist` (zipped .app, at
  // root or nested). `\S*` captures any leading path prefix so `unzip -j` can
  // extract that exact entry.
  const { stdout: listOut } = await execP('unzip', ['-l', p]);
  const entry = listOut.match(/(\S*[^/\s]+\.app\/Info\.plist)/)?.[1];
  if (!entry) {
    throw new Error(`${label} does not contain a *.app/Info.plist entry`);
  }
  const tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'taqwright-app-'));
  try {
    await execP('unzip', ['-o', '-j', p, entry, '-d', tmpDir]);
    const plistPath = join(tmpDir, 'Info.plist');
    const { stdout } = await execP('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plistPath]);
    const id = stdout.trim();
    if (!id) throw new Error(`CFBundleIdentifier not found in ${label} Info.plist`);
    return { kind, bundleId: id };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
