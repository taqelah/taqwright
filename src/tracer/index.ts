import type { Client as WebDriverClient } from 'webdriver';
import type { Platform } from '../types/index.js';
import type { HarLog } from '../network/har.js';
import { TAQWRIGHT_FAVICON_DATA_URI } from '../branding-assets.js';

/**
 * One row in the trace timeline. Captured AFTER the action completes so the
 * screenshot reflects the state the action produced. The previous row's
 * "after" doubles as the current row's "before" — no need to snapshot pre-state.
 */
export interface TraceEntry {
  /** e.g. `mobile.click`, `locator.fill`. */
  action: string;
  /** Best-effort one-line stringification of the action arguments. */
  args: string;
  /** Milliseconds since the trace started. */
  startTs: number;
  /** Milliseconds the action took to complete. */
  durationMs: number;
  /** Base64 PNG (no data-URL prefix), or `null` if the snapshot failed. */
  screenshot: string | null;
  /** XML page-source, or `null` if it failed. */
  source: string | null;
  /** Error message if the action threw. */
  error?: string;
}

/** Minimal slice of Playwright's `TestInfo` shape used by `toHtml`. */
export interface TraceTestInfo {
  title: string;
  status?: string;
  duration?: number;
  project?: { name?: string };
}

/** Optional inputs to {@link Tracer.toHtml}. */
export interface ToHtmlOptions {
  /**
   * HAR (network capture) data to embed in the artifact. When provided, the
   * player renders a side panel of in-flight + recently-completed requests
   * synchronized to the current playhead time. `null` / `undefined` collapses
   * the layout to a single column with no network panel.
   */
  har?: HarLog | null;
}

/**
 * Captures per-action screenshots + page-source for a single test, and
 * renders the collected timeline as a self-contained HTML artifact.
 *
 * Constructed by the `mobile` fixture when `use.trace !== 'off'`; instrumented
 * via a Proxy over the returned `Mobile` (see `./proxy.ts`).
 */
export class Tracer {
  private readonly entries: TraceEntry[] = [];
  private readonly startTs = Date.now();

  constructor(
    private readonly driver: WebDriverClient,
    // Kept for future per-platform formatting; not used today.
    private readonly _platform: Platform,
  ) {}

  /**
   * Absolute `Date.now()` value at Tracer construction. Used by `toHtml` to
   * convert HAR's `startedDateTime` ISO timestamps onto the trace's
   * relative-ms axis. Exposed so consumers can do their own correlation.
   */
  getStartTs(): number {
    return this.startTs;
  }

  /** Read-only view of the recorded actions, in insertion order. */
  getEntries(): readonly TraceEntry[] {
    return this.entries;
  }

  /**
   * Wrap a function call: time it, capture post-state, record it. Re-throws
   * the underlying error after recording so the test still fails normally.
   */
  async record<T>(action: string, args: unknown[], fn: () => Promise<T>): Promise<T> {
    const startTs = Date.now();
    let error: unknown;
    try {
      return await fn();
    } catch (e) {
      error = e;
      throw e;
    } finally {
      const endTs = Date.now();
      const [shot, source] = await Promise.all([
        this.driver.takeScreenshot().catch(() => null),
        this.driver.getPageSource().catch(() => null),
      ]);
      this.entries.push({
        action,
        args: serializeArgs(args),
        startTs: startTs - this.startTs,
        durationMs: endTs - startTs,
        screenshot: typeof shot === 'string' ? shot : null,
        source: typeof source === 'string' ? source : null,
        error:
          error instanceof Error ? error.message : error !== undefined ? String(error) : undefined,
      });
    }
  }

  /**
   * Render the recorded timeline as a self-contained HTML page. With `opts.har`
   * provided the page is a full video-style player with a correlated network
   * side panel; without it the player still renders but with the side panel
   * collapsed (single-column layout, action track only on the timeline).
   */
  toHtml(info: TraceTestInfo, opts?: ToHtmlOptions): string {
    const status = info.status ?? 'unknown';
    const project = info.project?.name ?? '';
    const harLog = opts?.har ?? null;
    const hasHar = harLog !== null;

    // Preprocess HAR entries onto the same relative-ms axis the trace uses.
    // `e.time === 0 && status === 0` → still-in-flight at flush; the runtime
    // extends those visually to the end of the trace.
    const harEntries = harLog?.log.entries ?? [];
    const harRel = harEntries
      .map((e) => {
        const startRel = new Date(e.startedDateTime).getTime() - this.startTs;
        return {
          startRel: Math.max(0, startRel),
          durMs: e.time,
          method: e.request.method,
          url: e.request.url,
          status: e.response.status,
          mime: e.response.content.mimeType ?? '',
          size: e.response.content.size ?? 0,
          error: (e as { _error?: string })._error ?? null,
        };
      })
      .filter((r) => r.startRel + Math.max(r.durMs, 0) >= 0);

    // Slim event payload — screenshots referenced by index to keep events tiny.
    const events = this.entries.map((e, i) => ({
      action: e.action,
      args: e.args,
      startRel: e.startTs,
      dur: e.durationMs,
      error: e.error,
      screenshotIdx: e.screenshot ? i : -1,
    }));
    const screenshots = this.entries.map((e) => e.screenshot);

    // totalMs spans whatever's latest: testInfo.duration, the last action's
    // end, or the last HAR entry's end. Default 0 keeps the empty case sane.
    const lastEventEnd = events.length
      ? events[events.length - 1]!.startRel + events[events.length - 1]!.dur
      : 0;
    const lastHarEnd = harRel.length
      ? harRel[harRel.length - 1]!.startRel + Math.max(harRel[harRel.length - 1]!.durMs, 0)
      : 0;
    const totalMs = Math.max(info.duration ?? 0, lastEventEnd, lastHarEnd, 0);

    const meta = {
      title: info.title,
      status,
      totalMs,
      projectName: project,
      hasHar,
      harComment: harLog?.log.comment ?? null,
      actionCount: events.length,
      requestCount: harRel.length,
    };

    const bodyClass = [hasHar ? 'hasHar' : 'noHar'].join(' ');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="icon" type="image/png" href="${TAQWRIGHT_FAVICON_DATA_URI}">
<title>Taqwright Trace — ${escHtml(info.title)}</title>
<style>${PLAYER_CSS}</style>
<script type="application/json" id="__tw_meta">${safeJson(meta)}</script>
<script type="application/json" id="__tw_events">${safeJson(events)}</script>
<script type="application/json" id="__tw_screenshots">${safeJson(screenshots)}</script>
<script type="application/json" id="__tw_har">${safeJson(harRel)}</script>
</head>
<body class="${bodyClass}">
<header class="hd">
  <div class="title">${escHtml(info.title)}</div>
  <div class="meta">
    <span class="status status-${escAttr(status)}">${escHtml(status)}</span>
    <span>·</span><span>${formatDuration(totalMs)}</span>
    <span>·</span><span>${events.length} action${events.length === 1 ? '' : 's'}</span>
    ${hasHar ? `<span>·</span><span>${harRel.length} request${harRel.length === 1 ? '' : 's'}</span>` : ''}
    ${project ? `<span>·</span><span>${escHtml(project)}</span>` : ''}
  </div>
</header>
<section class="timeline">
  <svg id="trk" viewBox="0 0 1000 60" preserveAspectRatio="none">
    <g id="trk-actions"></g>
    <g id="trk-har"></g>
    <line id="playhead" x1="0" y1="0" x2="0" y2="60"></line>
  </svg>
</section>
<section class="controls">
  <button class="btn" data-act="back" title="Back 1s">⏮</button>
  <button class="btn" data-act="step-back" title="Step ‑100ms">‹</button>
  <button class="btn play" data-act="play" title="Play / Pause (Space)">▶</button>
  <button class="btn" data-act="step-fwd" title="Step +100ms">›</button>
  <button class="btn" data-act="fwd" title="Forward 1s">⏭</button>
  <span class="sep"></span>
  <label class="speedlbl">Speed
    <select id="speed">
      <option value="0.5">0.5×</option>
      <option value="1" selected>1×</option>
      <option value="2">2×</option>
      <option value="4">4×</option>
    </select>
  </label>
  <span class="clock"><span id="now">00:00.0</span> / <span id="dur">${formatDuration(totalMs)}</span></span>
</section>
<section class="main">
  <div class="screenshot">
    <img id="bigshot" alt="screenshot at playhead"/>
    <div class="overlay">
      <div class="action" id="ov-action"></div>
      <div class="args" id="ov-args"></div>
      <div class="err" id="ov-err" hidden></div>
    </div>
    <div class="noshot" id="noshot" hidden>no screenshot at this moment</div>
  </div>
  <aside class="harpanel">
    <div class="harhead">
      <b>Network</b>
      <label class="allbox"><input type="checkbox" id="harall"> All</label>
    </div>
    <ul id="harlist"></ul>
    <div class="harempty" id="harempty" hidden></div>
  </aside>
</section>
<section class="actionindex">
  <table id="acts"><thead><tr><th>#</th><th>+t</th><th>dur</th><th>action</th><th>args</th></tr></thead><tbody></tbody></table>
</section>
<script>${PLAYER_JS}</script>
</body></html>`;
  }
}

/**
 * One-line stringification of action args. Locators get their leaf strategy
 * extracted (we know the shape because the Proxy is the only caller).
 * Anything else falls back to `JSON.stringify` with circular-ref guarding.
 */
function serializeArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  return args
    .map((a) => {
      if (a == null) return String(a);
      if (typeof a === 'string') return JSON.stringify(a);
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      // Locator-shaped object — has a private `strategy`; try to surface it.
      if (typeof a === 'object' && 'strategy' in (a as object)) {
        const s = (a as { strategy?: { using?: string; value?: string } }).strategy;
        if (s?.using && s?.value !== undefined) return `<${s.using}=${s.value}>`;
      }
      try {
        return JSON.stringify(a);
      } catch {
        return '[object]';
      }
    })
    .join(', ');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * JSON-encode + neutralize the only escape that matters inside
 * `<script type="application/json">`: a literal `</script` would close the
 * tag. The `<` form is valid JSON and renders fine when re-parsed.
 */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  return `${String(mm).padStart(2, '0')}:${ss.toFixed(1).padStart(4, '0')}`;
}

const PLAYER_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         margin: 0; background: #0d1117; color: #e6edf3;
         display: grid; grid-template-rows: auto auto auto 1fr auto; min-height: 100vh; }
  .hd { padding: 14px 24px; background: #161b22; border-bottom: 1px solid #30363d; }
  .title { font-size: 17px; font-weight: 600; margin-bottom: 4px; }
  .meta { color: #8b949e; font-size: 13px; display: flex; gap: 8px; align-items: center; }
  .status { padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 12px; }
  .status-passed { background: #1f3a25; color: #3fb950; }
  .status-failed, .status-timedOut, .status-interrupted { background: #3f1d20; color: #f85149; }
  .status-skipped, .status-unknown { background: #2a2c30; color: #8b949e; }

  .timeline { padding: 10px 24px 0; background: #161b22; }
  #trk { width: 100%; height: 60px; cursor: pointer; touch-action: none;
         background: #0d1117; border: 1px solid #30363d; border-radius: 4px; }
  #trk .seg { fill: #1f6feb; opacity: 0.85; }
  #trk .seg.err { fill: #f85149; }
  #trk .seg.cur { stroke: #ffffff; stroke-width: 1.2; }
  #trk .har2 { fill: #3fb950; opacity: 0.85; }
  #trk .har3 { fill: #79c0ff; opacity: 0.85; }
  #trk .har4 { fill: #d29922; opacity: 0.9; }
  #trk .har5 { fill: #f85149; opacity: 0.9; }
  #trk .har0 { fill: #6e7681; opacity: 0.7; }
  #trk #playhead { stroke: #e6edf3; stroke-width: 1.5; pointer-events: none; }

  .controls { padding: 10px 24px; background: #161b22; border-bottom: 1px solid #30363d;
              display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .btn { background: #21262d; color: #e6edf3; border: 1px solid #30363d;
         border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 14px;
         font-family: inherit; min-width: 36px; }
  .btn:hover { background: #30363d; }
  .btn.play { background: #238636; border-color: #2ea043; min-width: 48px; }
  .btn.play.paused { background: #21262d; border-color: #30363d; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .sep { width: 1px; height: 20px; background: #30363d; margin: 0 6px; }
  .speedlbl { font-size: 12px; color: #8b949e; display: flex; align-items: center; gap: 6px; }
  #speed { background: #0d1117; color: #e6edf3; border: 1px solid #30363d;
           padding: 4px 6px; border-radius: 3px; font-family: inherit; font-size: 12px; }
  .clock { margin-left: auto; font-family: ui-monospace, "SF Mono", monospace;
           font-size: 13px; color: #8b949e; }
  .clock #now { color: #e6edf3; }

  .main { display: grid; grid-template-columns: 1fr 380px; gap: 1px;
          background: #30363d; min-height: 400px; }
  body.noHar .main { grid-template-columns: 1fr; }
  body.noHar .harpanel { display: none; }

  .screenshot { background: #0d1117; display: flex; align-items: center;
                justify-content: center; position: relative; padding: 16px; overflow: hidden; }
  #bigshot { max-width: 100%; max-height: 70vh; object-fit: contain;
             border: 1px solid #30363d; border-radius: 6px; background: #161b22; }
  .overlay { position: absolute; bottom: 16px; left: 16px; right: 16px;
             pointer-events: none; }
  .overlay .action { display: inline-block; font-family: ui-monospace, "SF Mono", monospace;
                     font-size: 13px; color: #79c0ff; background: rgba(13,17,23,0.85);
                     padding: 4px 8px; border-radius: 3px; border: 1px solid #30363d; }
  .overlay .args { display: inline-block; margin-top: 4px;
                   font-family: ui-monospace, "SF Mono", monospace; font-size: 12px;
                   color: #8b949e; background: rgba(13,17,23,0.85); padding: 3px 8px;
                   border-radius: 3px; border: 1px solid #30363d; word-break: break-all; }
  .overlay .err { display: block; margin-top: 6px; color: #f85149; font-size: 12px;
                  padding: 6px 8px; background: rgba(248,81,73,0.12);
                  border-left: 3px solid #f85149; border-radius: 2px; }
  .noshot { color: #6e7681; font-size: 13px; }

  .harpanel { background: #161b22; display: flex; flex-direction: column;
              max-height: calc(70vh + 32px); overflow: hidden; }
  .harhead { padding: 12px 16px; border-bottom: 1px solid #30363d;
             display: flex; align-items: center; justify-content: space-between;
             font-size: 13px; }
  .allbox { color: #8b949e; font-size: 12px; display: flex; align-items: center; gap: 4px; }
  #harlist { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
  #harlist li { padding: 8px 16px; border-bottom: 1px solid #21262d;
                font-family: ui-monospace, "SF Mono", monospace; font-size: 12px;
                cursor: default; }
  #harlist li.active { background: rgba(31,111,235,0.12); }
  #harlist .topline { display: flex; gap: 6px; align-items: baseline; }
  #harlist .method { color: #e6edf3; font-weight: 600; min-width: 44px; }
  #harlist .status { padding: 1px 6px; border-radius: 3px; font-weight: 600; font-size: 11px; }
  #harlist .s2 { background: #1f3a25; color: #3fb950; }
  #harlist .s3 { background: #1a3a52; color: #79c0ff; }
  #harlist .s4 { background: #3a2e0e; color: #d29922; }
  #harlist .s5 { background: #3f1d20; color: #f85149; }
  #harlist .s0 { background: #2a2c30; color: #6e7681; }
  #harlist .reltime { margin-left: auto; color: #6e7681; font-size: 11px; }
  #harlist .urlline { color: #8b949e; margin-top: 3px; word-break: break-all; }
  #harlist .mimeline { color: #6e7681; margin-top: 2px; font-size: 11px; }
  .harempty { padding: 24px 16px; color: #6e7681; font-size: 13px; text-align: center; }

  .actionindex { background: #161b22; border-top: 1px solid #30363d;
                 max-height: 220px; overflow-y: auto; }
  #acts { width: 100%; border-collapse: collapse; font-size: 12px; }
  #acts th { text-align: left; padding: 8px 16px; color: #8b949e; font-weight: 500;
             border-bottom: 1px solid #30363d; position: sticky; top: 0; background: #161b22;
             font-family: ui-monospace, "SF Mono", monospace; }
  #acts td { padding: 6px 16px; border-bottom: 1px solid #21262d;
             font-family: ui-monospace, "SF Mono", monospace; }
  #acts td.num, #acts td.t, #acts td.d { color: #6e7681; }
  #acts td.action { color: #79c0ff; }
  #acts td.args { color: #8b949e; word-break: break-all; max-width: 0; overflow: hidden;
                  text-overflow: ellipsis; white-space: nowrap; }
  #acts tr { cursor: pointer; }
  #acts tr:hover td { background: #1c2129; }
  #acts tr.cur td { background: rgba(31,111,235,0.15); }
  #acts tr.err td.action { color: #f85149; }

  .empty { padding: 32px 16px; color: #6e7681; text-align: center; font-size: 13px; }
`;

// Inline player JS. CRITICAL — see CLAUDE.md: escape sequences inside this
// template literal are processed by the OUTER TS template at compile time,
// so anything we want to be a real backslash escape at runtime must be
// double-escaped here (e.g. '\\n' in source → '\n' at runtime).
const PLAYER_JS = `
(function () {
  var meta = JSON.parse(document.getElementById('__tw_meta').textContent || '{}');
  var events = JSON.parse(document.getElementById('__tw_events').textContent || '[]');
  var shots = JSON.parse(document.getElementById('__tw_screenshots').textContent || '[]');
  var har = meta.hasHar ? JSON.parse(document.getElementById('__tw_har').textContent || '[]') : [];

  var totalMs = Math.max(meta.totalMs || 0, 1);
  var T = 0;
  var playing = false;
  var speed = 1;
  var lastRaf = 0;
  var currentIdx = -1;
  var showAll = false;
  var dragging = false;

  var trk = document.getElementById('trk');
  var playheadEl = document.getElementById('playhead');
  var nowEl = document.getElementById('now');
  var durEl = document.getElementById('dur');
  var bigshot = document.getElementById('bigshot');
  var noshot = document.getElementById('noshot');
  var ovAction = document.getElementById('ov-action');
  var ovArgs = document.getElementById('ov-args');
  var ovErr = document.getElementById('ov-err');
  var harlist = document.getElementById('harlist');
  var harempty = document.getElementById('harempty');
  var playBtn = document.querySelector('.btn.play');
  var speedSel = document.getElementById('speed');
  var harall = document.getElementById('harall');

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function formatTime(ms) {
    var s = Math.max(0, ms) / 1000;
    var mm = Math.floor(s / 60);
    var ss = s - mm * 60;
    var fixed = ss.toFixed(1);
    if (fixed.indexOf('.') === 1) fixed = '0' + fixed;
    return pad(mm, 2) + ':' + fixed;
  }

  // ─── timeline track render (once) ─────────────────────────────
  function drawTimeline() {
    var actG = document.getElementById('trk-actions');
    var harG = document.getElementById('trk-har');
    actG.innerHTML = '';
    harG.innerHTML = '';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var x = (e.startRel / totalMs) * 1000;
      var w = Math.max(2, (e.dur / totalMs) * 1000);
      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'seg' + (e.error ? ' err' : ''));
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', '8');
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', '14');
      rect.setAttribute('data-i', String(i));
      rect.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var idx = parseInt(this.getAttribute('data-i'), 10);
        seek(events[idx].startRel, true);
      });
      actG.appendChild(rect);
    }
    for (var j = 0; j < har.length; j++) {
      var h = har[j];
      var hx = (h.startRel / totalMs) * 1000;
      var hd = h.durMs > 0 ? h.durMs : (totalMs - h.startRel);
      var hw = Math.max(2, (hd / totalMs) * 1000);
      var statusClass = h.status >= 500 ? 'har5' :
                        h.status >= 400 ? 'har4' :
                        h.status >= 300 ? 'har3' :
                        h.status >= 200 ? 'har2' : 'har0';
      var r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r2.setAttribute('class', statusClass);
      r2.setAttribute('x', String(hx));
      r2.setAttribute('y', '36');
      r2.setAttribute('width', String(hw));
      r2.setAttribute('height', '14');
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = h.method + ' ' + h.url + '  ' + (h.status || '???');
      r2.appendChild(title);
      harG.appendChild(r2);
    }
  }

  // ─── action index render (once) ───────────────────────────────
  function drawActionIndex() {
    var tbody = document.querySelector('#acts tbody');
    tbody.innerHTML = '';
    if (events.length === 0) {
      var empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="5" style="color:#6e7681;text-align:center;padding:24px">No traced actions.</td>';
      tbody.appendChild(empty);
      return;
    }
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var tr = document.createElement('tr');
      tr.setAttribute('data-i', String(i));
      if (e.error) tr.className = 'err';
      tr.innerHTML =
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="t">+' + e.startRel + 'ms</td>' +
        '<td class="d">' + e.dur + 'ms</td>' +
        '<td class="action">' + escapeHtml(e.action) + '</td>' +
        '<td class="args" title="' + escapeAttr(e.args) + '">' + escapeHtml(e.args) + '</td>';
      tr.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-i'), 10);
        seek(events[idx].startRel, true);
      });
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // Largest i with events[i].startRel <= T. -1 if no events have started yet.
  function findCurrentIdx(t) {
    if (events.length === 0) return -1;
    var lo = 0, hi = events.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (events[mid].startRel <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function render() {
    var x = (T / totalMs) * 1000;
    playheadEl.setAttribute('x1', String(x));
    playheadEl.setAttribute('x2', String(x));
    nowEl.textContent = formatTime(T);

    var idx = findCurrentIdx(T);
    if (idx !== currentIdx) {
      currentIdx = idx;
      if (idx === -1) {
        bigshot.style.display = 'none';
        noshot.hidden = false;
        ovAction.textContent = '';
        ovArgs.textContent = '';
        ovErr.hidden = true;
      } else {
        var e = events[idx];
        var shot = shots[idx];
        if (shot) {
          bigshot.src = 'data:image/png;base64,' + shot;
          bigshot.style.display = '';
          noshot.hidden = true;
        } else {
          bigshot.style.display = 'none';
          noshot.hidden = false;
        }
        ovAction.textContent = e.action;
        ovArgs.textContent = e.args || '';
        if (e.error) { ovErr.textContent = e.error; ovErr.hidden = false; }
        else { ovErr.hidden = true; ovErr.textContent = ''; }
      }
      // Highlight the current row in the action index + scroll into view.
      var rows = document.querySelectorAll('#acts tbody tr');
      for (var r = 0; r < rows.length; r++) rows[r].classList.remove('cur');
      if (idx >= 0 && rows[idx]) {
        rows[idx].classList.add('cur');
        // gentle scroll into view if outside the visible region
        var rect = rows[idx].getBoundingClientRect();
        var parent = rows[idx].parentElement.parentElement.parentElement;
        var prect = parent.getBoundingClientRect();
        if (rect.top < prect.top || rect.bottom > prect.bottom) {
          rows[idx].scrollIntoView({ block: 'nearest' });
        }
      }
      // Mark the corresponding action rect on the timeline.
      var segs = document.querySelectorAll('#trk-actions rect');
      for (var s = 0; s < segs.length; s++) segs[s].classList.remove('cur');
      if (idx >= 0 && segs[idx]) segs[idx].classList.add('cur');
    }

    renderHar();
  }

  function endOf(h) {
    return h.startRel + (h.durMs > 0 ? h.durMs : (totalMs - h.startRel));
  }

  function renderHar() {
    if (!meta.hasHar) return;
    if (har.length === 0) {
      harlist.style.display = 'none';
      harempty.hidden = false;
      harempty.textContent = meta.harComment
        ? 'no captures — ' + meta.harComment
        : 'no captures';
      return;
    }
    harempty.hidden = true;
    harlist.style.display = '';

    var visible = [];
    for (var i = 0; i < har.length; i++) {
      var h = har[i];
      var active = h.startRel <= T && endOf(h) >= T;
      if (showAll) {
        visible.push({ h: h, active: active });
      } else {
        // in-flight at T OR completed within last 2000ms before T
        var recentlyDone = !active && endOf(h) <= T && (T - endOf(h)) <= 2000;
        if (active || recentlyDone) visible.push({ h: h, active: active });
      }
    }

    // Build all rows in one pass; cheaper than diffing for the small lists
    // we expect (tens to hundreds of entries).
    var html = '';
    if (visible.length === 0) {
      html = '<li style="color:#6e7681;text-align:center">no in-flight or recent requests at this moment</li>';
    } else {
      for (var v = 0; v < visible.length; v++) {
        var h = visible[v].h;
        var active = visible[v].active;
        var sCls = h.status >= 500 ? 's5' :
                   h.status >= 400 ? 's4' :
                   h.status >= 300 ? 's3' :
                   h.status >= 200 ? 's2' : 's0';
        var stext = h.status || (h.error ? 'err' : '...');
        var endRel = endOf(h);
        var reltime = active
          ? 'in flight (+' + (T - h.startRel) + 'ms)'
          : (endRel <= T ? 'done ' + (T - endRel) + 'ms ago' : 'starts in ' + (h.startRel - T) + 'ms');
        var size = h.size > 0 ? formatBytes(h.size) : '';
        var mime = h.mime ? escapeHtml(h.mime) : '';
        html +=
          '<li class="' + (active ? 'active' : '') + '">' +
            '<div class="topline">' +
              '<span class="method">' + escapeHtml(h.method) + '</span>' +
              '<span class="status ' + sCls + '">' + escapeHtml(String(stext)) + '</span>' +
              '<span class="reltime">' + escapeHtml(reltime) + '</span>' +
            '</div>' +
            '<div class="urlline">' + escapeHtml(h.url) + '</div>' +
            (mime || size
              ? '<div class="mimeline">' + (mime ? mime : '') + (mime && size ? ' · ' : '') + size + '</div>'
              : '') +
          '</li>';
      }
    }
    harlist.innerHTML = html;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function seek(t, pause) {
    T = clamp(t, 0, totalMs);
    if (pause) setPlaying(false);
    render();
  }

  function setPlaying(p) {
    playing = p;
    playBtn.textContent = p ? '⏸' : '▶';
    playBtn.classList.toggle('paused', !p);
    if (p) {
      // Loop back to start if we're at the end.
      if (T >= totalMs) T = 0;
      lastRaf = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    if (!playing) return;
    var dt = now - lastRaf;
    lastRaf = now;
    T = clamp(T + dt * speed, 0, totalMs);
    render();
    if (T >= totalMs) {
      setPlaying(false);
      return;
    }
    requestAnimationFrame(tick);
  }

  // ─── pointer on timeline ──────────────────────────────────────
  function trkPos(ev) {
    var rect = trk.getBoundingClientRect();
    var x = (ev.clientX - rect.left) / rect.width;
    return clamp(x, 0, 1) * totalMs;
  }
  trk.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    dragging = true;
    setPlaying(false);
    trk.setPointerCapture(ev.pointerId);
    seek(trkPos(ev), false);
  });
  trk.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    seek(trkPos(ev), false);
  });
  trk.addEventListener('pointerup', function (ev) {
    dragging = false;
    try { trk.releasePointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
  });

  // ─── controls ─────────────────────────────────────────────────
  document.querySelectorAll('.controls .btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var act = btn.getAttribute('data-act');
      if (act === 'play') setPlaying(!playing);
      else if (act === 'back') seek(T - 1000, true);
      else if (act === 'fwd') seek(T + 1000, true);
      else if (act === 'step-back') seek(T - 100, true);
      else if (act === 'step-fwd') seek(T + 100, true);
    });
  });
  speedSel.addEventListener('change', function () {
    speed = parseFloat(speedSel.value) || 1;
  });
  if (harall) {
    harall.addEventListener('change', function () {
      showAll = harall.checked;
      renderHar();
    });
  }

  // ─── keyboard ────────────────────────────────────────────────
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.key === ' ') {
      ev.preventDefault();
      setPlaying(!playing);
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      seek(T - (ev.shiftKey ? 1000 : 100), true);
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      seek(T + (ev.shiftKey ? 1000 : 100), true);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      seek(0, true);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      seek(totalMs, true);
    }
  });

  // ─── init ─────────────────────────────────────────────────────
  drawTimeline();
  drawActionIndex();
  if (events.length === 0) {
    document.querySelectorAll('.controls .btn').forEach(function (b) { b.disabled = true; });
    speedSel.disabled = true;
    var ph = document.querySelector('.screenshot');
    if (ph) ph.innerHTML = '<div class="empty">No traced actions.</div>';
  } else {
    render();
  }
})();
`;
