/**
 * The inspector single-page web UI. Inlined as a string so tsc can ship it
 * without a separate asset-copy build step.
 */
export const INSPECTOR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>taqwright codegen</title>
<link rel="icon" type="image/png" href="/static/logo.png" />
<style>
  :root {
    color-scheme: light;
    --bg: #ffffff;
    --panel: #f6f8fa;
    --panel-2: #eaeef2;
    --border: #d0d7de;
    --border-strong: #afb8c1;
    --text: #1f2328;
    --text-dim: #656d76;
    --text-muted: #8b949e;
    --accent: #0969da;
    --accent-hover: #0550ae;
    --success: #1a7f37;
    --warn: #9a6700;
    --danger: #cf222e;
    --code-bg: #f6f8fa;
    --hl: rgba(9, 105, 218, 0.10);
    --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased; }
  /* ─── View switching ─────────────────────────────────────── */
  body.view-setup main { display: none; }
  body.view-setup .inspector-only { display: none !important; }
  body.view-inspector #setup { display: none; }
  body.view-inspector .setup-only { display: none !important; }
  /* ─── Header ─────────────────────────────────────────────── */
  header { display: flex; align-items: center; gap: 10px; padding: 8px 16px;
    background: var(--panel); border-bottom: 1px solid var(--border); height: 52px; }
  header .logo { height: 32px; width: auto; object-fit: contain; border-radius: 6px;
    flex-shrink: 0; }
  header h1 { font-size: 14px; font-weight: 600; margin: 0; letter-spacing: -0.01em;
    color: var(--text); }
  header h1 .brand { color: var(--accent); font-weight: 700; }
  header .dot { color: var(--text-muted); margin: 0 4px; }
  header .meta { color: var(--text-dim); font-size: 12px; font-family: var(--mono); }
  header .spacer { flex: 1; }
  header .header-ad { display: inline-flex; align-items: center; gap: 5px;
    text-decoration: none; font-size: 11.5px; color: var(--text-dim);
    background: var(--panel-2); border: 1px solid var(--border);
    padding: 4px 10px; border-radius: 999px; white-space: nowrap;
    transition: color 0.1s, border-color 0.1s, background 0.1s; }
  header .header-ad:hover { color: var(--accent); border-color: var(--accent);
    background: var(--bg); }
  header .header-ad-arrow { font-size: 11px; opacity: 0.8; }
  @media (max-width: 720px) { header .header-ad-text { display: none; } }
  button.icon { background: var(--panel-2); border: 1px solid var(--border);
    color: var(--text-dim); padding: 6px 10px; border-radius: 6px; font: inherit;
    cursor: pointer; white-space: nowrap; transition: background 0.1s, color 0.1s; }
  button.icon:hover { background: var(--border); color: var(--text); }
  button.icon.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  button.icon.danger { background: var(--danger); color: #fff; border-color: var(--danger); }
  button.icon.danger:hover { background: #b81c28; border-color: #b81c28; color: #fff; }
  button.icon:disabled { opacity: 0.5; cursor: not-allowed; }
  /* ─── Setup landing ──────────────────────────────────────── */
  #setup { padding: 16px 20px; max-width: 1100px; margin: 0 auto;
    height: calc(100vh - 52px); display: flex; flex-direction: column;
    gap: 12px; box-sizing: border-box; }
  /* ─── Wizard (3-step setup flow) ─────────────────────────── */
  .wizard-stepper { display: flex; align-items: center; gap: 0;
    padding: 4px 4px 8px; flex-shrink: 0; }
  .wizard-step-pill { display: inline-flex; align-items: center; gap: 9px;
    padding: 5px 14px 5px 5px; border-radius: 999px;
    background: var(--panel); border: 1px solid var(--border);
    color: var(--text-dim); font-size: 12.5px; font-weight: 500;
    user-select: none; transition: all 0.15s; }
  .wizard-step-pill .num { display: inline-flex; align-items: center;
    justify-content: center; width: 22px; height: 22px; border-radius: 50%;
    font-weight: 700; font-size: 11.5px; background: var(--panel-2);
    color: var(--text-muted); border: 1px solid var(--border);
    font-family: var(--mono); flex-shrink: 0; }
  .wizard-step-pill.active { color: var(--text); border-color: var(--accent);
    background: linear-gradient(180deg, #f1f8ff 0%, var(--panel) 100%);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.10); }
  .wizard-step-pill.active .num { background: var(--accent); color: white;
    border-color: var(--accent); }
  .wizard-step-pill.done { color: var(--success);
    border-color: rgba(26,127,55,0.35); cursor: pointer; }
  .wizard-step-pill.done:hover { background: #dafbe1; }
  .wizard-step-pill.done .num { background: var(--success); color: white;
    border-color: var(--success); }
  .wizard-step-pill.done .num .digit { display: none; }
  .wizard-step-pill.done .num::before { content: "✓"; }
  .wizard-line { flex: 1; height: 2px; background: var(--border); margin: 0 6px;
    border-radius: 1px; transition: background 0.25s; min-width: 24px;
    max-width: 80px; }
  .wizard-line.done { background: var(--success); }
  .wizard-content { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 2px; }
  .wizard-page { display: none; }
  .wizard-page.active { display: block; animation: wizardIn 0.22s ease-out; }
  @keyframes wizardIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .wizard-page-head { margin: 0 0 14px; padding: 0 2px; }
  .wizard-page-head h2 { font-size: 17px; font-weight: 600; margin: 0 0 4px;
    letter-spacing: -0.01em; color: var(--text); }
  .wizard-page-head p { font-size: 12.5px; color: var(--text-dim); margin: 0;
    line-height: 1.5; }
  /* Step 1: connection-mode picker */
  .conn-mode-card { margin: 0 0 14px; }
  .conn-mode-label { font-size: 12px; font-weight: 600; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px;
    padding-left: 2px; }
  .conn-mode-toggle { display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 10px; }
  @media (max-width: 800px) { .conn-mode-toggle { grid-template-columns: 1fr; } }
  .conn-mode-btn { display: flex; align-items: center; gap: 12px;
    padding: 12px 14px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; cursor: pointer; text-align: left;
    transition: border-color 0.1s, background 0.1s, box-shadow 0.1s;
    font: inherit; color: var(--text); min-width: 0; }
  .conn-mode-btn:hover { background: var(--panel-2);
    border-color: var(--border-strong); }
  .conn-mode-btn.active { border-color: var(--accent);
    background: linear-gradient(180deg, #f1f8ff 0%, var(--panel) 100%);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.10); }
  .conn-mode-ico { font-size: 22px; line-height: 1; flex-shrink: 0;
    width: 32px; height: 32px; border-radius: 8px;
    background: var(--panel-2); display: inline-flex;
    align-items: center; justify-content: center;
    border: 1px solid var(--border); }
  .conn-mode-btn.active .conn-mode-ico { background: var(--accent); color: white;
    border-color: var(--accent); }
  .conn-mode-body { display: flex; flex-direction: column; gap: 2px;
    min-width: 0; }
  .conn-mode-title { font-weight: 600; font-size: 13.5px; color: var(--text); }
  .conn-mode-sub { font-size: 11.5px; color: var(--text-dim); }
  /* Step 1: prereqs grid */
  .prereq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    align-content: start; }
  @media (max-width: 800px) { .prereq-grid { grid-template-columns: 1fr; } }
  /* Indeterminate "checking" progress bar above prereqs */
  .prereq-progress { height: 3px; background: var(--panel-2); border-radius: 2px;
    overflow: hidden; margin: 0 2px 14px; opacity: 1; position: relative;
    transition: opacity 0.35s; }
  .prereq-progress.done { opacity: 0; pointer-events: none; }
  .prereq-progress::before { content: ""; position: absolute; top: 0; bottom: 0;
    background: linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%);
    width: 35%; left: 0;
    animation: prereqSlide 1.4s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  @keyframes prereqSlide {
    from { transform: translateX(-100%); }
    to   { transform: translateX(380%); }
  }
  /* Step 3: app browse row */
  .app-browse-row { display: grid; grid-template-columns: 90px 1fr auto;
    align-items: center; gap: 8px; margin-bottom: 4px; }
  .app-browse-row label { font-size: 12px; color: var(--text-dim); }
  .app-browse-row input { background: #fff; color: var(--text);
    border: 1px solid var(--border); padding: 5px 9px; border-radius: 5px;
    font: 13px var(--mono); outline: none; min-width: 0; width: 100%; }
  .app-browse-row input:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  .app-browse-row .browse-btn { padding: 5px 12px; flex-shrink: 0; }
  .app-inspect-status { font-size: 11.5px; color: var(--text-dim);
    margin: 0 0 8px 98px; min-height: 14px; font-family: var(--mono); }
  .app-inspect-status.ok { color: var(--success); }
  .app-inspect-status.err { color: var(--danger); }
  .app-inspect-status.busy { color: var(--accent); }
  .app-inspect-status .spinner { display: inline-block; width: 10px; height: 10px;
    border: 2px solid rgba(9,105,218,0.25); border-top-color: var(--accent);
    border-radius: 50%; animation: loader-spin 0.7s linear infinite;
    margin-right: 6px; vertical-align: -2px; }
  /* Wizard footer reuses .action-bar styling. Back button alignment. */
  .action-bar.wizard-bar { justify-content: flex-start; }
  .action-bar.wizard-bar .grow { flex: 1; }
  /* Devices card */
  .device-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border);
    margin-bottom: 12px; padding-bottom: 0; }
  .device-tab { background: transparent; border: none; color: var(--text-dim);
    font: 12.5px inherit; padding: 8px 14px; cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
    display: inline-flex; align-items: center; gap: 6px; }
  .device-tab:hover { color: var(--text); }
  .device-tab.active { color: var(--text); border-bottom-color: var(--accent);
    font-weight: 600; }
  .device-tab .count { font-size: 10.5px; color: var(--text-muted);
    background: var(--panel-2); padding: 1px 7px; border-radius: 999px;
    border: 1px solid var(--border); font-family: var(--mono); font-weight: 500; }
  .device-tab.active .count { color: var(--accent); border-color: rgba(9,105,218,0.3);
    background: #ddf4ff; }
  .device-grid { display: grid; gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .device-pagination { display: flex; align-items: center; justify-content: center;
    gap: 12px; margin-top: 12px; padding-top: 8px; }
  .device-pagination .info { font-size: 11.5px; color: var(--text-dim);
    font-family: var(--mono); }
  .device-pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
  .device-tile { display: flex; flex-direction: column; gap: 4px;
    padding: 12px 12px 10px; border-radius: 8px; background: var(--panel-2);
    border: 1px solid var(--border); position: relative;
    transition: border-color 0.1s, background 0.1s, box-shadow 0.1s; }
  .device-tile.selectable { cursor: pointer; }
  .device-tile.selectable:hover { border-color: rgba(9,105,218,0.4);
    background: linear-gradient(180deg, #f1f8ff 0%, var(--panel) 100%); }
  .device-tile.selected { border-color: var(--accent); border-width: 2px;
    padding: 11px 11px 9px;
    background: linear-gradient(180deg, #ddf4ff 0%, #f1f8ff 100%);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  .device-tile .check { position: absolute; bottom: 8px; right: 8px;
    width: 22px; height: 22px; border-radius: 50%; background: var(--accent);
    color: white; display: none; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; line-height: 1;
    box-shadow: 0 2px 6px rgba(9,105,218,0.35); }
  .device-tile.selected .check { display: inline-flex; }
  .device-tile.booted { background: linear-gradient(180deg, #f1f8ff 0%, var(--panel) 100%);
    border-color: rgba(9,105,218,0.3); }
  .device-tile.booting { background: linear-gradient(180deg, #fff8c5 0%, var(--panel) 100%);
    border-color: rgba(154,103,0,0.35); }
  .device-tile .pill.booting { color: var(--warn);
    border-color: rgba(154,103,0,0.35); background: #fff8c5; }
  .device-tile .pill.booting .led { display: none; }
  .device-tile .pill.booting .spinner { display: inline-block; width: 9px; height: 9px;
    border: 1.5px solid rgba(154,103,0,0.25); border-top-color: var(--warn);
    border-radius: 50%; animation: loader-spin 0.7s linear infinite; }
  .device-tile .top { display: flex; align-items: center; gap: 8px; }
  .device-tile .icon { font-size: 22px; line-height: 1; }
  .device-tile .name { flex: 1; font-weight: 600; font-size: 13px; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .device-tile .meta { font-size: 11.5px; color: var(--text-dim); font-family: var(--mono);
    margin-left: 30px; }
  .device-tile .udid { font-size: 10.5px; color: var(--text-muted); font-family: var(--mono);
    margin-left: 30px; word-break: break-all; }
  .device-tile .pill { padding: 1px 7px; font-size: 10px; }
  .device-tile .actions { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
  .device-tile .actions .icon { padding: 4px 9px; font-size: 11.5px; }
  .device-tile .actions .icon.use { background: var(--accent); color: white;
    border-color: var(--accent); }
  .device-tile .actions .icon.use:hover { background: var(--accent-hover);
    border-color: var(--accent-hover); }
  .device-empty { padding: 12px 0; color: var(--text-muted); font-size: 12px; font-style: italic; }
  .device-empty .rec-sel-spinner { width: 13px; height: 13px; border-width: 1.5px;
    vertical-align: -2px; margin-right: 6px; font-style: normal; }
  .device-warn { padding: 8px 10px; margin-bottom: 10px; font-size: 12px;
    background: #fff8c5; border: 1px solid rgba(154,103,0,0.35);
    color: var(--warn); border-radius: 5px; font-family: var(--mono); }
  .card { background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 14px; }
  .card.flex { display: flex; flex-direction: column; min-height: 0; }
  .card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .card-head h2 { font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-dim); margin: 0; }
  .card-head .grow { flex: 1; }
  /* Doctor */
  .doctor-summary { display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: 5px; font-size: 12.5px;
    background: var(--panel-2); cursor: pointer; user-select: none; }
  .doctor-summary:hover { background: var(--border); }
  .doctor-summary .twisty { color: var(--text-muted); margin-left: auto; font-size: 10px; }
  .doctor-summary .pill { padding: 1px 7px; font-size: 10px; }
  .doctor-list { list-style: none; margin: 8px 0 0; padding: 0; display: none; }
  .doctor-list.expanded { display: block;
    max-height: clamp(140px, calc(100vh - 430px), 360px); overflow-y: auto; }
  .doctor-list li { display: block; padding: 3px 8px; font-size: 12px; }
  .doctor-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .doctor-list .ico { width: 14px; flex-shrink: 0; text-align: center; font-weight: 700;
    font-family: var(--mono); font-size: 11px; }
  .doctor-list .ico.ok { color: var(--success); }
  .doctor-list .ico.warn { color: var(--warn); }
  .doctor-list .ico.error { color: var(--danger); }
  .doctor-list .name { color: var(--text); min-width: 0; overflow-wrap: anywhere; }
  .doctor-list .detail { color: var(--text-dim); font-family: var(--mono);
    font-size: 11px; margin-left: auto; text-align: right;
    min-width: 0; overflow-wrap: anywhere; }
  .doctor-list .detail-block { margin: 2px 0 4px 22px; color: var(--text-dim);
    font-family: var(--mono); font-size: 11px; line-height: 1.45;
    overflow-wrap: anywhere; word-break: break-word; }
  /* Inputs */
  .field { display: grid; grid-template-columns: 90px 1fr; align-items: center;
    gap: 8px; margin-bottom: 6px; }
  .field label { font-size: 12px; color: var(--text-dim); }
  .field input, .field select { background: #fff; color: var(--text);
    border: 1px solid var(--border); padding: 5px 9px; border-radius: 5px;
    font: 13px var(--mono); outline: none; width: 100%; }
  .field select { font-family: inherit; cursor: pointer; }
  .field input:focus, .field select:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  .field-tri { display: grid; grid-template-columns: 90px 1fr 60px 90px;
    align-items: center; gap: 8px; margin-bottom: 8px; }
  .field-tri label { font-size: 12px; color: var(--text-dim); }
  .field-tri input { background: #fff; color: var(--text);
    border: 1px solid var(--border); padding: 5px 9px; border-radius: 5px;
    font: 13px var(--mono); outline: none; min-width: 0; width: 100%; }
  .field-tri input:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  .checkbox { display: flex; align-items: center; gap: 6px; padding: 4px 0;
    font-size: 12px; color: var(--text); cursor: pointer; }
  /* Standalone checkbox row — used for noReset etc. (no left-gutter) */
  .checkbox-row { display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; margin: 4px 0; border-radius: 5px;
    background: var(--panel-2); border: 1px solid var(--border);
    cursor: pointer; user-select: none; }
  .checkbox-row:hover { background: var(--border); }
  .checkbox-row input { margin: 0; flex-shrink: 0; }
  .checkbox-row .label { color: var(--text); font-size: 13px; font-weight: 500; }
  .checkbox-row .hint { color: var(--text-dim); font-size: 12px; margin-left: auto; }
  /* Pills */
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px;
    border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; border: 1px solid var(--border); }
  .pill .led { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); }
  .pill.live { color: var(--success); border-color: rgba(26,127,55,0.35); background: #dafbe1; }
  .pill.live .led { background: var(--success); box-shadow: 0 0 6px rgba(26,127,55,0.5); }
  .pill.down { color: var(--warn); border-color: rgba(154,103,0,0.35); background: #fff8c5; }
  .pill.down .led { background: var(--warn); }
  .pill.booting { color: var(--warn); border-color: rgba(154,103,0,0.35); background: #fff8c5; }
  .pill.booting .led { width: 9px; height: 9px; background: transparent; box-shadow: none;
    border: 1.5px solid rgba(154,103,0,0.3); border-top-color: var(--warn);
    border-radius: 50%; animation: loader-spin 0.7s linear infinite; }
  .appium-hint { font-size: 11px; color: var(--text-dim); line-height: 1.45; margin-top: 6px; }
  /* Capabilities */
  .caps-fields { flex: 1; min-height: 0; overflow: auto; padding-right: 4px; }
  .extras-head { display: flex; align-items: center; gap: 8px;
    color: var(--text-dim); font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    border-top: 1px solid var(--border); margin-top: 10px; padding: 12px 0 6px; }
  .extras-list { display: flex; flex-direction: column; gap: 6px; }
  .extras-list .empty-row { color: var(--text-muted); font-size: 12px;
    font-style: italic; padding: 6px 0; }
  .extra-cap { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,1fr) 28px;
    gap: 6px; align-items: center; }
  .extra-cap input { background: #fff; color: var(--text);
    border: 1px solid var(--border); padding: 5px 9px; border-radius: 5px;
    font: 12.5px var(--mono); outline: none; width: 100%; min-width: 0; }
  .extra-cap input:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  .x-btn { background: transparent; border: 1px solid var(--border);
    color: var(--text-muted); width: 28px; height: 28px; border-radius: 5px;
    font-size: 16px; line-height: 1; cursor: pointer; padding: 0;
    display: inline-flex; align-items: center; justify-content: center; }
  .x-btn:hover { color: var(--danger); border-color: rgba(207,34,46,0.4);
    background: #ffebe9; }
  .add-cap-btn { display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; background: transparent; color: var(--accent);
    border: 1px dashed var(--border); border-radius: 5px;
    font: 12.5px inherit; cursor: pointer; margin-top: 8px; }
  .add-cap-btn:hover { background: var(--panel-2); border-color: var(--accent); }
  .add-cap-btn .plus { font-weight: 700; font-size: 14px; line-height: 1; }
  /* Sticky action bar */
  .action-bar { flex-shrink: 0; display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; background: var(--panel); border-radius: 8px;
    border: 1px solid var(--border); }
  .action-summary { color: var(--text-dim); font-size: 12px; font-family: var(--mono);
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-summary strong { color: var(--text); font-weight: 600; }
  button.primary { background: var(--accent); color: white; border: none;
    padding: 8px 22px; border-radius: 6px; font: 600 13px inherit; cursor: pointer;
    transition: background 0.1s; }
  button.primary:hover { background: var(--accent-hover); }
  button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .err-banner { color: var(--danger); font-size: 12px; padding: 6px 10px;
    background: #ffebe9; border: 1px solid rgba(207,34,46,0.3);
    border-radius: 5px; margin-top: 8px; font-family: var(--mono); display: none; }
  .err-banner.shown { display: block; }
  .info-banner { color: var(--text-dim); font-size: 12px; padding: 8px 10px;
    background: #ddf4ff; border: 1px solid rgba(9,105,218,0.3);
    border-radius: 5px; margin-top: 10px; }
  .btn-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .btn-row .grow { flex: 1; }
  /* ─── Layout (inspector view) ────────────────────────────── */
  main { display: grid; grid-template-columns: minmax(280px, 30%) 1fr minmax(360px, 36%);
    height: calc(100vh - 52px); }
  .pane { overflow: hidden; display: flex; flex-direction: column;
    border-right: 1px solid var(--border); background: var(--bg); min-width: 0; }
  .pane:last-child { border-right: none; }
  .pane-head { padding: 10px 14px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px; background: var(--panel);
    flex-shrink: 0; height: 40px; }
  .pane-title { font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-dim); }
  .pane-body { flex: 1; overflow: auto; min-height: 0; }
  /* ─── Tree pane ──────────────────────────────────────────── */
  /* Hierarchy view-mode toggle (Tree / XML) */
  .hier-mode-toggle { display: inline-flex; gap: 0; flex-shrink: 0;
    border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
  .hier-mode-btn { background: var(--panel-2); border: none; color: var(--text-dim);
    padding: 3px 9px; font: 11px inherit; cursor: pointer;
    border-right: 1px solid var(--border); transition: background 0.1s, color 0.1s; }
  .hier-mode-btn:last-child { border-right: none; }
  .hier-mode-btn:hover { color: var(--text); }
  .hier-mode-btn.active { background: var(--accent); color: white; font-weight: 600; }
  .context-select { flex-shrink: 0; background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 5px; padding: 3px 7px;
    font: 11px inherit; cursor: pointer; max-width: 220px; }
  .context-select.web { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .context-hint { flex-shrink: 0; color: var(--muted); font: 11px inherit;
    cursor: pointer; padding: 3px 6px; border-radius: 5px; }
  .context-hint:hover { color: var(--text); background: var(--panel-2); }
  /* Hierarchy XML view */
  .hier-xml-body { padding: 0; background: var(--code-bg); }
  #hier-xml-pre { font-family: var(--mono); font-size: 11.5px;
    line-height: 1.45; white-space: pre; color: var(--text);
    margin: 0; padding: 8px 12px; }
  .tree-search { width: 100%; background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); padding: 5px 9px; border-radius: 5px;
    font: inherit; outline: none; }
  .tree-search:focus { border-color: var(--accent); }
  .hier-xml-body mark.xml-match { background: #fff3b0; color: inherit; border-radius: 2px; }
  .tree-body { padding: 6px 6px 12px; }
  ul.tree, ul.tree ul { list-style: none; padding-left: 14px; margin: 0; }
  ul.tree { padding-left: 4px; }
  li.node { white-space: nowrap; }
  li.node > .label { display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 6px; cursor: pointer; border-radius: 4px; user-select: none;
    max-width: 100%; }
  li.node > .label:hover { background: rgba(0,0,0,0.04); }
  li.node.selected > .label { background: var(--hl); color: var(--text);
    box-shadow: inset 2px 0 0 var(--accent); }
  li.node.match > .label { outline: 1px solid var(--warn); outline-offset: -1px; }
  .twisty { display: inline-block; width: 12px; color: var(--text-muted);
    font-size: 9px; text-align: center; }
  .twisty.empty { visibility: hidden; }
  .tag { color: var(--accent); font-family: var(--mono); font-size: 12px; }
  .ident { color: var(--warn); font-family: var(--mono); font-size: 12px; }
  .text-snippet { color: var(--success); font-family: var(--mono); font-size: 12px; }
  /* ─── Screen pane ────────────────────────────────────────── */
  #screen-wrap { display: flex; justify-content: center; align-items: flex-start;
    padding: 16px; }
  #screen-host { position: relative; display: inline-block; max-width: 100%;
    border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
    background: #000; box-shadow: 0 6px 22px rgba(0,0,0,0.10); }
  #screen-img { display: block; max-width: 100%; max-height: calc(100vh - 100px);
    user-select: none; -webkit-user-drag: none; }
  /* Graceful fallback when a snapshot fails / returns no screenshot — shown
     instead of the browser's broken-image glyph. */
  .screen-unavailable-msg { display: none; box-sizing: border-box; width: 300px;
    max-width: 100%; min-height: 480px; max-height: calc(100vh - 100px);
    flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    padding: 24px; text-align: center; color: var(--text-dim); }
  .screen-unavailable-title { font-size: 14px; font-weight: 600; color: var(--text); }
  .screen-unavailable-sub { font-size: 12.5px; }
  #screen-host.screen-unavailable #screen-img { display: none; }
  #screen-host.screen-unavailable .screen-unavailable-msg { display: flex; }
  #highlight { position: absolute; border: 2px solid var(--accent);
    background: rgba(9,105,218,0.12); box-shadow: 0 0 0 9999px rgba(0,0,0,0.40) inset;
    pointer-events: none; transition: all 0.12s ease-out; }
  .screen-action-overlay { position: absolute; inset: 0; display: none; z-index: 5;
    align-items: center; justify-content: center; background: rgba(0,0,0,0.32); }
  .screen-action-overlay.shown { display: flex; }
  .screen-action-card { display: flex; align-items: center; gap: 10px;
    background: var(--panel); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 14px; font-size: 12.5px; font-weight: 600;
    box-shadow: 0 6px 22px rgba(0,0,0,0.25); }
  .screen-action-check { display: none; color: var(--success); font-size: 16px; font-weight: 700; }
  .screen-action-overlay.done .rec-sel-spinner { display: none; }
  .screen-action-overlay.done .screen-action-check { display: inline; }
  .screen-action-overlay.done .screen-action-card { color: var(--success); }
  /* ─── Right pane (tabs) ──────────────────────────────────── */
  .tabs { display: flex; background: var(--panel); border-bottom: 1px solid var(--border);
    flex-shrink: 0; }
  .tab { padding: 10px 16px; cursor: pointer; color: var(--text-dim);
    font-size: 12px; font-weight: 500; border-bottom: 2px solid transparent;
    transition: color 0.1s, border-color 0.1s; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .tab-content { padding: 14px 16px; overflow: auto; flex: 1; min-height: 0; }
  .tab-content.hidden { display: none; }
  /* ─── Attributes ──────────────────────────────────────────── */
  table.attrs { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.attrs td { padding: 5px 8px; vertical-align: top; }
  table.attrs tr:nth-child(even) { background: rgba(0,0,0,0.025); }
  table.attrs td:first-child { color: var(--text-dim); white-space: nowrap;
    width: 130px; font-family: var(--mono); }
  table.attrs td:last-child { color: var(--text); word-break: break-all; font-family: var(--mono); }
  /* ─── Type-into-field card ───────────────────────────────── */
  .type-card { background: var(--panel); border: 1px solid var(--accent);
    border-radius: 8px; padding: 12px; margin-bottom: 14px;
    box-shadow: 0 0 0 1px rgba(9,105,218,0.15); }
  .type-row { display: flex; gap: 6px; margin-top: 8px; }
  .type-input { flex: 1; background: var(--code-bg); color: var(--text);
    border: 1px solid var(--border); padding: 7px 11px; border-radius: 5px;
    font: 13px var(--mono); outline: none; }
  .type-input:focus { border-color: var(--accent); }
  .type-hint { font-size: 11px; color: var(--text-dim); margin-top: 6px;
    font-family: var(--mono); }
  .type-hint code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px;
    border: 1px solid var(--border); }
  /* "Build relative xpath" affordance + result card */
  .build-rel-btn { display: flex; align-items: center; gap: 10px;
    width: 100%; padding: 10px 12px; margin-top: 10px;
    background: var(--panel); color: var(--text);
    border: 1px dashed var(--border); border-radius: 8px;
    font: 13px inherit; cursor: pointer; text-align: left;
    transition: border-color 0.1s, background 0.1s; }
  .build-rel-btn:hover { background: var(--panel-2); border-color: var(--accent); }
  .build-rel-btn .ico { font-size: 16px; line-height: 1; }
  .build-rel-btn .body { flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 2px; }
  .build-rel-btn .title { display: block; font-weight: 600; font-size: 13px; }
  .build-rel-btn .sub { display: block; font-size: 11.5px; color: var(--text-dim); }
  .rel-card { background: linear-gradient(180deg, #f1f8ff 0%, var(--panel) 100%);
    border: 1px solid rgba(9,105,218,0.35); border-radius: 8px;
    padding: 12px; margin-bottom: 12px; }
  .rel-card .anchor-line { font-size: 11.5px; color: var(--text-dim);
    margin-bottom: 8px; }
  .rel-card .anchor-line strong { color: var(--accent); font-family: var(--mono); }
  .rel-card .rel-tip { display: flex; gap: 8px; align-items: flex-start;
    margin-top: 10px; padding: 9px 11px; border-radius: 6px;
    background: #fff8c5; border: 1px solid rgba(154,103,0,0.35);
    color: #4d3800; font-size: 11.5px; line-height: 1.45; }
  .rel-card .rel-tip .ico { flex-shrink: 0; font-size: 14px; line-height: 1.2; }
  .rel-card .rel-tip code { background: rgba(154,103,0,0.12); padding: 1px 5px;
    border-radius: 3px; font-family: var(--mono); font-size: 11px; }
  /* ─── Locator cards ──────────────────────────────────────── */
  .loc-card { background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px; margin-bottom: 12px; }
  .loc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .cat-badge { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; padding: 3px 8px; border-radius: 4px;
    background: var(--panel-2); color: var(--text-dim); border: 1px solid var(--border); }
  .cat-badge.id { color: #0969da; border-color: rgba(9,105,218,0.35); background: #ddf4ff; }
  .cat-badge.uiautomator,
  .cat-badge.predicate { color: #6639ba; border-color: rgba(102,57,186,0.35); background: #f3e8ff; }
  .cat-badge.classChain { color: #9a6700; border-color: rgba(154,103,0,0.35); background: #fff8c5; }
  .cat-badge.xpath { color: #1a7f37; border-color: rgba(26,127,55,0.35); background: #dafbe1; }
  .cat-sub { font-size: 11px; color: var(--text-dim); }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; }
  .badge.unique { background: #dafbe1; color: var(--success);
    border: 1px solid rgba(26,127,55,0.35); }
  .badge.collision { background: #ffebe9; color: var(--danger);
    border: 1px solid rgba(207,34,46,0.35); }
  .badge.empty { background: var(--panel); color: var(--text-muted);
    border: 1px solid var(--border); }
  .badge.positional { background: #fff4e0; color: #9a6700;
    border: 1px solid rgba(154,103,0,0.40); }
  .badge.recommended { background: #fff8c5; color: #7a5c00;
    border: 1px solid rgba(154,103,0,0.45); font-weight: 700; }
  .loc-card.is-rec { border-color: rgba(154,103,0,0.55);
    box-shadow: 0 0 0 1px rgba(154,103,0,0.25) inset; }
  .loc-spacer { flex: 1; }
  .loc-code { font-family: var(--mono); font-size: 12.5px; background: var(--code-bg);
    padding: 9px 11px; border-radius: 5px; word-break: break-all; line-height: 1.5;
    color: var(--text); border: 1px solid var(--border); }
  .loc-actions { display: flex; gap: 6px; margin-top: 9px; }
  .loc-actions button { flex-shrink: 0; }
  /* ─── Record tab ─────────────────────────────────────────── */
  /* Recording toggle banner — top of the Record tab. */
  .rec-toggle { display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; border-radius: 10px; margin-bottom: 14px;
    border: 1px solid var(--border); background: var(--panel);
    transition: background 0.15s, border-color 0.15s; }
  .rec-toggle.live { border-color: rgba(207,34,46,0.4);
    background: linear-gradient(180deg, #fff5f5 0%, var(--panel) 100%); }
  .rec-toggle .rec-led { width: 10px; height: 10px; border-radius: 50%;
    background: var(--text-muted); flex-shrink: 0; }
  .rec-toggle.live .rec-led { background: var(--danger);
    animation: rec-led-pulse 1.4s ease-in-out infinite; }
  @keyframes rec-led-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(207,34,46,0.55); transform: scale(1); }
    70%      { box-shadow: 0 0 0 8px rgba(207,34,46,0); transform: scale(0.92); }
  }
  .rec-toggle .rec-status { flex: 1; font-size: 12.5px; color: var(--text-dim);
    line-height: 1.4; min-width: 0; }
  .rec-toggle .rec-status strong { color: var(--text); font-weight: 600; }
  .rec-toggle.live .rec-status strong { color: var(--danger); }
  .btn-rec-toggle { background: var(--danger); color: white; border: none;
    padding: 9px 16px; border-radius: 6px; font: 600 13px inherit;
    cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
    transition: background 0.1s, transform 0.05s; flex-shrink: 0; }
  .btn-rec-toggle:hover { background: #a40e1c; }
  .btn-rec-toggle:active { transform: translateY(0.5px); }
  .btn-rec-toggle.stop { background: #1f2328; }
  .btn-rec-toggle.stop:hover { background: #0d1117; }
  .btn-rec-toggle .rec-ico { width: 12px; height: 12px; background: white;
    border-radius: 50%; flex-shrink: 0; }
  .btn-rec-toggle.stop .rec-ico { border-radius: 2px; }
  /* Selected element card — sticky context block at the top of the tab. */
  .rec-selected { display: flex; gap: 12px; align-items: flex-start;
    padding: 12px 14px; border-radius: 10px; margin-bottom: 16px;
    border: 1px solid var(--border); background: var(--panel);
    transition: background 0.15s, border-color 0.15s; }
  .rec-selected.has { border-color: rgba(9,105,218,0.35);
    background: linear-gradient(180deg, #f1f8ff 0%, var(--panel) 100%); }
  .rec-sel-icon { width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px;
    background: var(--panel-2); color: var(--text-muted); font-size: 16px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--border); }
  .rec-selected.has .rec-sel-icon { background: var(--accent); color: white;
    border-color: var(--accent); }
  .rec-sel-body { flex: 1; min-width: 0; }
  .rec-sel-title { font-weight: 600; font-size: 13.5px; color: var(--text);
    line-height: 1.3; }
  .rec-sel-sub { font-size: 11.5px; color: var(--text-dim); margin-top: 4px;
    font-family: var(--mono); word-break: break-all;
    background: var(--code-bg); padding: 4px 8px; border-radius: 4px;
    border: 1px solid var(--border); display: inline-block; max-width: 100%; }
  .rec-selected:not(.has) .rec-sel-sub { background: transparent; border: none;
    padding: 0; font-family: inherit; color: var(--text-muted);
    display: block; width: 100%; }
  .rec-no-unique { color: var(--warn); font-size: 12px; line-height: 1.45;
    margin-bottom: 8px; }
  .rec-sel-spinner { display: inline-block; width: 16px; height: 16px;
    border: 2px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: loader-spin 0.7s linear infinite; }
  .rec-resolving-hint { display: block; margin-top: 4px; font-size: 11px;
    color: var(--text-muted); line-height: 1.4; }
  .empty-state .rec-sel-spinner { width: 13px; height: 13px; border-width: 1.5px;
    vertical-align: -2px; margin-right: 6px; }

  /* Action groups */
  .rec-group { margin-bottom: 18px; }
  .rec-group-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-dim); margin-bottom: 9px; }
  .rec-group-title .grow { flex: 1; }
  .rec-subtitle { font-size: 11px; color: var(--text-muted); margin: 14px 0 8px;
    font-weight: 500; letter-spacing: 0.02em; }
  .rec-subtitle:first-child { margin-top: 0; }

  /* Action buttons */
  .rec-grid { display: grid; gap: 7px;
    grid-template-columns: repeat(auto-fit, minmax(115px, 1fr)); }
  .rec-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .rec-act { background: var(--panel); color: var(--text);
    border: 1px solid var(--border); padding: 9px 11px; border-radius: 6px;
    font: 13px inherit; cursor: pointer;
    transition: background 0.1s, border-color 0.1s, transform 0.05s, box-shadow 0.1s;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    white-space: nowrap; min-width: 0; }
  .rec-act .ico { font-size: 14px; line-height: 1; }
  .rec-act:hover:not(:disabled) { background: var(--panel-2);
    border-color: var(--border-strong);
    box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .rec-act:active:not(:disabled) { transform: translateY(0.5px); box-shadow: none; }
  .rec-act:disabled { opacity: 0.4; cursor: not-allowed; }
  .rec-act.primary { background: var(--accent); color: white;
    border-color: var(--accent); font-weight: 600; padding: 11px 14px; }
  .rec-act.primary:hover:not(:disabled) { background: var(--accent-hover);
    border-color: var(--accent-hover); }
  .rec-act.primary:disabled { background: var(--accent); opacity: 0.35; }

  /* Y/X-range row for custom screen-scroll */
  .rec-y-range { display: flex; flex-direction: column; gap: 8px;
    margin-top: 8px; padding: 8px 10px; border-radius: 5px;
    border: 1px dashed var(--border); background: var(--panel-2); }
  .rec-y-range-label { display: flex; gap: 8px; align-items: baseline;
    font-size: 11px; color: var(--text-dim); flex-wrap: wrap; }
  .rec-y-range-defaults { color: var(--text-muted); font-size: 10.5px;
    font-family: var(--mono); }
  .rec-y-range-fields { display: flex; align-items: center; gap: 12px;
    flex-wrap: wrap; }
  .rec-y-cell { display: inline-flex; align-items: center; gap: 4px;
    color: var(--text-dim); font-size: 12px; }
  .rec-y-cell input { width: 48px; background: #fff; color: var(--text);
    border: 1px solid var(--border); padding: 4px 6px; border-radius: 4px;
    font: 12px var(--mono); outline: none; text-align: right; }
  .rec-y-cell input:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  /* Text-input row */
  .rec-input-row { display: flex; gap: 6px; }
  .rec-input { flex: 1; min-width: 0; background: #fff; color: var(--text);
    border: 1px solid var(--border); padding: 8px 12px; border-radius: 6px;
    font: 13px var(--mono); outline: none; }
  .rec-input:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  .rec-input:disabled { background: var(--panel); color: var(--text-muted); }
  .rec-input-row .rec-act { padding: 7px 12px; flex-shrink: 0; }

  /* Assertion row inputs (text/value) */
  .rec-assert-row { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
  .rec-assert-row input { flex: 1; min-width: 0; background: #fff; color: var(--text);
    border: 1px solid var(--border); padding: 7px 11px; border-radius: 6px;
    font: 12.5px var(--mono); outline: none; }
  .rec-assert-row input:focus { border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
  .rec-assert-row input:disabled { background: var(--panel); color: var(--text-muted); }
  /* Record subtabs (Actions / Screen / Assertions) */
  .rec-subtabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;
    padding: 3px; margin-bottom: 14px; background: var(--panel-2);
    border: 1px solid var(--border); border-radius: 8px; }
  .rec-subtab { border: none; background: transparent; color: var(--text-dim);
    font: 12px inherit; font-weight: 600; padding: 7px 10px; border-radius: 6px;
    cursor: pointer; }
  .rec-subtab:hover { color: var(--text); }
  .rec-subtab.active { background: var(--panel); color: var(--text);
    box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
  .rec-pane.hidden { display: none; }
  /* Pick-target hint banner */
  .rec-pickhint { display: flex; align-items: center; gap: 8px;
    background: #fff8c5; color: var(--warn); border: 1px solid rgba(154,103,0,0.35);
    padding: 9px 13px; border-radius: 6px; font-size: 12.5px; margin-bottom: 14px; }
  .rec-pickhint .pulse { width: 8px; height: 8px; border-radius: 50%;
    background: var(--warn); flex-shrink: 0;
    animation: rec-pulse 1.2s ease-in-out infinite; }
  @keyframes rec-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(0.8); }
  }
  .rec-pickhint button { margin-left: auto; }

  /* Recorded script */
  .lang-seg { display: inline-flex; gap: 2px; margin-right: 6px; }
  .lang-seg button { padding: 3px 8px; font-size: 11px; }
  .lang-seg button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .rec-lang-note { font-size: 11px; color: var(--text-dim); margin: 2px 2px 8px; }
  .rec-script-card { background: var(--code-bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 0; overflow: hidden; }
  .rec-script-card pre { background: transparent; padding: 12px 14px;
    font-family: var(--mono); font-size: 12.5px; line-height: 1.6;
    white-space: pre-wrap; word-break: normal; overflow-wrap: anywhere; color: var(--text);
    margin: 0; max-height: 320px; overflow: auto; }
  .rec-script-card pre:empty::before { content: "// no actions yet — start recording and interact with the device";
    color: var(--text-muted); font-style: italic; }
  /* Syntax-highlight tokens (GitHub light theme palette). */
  .tok-kw  { color: #cf222e; }
  .tok-str { color: #0a3069; }
  .tok-num { color: #0550ae; }
  .tok-cmt { color: #6e7781; font-style: italic; }
  .tok-fn  { color: #8250df; }
  .tok-id  { color: #1f2328; }
  .tok-pun { color: #57606a; }

  /* Pick-mode cursor on the screen host */
  #screen-host.pick-mode { cursor: crosshair;
    outline: 2px dashed var(--warn); outline-offset: -2px; }
  /* ─── Empty states ───────────────────────────────────────── */
  .empty-state { padding: 40px 16px; text-align: center; color: var(--text-muted); }
  .empty-state svg { opacity: 0.4; margin-bottom: 12px; }
  /* ─── Loader overlay ─────────────────────────────────────── */
  .loader-overlay { position: fixed; inset: 0; z-index: 1100;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
    display: none; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; opacity: 0; transition: opacity 0.18s ease-out; }
  .loader-overlay.shown { display: flex; opacity: 1; }
  .loader-spinner { width: 42px; height: 42px;
    border: 3px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: loader-spin 0.85s linear infinite; }
  @keyframes loader-spin { to { transform: rotate(360deg); } }
  .loader-message { color: var(--text); font-size: 14px; font-weight: 600;
    margin-top: 4px; }
  .loader-sub { color: var(--text-dim); font-size: 12.5px;
    max-width: 380px; text-align: center; line-height: 1.45; }
  #loader-cancel { display: none; margin-top: 6px; background: var(--panel-2);
    color: var(--text); border: 1px solid var(--border); border-radius: 6px;
    padding: 7px 16px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  #loader-cancel:hover { background: var(--border); }
  #loader-cancel.shown { display: inline-block; }
  /* ─── Toast notifications ────────────────────────────────── */
  #toasts { position: fixed; top: 60px; right: 16px; z-index: 1000;
    display: flex; flex-direction: column; gap: 8px;
    max-width: 420px; min-width: 280px; pointer-events: none; }
  .toast { background: var(--panel); border: 1px solid var(--border);
    border-left: 4px solid var(--accent); padding: 10px 12px 10px 14px;
    border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.10);
    display: flex; align-items: flex-start; gap: 10px;
    pointer-events: auto; animation: toast-in 0.18s ease-out;
    font-size: 12.5px; line-height: 1.45; }
  .toast.error { border-left-color: var(--danger); }
  .toast.success { border-left-color: var(--success); }
  .toast.info { border-left-color: var(--accent); }
  .toast .title { color: var(--text); font-weight: 600; margin-bottom: 2px; }
  .toast.error .title { color: var(--danger); }
  .toast.success .title { color: var(--success); }
  .toast .body { flex: 1; color: var(--text); word-break: break-word; min-width: 0; }
  .toast .body .msg { color: var(--text-dim); }
  .toast .close { background: transparent; border: none; color: var(--text-muted);
    cursor: pointer; padding: 0; font-size: 16px; line-height: 1;
    flex-shrink: 0; margin-top: 1px; }
  .toast .close:hover { color: var(--text); }
  @keyframes toast-in {
    from { transform: translateX(20px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  .toast.fading { animation: toast-out 0.18s ease-in forwards; }
  @keyframes toast-out {
    to { transform: translateX(20px); opacity: 0; }
  }
  /* ─── Confirm modal ──────────────────────────────────────── */
  #modal-overlay { position: fixed; inset: 0; z-index: 2000;
    background: rgba(27,31,36,0.45); backdrop-filter: blur(2px);
    display: none; align-items: center; justify-content: center; padding: 20px;
    animation: modal-fade 0.12s ease-out; }
  #modal-overlay.open { display: flex; }
  .modal-card { background: var(--bg); border: 1px solid var(--border);
    border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,0.24);
    width: 100%; max-width: 420px; overflow: hidden;
    animation: modal-pop 0.14s cubic-bezier(0.2,0.9,0.3,1.1); }
  .modal-body { padding: 22px 22px 18px; display: flex; gap: 14px; align-items: flex-start; }
  .modal-icon { flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 20px; line-height: 1;
    background: rgba(207,34,46,0.12); color: var(--danger); }
  .modal-text { flex: 1; min-width: 0; }
  .modal-title { font-size: 15px; font-weight: 600; color: var(--text);
    margin: 1px 0 6px; }
  .modal-msg { font-size: 13px; color: var(--text-dim); line-height: 1.5; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px;
    padding: 0 22px 18px; }
  .modal-btn { padding: 8px 16px; border-radius: 7px; font: inherit;
    font-size: 13px; font-weight: 500; cursor: pointer;
    border: 1px solid var(--border); background: var(--panel-2);
    color: var(--text); transition: background 0.1s, border-color 0.1s; }
  .modal-btn:hover { background: var(--border); }
  .modal-btn.confirm { background: var(--danger); border-color: var(--danger);
    color: #fff; }
  .modal-btn.confirm:hover { background: #b81c28; border-color: #b81c28; }
  .modal-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  @keyframes modal-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes modal-pop {
    from { transform: translateY(8px) scale(0.97); opacity: 0; }
    to   { transform: translateY(0) scale(1); opacity: 1; }
  }
  /* ─── Status bar ─────────────────────────────────────────── */
  #status { position: fixed; bottom: 8px; left: 12px; background: var(--panel);
    border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px;
    font-size: 11px; color: var(--text-dim); font-family: var(--mono);
    transition: opacity 0.3s; z-index: 10; }
  #status.busy { color: var(--accent); }
  /* Hide the status pill on the setup view — would overlap the action-bar
     Connect button at the bottom of the viewport. The action bar's own
     "Connecting…" label + toasts are enough. */
  body.view-setup #status { display: none; }
  /* ─── Scrollbars ─────────────────────────────────────────── */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 5px;
    border: 2px solid var(--bg); }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  /* ─── Guided tour (spotlight coach-marks) ─────────────────── */
  #tour-overlay { position: fixed; inset: 0; z-index: 1000; display: none; }
  #tour-overlay.show { display: block; }
  /* Click-catcher so the tour is modal — the app stays put behind the dimmer. */
  #tour-catcher { position: absolute; inset: 0; }
  #tour-spotlight { position: absolute; border-radius: 8px; pointer-events: none;
    box-shadow: 0 0 0 9999px rgba(8,12,20,0.55), 0 0 0 2px var(--accent),
      0 0 0 6px rgba(31,111,235,0.35); transition: all 0.18s ease; }
  #tour-pop { position: absolute; width: 320px; max-width: calc(100vw - 24px);
    background: var(--panel); color: var(--text); border: 1px solid var(--border-strong);
    border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); padding: 14px 16px;
    font-size: 13px; line-height: 1.5; }
  #tour-pop h3 { margin: 0 0 6px; font-size: 14px; }
  #tour-pop .tour-body { color: var(--text-dim); }
  #tour-pop .tour-body b { color: var(--text); }
  #tour-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  #tour-progress { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }
  #tour-foot .grow { flex: 1; }
  #tour-skip { position: absolute; top: 8px; right: 10px; background: none; border: none;
    color: var(--text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px; }
  #tour-skip:hover { color: var(--text); }
  /* ─── Help reference panel ────────────────────────────────── */
  #help-overlay { position: fixed; inset: 0; z-index: 1100; display: none;
    background: rgba(8,12,20,0.5); }
  #help-overlay.show { display: flex; align-items: center; justify-content: center; }
  #help-panel { width: 720px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px);
    overflow: auto; background: var(--panel); border: 1px solid var(--border-strong);
    border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,0.4); padding: 20px 22px; }
  #help-panel .help-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  #help-panel .help-head h2 { margin: 0; font-size: 17px; }
  #help-panel .help-head .grow { flex: 1; }
  #help-panel .help-lead { color: var(--text-dim); font-size: 13px; margin: 0 0 14px; }
  #help-close { background: none; border: none; color: var(--text-muted); cursor: pointer;
    font-size: 20px; line-height: 1; padding: 2px 6px; }
  #help-close:hover { color: var(--text); }
  #help-panel details { border: 1px solid var(--border); border-radius: 8px;
    margin-bottom: 8px; background: var(--panel-2); overflow: hidden; }
  #help-panel summary { cursor: pointer; padding: 10px 12px; font-weight: 600; font-size: 13px;
    list-style: none; user-select: none; }
  #help-panel summary::-webkit-details-marker { display: none; }
  #help-panel summary::before { content: "▸ "; color: var(--text-muted); }
  #help-panel details[open] summary::before { content: "▾ "; }
  #help-panel .help-sec { padding: 0 14px 12px 26px; color: var(--text-dim); font-size: 13px;
    line-height: 1.6; }
  #help-panel .help-sec b { color: var(--text); }
  #help-panel .help-sec code { font-family: var(--mono); font-size: 12px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 4px;
    padding: 0 4px; }
  #help-panel .help-sec ul,
  #help-panel .help-sec ol { margin: 4px 0; padding-left: 18px; }
  #help-panel .help-sec li { margin: 3px 0; }
  /* ─── Screen "how to use" hint ────────────────────────────── */
  .screen-help-btn { font-size: 11px; color: var(--text-dim); cursor: pointer;
    border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
    background: var(--panel-2); white-space: nowrap; }
  .screen-help-btn:hover { color: var(--text); border-color: var(--accent); }
  #screen-wrap { position: relative; }
  .screen-help-pop { display: none; position: absolute; top: 10px; left: 50%;
    transform: translateX(-50%); z-index: 20; width: 340px; max-width: calc(100% - 20px);
    background: var(--panel); color: var(--text); border: 1px solid var(--border-strong);
    border-radius: 10px; box-shadow: 0 10px 32px rgba(0,0,0,0.32); padding: 12px 14px;
    font-size: 12.5px; line-height: 1.5; }
  .screen-help-pop.show { display: block; }
  .screen-help-title { font-weight: 700; font-size: 13px; margin-bottom: 6px; }
  .screen-help-pop ul { margin: 0 0 10px; padding-left: 18px; color: var(--text-dim); }
  .screen-help-pop ul b { color: var(--text); }
  .screen-help-pop li { margin: 3px 0; }
  .screen-help-x { position: absolute; top: 6px; right: 8px; background: none; border: none;
    color: var(--text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px; }
  .screen-help-x:hover { color: var(--text); }
  .screen-help-ok { padding: 4px 12px; }
  /* ─── Demo stage (illustrated inspector for the tour) ─────── */
  #demo-stage { display: none; position: fixed; inset: 0; z-index: 900;
    background: var(--bg); flex-direction: column; padding: 12px 16px 16px; }
  #demo-stage.show { display: flex; }
  .demo-bar { display: flex; align-items: center; gap: 10px; padding: 4px 2px 12px; }
  .demo-badge { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; color: white;
    background: var(--accent); border-radius: 4px; padding: 2px 6px; }
  .demo-bar-title { font-size: 13px; color: var(--text-dim); }
  .demo-bar .grow { flex: 1; }
  .demo-panes { flex: 1; display: grid; grid-template-columns: 1fr 1.1fr 1.2fr; gap: 12px;
    min-height: 0; }
  .demo-pane { display: flex; flex-direction: column; min-height: 0;
    border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--panel); }
  .demo-pane .pane-body { flex: 1; overflow: auto; padding: 8px 10px; }
  .demo-seg { display: inline-flex; gap: 2px; background: var(--panel-2); border-radius: 6px;
    padding: 2px; font-size: 11px; }
  .demo-seg span { padding: 1px 8px; border-radius: 4px; color: var(--text-dim); }
  .demo-seg span.on { background: var(--panel); color: var(--text); font-weight: 600; }
  .demo-seg.sm { font-size: 10.5px; width: 100%; }
  .demo-seg.sm .grow { flex: 1; }
  .demo-search { font-size: 11px; color: var(--text-muted); border: 1px solid var(--border);
    border-radius: 6px; padding: 2px 8px; background: var(--panel-2); }
  .demo-meta { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }
  .demo-tree { list-style: none; margin: 0; padding: 0; font-family: var(--mono); font-size: 12px;
    color: var(--text-dim); }
  .demo-tree li { padding: 2px 4px; border-radius: 4px; white-space: nowrap; }
  .demo-tree li.i1 { padding-left: 16px; }
  .demo-tree li.i2 { padding-left: 30px; }
  .demo-tree li.sel { background: rgba(31,111,235,0.14); color: var(--text); }
  .demo-id { color: #6639ba; }
  .demo-q { color: var(--success); }
  .demo-screen-body { display: flex; align-items: flex-start; justify-content: center; }
  .demo-phone { width: 220px; border: 8px solid #111723; border-radius: 26px; overflow: hidden;
    background: #fbf1ee; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
  .demo-statusbar { display: flex; justify-content: space-between; font-size: 9px; color: #3a3a3a;
    padding: 4px 12px; background: #fbf1ee; }
  .demo-app { padding: 22px 18px 22px; display: flex; flex-direction: column; align-items: center;
    gap: 10px; background: #fbf1ee; min-height: 340px; }
  .demo-app-logo { width: 56px; height: 56px; border-radius: 14px; background: #f5333b;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0;
    margin-top: 6px; }
  .demo-logo-glass { font-size: 20px; line-height: 1; }
  .demo-logo-name { font-size: 9px; font-weight: 800; color: #fff; }
  .demo-app-title { font-size: 19px; font-weight: 800; color: #1b1320; margin: 2px 0 0; }
  .demo-app-sub { font-size: 11px; color: #9b8f93; margin-bottom: 6px; }
  .demo-field { width: 100%; height: 36px; border: 1px solid #e3d7d6; border-radius: 10px;
    background: #fdf8f7; display: flex; align-items: center; gap: 8px; padding: 0 10px; }
  .demo-field.sel { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(31,111,235,0.30); }
  .demo-field-ico { font-size: 13px; opacity: 0.7; }
  .demo-field-ph { font-size: 12px; color: #9b8f93; }
  .demo-field-eye { margin-left: auto; font-size: 12px; opacity: 0.55; }
  .demo-app-btn { width: 100%; height: 40px; border: none; border-radius: 10px; color: #fff;
    background: #a0185a; font-size: 14px; font-weight: 700; margin-top: 6px; }
  .demo-creds { width: 100%; margin-top: 8px; padding: 10px 12px; border-radius: 12px;
    background: #f6e7ea; text-align: center; font-size: 10.5px; color: #5a4a4f; line-height: 1.5; }
  .demo-creds-title { font-weight: 800; color: #a0185a; margin-bottom: 2px; font-size: 11px; }
  .demo-tabwrap { flex: 1; overflow: auto; padding: 10px 12px; }
  .demo-tabpane.hidden { display: none; }
  .demo-rec-banner { font-size: 12px; color: var(--text-dim); display: flex; align-items: center;
    gap: 6px; margin-bottom: 10px; }
  .demo-rec-banner b { color: var(--text); }
  .demo-led { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  .demo-rec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .demo-act { border: 1px solid var(--border); border-radius: 7px; padding: 7px 8px; font-size: 12px;
    color: var(--text-dim); background: var(--panel-2); }
  .demo-act.primary { grid-column: 1 / -1; border-color: var(--accent); color: var(--text);
    background: rgba(31,111,235,0.10); font-weight: 600; }
  .demo-subtabs { margin-top: 10px; font-size: 11px; color: var(--text-muted); }
  .demo-code { font-family: var(--mono); font-size: 11.5px; line-height: 1.5; color: var(--text);
    background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    white-space: pre-wrap; margin: 8px 0 0; }
  .demo-loc-row { display: flex; align-items: center; gap: 8px; padding: 5px 2px; font-size: 12px;
    border-bottom: 1px solid var(--border); }
  .demo-loc-row code { font-family: var(--mono); font-size: 11px; color: var(--text-dim);
    overflow-wrap: anywhere; }
  .demo-cat { font-size: 10px; font-weight: 700; border: 1px solid var(--border); border-radius: 999px;
    padding: 1px 7px; color: var(--text-dim); white-space: nowrap; }
  .demo-cat.id { color: var(--success); border-color: rgba(26,127,55,0.35); background: #dafbe1; }
  .demo-cat.uiautomator { color: #6639ba; border-color: rgba(102,57,186,0.35); background: #f3e8ff; }
  .demo-cat.xpath { color: var(--text-muted); }
  .demo-pick { margin-left: auto; font-size: 10px; color: var(--accent); font-weight: 600; }
  .demo-attrs { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .demo-attrs td { border-bottom: 1px solid var(--border); padding: 4px 6px; vertical-align: top; }
  .demo-attrs td:first-child { color: var(--text-muted); font-family: var(--mono); width: 38%; }
</style>
</head>
<body class="view-setup">
<header>
  <img class="logo" src="/static/logo.png" alt="taqwright" />
  <h1><span class="brand">taqwright</span> codegen</h1>
  <span class="dot">·</span>
  <span class="meta" id="session-meta">setup</span>
  <span class="spacer"></span>
  <a class="header-ad" href="https://www.taqwright.ai/" target="_blank" rel="noopener noreferrer"
     title="taqwright — In-sprint mobile UI automation, on autopilot">
    <span class="header-ad-text">In-sprint mobile UI automation, on autopilot.</span>
    <span class="header-ad-arrow" aria-hidden="true">↗</span>
  </a>
  <button class="icon" id="btn-help" title="Help &amp; guided tour">? Help</button>
  <button class="icon danger inspector-only" id="btn-disconnect" title="End the WebDriver session and return to setup">Disconnect</button>
  <button class="primary attached-only" id="btn-resume" title="Resume the paused test and close this inspector" style="display:none">Resume ▶</button>
</header>

<!-- ─── Setup landing view (3-step wizard) ─────────────────── -->
<div id="setup" class="setup-only">
  <!-- Stepper -->
  <div class="wizard-stepper" role="tablist">
    <div class="wizard-step-pill active" data-step="1" role="tab">
      <span class="num"><span class="digit">1</span></span>
      <span class="label">Prerequisites</span>
    </div>
    <span class="wizard-line"></span>
    <div class="wizard-step-pill" data-step="2" role="tab">
      <span class="num"><span class="digit">2</span></span>
      <span class="label">Select device</span>
    </div>
    <span class="wizard-line"></span>
    <div class="wizard-step-pill" data-step="3" role="tab">
      <span class="num"><span class="digit">3</span></span>
      <span class="label">Configure &amp; connect</span>
    </div>
  </div>

  <div class="wizard-content">
    <!-- ─── Step 1: connection mode + prereqs / cloud auth ─── -->
    <div class="wizard-page active" data-page="1">
      <div class="wizard-page-head">
        <h2>Check prerequisites</h2>
        <p id="step1-intro">Confirming the CLIs you need (adb, xcrun, Java) are installed and that the Appium server is reachable. If the Appium pill is grey, click <strong>Start Appium</strong> — <strong>Next</strong> unlocks once it turns green.</p>
      </div>

      <!-- Connection mode -->
      <div class="conn-mode-card">
        <div class="conn-mode-label">Where will the device run?</div>
        <div class="conn-mode-toggle" role="tablist">
          <button class="conn-mode-btn active" data-conn-mode="local" type="button" role="tab">
            <span class="conn-mode-ico">🖥</span>
            <span class="conn-mode-body">
              <span class="conn-mode-title">Local</span>
              <span class="conn-mode-sub">Emulators &amp; simulators on this machine</span>
            </span>
          </button>
          <button class="conn-mode-btn" data-conn-mode="browserstack" type="button" role="tab">
            <span class="conn-mode-ico">☁</span>
            <span class="conn-mode-body">
              <span class="conn-mode-title">BrowserStack</span>
              <span class="conn-mode-sub">App Automate cloud devices</span>
            </span>
          </button>
          <button class="conn-mode-btn" data-conn-mode="lambdatest" type="button" role="tab">
            <span class="conn-mode-ico">☁</span>
            <span class="conn-mode-body">
              <span class="conn-mode-title">LambdaTest</span>
              <span class="conn-mode-sub">Real-device cloud</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Local prereqs (env + appium) -->
      <div id="step1-local-block">
        <div class="prereq-progress" id="prereq-progress"></div>
        <div class="prereq-grid">
          <div class="card card-env">
            <div class="card-head">
              <h2>Environment</h2>
              <span class="grow"></span>
            </div>
            <div class="doctor-summary" id="doctor-summary">
              <span id="doctor-summary-pill" class="pill down"><span class="led"></span><span id="doctor-summary-label">checking…</span></span>
              <span class="grow"></span>
              <span class="twisty" id="doctor-twisty">▾</span>
            </div>
            <ul class="doctor-list" id="doctor-list"></ul>
          </div>
          <div class="card card-appium">
            <div class="card-head">
              <h2>Appium server</h2>
              <span class="grow"></span>
              <span id="appium-pill" class="pill down"><span class="led"></span><span id="appium-pill-label">checking…</span></span>
            </div>
            <div class="field-tri">
              <label for="appium-host">host</label>
              <input id="appium-host" />
              <label for="appium-port" style="text-align:right">port</label>
              <input id="appium-port" />
            </div>
            <div class="field">
              <label for="appium-path">path</label>
              <input id="appium-path" />
            </div>
            <div class="btn-row" style="margin-top:8px">
              <span class="grow"></span>
              <button class="icon" id="btn-appium-recheck">Recheck</button>
              <button class="icon" id="btn-appium-restart">Restart Appium</button>
              <button class="icon" id="btn-appium-start">Start Appium</button>
            </div>
            <div id="appium-start-hint" class="appium-hint" style="display:none">First start can take up to a minute while the UiAutomator2 / XCUITest drivers load.</div>
          </div>
        </div>
      </div>

      <!-- Cloud creds card (BrowserStack / LambdaTest) -->
      <div id="step1-cloud-block" style="display:none">
        <div class="card">
          <div class="card-head">
            <h2 id="cloud-creds-title">Cloud credentials</h2>
            <span class="grow"></span>
            <span id="cloud-creds-pill" class="pill down"><span class="led"></span><span id="cloud-creds-pill-label">awaiting…</span></span>
          </div>
          <div class="field">
            <label for="cloud-user">Username</label>
            <input id="cloud-user" placeholder="username" autocomplete="off" />
          </div>
          <div class="field">
            <label for="cloud-key">Access key</label>
            <input id="cloud-key" type="password" placeholder="access key" autocomplete="off" />
          </div>
          <div id="cloud-creds-hint" class="info-banner" style="margin-top:10px"></div>
        </div>
      </div>
    </div>

    <!-- ─── Step 2: select device ────────────────────────── -->
    <div class="wizard-page" data-page="2">
      <div class="wizard-page-head">
        <h2>Pick a device</h2>
        <p>Boot an emulator or simulator below, then <strong>tap a running device</strong> to select it (Android or iOS — only your last tap counts). Click <strong>Next</strong> when ready.</p>
      </div>
      <div class="card card-devices">
        <div class="card-head">
          <h2>Devices</h2>
          <span class="grow"></span>
          <button class="icon" id="btn-devices-refresh" type="button">↻ Refresh</button>
        </div>
        <div id="devices-warn"></div>
        <div class="device-tabs" role="tablist">
          <button class="device-tab active" data-device-tab="android" type="button">
            <span>Android</span><span class="count" id="device-count-android">0</span>
          </button>
          <button class="device-tab" data-device-tab="ios" type="button">
            <span>iOS</span><span class="count" id="device-count-ios">0</span>
          </button>
        </div>
        <div class="device-grid" id="device-grid"></div>
        <div class="device-pagination" id="device-pagination"></div>
      </div>
    </div>

    <!-- ─── Step 3: capabilities + connect ───────────────── -->
    <div class="wizard-page" data-page="3">
      <div class="wizard-page-head">
        <h2>Configure capabilities &amp; connect</h2>
        <p>The device you picked already filled most of these. Optionally browse for an <strong>.apk</strong>, <strong>.ipa</strong>, <strong>.app</strong>, or <strong>.app.zip</strong> to install — its package / bundle ID will populate automatically.</p>
      </div>
      <div class="card card-caps flex">
        <div class="card-head">
          <h2>Capabilities</h2>
          <span class="grow"></span>
          <button class="icon" id="btn-caps-reset" title="Reset to defaults from taqwright.config.ts">↺ Reset</button>
        </div>
        <div class="caps-fields">
          <div class="field">
            <label for="cap-platform">Platform</label>
            <select id="cap-platform">
              <option value="Android">Android · UiAutomator2</option>
              <option value="iOS">iOS · XCUITest</option>
            </select>
          </div>
          <div class="field">
            <label for="cap-device">Device</label>
            <input id="cap-device" placeholder="emulator-5554, Pixel 6, iPhone 15…" />
          </div>
          <div class="field">
            <label for="cap-version">OS version</label>
            <input id="cap-version" placeholder="optional · e.g. 14, 17.0" />
          </div>
          <div class="app-browse-row">
            <label for="cap-app">App</label>
            <input id="cap-app" placeholder="optional · path to .apk / .ipa / .app / .app.zip" />
            <button class="icon browse-btn" id="btn-app-browse" type="button" title="Pick a file with the system file dialog">Browse…</button>
          </div>
          <div class="app-inspect-status" id="app-inspect-status"></div>
          <div class="field">
            <label for="cap-bundle"><span id="cap-bundle-label">Package</span></label>
            <input id="cap-bundle" placeholder="optional · com.example.app" />
          </div>
          <div class="field">
            <label for="cap-udid">UDID</label>
            <input id="cap-udid" placeholder="optional · device serial" />
          </div>
          <label class="checkbox-row" for="cap-noreset">
            <input type="checkbox" id="cap-noreset" checked />
            <span class="label">noReset</span>
            <span class="hint">don't reinstall the app between sessions</span>
          </label>
          <div class="extras-head">
            <span>Extra capabilities</span>
            <span style="flex:1"></span>
          </div>
          <div class="extras-list" id="extras-list"></div>
          <button class="add-cap-btn" id="btn-add-cap" type="button">
            <span class="plus">+</span><span>Add capability</span>
          </button>
        </div>
        <datalist id="known-caps">
          <option value="appium:autoGrantPermissions">
          <option value="appium:autoAcceptAlerts">
          <option value="appium:autoDismissAlerts">
          <option value="appium:fullReset">
          <option value="appium:enforceAppInstall">
          <option value="appium:dontStopAppOnReset">
          <option value="appium:skipServerInstallation">
          <option value="appium:skipDeviceInitialization">
          <option value="appium:appActivity">
          <option value="appium:appWaitActivity">
          <option value="appium:appWaitPackage">
          <option value="appium:appWaitDuration">
          <option value="appium:newCommandTimeout">
          <option value="appium:orientation">
          <option value="appium:language">
          <option value="appium:locale">
          <option value="appium:systemPort">
          <option value="appium:adbPort">
          <option value="appium:mjpegServerPort">
          <option value="appium:mjpegScreenshotUrl">
          <option value="appium:chromedriverExecutable">
          <option value="appium:nativeWebScreenshot">
          <option value="appium:disableWindowAnimation">
          <option value="appium:wdaLocalPort">
          <option value="appium:wdaLaunchTimeout">
          <option value="appium:wdaConnectionTimeout">
          <option value="appium:simulatorStartupTimeout">
          <option value="appium:useNewWDA">
          <option value="appium:usePrebuiltWDA">
          <option value="appium:webDriverAgentUrl">
          <option value="appium:resetOnSessionStartOnly">
          <option value="appium:nativeWebTap">
          <option value="appium:printPageSourceOnFindFailure">
          <option value="browserName">
          <option value="appium:browserName">
        </datalist>
      </div>
    </div>
  </div>

  <!-- Wizard navigation footer (Back / Next or Connect) -->
  <div class="action-bar wizard-bar">
    <button class="primary" id="btn-step-back" type="button" style="display:none">← Back</button>
    <div class="action-summary" id="connect-summary">Connect to <strong>localhost:4725</strong> · <strong>Android</strong> · UiAutomator2</div>
    <button class="primary" id="btn-step-next" type="button">Next →</button>
    <button class="primary" id="btn-connect" type="button" style="display:none">Connect →</button>
  </div>
</div>
<main>
  <!-- ─── Tree ───────────────────────────────────────────── -->
  <div class="pane">
    <div class="pane-head">
      <span class="pane-title">Hierarchy</span>
      <div class="hier-mode-toggle" role="tablist" aria-label="hierarchy view">
        <button class="hier-mode-btn active" data-hier-mode="tree" type="button" role="tab">Tree</button>
        <button class="hier-mode-btn" data-hier-mode="xml" type="button" role="tab">XML</button>
      </div>
      <span class="loc-spacer"></span>
      <input class="tree-search" id="tree-search" placeholder="filter by tag, id, text…" />
    </div>
    <div class="pane-body tree-body" id="hier-tree-body">
      <ul class="tree" id="tree"></ul>
    </div>
    <div class="pane-body hier-xml-body" id="hier-xml-body" style="display:none">
      <pre id="hier-xml-pre"></pre>
    </div>
  </div>
  <!-- ─── Screen ─────────────────────────────────────────── -->
  <div class="pane">
    <div class="pane-head">
      <span class="pane-title">Screen</span>
      <span class="screen-help-btn" id="screen-help-btn" role="button" tabindex="0"
            title="What can I do on the screen?">ⓘ How to use</span>
      <span class="meta" id="screen-meta" style="margin-left:auto"></span>
      <select class="context-select hidden" id="context-select"
              title="Automation context — switch into a WebView to inspect the web DOM"></select>
      <span class="context-hint hidden" id="context-hint" role="button" tabindex="0"
            title="No WebView context detected — click for help">ⓘ No WebView</span>
    </div>
    <div class="pane-body" id="screen-wrap">
      <div class="screen-help-pop" id="screen-help-pop" role="dialog" aria-label="Using the screen">
        <button class="screen-help-x" id="screen-help-close" type="button" aria-label="Dismiss">×</button>
        <div class="screen-help-title">Working on the screen</div>
        <ul>
          <li><b>Click any element</b> on the screen to <b>select</b> it — then read its
            <b>Attributes</b> / <b>Locators</b>, or record an action on it from the <b>Record</b> tab.</li>
          <li>The blue box highlights the selected element's bounds.</li>
          <li>Hard to hit something small or overlapping? Pick it from the <b>Hierarchy</b> tree on the left.</li>
          <li>When recording a <b>tap at coordinates</b> or a <b>drag target</b>, click the exact spot on the screen.</li>
        </ul>
        <button class="primary screen-help-ok" id="screen-help-ok2" type="button">Got it</button>
      </div>
      <div id="screen-host">
        <img id="screen-img" alt="device screen" />
        <div class="screen-unavailable-msg">
          <div class="screen-unavailable-title">Device screen unavailable</div>
          <div class="screen-unavailable-sub">Couldn't capture the device — retrying…</div>
        </div>
        <div id="highlight" style="display:none"></div>
        <div id="screen-action-overlay" class="screen-action-overlay" aria-hidden="true">
          <div class="screen-action-card">
            <span class="rec-sel-spinner"></span>
            <span class="screen-action-check">✓</span>
            <span id="screen-action-label">Performing action…</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <!-- ─── Inspector ──────────────────────────────────────── -->
  <div class="pane">
    <div class="tabs" role="tablist">
      <div class="tab active" data-tab="record" role="tab">Record</div>
      <div class="tab" data-tab="script" role="tab">Recorded script</div>
      <div class="tab" data-tab="locators" role="tab">Locators</div>
      <div class="tab" data-tab="attrs" role="tab">Attributes</div>
    </div>
    <div class="tab-content" id="tab-record">
      <!-- Recording start/stop banner -->
      <div class="rec-toggle" id="rec-toggle">
        <span class="rec-led"></span>
        <div class="rec-status" id="rec-status">
          <strong>Not recording</strong> — press Start to capture actions as a script.
        </div>
        <button class="btn-rec-toggle" id="btn-rec-toggle" type="button">
          <span class="rec-ico"></span>
          <span id="btn-rec-toggle-label">Start record</span>
        </button>
      </div>

      <!-- Pick-target banner (only shown while waiting for the user to click a point on the screen) -->
      <div class="rec-pickhint" id="rec-pickhint" style="display:none">
        <span class="pulse"></span>
        <span id="rec-pickhint-label">Click a target on the screen to complete the action.</span>
        <button class="icon" id="btn-rec-cancel">Cancel</button>
      </div>

      <!-- Selected element card -->
      <div class="rec-selected" id="rec-selected">
        <div class="rec-sel-icon" id="rec-sel-icon">○</div>
        <div class="rec-sel-body">
          <div class="rec-sel-title" id="rec-sel-title">No element selected</div>
          <div class="rec-sel-sub" id="rec-sel-sub">Tap an element on the screen or in the Hierarchy.</div>
        </div>
      </div>

      <!-- Subtab bar -->
      <div class="rec-subtabs" role="tablist">
        <button class="rec-subtab active" data-subtab="actions" type="button">Actions</button>
        <button class="rec-subtab" data-subtab="screen" type="button">Screen</button>
        <button class="rec-subtab" data-subtab="assert" type="button">Assertions</button>
      </div>

      <!-- Actions pane (element-scoped) -->
      <div class="rec-pane" id="rec-pane-actions">
        <button class="rec-act primary" data-act="click" disabled style="width:100%">
          <span class="ico">▶</span><span>Click</span>
        </button>
        <button class="rec-act" data-screen="tap-point" style="width:100%;margin-top:7px">
          <span class="ico">⊙</span><span>Click @ coordinates</span>
        </button>
        <div class="rec-grid cols-2" style="margin-top:7px">
          <button class="rec-act" data-act="doubleTap" disabled><span class="ico">⏯</span><span>Double tap</span></button>
          <button class="rec-act" data-act="longPress" disabled><span class="ico">⏱</span><span>Long press</span></button>
        </div>

        <div class="rec-subtitle">Toggle</div>
        <div class="rec-grid cols-2">
          <button class="rec-act" data-act="check" disabled><span class="ico">☑</span><span>Check</span></button>
          <button class="rec-act" data-act="uncheck" disabled><span class="ico">☐</span><span>Uncheck</span></button>
        </div>

        <div class="rec-subtitle">Focus</div>
        <div class="rec-grid cols-2">
          <button class="rec-act" data-act="focus" disabled><span class="ico">⌖</span><span>Focus</span></button>
          <button class="rec-act" data-act="blur" disabled><span class="ico">⊘</span><span>Blur</span></button>
        </div>

        <div class="rec-subtitle">Type text</div>
        <div class="rec-input-row">
          <input class="rec-input" id="rec-type-input" placeholder="Type text into the field…" disabled />
          <button class="rec-act" id="btn-rec-type" disabled><span class="ico">⌨</span><span>Type</span></button>
          <button class="rec-act" id="btn-rec-clear" disabled title="Clear the field"><span class="ico">⌫</span><span>Clear</span></button>
        </div>

        <div class="rec-subtitle">Type sequentially (one char at a time)</div>
        <div class="rec-input-row">
          <input class="rec-input" id="rec-seq-input" placeholder="Text…" disabled />
          <input class="rec-input" id="rec-seq-delay" placeholder="delay (ms)" inputmode="numeric" style="max-width:90px" disabled />
          <button class="rec-act" id="btn-rec-seq" disabled><span class="ico">⌨</span><span>Type slowly</span></button>
        </div>

        <div class="rec-subtitle">Press key</div>
        <div class="rec-input-row">
          <select class="rec-input" id="rec-press-key" disabled>
            <option value="Enter">Enter</option>
            <option value="Tab">Tab</option>
            <option value="Backspace">Backspace</option>
            <option value="Space">Space</option>
            <option value="Escape">Escape</option>
            <option value="ArrowUp">ArrowUp</option>
            <option value="ArrowDown">ArrowDown</option>
            <option value="ArrowLeft">ArrowLeft</option>
            <option value="ArrowRight">ArrowRight</option>
            <option value="Delete">Delete</option>
            <option value="Home">Home</option>
            <option value="End">End</option>
            <option value="PageUp">PageUp</option>
            <option value="PageDown">PageDown</option>
          </select>
          <button class="rec-act" id="btn-rec-press" disabled><span class="ico">⏎</span><span>Press</span></button>
        </div>

        <div class="rec-subtitle">Select picker option</div>
        <div class="rec-input-row">
          <input class="rec-input" id="rec-select-label" placeholder="Option label…" disabled />
          <button class="rec-act" id="btn-rec-select" disabled><span class="ico">▼</span><span>Select</span></button>
        </div>

        <div class="rec-subtitle">Swipe within element</div>
        <div class="rec-grid">
          <button class="rec-act" data-act="swipe-left" disabled><span class="ico">←</span><span>Left</span></button>
          <button class="rec-act" data-act="swipe-right" disabled><span class="ico">→</span><span>Right</span></button>
          <button class="rec-act" data-act="swipe-up" disabled><span class="ico">↑</span><span>Up</span></button>
          <button class="rec-act" data-act="swipe-down" disabled><span class="ico">↓</span><span>Down</span></button>
        </div>

        <div class="rec-subtitle">Gestures</div>
        <div class="rec-grid">
          <button class="rec-act" data-act="pinch-in" disabled><span class="ico">⊖</span><span>Pinch in</span></button>
          <button class="rec-act" data-act="pinch-out" disabled><span class="ico">⊕</span><span>Pinch out</span></button>
          <button class="rec-act" data-act="scrollIntoView" disabled><span class="ico">↕</span><span>Scroll to</span></button>
          <button class="rec-act" data-act="dragToPoint" disabled title="Drag the selected element onto a target you pick"><span class="ico">⛶</span><span>Drag to target</span></button>
        </div>
      </div>

      <!-- Screen pane (no element selection required) -->
      <div class="rec-pane hidden" id="rec-pane-screen">
        <div class="rec-grid cols-2">
          <button class="rec-act" data-screen="scroll-up"><span class="ico">↑</span><span>Scroll up</span></button>
          <button class="rec-act" data-screen="scroll-down"><span class="ico">↓</span><span>Scroll down</span></button>
        </div>
        <div class="rec-y-range">
          <div class="rec-y-range-label">
            <span>Custom region (% of screen, optional)</span>
            <span class="rec-y-range-defaults">defaults: y 40–60% · x 50%</span>
          </div>
          <div class="rec-y-range-fields">
            <span class="rec-y-cell">
              <span>y from</span>
              <input id="rec-scroll-top" placeholder="40" inputmode="numeric" />
              <span>to</span>
              <input id="rec-scroll-bottom" placeholder="60" inputmode="numeric" />
              <span>%</span>
            </span>
            <span class="rec-y-cell">
              <span>x at</span>
              <input id="rec-scroll-x" placeholder="50" inputmode="numeric" />
              <span>%</span>
            </span>
            <button class="icon" id="btn-rec-y-clear" type="button" title="Clear range">×</button>
          </div>
        </div>
        <div class="rec-grid" style="margin-top:7px">
          <button class="rec-act" data-screen="drag-and-drop" title="Pick a source element, then a drop target"><span class="ico">⛶</span><span>Drag &amp; drop</span></button>
        </div>
      </div>

      <!-- Assertions pane (element-scoped) -->
      <div class="rec-pane hidden" id="rec-pane-assert">
        <div class="rec-grid">
          <button class="rec-act" data-assert="visible" disabled><span class="ico">✓</span><span>Visible</span></button>
          <button class="rec-act" data-assert="hidden" disabled><span class="ico">✗</span><span>Hidden</span></button>
          <button class="rec-act" data-assert="enabled" disabled><span class="ico">🔓</span><span>Enabled</span></button>
          <button class="rec-act" data-assert="disabled" disabled><span class="ico">🔒</span><span>Disabled</span></button>
          <button class="rec-act" data-assert="checked" disabled><span class="ico">☑</span><span>Checked</span></button>
          <button class="rec-act" data-assert="unchecked" disabled><span class="ico">☐</span><span>Unchecked</span></button>
          <button class="rec-act" data-assert="editable" disabled><span class="ico">✎</span><span>Editable</span></button>
          <button class="rec-act" data-assert="readonly" disabled><span class="ico">⊘</span><span>Readonly</span></button>
          <button class="rec-act" data-assert="focused" disabled><span class="ico">⌖</span><span>Focused</span></button>
          <button class="rec-act" data-assert="attached" disabled><span class="ico">⚓</span><span>Attached</span></button>
          <button class="rec-act" data-assert="empty" disabled><span class="ico">∅</span><span>Empty</span></button>
          <button class="rec-act" data-assert="inViewport" disabled><span class="ico">🖽</span><span>In viewport</span></button>
        </div>
        <div class="rec-assert-row">
          <input id="rec-assert-text" placeholder="text equals…" disabled />
          <button class="rec-act" data-assert="text-exact" disabled><span class="ico">≡</span><span>Equals</span></button>
          <button class="rec-act" data-assert="text-contains" disabled><span class="ico">⊃</span><span>Contains</span></button>
        </div>
        <div class="rec-assert-row">
          <input id="rec-assert-value" placeholder="value equals…" disabled />
          <button class="rec-act" data-assert="value" disabled><span class="ico">≡</span><span>Assert value</span></button>
        </div>
        <div class="rec-assert-row">
          <input id="rec-assert-count" placeholder="match count…" inputmode="numeric" disabled />
          <button class="rec-act" data-assert="count" disabled><span class="ico">#</span><span>Assert count</span></button>
        </div>
        <div class="rec-assert-row">
          <input id="rec-assert-attr-name" placeholder="attribute name…" disabled />
          <input id="rec-assert-attr-value" placeholder="value…" disabled />
          <button class="rec-act" data-assert="attribute" disabled><span class="ico">≡</span><span>Assert attribute</span></button>
        </div>
      </div>

    </div>
    <div class="tab-content hidden" id="tab-script">
      <div class="rec-group">
        <div class="rec-group-title">
          Recorded script
          <span class="grow"></span>
          <span class="lang-seg" id="script-lang">
            <button class="icon active" data-lang="ts" type="button">Taqwright</button>
            <button class="icon" data-lang="python" type="button">Python</button>
            <button class="icon" data-lang="java" type="button">Java</button>
          </span>
          <button class="icon" id="btn-copy-script" type="button">⎘ Copy</button>
          <button class="icon" id="btn-export-script" type="button" title="Save the recorded script into your project's tests folder">↓ Export</button>
          <button class="icon" id="btn-clear-script" type="button">Clear</button>
        </div>
        <div class="rec-lang-note" id="script-lang-note" style="display:none">Steps only — paste into your own Appium test (driver/setup not included).</div>
        <div class="rec-script-card">
          <pre id="script"></pre>
        </div>
      </div>
    </div>
    <div class="tab-content hidden" id="tab-locators">
      <div class="empty-state">
        <div>Select an element to see unique locator strategies.</div>
      </div>
    </div>
    <div class="tab-content hidden" id="tab-attrs">
      <div class="empty-state">
        <div>Select an element.</div>
      </div>
    </div>
    <div class="tab-content hidden" id="tab-script-OLD-UNUSED" style="display:none">
      <pre id="script-old"></pre>
    </div>
  </div>
</main>
<div class="loader-overlay" id="loader" aria-live="polite" aria-hidden="true">
  <div class="loader-spinner"></div>
  <div class="loader-message" id="loader-msg">Loading…</div>
  <div class="loader-sub" id="loader-sub"></div>
  <button id="loader-cancel" type="button">Cancel</button>
</div>
<div id="toasts" aria-live="polite"></div>
<div id="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <div class="modal-card">
    <div class="modal-body">
      <span class="modal-icon" id="modal-icon">⚠️</span>
      <div class="modal-text">
        <div class="modal-title" id="modal-title">Are you sure?</div>
        <div class="modal-msg" id="modal-msg"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="modal-btn" id="modal-cancel">Cancel</button>
      <button class="modal-btn confirm" id="modal-confirm">Confirm</button>
    </div>
  </div>
</div>
<div id="status">ready</div>

<!-- ─── Demo stage (illustrated inspector for the Inspector tour) ─── -->
<div id="demo-stage" aria-hidden="true">
  <div class="demo-bar">
    <span class="demo-badge">DEMO</span>
    <span class="demo-bar-title">Inspector — example walkthrough (Taqelah demo app)</span>
    <span class="grow"></span>
    <button class="icon" id="demo-disconnect" type="button" disabled>Disconnect</button>
  </div>
  <div class="demo-panes">
    <!-- Hierarchy -->
    <div class="pane demo-pane" id="demo-hier">
      <div class="pane-head">
        <span class="pane-title">Hierarchy</span>
        <div class="demo-seg"><span class="on">Tree</span><span>XML</span></div>
        <span class="grow"></span>
        <span class="demo-search">filter by tag, id, text…</span>
      </div>
      <div class="pane-body">
        <ul class="demo-tree">
          <li>▾ android.widget.FrameLayout</li>
          <li class="i1">▾ android.view.View</li>
          <li class="i2 sel">android.widget.EditText <span class="demo-q">hint="Username"</span></li>
          <li class="i2">android.widget.EditText <span class="demo-q">hint="Password"</span></li>
          <li class="i2">android.view.View <span class="demo-id">desc="Login"</span></li>
        </ul>
      </div>
    </div>
    <!-- Screen (demo login phone) -->
    <div class="pane demo-pane" id="demo-screen">
      <div class="pane-head">
        <span class="pane-title">Screen</span>
        <span class="grow"></span>
        <span class="demo-meta">1080 × 2340</span>
      </div>
      <div class="pane-body demo-screen-body">
        <div class="demo-phone">
          <div class="demo-statusbar"><span>1:11</span><span>▾ ▮ ▶</span></div>
          <div class="demo-app">
            <div class="demo-app-logo"><span class="demo-logo-glass">🍹</span><span class="demo-logo-name">taqelah!</span></div>
            <div class="demo-app-title">DemoApp</div>
            <div class="demo-app-sub">Sign in to shop the latest styles</div>
            <div class="demo-field sel"><span class="demo-field-ico">👤</span><span class="demo-field-ph">Username</span></div>
            <div class="demo-field"><span class="demo-field-ico">🔒</span><span class="demo-field-ph">Password</span><span class="demo-field-eye">👁</span></div>
            <button class="demo-app-btn" type="button">Login</button>
            <div class="demo-creds">
              <div class="demo-creds-title">Demo Credentials</div>
              <div>Username: emma@demoapp.com</div>
              <div>Password: 10203040</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Inspector tabs -->
    <div class="pane demo-pane" id="demo-tabs">
      <div class="tabs" role="tablist">
        <div class="tab active" data-demo-tab="rec">Record</div>
        <div class="tab" data-demo-tab="script">Recorded script</div>
        <div class="tab" data-demo-tab="loc">Locators</div>
        <div class="tab" data-demo-tab="attrs">Attributes</div>
      </div>
      <div class="demo-tabwrap">
        <div class="demo-tabpane" id="demo-rec">
          <div class="demo-rec-banner"><span class="demo-led"></span>Recording — selected: <b>Username field</b></div>
          <div class="demo-rec-grid">
            <span class="demo-act primary">▶ Click</span>
            <span class="demo-act">⌨ Type</span>
            <span class="demo-act">⌫ Clear</span>
            <span class="demo-act">⏱ Long press</span>
            <span class="demo-act">↕ Scroll to</span>
            <span class="demo-act">✓ Assert visible</span>
          </div>
          <div class="demo-subtabs">Actions · Screen · Assertions</div>
        </div>
        <div class="demo-tabpane hidden" id="demo-script">
          <div class="demo-seg sm"><span class="on">Taqwright</span><span>Python</span><span>Java</span>
            <span class="grow"></span><span>⎘ Copy</span><span>↓ Export</span></div>
          <pre class="demo-code">await mobile.getByXpath("//*[@hint='Username']").fill('emma@demoapp.com');
await mobile.getByXpath("//*[@hint='Password']").fill('10203040');
await mobile.getByUiSelector('new UiSelector().description("Login")').click();</pre>
        </div>
        <div class="demo-tabpane hidden" id="demo-loc">
          <div class="demo-loc-row"><span class="demo-cat xpath">xpath</span><code>//android.widget.EditText[@hint="Username"]</code><span class="demo-pick">recommended</span></div>
          <div class="demo-loc-row"><span class="demo-cat uiautomator">UIAutomator</span><code>new UiSelector().className("android.widget.EditText").instance(0)</code></div>
          <div class="demo-loc-row"><span class="demo-cat xpath">xpath</span><code>(//android.widget.EditText)[1]</code></div>
        </div>
        <div class="demo-tabpane hidden" id="demo-attrs">
          <table class="demo-attrs">
            <tr><td>class</td><td>android.widget.EditText</td></tr>
            <tr><td>hint</td><td>Username</td></tr>
            <tr><td>text</td><td></td></tr>
            <tr><td>content-desc</td><td></td></tr>
            <tr><td>resource-id</td><td></td></tr>
            <tr><td>bounds</td><td>[72,560][1008,696]</td></tr>
          </table>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ─── Guided tour (spotlight) ─────────────────────────────── -->
<div id="tour-overlay" aria-hidden="true">
  <div id="tour-catcher"></div>
  <div id="tour-spotlight"></div>
  <div id="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    <button id="tour-skip" type="button" aria-label="Skip tour" title="Skip">×</button>
    <h3 id="tour-title"></h3>
    <div class="tour-body" id="tour-text"></div>
    <div id="tour-foot">
      <span id="tour-progress"></span>
      <span class="grow"></span>
      <button class="icon" id="tour-back" type="button">← Back</button>
      <button class="primary" id="tour-next" type="button">Next →</button>
    </div>
  </div>
</div>

<!-- ─── Help reference panel ────────────────────────────────── -->
<div id="help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title">
  <div id="help-panel">
    <div class="help-head">
      <h2 id="help-title">taqwright codegen — Help</h2>
      <span class="grow"></span>
      <button class="primary" id="help-tour-setup" type="button" title="Guided tour of the setup wizard">▶ Setup tour</button>
      <button class="icon" id="help-tour-inspector" type="button" title="Preview the inspector / device-screen tour (no device needed)">▶ Inspector tour</button>
      <button id="help-close" type="button" aria-label="Close help">×</button>
    </div>
    <p class="help-lead">codegen lets you drive a real device, inspect its UI, record your actions
      as you go, and export a runnable test. Take the <b>Setup tour</b> or preview the
      <b>Inspector tour</b> (the device-screen view — works even before you connect), or read the
      topics below.</p>

    <details open>
      <summary>Quick start</summary>
      <div class="help-sec">
        <ol>
          <li><b>Connect</b> a device (the 3-step setup wizard).</li>
          <li><b>Click an element</b> on the screen (or a node in the Hierarchy) to select it.</li>
          <li>Press <b>Start record</b>, then pick actions / assertions for the selected element.</li>
          <li>Open <b>Recorded script</b> and <b>Export</b> it into your project.</li>
        </ol>
      </div>
    </details>

    <details open>
      <summary>1 · Connecting to a device</summary>
      <div class="help-sec">
        Choose <b>Local</b> (an emulator / simulator or USB device on this machine) or <b>Cloud</b>
        (BrowserStack / LambdaTest) at the top, then walk the 3-step wizard:
        <ul>
          <li><b>Step 1 — Prerequisites:</b> the <b>Environment</b> card runs a health check
            (<code>adb</code>, JDK, Android SDK, Appium drivers — expand it for details); the
            <b>Appium server</b> card lets you <b>Start</b> / Restart / Recheck a local Appium.
            <b>Next</b> unlocks once Appium is green. Cloud mode shows a credentials card instead.</li>
          <li><b>Step 2 — Pick a device:</b> switch the <b>Android / iOS</b> tabs,
            <code>↻ Refresh</code> the list, and <b>Start</b> a shutdown emulator (or select a
            running one / a cloud device).</li>
          <li><b>Step 3 — App &amp; capabilities:</b> point at the app under test with
            <b>Browse…</b>, tweak or <b>+ Add</b> Appium capabilities (<b>↺ Reset</b> restores the
            config defaults), then <b>Connect →</b>.</li>
        </ul>
      </div>
    </details>

    <details>
      <summary>2 · The window layout</summary>
      <div class="help-sec">
        Once connected you get three panes:
        <ul>
          <li><b>Hierarchy</b> (left) — the UI element tree.</li>
          <li><b>Screen</b> (center) — a live mirror of the device.</li>
          <li><b>Inspector</b> (right) — four tabs: <b>Record</b>, <b>Recorded script</b>,
            <b>Locators</b>, <b>Attributes</b>.</li>
        </ul>
        Selecting an element anywhere drives all of these at once.
      </div>
    </details>

    <details>
      <summary>3 · Hierarchy — Tree &amp; XML</summary>
      <div class="help-sec">
        <ul>
          <li>Toggle <b>Tree</b> (collapsible element tree) or raw <b>XML</b> page source.</li>
          <li><b>Filter</b> with the search box — matches by tag, id, or text.</li>
          <li><b>Click a node</b> to select it: it highlights on the screen and populates the
            Locators / Attributes tabs.</li>
          <li>Use the tree to reach <b>small or overlapping</b> elements that are hard to click on
            the screen.</li>
        </ul>
      </div>
    </details>

    <details>
      <summary>4 · Screen mirror &amp; WebView</summary>
      <div class="help-sec">
        <ul>
          <li><b>Click any element</b> on the live screen to <b>select</b> it (the blue box shows
            its bounds). The mirror is for selecting / inspecting — actions are recorded from the
            Record tab.</li>
          <li>When recording a <b>tap at coordinates</b> or a <b>drag target</b>, click the exact
            spot on the screen.</li>
          <li><b>WebView:</b> if the app has a WebView, the context dropdown above the screen lets
            you switch into it to inspect the web DOM.</li>
        </ul>
      </div>
    </details>

    <details>
      <summary>5 · Recording — Actions</summary>
      <div class="help-sec">
        Press <b>Start record</b>, select an element, then choose an action; each is appended to
        the script live.
        <ul>
          <li><b>Element:</b> Click, Double tap, Long press, Check / Uncheck, Focus / Blur, Type,
            Clear, Type slowly, Press (a key), Select (a dropdown value).</li>
          <li><b>Gestures:</b> Swipe ← → ↑ ↓, Pinch in / out, Scroll to (scroll the element into
            view), Drag to target (drag the element onto a point you click).</li>
        </ul>
        The <b>Actions / Screen / Assertions</b> sub-tabs switch what the palette records.
      </div>
    </details>

    <details>
      <summary>6 · Recording — Screen taps</summary>
      <div class="help-sec">
        The <b>Screen</b> sub-tab records raw interactions <b>at coordinates</b> — no element
        selection needed. Useful for canvases, maps, games, or anything the hierarchy doesn't
        expose as a tappable element.
      </div>
    </details>

    <details>
      <summary>7 · Recording — Assertions</summary>
      <div class="help-sec">
        The <b>Assertions</b> sub-tab records checks that verify state on the selected element:
        <ul>
          <li><b>State:</b> Visible, Hidden, Enabled, Disabled, Checked, Unchecked, Editable,
            Readonly, Focused, Attached, Empty, In viewport.</li>
          <li><b>Text:</b> Equals (exact) or Contains.</li>
          <li><b>Value</b>, <b>Count</b> (how many match), and <b>Attribute</b> (assert a specific
            attribute value).</li>
        </ul>
        Assertions are how your exported test catches regressions.
      </div>
    </details>

    <details>
      <summary>8 · Locators</summary>
      <div class="help-sec">
        With an element selected, the <b>Locators</b> tab lists <b>ranked, uniqueness-verified</b>
        candidates per strategy:
        <ul>
          <li><b>id</b> and <b>accessibility id</b> (most stable).</li>
          <li><b>UIAutomator</b> (Android), <b>NSPredicate</b> / <b>Class Chain</b> (iOS).</li>
          <li><b>xpath</b> (fallback).</li>
        </ul>
        A <b>Recommended</b> pick is floated to the top. Click any candidate to copy it.
      </div>
    </details>

    <details>
      <summary>9 · Attributes</summary>
      <div class="help-sec">
        The <b>Attributes</b> tab shows the selected element's full attribute set (resource-id,
        text, content-desc / name, bounds, class, …) plus its xpath — handy for crafting your own
        locators.
      </div>
    </details>

    <details>
      <summary>10 · The recorded script &amp; export</summary>
      <div class="help-sec">
        The <b>Recorded script</b> tab renders your test in three languages:
        <ul>
          <li><b>Taqwright</b> — a complete, runnable test.</li>
          <li><b>Python</b> / <b>Java</b> — the steps only (paste into your own Appium test;
            driver / setup not included).</li>
        </ul>
        Use <code>⎘ Copy</code>, <code>↓ Export</code> (saves into your project's tests folder), or
        <b>Clear</b> to start over.
      </div>
    </details>

    <details>
      <summary>Tips &amp; shortcuts</summary>
      <div class="help-sec">
        <ul>
          <li>Re-open this help any time with <b>? Help</b> in the header.</li>
          <li>During the tour: <b>→ / ←</b> next / back, <b>Esc</b> to skip.</li>
          <li>The Screen pane's <b>ⓘ How to use</b> explains on-screen interactions.</li>
          <li><b>Disconnect</b> ends the session and returns you to setup.</li>
        </ul>
      </div>
    </details>
  </div>
</div>
<script>
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const setStatus = (s, busy) => {
    status.textContent = s;
    status.classList.toggle('busy', !!busy);
  };

  /** Full-screen loader overlay. Use during multi-second blocking work like
   * opening a WebDriver session or downloading the first snapshot. */
  function showLoader(msg, sub, onCancel) {
    const el = $('loader');
    if (!el) return;
    $('loader-msg').textContent = msg || 'Loading…';
    $('loader-sub').textContent = sub || '';
    // Optional Cancel button — shown only when the caller passes a handler
    // (e.g. a long cloud connect the user may want to abort).
    const cancel = $('loader-cancel');
    if (onCancel) {
      cancel.onclick = onCancel;
      cancel.classList.add('shown');
    } else {
      cancel.onclick = null;
      cancel.classList.remove('shown');
    }
    el.classList.add('shown');
    el.setAttribute('aria-hidden', 'false');
  }
  function hideLoader() {
    const el = $('loader');
    if (!el) return;
    const cancel = $('loader-cancel');
    cancel.onclick = null;
    cancel.classList.remove('shown');
    el.classList.remove('shown');
    el.setAttribute('aria-hidden', 'true');
  }

  /** Floating, layout-neutral notifications. Errors stick until dismissed; success/info auto-hide. */
  function showToast(message, type, options) {
    type = type || 'info';
    options = options || {};
    const cont = $('toasts');
    if (!cont) return () => {};
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const title = options.title || (type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Info');
    el.innerHTML =
      '<div class="body">' +
        '<div class="title"></div>' +
        '<div class="msg"></div>' +
      '</div>' +
      '<button class="close" type="button" aria-label="dismiss">×</button>';
    el.querySelector('.title').textContent = title;
    el.querySelector('.msg').textContent = message;
    const dismiss = () => {
      if (!el.parentNode) return;
      el.classList.add('fading');
      setTimeout(() => el.remove(), 200);
    };
    el.querySelector('.close').onclick = dismiss;
    cont.appendChild(el);
    const ttl = options.ttl != null ? options.ttl : (type === 'error' ? 0 : 3500);
    if (ttl > 0) setTimeout(dismiss, ttl);
    return dismiss;
  }

  /** Remove every toast on screen. Useful before retrying an action. */
  function clearToasts() {
    const cont = $('toasts');
    if (cont) cont.replaceChildren();
  }

  const state = {
    platform: 'android',
    project: '',
    viewport: { w: 0, h: 0 },
    sourceXml: '',
    xmlDoc: null,
    selected: null,
    nodeMap: new Map(),
    nextId: 0,
    suggestSeq: 0,
    context: 'NATIVE_APP',
  };

  function isWebContext() {
    return !!state.context && state.context !== 'NATIVE_APP';
  }

  // ─── Snapshot ────────────────────────────────────────────────────
  /** Identifying fingerprint for an element across snapshots. */
  function elementSignature(el) {
    if (!el) return '';
    return [
      el.tagName,
      el.getAttribute('class') || '',
      el.getAttribute('resource-id') || '',
      el.getAttribute('content-desc') || '',
      el.getAttribute('name') || '',
      el.getAttribute('text') || el.getAttribute('label') || '',
      el.getAttribute('hint') || el.getAttribute('placeholderValue') || '',
    ].join('|');
  }

  /**
   * Rebind state.selected to the new tree node without re-fetching locator
   * suggestions or flipping the Record-tab card to "resolving". Used when a
   * snapshot refresh produces an element with the SAME xpath + signature as
   * the prior selection — semantically the same element, no need to redo
   * the work.
   */
  function quietlyRebindSelection(el) {
    state.selected = el;
    document.querySelectorAll('li.node.selected').forEach((n) => n.classList.remove('selected'));
    if (el.__nodeId) {
      const li = document.querySelector('li.node[data-id="' + el.__nodeId + '"]');
      if (li) li.classList.add('selected');
    }
    drawHighlight(el);
  }

  /** Drop the current selection (used when the new snapshot doesn't contain it). */
  function clearSelection() {
    state.selected = null;
    clearLocatorState();
    document.querySelectorAll('li.node.selected').forEach((n) => n.classList.remove('selected'));
    $('highlight').style.display = 'none';
    $('tab-attrs').innerHTML = '<div class="empty-state">Select an element.</div>';
    $('tab-locators').innerHTML =
      '<div class="empty-state">Select an element to see unique locator strategies.</div>';
  }

  // ─── Auto-refresh ────────────────────────────────────────────────
  // Polls /api/snapshot so the inspector mirrors the device live. Always on
  // while connected (no toggle); auto-paused during snapshots, anchor-picks,
  // and locator resolves.
  const AUTO_REFRESH_MS = 1500;
  const WEB_REFRESH_MS = 4000; // WebView snapshots are heavier — larger floor
  let autoRefreshOn = true;
  let autoRefreshTimer = null;
  let snapshotInFlight = false;

  function scheduleNextRefresh(delay) {
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = setTimeout(autoRefreshTick, delay);
  }
  function startAutoRefresh() {
    if (autoRefreshTimer) return;
    autoRefreshOn = true;
    scheduleNextRefresh(0);
    refreshContexts(); // populate Native + any WebView contexts on connect
  }
  function stopAutoRefresh() {
    autoRefreshOn = false;
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
    // Reset the context selector back to its hidden default on disconnect.
    state.context = 'NATIVE_APP';
    const sel = document.getElementById('context-select');
    if (sel) {
      sel.classList.add('hidden');
      sel.classList.remove('web');
    }
  }
  async function autoRefreshTick() {
    autoRefreshTimer = null;
    if (!autoRefreshOn) return;
    // Busy (snapshot/verify/anchor-pick in progress) — re-check soon.
    if (snapshotInFlight || anchorPickHandler !== null || locatorState === 'resolving') {
      scheduleNextRefresh(AUTO_REFRESH_MS);
      return;
    }
    const started = performance.now();
    await fetchSnapshot();
    const elapsed = performance.now() - started;
    // Gap at least as long as the snapshot took (with a webview floor) so we
    // never pile onto a slow device.
    const base = isWebContext() ? WEB_REFRESH_MS : AUTO_REFRESH_MS;
    if (autoRefreshOn) scheduleNextRefresh(Math.max(base, elapsed));
  }

  // Toggle the "device screen unavailable" fallback (shown when a snapshot
  // fails or returns no screenshot, so we never render a broken <img>).
  function setScreenUnavailable(on) {
    $('screen-host').classList.toggle('screen-unavailable', !!on);
  }

  async function fetchSnapshot(opts) {
    const force = opts && opts.force;
    if (snapshotInFlight) {
      if (!force) return;                 // Non-forced refresh: skip if a snapshot is already running
      // Forced (context switch): wait for the in-flight snapshot to finish,
      // then run ours so the tree re-renders for the new context.
      while (snapshotInFlight) await new Promise((r) => setTimeout(r, 50));
    }
    snapshotInFlight = true;
    setStatus('snapshot…', true);
    try {
      const r = await fetch('/api/snapshot');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      // Capture the selected element's xpath + identity fingerprint AFTER the
      // fetch resolves, so a selection the user made while the snapshot was in
      // flight (e.g. tapping a new element right after an action) is the one we
      // re-bind across the new tree — not the stale selection from when the
      // snapshot started. Reading these off the now-detached node is safe;
      // renderTree builds fresh nodes. The xpath+signature match below still
      // drops an unrelated element sitting at the same xpath after a navigation.
      const prevXpath = state.selected?.__xpath;
      const prevSig = elementSignature(state.selected);
      state.platform = j.platform;
      state.project = j.project;
      state.viewport = j.viewport;
      state.sourceXml = j.source;
      $('session-meta').textContent = formatSessionMeta(j.platform, j.project);
      $('screen-meta').textContent = j.viewport.w + ' × ' + j.viewport.h;
      // Only set the image when there's an actual screenshot — an empty/missing
      // one would render as a broken <img>; show the fallback instead.
      if (typeof j.screenshot === 'string' && j.screenshot.length > 0) {
        $('screen-img').src = 'data:image/png;base64,' + j.screenshot;
        setScreenUnavailable(false);
      } else {
        setScreenUnavailable(true);
      }
      renderTree();
      if (hierarchyMode === 'xml') refreshHierarchyXml();
      if (prevXpath && prevSig) {
        let match = null;
        for (const [, el] of state.nodeMap) {
          if (el.__xpath === prevXpath && elementSignature(el) === prevSig) {
            match = el; break;
          }
        }
        if (match) {
          // Same xpath + identifying signature → it's semantically the same
          // element. Just rebind state.selected to the new DOM node and
          // refresh the highlight; skip the locator re-fetch and the Record-
          // tab "resolving…" flash. This is what makes auto-refresh stop
          // blinking.
          quietlyRebindSelection(match);
        } else {
          clearSelection();
        }
      }
      setStatus('idle');
    } catch (err) {
      setStatus('error: ' + err.message);
      setScreenUnavailable(true);
    } finally {
      snapshotInFlight = false;
    }
  }

  // ─── Tree rendering ──────────────────────────────────────────────
  function renderTree() {
    state.nodeMap.clear();
    state.nextId = 0;
    const parser = new DOMParser();
    // In a WebView the page source is an HTML DOM (often not well-formed XML),
    // so parse it as HTML. Native sources stay XML.
    const doc = parser.parseFromString(state.sourceXml, isWebContext() ? 'text/html' : 'text/xml');
    state.xmlDoc = doc;
    const root = doc.documentElement;
    if (!root) {
      $('tree').innerHTML = '<li class="empty-state">No source.</li>';
      return;
    }
    annotateXpaths(root, '/' + root.tagName);
    $('tree').innerHTML = renderNode(root, true);
    bindTreeClicks();
    applyTreeFilter($('tree-search').value);
  }

  function annotateXpaths(el, xp) {
    el.__xpath = xp;
    const children = Array.from(el.children);
    const counts = {};
    for (const c of children) counts[c.tagName] = (counts[c.tagName] ?? 0) + 1;
    const seen = {};
    for (const c of children) {
      seen[c.tagName] = (seen[c.tagName] ?? 0) + 1;
      const idx = counts[c.tagName] > 1 ? '[' + seen[c.tagName] + ']' : '';
      annotateXpaths(c, xp + '/' + c.tagName + idx);
    }
  }

  function renderNode(el, isRoot) {
    const id = ++state.nextId;
    state.nodeMap.set(id, el);
    el.__nodeId = id;
    const tag = shortTag(el.tagName);
    const ident = pickIdent(el);
    const textHint = pickTextHint(el, ident);
    const children = Array.from(el.children);
    const twisty = children.length
      ? '<span class="twisty">▾</span>'
      : '<span class="twisty empty">·</span>';
    const identHtml = ident
      ? ' <span class="ident">' + escapeHtml(truncate(ident, 50)) + '</span>'
      : '';
    const textHtml = textHint
      ? ' <span class="text-snippet">"' + escapeHtml(truncate(textHint, 50)) + '"</span>'
      : '';
    let html = '<li class="node" data-id="' + id + '">';
    html += '<span class="label">' + twisty;
    html += '<span class="tag">' + escapeHtml(tag) + '</span>' + identHtml + textHtml;
    html += '</span>';
    if (children.length) {
      html += '<ul' + (isRoot ? '' : '') + '>' + children.map((c) => renderNode(c, false)).join('') + '</ul>';
    }
    html += '</li>';
    return html;
  }

  /** Trim "android.widget." or "XCUIElementType" prefix for compactness. */
  function shortTag(tag) {
    if (tag.startsWith('XCUIElementType')) return tag.slice('XCUIElementType'.length);
    if (tag.startsWith('android.widget.')) return tag.slice('android.widget.'.length);
    if (tag.startsWith('android.view.')) return tag.slice('android.view.'.length);
    return tag;
  }

  function pickIdent(el) {
    const rid = el.getAttribute('resource-id');
    if (rid) {
      return rid.includes(':id/') ? rid.split(':id/')[1] : rid;
    }
    return el.getAttribute('content-desc')
      || el.getAttribute('name')
      || '';
  }

  function pickTextHint(el, ident) {
    const t = el.getAttribute('text') || el.getAttribute('label') || el.getAttribute('value') || '';
    if (!t || t === ident) return '';
    return t;
  }

  function bindTreeClicks() {
    $('tree').onclick = (ev) => {
      const li = ev.target.closest('li.node');
      if (!li) return;
      const id = Number(li.dataset.id);
      const el = state.nodeMap.get(id);
      if (el) selectElement(el);
    };
  }

  // ─── Tree filter ─────────────────────────────────────────────────
  $('tree-search').addEventListener('input', (ev) => {
    if (hierarchyMode === 'xml') applyXmlFilter(ev.target.value);
    else applyTreeFilter(ev.target.value);
  });
  function applyTreeFilter(q) {
    q = (q || '').trim().toLowerCase();
    const items = $('tree').querySelectorAll('li.node');
    if (!q) {
      items.forEach((li) => { li.style.display = ''; li.classList.remove('match'); });
      return;
    }
    items.forEach((li) => {
      const id = Number(li.dataset.id);
      const el = state.nodeMap.get(id);
      if (!el) return;
      const hay = (el.tagName + ' ' +
        (el.getAttribute('resource-id') || '') + ' ' +
        (el.getAttribute('content-desc') || '') + ' ' +
        (el.getAttribute('name') || '') + ' ' +
        (el.getAttribute('label') || '') + ' ' +
        (el.getAttribute('text') || '')).toLowerCase();
      const hit = hay.includes(q);
      li.classList.toggle('match', hit);
    });
  }

  // ─── Selection ───────────────────────────────────────────────────
  function selectElement(el) {
    // Anchor-pick mode (relative-xpath builder): consume this click as the
    // anchor and don't actually re-select. The pick handler does its own UI.
    if (anchorPickHandler && state.selected && el !== state.selected) {
      const handler = anchorPickHandler;
      endAnchorPick();
      handler(el);
      return;
    }
    // Note: we deliberately keep stickyRelative alive across selections.
    // fetchAndRenderLocators only re-injects the relative card when the
    // newly-selected element signature matches stickyRelative.elementSig
    // — so navigating away hides it and navigating back surfaces it.
    // The Dismiss button is the only thing that wipes it permanently.
    state.selected = el;
    // Invalidate stale Record-tab locator. fetchAndRenderLocators flips this
    // to 'resolving' immediately so the user sees the in-flight state.
    markLocatorResolving();
    document.querySelectorAll('li.node.selected').forEach((n) => n.classList.remove('selected'));
    if (el.__nodeId) {
      const li = document.querySelector('li.node[data-id="' + el.__nodeId + '"]');
      if (li) {
        li.classList.add('selected');
        li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    drawHighlight(el);
    renderAttrs(el);
    fetchAndRenderLocators(el);
  }

  function selectByXpath(xp) {
    for (const [, el] of state.nodeMap) {
      if (el.__xpath === xp) { selectElement(el); return; }
    }
  }

  function getBounds(el) {
    if (state.platform === 'android') {
      const b = el.getAttribute('bounds');
      if (!b) return null;
      const m = b.match(/\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]/);
      if (!m) return null;
      const x1 = +m[1], y1 = +m[2], x2 = +m[3], y2 = +m[4];
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    const x = +(el.getAttribute('x') ?? 0);
    const y = +(el.getAttribute('y') ?? 0);
    const w = +(el.getAttribute('width') ?? 0);
    const h = +(el.getAttribute('height') ?? 0);
    return { x, y, w, h };
  }

  function drawHighlight(el) {
    const b = getBounds(el);
    if (!b || b.w <= 0 || b.h <= 0) {
      $('highlight').style.display = 'none';
      return;
    }
    const img = $('screen-img');
    // Same isotropic scale as imgToDevice (inverse direction) so the highlight
    // tracks the screenshot, not a per-axis-distorted bounds projection.
    const scale = Math.min(img.clientWidth / state.viewport.w, img.clientHeight / state.viewport.h);
    const hl = $('highlight');
    hl.style.left = (b.x * scale) + 'px';
    hl.style.top = (b.y * scale) + 'px';
    hl.style.width = (b.w * scale) + 'px';
    hl.style.height = (b.h * scale) + 'px';
    hl.style.display = 'block';
  }

  // ─── Attributes panel ────────────────────────────────────────────
  function renderAttrs(el) {
    const rows = [];
    for (const a of Array.from(el.attributes)) {
      rows.push(
        '<tr><td>' + escapeHtml(a.name) + '</td><td>' +
        escapeHtml(truncate(a.value, 200)) + '</td></tr>',
      );
    }
    rows.push('<tr><td>xpath</td><td>' + escapeHtml(el.__xpath ?? '') + '</td></tr>');
    $('tab-attrs').innerHTML = '<table class="attrs"><tbody>' + rows.join('') + '</tbody></table>';
  }

  // ─── Relative-xpath builder (anchor pick + path computation) ───
  /** When set, the next selectElement(...) becomes the anchor, not the new selection. */
  let anchorPickHandler = null;
  /**
   * Sticky relative xpath bound to the current selection. Survives snapshot
   * refreshes (re-injected after fetchAndRenderLocators) and is dismissed
   * either explicitly via the card's Dismiss button or implicitly when the
   * user selects a different element. Identified by element XPATH (not just
   * signature) — featureless Views all share an empty signature so xpath
   * is what actually distinguishes them.
   */
  let stickyRelative = null; // { elementXpath, elementSig, xpath, code, anchorLabel }

  function isStickyMatch(el) {
    if (!stickyRelative || !el) return false;
    return el.__xpath === stickyRelative.elementXpath
      && elementSignature(el) === stickyRelative.elementSig;
  }

  function startRelativeAnchorPick() {
    if (!state.selected) return;
    // Snapshot the target by xpath + signature so we can re-resolve it from
    // whichever tree is current when the anchor finally gets clicked. Holding
    // a direct reference would point at a stale XMLDocument if any refresh
    // (auto-refresh polling or post-action) parses a new doc in between —
    // anchor and target would then live in different docs and share no
    // common ancestor.
    const targetXpath = state.selected.__xpath;
    const targetSig = elementSignature(state.selected);
    anchorPickHandler = (anchor) => {
      let target = null;
      for (const [, el] of state.nodeMap) {
        if (el.__xpath === targetXpath && elementSignature(el) === targetSig) {
          target = el; break;
        }
      }
      if (!target) {
        showToast(
          'The target element is no longer in the current page source. ' +
          'Refresh and re-select it before building the relative xpath.',
          'error',
          { title: 'Target lost' },
        );
        return;
      }
      buildRelativeLocator(target, anchor);
    };
    $('rec-pickhint-label').textContent =
      'Pick the anchor element (must have a unique attribute like text, id, or content-desc).';
    $('rec-pickhint').style.display = 'flex';
    $('screen-host').classList.add('pick-mode');
  }
  function endAnchorPick() {
    anchorPickHandler = null;
    $('rec-pickhint').style.display = 'none';
    $('screen-host').classList.remove('pick-mode');
  }

  /** Walk anchor → root and target → root, find common ancestor, build a relative xpath. */
  function buildRelativePath(anchor, target) {
    function chain(el) {
      const out = [];
      for (let n = el; n; n = n.parentElement) out.unshift(n);
      return out;
    }
    const aChain = chain(anchor);
    const tChain = chain(target);
    let i = 0;
    while (i < aChain.length && i < tChain.length && aChain[i] === tChain[i]) i++;
    if (i === 0) return null;
    const stepsUp = aChain.length - i;
    let down = '';
    for (let j = i; j < tChain.length; j++) {
      const node = tChain[j];
      const parent = tChain[j - 1];
      const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      const idx = sibs.indexOf(node) + 1;
      down += '/' + node.tagName + (sibs.length > 1 ? '[' + idx + ']' : '');
    }
    let path = '';
    for (let k = 0; k < stepsUp; k++) path += '/..';
    return path + down;
  }

  async function buildRelativeLocator(target, anchor) {
    if (anchor === target) {
      showToast('Pick a different element as the anchor.', 'error', { title: 'Same element' });
      return;
    }
    setStatus('building relative xpath…', true);
    try {
      const anchorAttrs = {};
      for (const a of Array.from(anchor.attributes)) anchorAttrs[a.name] = a.value;
      // Ask the server for the anchor's locator candidates and find a unique xpath.
      const r = await fetch('/api/suggest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attrs: anchorAttrs, xpath: anchor.__xpath ?? '' }),
      });
      const { all } = await r.json();
      const xpathCandidates = (all || [])
        .filter((s) => s.using === 'xpath' && s.unique)
        .sort((a, b) => b.priority - a.priority);
      if (xpathCandidates.length === 0) {
        showToast(
          'The chosen anchor has no unique xpath of its own. Try an element with text, id, or content-desc.',
          'error',
          { title: 'Anchor not unique' },
        );
        return;
      }
      const anchorXpath = xpathCandidates[0].value;
      const relPath = buildRelativePath(anchor, target);
      if (relPath === null) {
        showToast('Anchor and target are not in the same tree.', 'error',
          { title: 'No relative path' });
        return;
      }
      const combined = anchorXpath + relPath;
      // Verify uniqueness on the live device.
      const vr = await fetch('/api/verify-xpath', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ xpath: combined }),
      });
      const verify = await vr.json();
      if (!verify.unique) {
        showToast(
          'Relative xpath matches ' + verify.count + ' elements — not unique. ' +
          'Try a closer anchor.', 'error', { title: 'Not unique' });
        return;
      }
      const code = 'mobile.getByXpath(' + JSON.stringify(combined) + ')';
      const anchorLabel = shortTag(anchor.tagName) +
        (pickIdent(anchor) ? ' · ' + pickIdent(anchor) : '');
      // Persist for the current selection so post-action snapshot refreshes
      // can re-inject the card and re-promote the locator.
      stickyRelative = {
        elementXpath: state.selected.__xpath,
        elementSig: elementSignature(state.selected),
        xpath: combined,
        code,
        anchorLabel,
      };
      injectRelativeCard(combined, code, anchorLabel);
      promoteRelativeLocator(combined, code);
      setStatus('relative xpath built ✓');
    } catch (err) {
      showToast(err.message, 'error', { title: 'Failed to build relative xpath' });
    }
  }

  /** Promote the relative xpath as the active Record-tab locator. */
  function promoteRelativeLocator(xpath, code) {
    setBestLocator({
      category: 'xpath',
      subLabel: 'relative',
      priority: 9999,
      code,
      using: 'xpath',
      value: xpath,
      unique: true,
      count: 1,
    });
  }

  /** Insert (or replace) the relative-xpath card at the top of the Locators tab. */
  function injectRelativeCard(xpath, code, anchorLabel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rel-card';
    wrapper.innerHTML =
      '<div class="anchor-line">⚓ anchored to <strong>' + escapeHtml(anchorLabel) + '</strong></div>' +
      '<div class="loc-head">' +
        '<span class="cat-badge xpath">XPath</span>' +
        '<span class="cat-sub">relative path</span>' +
        '<span class="loc-spacer"></span>' +
        '<span class="badge unique">unique</span>' +
      '</div>' +
      '<div class="loc-code"></div>' +
      '<div class="loc-actions">' +
        '<button class="icon" data-act="dismiss">Dismiss</button>' +
      '</div>' +
      '<div class="rel-tip">' +
        '<span class="ico">⚠</span>' +
        '<div>' +
          '<strong>Heads-up:</strong> relative xpaths are fragile — they break ' +
          'when the surrounding layout changes. Ask your mobile engineer to ' +
          'add a stable identifier to this element ' +
          '(<code>testID</code> on React&nbsp;Native, <code>android:id</code> / ' +
          '<code>contentDescription</code> on Android, ' +
          '<code>accessibilityIdentifier</code> on iOS). Then you can switch ' +
          'to <code>mobile.getById(...)</code> and the locator stays robust ' +
          'across UI changes.' +
        '</div>' +
      '</div>';
    wrapper.querySelector('.loc-code').textContent = code;

    const tab = $('tab-locators');
    const existing = tab.querySelector(':scope > .rel-card');
    if (existing) existing.remove();
    tab.insertBefore(wrapper, tab.firstChild);

    wrapper.querySelector('[data-act="dismiss"]').onclick = () => {
      wrapper.remove();
      stickyRelative = null;
      setBestLocator(null);
    };
  }

  // ─── Locators panel ─────────────────────────────────────────────
  async function fetchAndRenderLocators(el) {
    const seq = ++state.suggestSeq;
    setStatus('verifying locators…', true);
    markLocatorResolving();
    $('tab-locators').innerHTML =
      '<div class="empty-state"><span class="rec-sel-spinner"></span>Verifying locator uniqueness…</div>';
    const attrs = {};
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
    attrs['__tag'] = (el.tagName || '').toLowerCase();
    try {
      const r = await fetch('/api/suggest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attrs, xpath: el.__xpath ?? '' }),
      });
      if (seq !== state.suggestSeq) return;  // newer request landed
      const { best, recommended } = await r.json();
      renderLocatorCards(best, recommended);
      // Tell the Record tab which locator to use for element-targeted actions.
      // Prefer the cross-category robust pick over the first per-category unique.
      setBestLocator(recommended || best.find((s) => s.unique) || null);
      // If the user previously built a sticky relative xpath for THIS exact
      // element (xpath + signature match), re-inject the card and re-promote
      // it as the active locator. xpath is required because featureless
      // Views all share an empty signature.
      if (isStickyMatch(state.selected)) {
        injectRelativeCard(stickyRelative.xpath, stickyRelative.code, stickyRelative.anchorLabel);
        promoteRelativeLocator(stickyRelative.xpath, stickyRelative.code);
      }
      setStatus('idle');
    } catch (err) {
      $('tab-locators').innerHTML =
        '<div class="empty-state">Suggest error: ' + escapeHtml(err.message) + '</div>';
      setBestLocator(null);
      setStatus('error');
    }
  }

  function isTextInput(el) {
    if (!el) return false;
    if (state.platform === 'android') {
      const cls = el.getAttribute('class') || '';
      if (cls === 'android.widget.EditText') return true;
      if (cls.endsWith('.EditText')) return true;
      if (cls === 'android.widget.AutoCompleteTextView') return true;
      if ((el.getAttribute('text-entry-key') || '') === 'true') return true;
      if ((el.getAttribute('password') || '') === 'true') return true;
      return false;
    }
    const type = el.getAttribute('type') || '';
    return type === 'XCUIElementTypeTextField'
      || type === 'XCUIElementTypeSecureTextField'
      || type === 'XCUIElementTypeSearchField'
      || type === 'XCUIElementTypeTextView';
  }

  function renderLocatorCards(list, recommended) {
    if (!Array.isArray(list) || list.length === 0) {
      $('tab-locators').innerHTML =
        '<div class="empty-state">No locator strategies found for this element.</div>';
      return;
    }
    // Recommended pick is cross-category — it may not even be in the
    // per-category best list. Surface it, then float it to the top so it
    // reads as the answer regardless of the id/uiautomator/xpath order.
    const cards_src = list.slice();
    const recCode = recommended ? recommended.code : null;
    if (recCode && !cards_src.some((s) => s.code === recCode)) {
      cards_src.unshift(recommended);
    }
    if (recCode) {
      const ri = cards_src.findIndex((s) => s.code === recCode);
      if (ri > 0) {
        const rec = cards_src.splice(ri, 1)[0];
        cards_src.unshift(rec);
      }
    }
    const showType = isTextInput(state.selected);
    const typeTarget =
      (recommended && recommended.unique && recommended) ||
      cards_src.find((s) => s.unique) ||
      null;
    const typeHtml = (showType && typeTarget)
      ? '<div class="type-card">' +
          '<div class="loc-head">' +
            '<span class="cat-badge id">Type</span>' +
            '<span class="cat-sub">into this field via ' +
              escapeHtml(labelForCategory(typeTarget.category)) + '</span>' +
          '</div>' +
          '<div class="type-row">' +
            '<input class="type-input" id="type-input" placeholder="text to type…" />' +
            '<button class="icon" id="btn-type-send">Send</button>' +
          '</div>' +
          '<div class="type-hint">↵ Enter to send · clears the field first, like ' +
            '<code>.fill()</code></div>' +
        '</div>'
      : (showType
          ? '<div class="type-card"><div class="cat-sub">' +
              'Text input detected, but no unique locator yet — pick one below.' +
            '</div></div>'
          : '');
    const cards = cards_src.map((s, i) => {
      // Positional = synthesized .nth(i). Unique right now but index-fragile;
      // badge it distinctly so it doesn't read as confidently as a stable
      // attribute locator. (descriptor.kind === 'nth' is the only producer.)
      const positional = !!(s.descriptor && s.descriptor.kind === 'nth');
      const isRec = !!(recCode && s.code === recCode);
      const badgeHtml = !s.unique
        ? (s.count > 1
            ? '<span class="badge collision">' + s.count + ' matches</span>'
            : '<span class="badge empty">no match</span>')
        : positional
          ? '<span class="badge positional">positional · fragile</span>'
          : '<span class="badge unique">unique</span>';
      const recHtml = isRec
        ? '<span class="badge recommended">★ Recommended</span>'
        : '';
      const catLabel = labelForCategory(s.category);
      return (
        '<div class="loc-card' + (isRec ? ' is-rec' : '') + '" data-i="' + i + '">' +
          '<div class="loc-head">' +
            '<span class="cat-badge ' + s.category + '">' + escapeHtml(catLabel) + '</span>' +
            '<span class="cat-sub">' + escapeHtml(s.subLabel) + '</span>' +
            '<span class="loc-spacer"></span>' +
            recHtml + badgeHtml +
          '</div>' +
          '<div class="loc-code">' + escapeHtml(s.code) + '</div>' +
        '</div>'
      );
    }).join('');
    // Affordance for building a relative xpath when the existing locators
    // aren't a fit (no unique, or user wants a more semantic anchor).
    const buildRelHtml =
      '<button class="build-rel-btn" id="btn-build-rel" type="button">' +
        '<span class="ico">⚓</span>' +
        '<span class="body">' +
          '<span class="title">Build a relative xpath</span>' +
          '<span class="sub">Pick another element as an anchor — taqwright will compute a path-walking xpath rooted at it.</span>' +
        '</span>' +
      '</button>';

    $('tab-locators').innerHTML = typeHtml + cards + buildRelHtml;
    $('btn-build-rel').onclick = startRelativeAnchorPick;

    if (showType && typeTarget) {
      const sendType = async () => {
        const inp = $('type-input');
        const text = inp.value;
        if (!text) { inp.focus(); return; }
        setStatus('typing…', true);
        try {
          const r = await fetch('/api/locator-action', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              kind: 'fill',
              using: typeTarget.using,
              value: typeTarget.value,
              descriptor: typeTarget.descriptor,
              code: typeTarget.code,
              text,
            }),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || ('HTTP ' + r.status));
          }
          inp.value = '';
          await refreshScript();
          setTimeout(fetchSnapshot, 300);
          setStatus('typed');
        } catch (err) {
          setStatus('type error: ' + err.message);
        }
      };
      $('btn-type-send').onclick = sendType;
      $('type-input').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); sendType(); }
      });
    }

  }

  function labelForCategory(c) {
    return ({
      id: 'ID',
      uiautomator: 'UIAutomator',
      predicate: 'NSPredicate',
      classChain: 'Class Chain',
      xpath: 'XPath',
    })[c] || c;
  }

  // ─── Pointer events on the screen ───────────────────────────────
  function imgToDevice(ev) {
    const img = $('screen-img');
    const rect = img.getBoundingClientRect();
    // One isotropic scale from the inset-free axis. The screenshot can be
    // taller/wider than the logical bounds space when it includes a system-bar
    // inset (e.g. BrowserStack Android nav bar); scaling each axis on its own
    // then distorts the off-inset axis and shifts hit-testing to a neighbour.
    // max() picks the axis with no inset (its bounds dimension isn't shrunk).
    const scale = Math.max(state.viewport.w / rect.width, state.viewport.h / rect.height);
    return {
      x: Math.round((ev.clientX - rect.left) * scale),
      y: Math.round((ev.clientY - rect.top) * scale),
    };
  }

  // A corrupt/truncated data URI fails to decode — fall back rather than show
  // the browser's broken-image glyph.
  $('screen-img').addEventListener('error', () => setScreenUnavailable(true));

  $('screen-img').addEventListener('mouseup', (ev) => {
    const pt = imgToDevice(ev);
    // Pick mode (Record tab) takes priority — consume one click then dismiss.
    if (pickHandler) {
      const handler = pickHandler;
      cancelPickMode();
      handler(pt);
      return;
    }
    // Default: clicking the screen selects the element under the cursor.
    const hit = findHit(pt.x, pt.y);
    if (hit) selectElement(hit);
  });

  /** Does this element have any attribute that the locator suggester can use? */
  function hasUsefulAttrs(el) {
    return !!(
      el.getAttribute('resource-id') ||
      el.getAttribute('content-desc') ||
      el.getAttribute('text') ||
      el.getAttribute('hint') ||
      el.getAttribute('name') ||
      el.getAttribute('label') ||
      el.getAttribute('value') ||
      el.getAttribute('placeholderValue')
    );
  }

  /** BFS the subtree under root to find the closest descendant with a useful attribute. */
  function findUsefulDescendant(root) {
    const queue = Array.from(root.children);
    while (queue.length > 0) {
      const el = queue.shift();
      if (hasUsefulAttrs(el)) return el;
      for (const c of Array.from(el.children)) queue.push(c);
    }
    return null;
  }

  function findHit(x, y) {
    let smallest = null;
    let smallestArea = Infinity;
    for (const [, el] of state.nodeMap) {
      const b = getBounds(el);
      if (!b || b.w <= 0 || b.h <= 0) continue;
      if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
      const area = b.w * b.h;
      if (area < smallestArea) { smallestArea = area; smallest = el; }
    }
    if (!smallest) return null;
    // If the innermost hit is a featureless wrapper (common in React Native /
    // Flutter / SwiftUI views), reach into its subtree for a child with
    // identifying attributes — otherwise the Record tab actions stay disabled
    // because no unique locator can be built.
    if (hasUsefulAttrs(smallest)) return smallest;
    return findUsefulDescendant(smallest) ?? smallest;
  }


  // Tabs.
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      for (const k of ['record', 'script', 'locators', 'attrs']) {
        $('tab-' + k).classList.toggle('hidden', k !== t.dataset.tab);
      }
      if (t.dataset.tab === 'script') refreshScript();
    };
  });

  // Record subtabs (Actions / Screen / Assertions) — independent of the
  // top-level .tab bar; panes live inside #tab-record so all the existing
  // #tab-record handlers/selectors keep matching.
  document.querySelectorAll('.rec-subtab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.rec-subtab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      for (const k of ['actions', 'screen', 'assert']) {
        $('rec-pane-' + k).classList.toggle('hidden', k !== t.dataset.subtab);
      }
    };
  });

  // ─── Hierarchy view-mode toggle (XML / Tree) ─────────────────────
  // Tree is the default — the structured view is easier to scan; XML is opt-in.
  let hierarchyMode = 'tree';
  function setHierarchyMode(mode) {
    hierarchyMode = mode;
    document.querySelectorAll('.hier-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.hierMode === mode);
    });
    const treeBody = document.getElementById('hier-tree-body');
    const xmlBody = document.getElementById('hier-xml-body');
    // The filter field stays visible in both modes; re-apply it for the mode
    // we're switching into so highlights stay correct.
    if (mode === 'xml') {
      treeBody.style.display = 'none';
      xmlBody.style.display = '';
      refreshHierarchyXml();
    } else {
      treeBody.style.display = '';
      xmlBody.style.display = 'none';
      applyTreeFilter($('tree-search').value);
    }
  }
  document.querySelectorAll('.hier-mode-btn').forEach((b) => {
    b.onclick = () => setHierarchyMode(b.dataset.hierMode);
  });

  // ─── Context (Native / WebView) selector ────────────────────────
  function contextLabel(ctx) {
    if (ctx === 'NATIVE_APP') return 'Native';
    // WEBVIEW_com.example → 'WebView (com.example)'
    const m = ctx.match(/^WEBVIEW_?(.*)$/i);
    return m && m[1] ? 'WebView (' + m[1] + ')' : 'WebView';
  }

  function applyContextUi() {
    const sel = document.getElementById('context-select');
    if (!sel) return;
    sel.classList.toggle('web', isWebContext());
  }

  async function refreshContexts() {
    const sel = document.getElementById('context-select');
    if (!sel) return;
    try {
      const r = await fetch('/api/contexts');
      if (!r.ok) return;
      const j = await r.json();
      const contexts = Array.isArray(j.contexts) && j.contexts.length
        ? j.contexts : ['NATIVE_APP'];
      state.context = j.current || state.context || 'NATIVE_APP';
      sel.innerHTML = '';
      for (const ctx of contexts) {
        const opt = document.createElement('option');
        opt.value = ctx;
        opt.textContent = contextLabel(ctx);
        if (ctx === state.context) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.classList.remove('hidden');
      // Surface a hint when the device exposes no WebView — e.g. an Android
      // WebView that isn't debuggable, so it never appears as a context.
      const hasWeb = contexts.some(function (c) { return /^WEBVIEW/i.test(c); });
      const hint = document.getElementById('context-hint');
      if (hint) hint.classList.toggle('hidden', hasWeb);
      applyContextUi();
    } catch {
      // No session / driver error — leave the selector as-is.
    }
  }

  {
    const sel = document.getElementById('context-select');
    if (sel) {
      // Contexts appear only after the WebView finishes loading, so refresh
      // the list lazily when the user opens the dropdown rather than polling.
      sel.addEventListener('mousedown', () => { refreshContexts(); });
      sel.addEventListener('change', async () => {
        const target = sel.value;
        if (target === state.context) return;
        setStatus('switching context…', true);
        try {
          const r = await fetch('/api/context', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ context: target }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
          state.context = j.current || target;
          applyContextUi();
          // A successful switch means a WebView context exists — drop the hint.
          const hint = document.getElementById('context-hint');
          if (hint) hint.classList.add('hidden');
          clearSelection();
          state.sourceXml = '';
          await fetchSnapshot({ force: true });
          showToast('Now in ' + contextLabel(state.context), 'success',
            { title: 'Context switched' });
        } catch (err) {
          showToast(err.message, 'error', { title: 'Context switch failed' });
          // Revert the dropdown to the still-active context.
          refreshContexts();
        } finally {
          setStatus('idle');
        }
      });
    }
    const hint = document.getElementById('context-hint');
    if (hint) {
      const explain = function () {
        // Re-check in case the WebView just finished loading and now appears.
        refreshContexts();
        const android =
          'No WebView context found. The app\\'s WebView must be debuggable — ' +
          'call WebView.setWebContentsDebuggingEnabled(true) (automatic in ' +
          'debuggable builds). To switch into it, Appium also needs ' +
          'chromedriver: enable appium:chromedriverAutodownload or set ' +
          'appium:chromedriverExecutable. Note: Chrome Custom Tabs / external ' +
          'browsers won\\'t appear as a context.';
        const ios =
          'No WebView context found. Ensure the WebView has loaded; on iOS, ' +
          'Safari Web Inspector / WKWebView inspection must be enabled for the ' +
          'app or device.';
        const msg = state.platform === 'ios' ? ios : android;
        showToast(msg, 'info', { title: 'WebView not detected', ttl: 0 });
      };
      hint.addEventListener('click', explain);
      hint.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); explain(); }
      });
    }
  }

  function refreshHierarchyXml() {
    applyXmlFilter($('tree-search').value);
  }
  // Highlight (not hide) substring matches in the XML view — parity with the
  // tree filter. Empty query renders the plain source.
  function applyXmlFilter(q) {
    const pre = document.getElementById('hier-xml-pre');
    if (!pre) return;
    const xml = state.sourceXml || '';
    q = (q || '').trim();
    if (!q) {
      pre.textContent = xml;
      return;
    }
    const lx = xml.toLowerCase();
    const lq = q.toLowerCase();
    let html = '';
    let idx = 0;
    let pos = lx.indexOf(lq);
    while (pos !== -1) {
      html +=
        escapeHtml(xml.slice(idx, pos)) +
        '<mark class="xml-match">' +
        escapeHtml(xml.slice(pos, pos + q.length)) +
        '</mark>';
      idx = pos + q.length;
      pos = lx.indexOf(lq, idx);
    }
    html += escapeHtml(xml.slice(idx));
    pre.innerHTML = html;
  }

  // ─── Record tab wiring ──────────────────────────────────────────
  /** When set, the next click on the screen completes a coordinate-targeted action. */
  let pickHandler = null;

  function startPickMode(label, onPick) {
    pickHandler = onPick;
    $('rec-pickhint-label').textContent = label;
    $('rec-pickhint').style.display = 'flex';
    $('screen-host').classList.add('pick-mode');
  }
  function cancelPickMode() {
    pickHandler = null;
    $('rec-pickhint').style.display = 'none';
    $('screen-host').classList.remove('pick-mode');
  }
  $('btn-rec-cancel').onclick = cancelPickMode;

  /** Best-unique locator for the currently selected element, if any. */
  let bestLocatorForSelected = null;
  /** 'idle' | 'resolving' | 'resolved' — what state the locator suggestion is in. */
  let locatorState = 'idle';

  function setBestLocator(s) {
    bestLocatorForSelected = s;
    locatorState = 'resolved';
    refreshRecordButtons();
  }
  function markLocatorResolving() {
    bestLocatorForSelected = null;
    locatorState = 'resolving';
    refreshRecordButtons();
  }
  function clearLocatorState() {
    bestLocatorForSelected = null;
    locatorState = 'idle';
    refreshRecordButtons();
  }

  /** Enable/disable element-action buttons based on whether we have a selection + unique locator. */
  function refreshRecordButtons() {
    const hasUnique = !!(bestLocatorForSelected && bestLocatorForSelected.unique);

    // Selected-element card.
    const card = $('rec-selected');
    const titleEl = $('rec-sel-title');
    const subEl = $('rec-sel-sub');
    const iconEl = $('rec-sel-icon');
    if (state.selected) {
      const tag = shortTag(state.selected.tagName);
      const ident = pickIdent(state.selected);
      titleEl.textContent = ident ? tag + ' · ' + ident : tag;
      if (hasUnique) {
        iconEl.textContent = '✓';
      } else if (locatorState === 'resolving') {
        iconEl.innerHTML = '<span class="rec-sel-spinner"></span>';
      } else {
        iconEl.textContent = '⚠';
      }
      if (hasUnique) {
        card.classList.add('has');
        subEl.textContent = bestLocatorForSelected.code;
      } else {
        card.classList.remove('has');
        if (locatorState === 'resolving') {
          subEl.innerHTML = 'Resolving locator…' +
            (isCloudMode()
              ? '<span class="rec-resolving-hint">Verifying candidates against the cloud device — this can take a few seconds.</span>'
              : '');
        } else {
          // No unique locator: render an inline Build-relative-xpath button
          // here so the user doesn't have to leave the Record tab.
          subEl.innerHTML =
            '<div class="rec-no-unique">No unique locator for this element. Anchor it against a nearby element instead:</div>' +
            '<button class="build-rel-btn" id="btn-build-rel-record" type="button">' +
              '<span class="ico">⚓</span>' +
              '<span class="body">' +
                '<span class="title">Build a relative xpath</span>' +
                '<span class="sub">Pick another element as an anchor — taqwright will compute a path-walking xpath rooted at it.</span>' +
              '</span>' +
            '</button>';
          const btn = document.getElementById('btn-build-rel-record');
          if (btn) {
            btn.onclick = (e) => { e.stopPropagation(); startRelativeAnchorPick(); };
          }
        }
      }
    } else {
      card.classList.remove('has');
      iconEl.textContent = '○';
      titleEl.textContent = 'No element selected';
      subEl.textContent = 'Tap an element on the screen or in the Hierarchy.';
    }

    // Element action buttons.
    document.querySelectorAll('#tab-record .rec-act[data-act]').forEach((btn) => {
      btn.disabled = !hasUnique;
    });
    $('btn-rec-type').disabled = !hasUnique;
    $('btn-rec-clear').disabled = !hasUnique;
    $('rec-type-input').disabled = !hasUnique;
    $('btn-rec-seq').disabled = !hasUnique;
    $('rec-seq-input').disabled = !hasUnique;
    $('rec-seq-delay').disabled = !hasUnique;
    $('btn-rec-press').disabled = !hasUnique;
    $('rec-press-key').disabled = !hasUnique;
    $('btn-rec-select').disabled = !hasUnique;
    $('rec-select-label').disabled = !hasUnique;
    document.querySelectorAll('#tab-record .rec-act[data-assert]').forEach((btn) => {
      btn.disabled = !hasUnique;
    });
    $('rec-assert-text').disabled = !hasUnique;
    $('rec-assert-value').disabled = !hasUnique;
    $('rec-assert-count').disabled = !hasUnique;
    $('rec-assert-attr-name').disabled = !hasUnique;
    $('rec-assert-attr-value').disabled = !hasUnique;
    // Pre-fill the text/value inputs from the currently-selected element so
    // the user just confirms what's there. Read straight from the parsed
    // page source — no extra device round-trip.
    if (hasUnique && state.selected) {
      const t = state.selected.getAttribute('text') ||
                state.selected.getAttribute('label') ||
                state.selected.getAttribute('name') || '';
      const v = state.selected.getAttribute('value') || '';
      $('rec-assert-text').value = t;
      $('rec-assert-value').value = v;
    }
  }

  // ─── Action progress overlay (over the device screenshot) ───────
  // Bridges the gap between clicking an action and the screen updating: a veil
  // with a per-action label while the device works, then a brief success ✓.
  let actionInFlight = false;
  function actionLabel(kind) {
    const m = { click: 'Tapping…', doubleTap: 'Double-tapping…', longPress: 'Long-pressing…',
      fill: 'Typing…', clear: 'Clearing…', swipe: 'Swiping…', scrollIntoView: 'Scrolling…',
      pinch: 'Pinching…', check: 'Checking…', uncheck: 'Unchecking…', focus: 'Focusing…',
      blur: 'Blurring…', press: 'Pressing key…', pressSequentially: 'Typing…',
      selectOption: 'Selecting…', dragTo: 'Dragging…', scroll: 'Scrolling…' };
    return m[kind] || 'Performing action…';
  }
  function beginAction(label) {
    if (actionInFlight) return false;          // ignore re-entrant clicks
    actionInFlight = true;
    const el = $('screen-action-overlay');
    el.classList.remove('done');
    $('screen-action-label').textContent = label;
    el.classList.add('shown');
    el.setAttribute('aria-hidden', 'false');
    setStatus('action…', true);
    return true;
  }
  function endActionSuccess() {
    const el = $('screen-action-overlay');
    el.classList.add('done');
    $('screen-action-label').textContent = 'Done';
    setTimeout(() => { el.classList.remove('shown'); el.setAttribute('aria-hidden', 'true'); }, 700);
    setStatus('done');
    actionInFlight = false;
  }
  function endActionError(msg) {
    const el = $('screen-action-overlay');
    el.classList.remove('shown');
    el.setAttribute('aria-hidden', 'true');
    setStatus('action error: ' + msg);
    showToast(msg, 'error', { title: 'Action failed' });
    actionInFlight = false;
  }

  async function postLocatorAction(extra) {
    if (!bestLocatorForSelected) return;
    if (!beginAction(actionLabel(extra.kind))) return;
    const s = bestLocatorForSelected;
    try {
      const r = await fetch('/api/locator-action', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          using: s.using, value: s.value, descriptor: s.descriptor, code: s.code, ...extra,
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
      await refreshScript();
      await new Promise((res) => setTimeout(res, 300));   // let the device settle
      await fetchSnapshot({ force: true });
      endActionSuccess();
    } catch (err) {
      endActionError(err.message);
    }
  }
  async function postScreenAction(body) {
    if (!beginAction(actionLabel(body.kind))) return;
    try {
      const r = await fetch('/api/screen-action', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
      await refreshScript();
      await new Promise((res) => setTimeout(res, 300));   // let the device settle
      await fetchSnapshot({ force: true });
      endActionSuccess();
    } catch (err) {
      endActionError(err.message);
    }
  }

  // Resolve the element under a device point to its best UNIQUE locator
  // suggestion, without touching the current selection / Record-tab state.
  // Mirrors fetchAndRenderLocators' attrs/xpath/suggest pipeline. Returns the
  // suggestion ({ code, using, value, descriptor, unique }) or null when no
  // uniquely-locatable element sits there.
  async function resolveUniqueLocatorAt(pt) {
    const el = findHit(pt.x, pt.y);
    if (!el) return null;
    const attrs = {};
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
    attrs['__tag'] = (el.tagName || '').toLowerCase();
    try {
      const r = await fetch('/api/suggest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attrs, xpath: el.__xpath ?? '' }),
      });
      if (!r.ok) return null;
      const { best, recommended } = await r.json();
      const pick = recommended || (best || []).find((s) => s.unique) || null;
      return (pick && pick.unique) ? pick : null;
    } catch {
      return null;
    }
  }

  // Drive + record an element-to-element drag. Both src and target are
  // locator suggestions; renders as await <src>.dragTo(<target>).
  async function postDragTo(src, target) {
    setStatus('action…', true);
    try {
      const r = await fetch('/api/locator-action', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'dragTo',
          using: src.using, value: src.value,
          descriptor: src.descriptor, code: src.code,
          target: {
            using: target.using, value: target.value,
            descriptor: target.descriptor, code: target.code,
          },
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
      await refreshScript();
      setTimeout(fetchSnapshot, 300);
      setStatus('done');
    } catch (err) {
      setStatus('action error: ' + err.message);
    }
  }

  // Element-action button delegation.
  document.querySelectorAll('#tab-record .rec-act[data-act]').forEach((btn) => {
    btn.onclick = () => {
      const act = btn.dataset.act;
      if (!bestLocatorForSelected) return;
      switch (act) {
        case 'click':          return postLocatorAction({ kind: 'click' });
        case 'doubleTap':      return postLocatorAction({ kind: 'doubleTap' });
        case 'longPress':      return postLocatorAction({ kind: 'longPress' });
        case 'check':          return postLocatorAction({ kind: 'check' });
        case 'uncheck':        return postLocatorAction({ kind: 'uncheck' });
        case 'focus':          return postLocatorAction({ kind: 'focus' });
        case 'blur':           return postLocatorAction({ kind: 'blur' });
        case 'swipe-left':     return postLocatorAction({ kind: 'swipe', direction: 'left' });
        case 'swipe-right':    return postLocatorAction({ kind: 'swipe', direction: 'right' });
        case 'swipe-up':       return postLocatorAction({ kind: 'swipe', direction: 'up' });
        case 'swipe-down':     return postLocatorAction({ kind: 'swipe', direction: 'down' });
        case 'scrollIntoView': return postLocatorAction({ kind: 'scrollIntoView' });
        case 'pinch-in':       return postLocatorAction({ kind: 'pinch', direction: 'in' });
        case 'pinch-out':      return postLocatorAction({ kind: 'pinch', direction: 'out' });
        case 'dragToPoint': {
          // Source is the selected element (button is gated on a unique
          // locator). Drop target must resolve to a uniquely-locatable
          // element too — on a miss, re-arm pick mode so the user retries.
          const src = bestLocatorForSelected;
          const pickTarget = () => startPickMode('Click the drop target element.', async (pt) => {
            const target = await resolveUniqueLocatorAt(pt);
            if (!target) {
              setStatus('No uniquely-locatable element there — pick another drop target');
              pickTarget();
              return;
            }
            postDragTo(src, target);
          });
          pickTarget();
          return;
        }
      }
    };
  });

  $('btn-rec-seq').onclick = () => {
    const text = $('rec-seq-input').value;
    if (!text) { $('rec-seq-input').focus(); return; }
    const delayStr = $('rec-seq-delay').value;
    const delay = delayStr ? parseInt(delayStr, 10) : undefined;
    const extra = (delay && delay > 0) ? { kind: 'pressSequentially', text, delay } : { kind: 'pressSequentially', text };
    postLocatorAction(extra).then(() => {
      $('rec-seq-input').value = '';
    });
  };

  $('btn-rec-press').onclick = () => {
    const key = $('rec-press-key').value;
    if (!key) return;
    postLocatorAction({ kind: 'press', key });
  };

  $('btn-rec-select').onclick = () => {
    const label = $('rec-select-label').value;
    if (!label) { $('rec-select-label').focus(); return; }
    postLocatorAction({ kind: 'selectOption', value: { label } }).then(() => {
      $('rec-select-label').value = '';
    });
  };

  $('btn-rec-type').onclick = () => {
    const text = $('rec-type-input').value;
    if (!text) { $('rec-type-input').focus(); return; }
    postLocatorAction({ kind: 'fill', text }).then(() => {
      $('rec-type-input').value = '';
    });
  };
  $('rec-type-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); $('btn-rec-type').click(); }
  });
  $('btn-rec-clear').onclick = () => {
    postLocatorAction({ kind: 'clear' }).then(() => {
      $('rec-type-input').value = '';
    });
  };

  // ─── Custom Y range for screen scroll up/down ─────────────────
  /**
   * Read the user's top% and bottom% inputs and map them into direction-
   * aware fromY/toY fractions. Recorded code uses from.y for the finger
   * start and to.y for the finger end — same convention as Mobile.swipe.
   * Empty inputs → no overrides.
   */
  function readScrollYRange(direction) {
    const topRaw = $('rec-scroll-top').value.trim();
    const botRaw = $('rec-scroll-bottom').value.trim();
    const xRaw = $('rec-scroll-x').value.trim();
    const out = {};

    // Y range: top%/bottom% → direction-aware fromY/toY (finger start/end).
    if (topRaw !== '' || botRaw !== '') {
      const topPct = topRaw === '' ? null : Math.max(0, Math.min(100, Number(topRaw)));
      const botPct = botRaw === '' ? null : Math.max(0, Math.min(100, Number(botRaw)));
      if (topPct !== null || botPct !== null) {
        const top = (topPct ?? 0) / 100;
        const bot = (botPct ?? 100) / 100;
        // For scroll('down') the finger moves UP across the region: from y=bot to y=top.
        // For scroll('up')   the finger moves DOWN across the region: from y=top to y=bot.
        if (direction === 'down') { out.fromY = bot; out.toY = top; }
        else if (direction === 'up') { out.fromY = top; out.toY = bot; }
      }
    }

    // X anchor: single value where the vertical scroll happens horizontally.
    if (xRaw !== '') {
      const xPct = Math.max(0, Math.min(100, Number(xRaw)));
      if (!Number.isNaN(xPct)) {
        const x = xPct / 100;
        out.fromX = x;
        out.toX = x;
      }
    }

    return out;
  }
  $('btn-rec-y-clear').onclick = () => {
    $('rec-scroll-top').value = '';
    $('rec-scroll-bottom').value = '';
    $('rec-scroll-x').value = '';
  };

  // ─── Assert-action button delegation ─────────────────────────────
  /**
   * Send an assertion to the server. The server runs a short verify check
   * against the live device first; if it would fail, we surface a "Record
   * anyway" toast and re-post with force=true on confirmation.
   */
  async function postAssertion(opts) {
    if (!bestLocatorForSelected) return;
    const s = bestLocatorForSelected;
    const body = {
      kind: 'assertion',
      using: s.using, value: s.value, descriptor: s.descriptor, code: s.code,
      matcher: opts.matcher,
      expected: opts.expected,
      expectedCount: opts.expectedCount,
      attrName: opts.attrName,
      mode: opts.mode,
      force: !!opts.force,
    };
    setStatus('verifying assertion…', true);
    try {
      const r = await fetch('/api/locator-action', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      if (j.recorded) {
        setStatus('asserted ✓');
        await refreshScript();
        showToast('Assertion recorded', 'success', { title: 'Recorded' });
      } else if (!j.verified) {
        const got = j.actual !== undefined ? ' (got: ' + JSON.stringify(j.actual) + ')' : '';
        const dismiss = showToast(
          'This assertion would fail right now' + got + '. Record it anyway?',
          'error',
          { title: 'Assertion would fail', ttl: 0 },
        );
        // Patch the toast to add a "Record anyway" button that re-posts with force.
        const cont = $('toasts');
        const lastToast = cont.querySelector('.toast.error:last-child');
        if (lastToast) {
          const btn = document.createElement('button');
          btn.className = 'icon';
          btn.style.marginLeft = '4px';
          btn.textContent = 'Record anyway';
          btn.onclick = () => {
            dismiss();
            postAssertion({ ...opts, force: true });
          };
          const body = lastToast.querySelector('.body');
          if (body) body.appendChild(btn);
        }
      } else {
        // Verified but not recorded — recording is off.
        showToast('Recording is off — Start record first.', 'info', { title: 'Not recorded' });
      }
    } catch (err) {
      showToast(err.message, 'error', { title: 'Assertion failed' });
    }
  }

  document.querySelectorAll('#tab-record .rec-act[data-assert]').forEach((btn) => {
    btn.onclick = () => {
      const which = btn.dataset.assert;
      switch (which) {
        case 'visible':
        case 'hidden':
        case 'enabled':
        case 'disabled':
        case 'checked':
        case 'unchecked':
        case 'editable':
        case 'readonly':
        case 'focused':
        case 'attached':
        case 'empty':
        case 'inViewport':
          return postAssertion({ matcher: which });
        case 'text-exact': {
          const expected = $('rec-assert-text').value;
          return postAssertion({ matcher: 'text', expected, mode: 'exact' });
        }
        case 'text-contains': {
          const expected = $('rec-assert-text').value;
          return postAssertion({ matcher: 'text', expected, mode: 'contains' });
        }
        case 'value': {
          const expected = $('rec-assert-value').value;
          return postAssertion({ matcher: 'value', expected });
        }
        case 'count': {
          const raw = $('rec-assert-count').value;
          const expectedCount = parseInt(raw, 10);
          if (Number.isNaN(expectedCount)) {
            setStatus('count assertion needs a number');
            return;
          }
          return postAssertion({ matcher: 'count', expectedCount });
        }
        case 'attribute': {
          const attrName = $('rec-assert-attr-name').value.trim();
          const expected = $('rec-assert-attr-value').value;
          if (!attrName) {
            setStatus('attribute assertion needs a name');
            return;
          }
          return postAssertion({ matcher: 'attribute', attrName, expected });
        }
      }
    };
  });

  // Screen-action button delegation.
  document.querySelectorAll('#tab-record .rec-act[data-screen]').forEach((btn) => {
    btn.onclick = () => {
      const act = btn.dataset.screen;
      switch (act) {
        case 'scroll-up':    return postScreenAction({ kind: 'scroll', direction: 'up',   ...readScrollYRange('up') });
        case 'scroll-down':  return postScreenAction({ kind: 'scroll', direction: 'down', ...readScrollYRange('down') });
        case 'tap-point':
          startPickMode('Click the screen where the tap should land.', (pt) => {
            // Use existing /api/tap (already records as 'tap').
            fetch('/api/tap', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(pt),
            }).then(refreshScript).then(() => setTimeout(fetchSnapshot, 300));
          });
          return;
        case 'drag-and-drop': {
          // Both endpoints must resolve to uniquely-locatable elements;
          // re-arm the relevant pick step on a miss. Records as
          // await <src>.dragTo(<target>).
          const pickSrc = () => startPickMode('Click the element to drag.', async (p1) => {
            const src = await resolveUniqueLocatorAt(p1);
            if (!src) {
              setStatus('No uniquely-locatable element there — pick another source');
              pickSrc();
              return;
            }
            const pickTgt = () => startPickMode('Now click the drop target element.', async (p2) => {
              const target = await resolveUniqueLocatorAt(p2);
              if (!target) {
                setStatus('No uniquely-locatable element there — pick another drop target');
                pickTgt();
                return;
              }
              postDragTo(src, target);
            });
            pickTgt();
          });
          pickSrc();
          return;
        }
      }
    };
  });

  // ─── Recording start/stop toggle ──────────────────────────
  let recording = false;
  function applyRecordingState(on) {
    recording = !!on;
    const banner = $('rec-toggle');
    const status = $('rec-status');
    const btn = $('btn-rec-toggle');
    const label = $('btn-rec-toggle-label');
    banner.classList.toggle('live', recording);
    btn.classList.toggle('stop', recording);
    if (recording) {
      status.innerHTML = '<strong>Recording</strong> — every action below is appended to the script.';
      label.textContent = 'Stop record';
    } else {
      status.innerHTML = "<strong>Not recording</strong> — press Start to capture actions as a script.";
      label.textContent = 'Start record';
    }
  }
  $('btn-rec-toggle').onclick = async () => {
    const next = !recording;
    const path = next ? '/api/recording/start' : '/api/recording/stop';
    try {
      const r = await fetch(path, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const wasRecording = recording;
      applyRecordingState(j.recording);
      await refreshScript();
      // Stop transition: surface a confirmation that the script is captured.
      if (wasRecording && !j.recording) {
        if (lastSpec) {
          // Use action-line count (everything between the test() body braces)
          // as a rough "N actions recorded" hint.
          const actionLines = lastSpec.split('\\n').filter((l) => /^\\s*await\\s/.test(l)).length;
          const actionLabel = actionLines + (actionLines === 1 ? ' action' : ' actions');
          showToast(
            'Recording stopped — ' + actionLabel + ' captured. Use ↓ Export or ⎘ Copy from the Recorded script tab.',
            'success',
            { title: 'Script saved' },
          );
        } else {
          showToast(
            'Recording stopped — no actions were captured.',
            'info',
            { title: 'Nothing recorded' },
          );
        }
      } else if (!wasRecording && j.recording) {
        showToast('Recording — every action you take will append to the script.', 'info', { title: 'Recording' });
      }
    } catch (err) {
      showToast(err.message, 'error', { title: 'Recording toggle failed' });
    }
  };

  /** Cache the most-recent unstyled spec so Copy doesn't paste highlighted HTML. */
  let lastSpec = '';
  // Target language for the Recorded-script tab: 'ts' (default, taqwright) |
  // 'python' (Appium-Python-Client) | 'java' (Appium java-client).
  let scriptLang = 'ts';
  function defaultScriptName() {
    return scriptLang === 'python'
      ? 'recorded_steps.py'
      : scriptLang === 'java'
        ? 'RecordedSteps.java'
        : 'recorded.spec.ts';
  }
  async function refreshScript() {
    const r = await fetch('/api/recording?lang=' + scriptLang);
    const j = await r.json();
    lastSpec = j.spec || '';
    $('script').innerHTML = lastSpec ? highlightCode(lastSpec, scriptLang) : '';
    if (typeof j.recording === 'boolean' && j.recording !== recording) {
      applyRecordingState(j.recording);
    }
  }
  document.querySelectorAll('#script-lang button').forEach((b) => {
    b.onclick = async () => {
      scriptLang = b.dataset.lang;
      document
        .querySelectorAll('#script-lang button')
        .forEach((x) => x.classList.toggle('active', x === b));
      $('script-lang-note').style.display = scriptLang === 'ts' ? 'none' : '';
      await refreshScript();
    };
  });
  $('btn-copy-script').onclick = async () => {
    try {
      await refreshScript();
      if (!lastSpec) {
        showToast('Recorded script is empty — record something first.', 'info', { title: 'Nothing to copy' });
        return;
      }
      await navigator.clipboard.writeText(lastSpec);
      showToast('Copied ' + lastSpec.length + ' chars to clipboard.', 'success', { title: 'Copied' });
    } catch (err) {
      showToast(err.message || String(err), 'error', { title: 'Copy failed' });
    }
  };
  $('btn-clear-script').onclick = async () => {
    try {
      await refreshScript();
      if (!lastSpec) {
        showToast('Already empty.', 'info', { title: 'Nothing to clear' });
        return;
      }
      const r = await fetch('/api/recording/clear', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await refreshScript();
      showToast('Recorded script cleared.', 'success', { title: 'Cleared' });
    } catch (err) {
      showToast(err.message || String(err), 'error', { title: 'Clear failed' });
    }
  };
  $('btn-export-script').onclick = async () => {
    try {
      // Look up where this lands so the prompt + native panel can show the path.
      const infoR = await fetch('/api/export-script/info');
      const info = await infoR.json();
      if (!info.ok) {
        showToast(
          info.error || 'No taqwright.config.ts found — run the inspector from a project directory.',
          'error',
          { title: 'Cannot export' },
        );
        return;
      }
      await refreshScript();
      if (!lastSpec) {
        showToast('Recorded script is empty — record something first.', 'info', { title: 'Nothing to export' });
        return;
      }

      // Preferred path: macOS native save panel — lets the user navigate
      // anywhere, pick a filename, and the OS itself handles overwrite
      // confirmation. Falls back to a plain prompt() on Linux/Windows or
      // when osascript isn't available.
      let absolutePath = '';
      try {
        const sR = await fetch('/api/file-save-picker', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            defaultName: defaultScriptName(),
            defaultLocation: info.absoluteDir,
          }),
        });
        const sJ = await sR.json();
        if (sJ.cancelled) return;
        if (sJ.ok && sJ.path) absolutePath = sJ.path;
        // sJ.error → fall through to prompt below.
      } catch { /* fall through to prompt */ }

      if (absolutePath) {
        // Native panel already confirmed overwrite at the OS level.
        const r = await fetch('/api/export-script', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            absolutePath,
            content: lastSpec,
            overwrite: true,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status);
        showToast(
          'Saved to ' + j.path + ' (' + j.bytes + ' bytes).',
          'success',
          { title: 'Exported' },
        );
        return;
      }

      // Fallback: plain prompt for filename within testDir (non-macOS).
      const filename = window.prompt(
        'Save as (relative to ' + info.absoluteDir + '):',
        defaultScriptName(),
      );
      if (!filename) return;
      let r = await fetch('/api/export-script', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename, content: lastSpec }),
      });
      let j = await r.json();
      if (!r.ok || !j.ok) {
        if (/already exists/i.test(j.error || '')) {
          const ok = window.confirm(j.error + '\\n\\nOverwrite?');
          if (!ok) return;
          r = await fetch('/api/export-script', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filename, content: lastSpec, overwrite: true }),
          });
          j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status);
        } else {
          throw new Error(j.error || 'HTTP ' + r.status);
        }
      }
      showToast(
        'Saved to ' + j.path + ' (' + j.bytes + ' bytes).',
        'success',
        { title: 'Exported' },
      );
    } catch (err) {
      showToast(err.message || String(err), 'error', { title: 'Export failed' });
    }
  };

  // Keyboard: R = refresh.
  document.addEventListener('keydown', (ev) => {
    if (
      (ev.key === 'r' || ev.key === 'R') &&
      !ev.metaKey && !ev.ctrlKey && !ev.altKey &&
      !(ev.target instanceof HTMLInputElement) &&
      !(ev.target instanceof HTMLTextAreaElement)
    ) {
      ev.preventDefault();
      fetchSnapshot();
    }
  });

  /** Build the header meta line — drop the project name when it duplicates the platform. */
  function formatSessionMeta(platform, project) {
    const p = String(platform || '').toLowerCase();
    const proj = String(project || '').trim();
    if (!proj || proj.toLowerCase() === p) return platform || '';
    return platform + ' · ' + proj;
  }

  /**
   * Tiny JS/TS syntax highlighter for the recorded script. Single-pass
   * tokenizer (more robust than regex passes which choke when keywords
   * appear inside strings) producing colored <span> tags.
   */
  // Language-agnostic tokenizer shared by the Taqwright (TS), Python and Java
  // views. Strings / numbers / identifiers / function-calls / punctuation are
  // common; only line-comment syntax and the keyword set vary by language.
  const KW_BY_LANG = {
    ts: new Set([
      'import', 'from', 'export', 'async', 'await', 'return',
      'if', 'else', 'const', 'let', 'var', 'new',
      'true', 'false', 'null', 'undefined',
    ]),
    python: new Set([
      'import', 'from', 'as', 'def', 'class', 'return',
      'if', 'elif', 'else', 'for', 'while', 'in', 'is', 'and', 'or', 'not',
      'lambda', 'assert', 'with', 'try', 'except', 'None', 'True', 'False',
    ]),
    java: new Set([
      'import', 'package', 'public', 'private', 'protected', 'static', 'final',
      'void', 'var', 'new', 'return', 'if', 'else', 'for', 'while', 'class',
      'this', 'throws', 'throw', 'try', 'catch', 'true', 'false', 'null', 'assert',
    ]),
  };
  function highlightCode(src, lang) {
    const KW = KW_BY_LANG[lang] || KW_BY_LANG.ts;
    const out = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
      const c = src[i];
      // Line comment: // (TS/Java) or # (Python) ... newline
      if ((c === '/' && src[i + 1] === '/') || (c === '#' && lang === 'python')) {
        const end = src.indexOf('\\n', i);
        const stop = end === -1 ? n : end;
        out.push(span('cmt', src.slice(i, stop)));
        i = stop;
        continue;
      }
      // String 'foo' or "foo"
      if (c === "'" || c === '"') {
        const quote = c;
        let j = i + 1;
        while (j < n && src[j] !== quote) {
          if (src[j] === '\\\\' && j + 1 < n) j += 2;
          else j += 1;
        }
        out.push(span('str', src.slice(i, Math.min(j + 1, n))));
        i = Math.min(j + 1, n);
        continue;
      }
      // Number
      if (c >= '0' && c <= '9') {
        let j = i;
        while (j < n && /[\\d._]/.test(src[j])) j++;
        out.push(span('num', src.slice(i, j)));
        i = j;
        continue;
      }
      // Identifier
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < n && /[\\w$]/.test(src[j])) j++;
        const word = src.slice(i, j);
        // Skip whitespace to peek for an open-paren (function-call style).
        let k = j;
        while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
        const tag = KW.has(word) ? 'kw' : (src[k] === '(' ? 'fn' : 'id');
        out.push(span(tag, word));
        i = j;
        continue;
      }
      // Whitespace passes through verbatim (no span needed — saves bytes).
      if (c === ' ' || c === '\\t' || c === '\\n' || c === '\\r') {
        out.push(c);
        i++;
        continue;
      }
      // Punctuation / operators.
      out.push(span('pun', c));
      i++;
    }
    return out.join('');
  }
  function span(tag, text) {
    return '<span class="tok-' + tag + '">' + escapeHtml(text) + '</span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // Promise-based confirm dialog — replaces window.confirm with an in-page modal.
  // Resolves true on confirm, false on cancel / overlay-click / Escape.
  function confirmModal(opts) {
    const o = opts || {};
    const overlay = $('modal-overlay');
    $('modal-title').textContent = o.title || 'Are you sure?';
    $('modal-msg').textContent = o.message || '';
    $('modal-icon').textContent = o.icon || '⚠️';
    const confirmBtn = $('modal-confirm');
    const cancelBtn = $('modal-cancel');
    confirmBtn.textContent = o.confirmLabel || 'Confirm';
    cancelBtn.textContent = o.cancelLabel || 'Cancel';
    confirmBtn.classList.toggle('confirm', o.danger !== false);
    return new Promise((resolve) => {
      function cleanup(result) {
        overlay.classList.remove('open');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        overlay.onclick = null;
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') cleanup(false);
        else if (e.key === 'Enter') cleanup(true);
      }
      confirmBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
      document.addEventListener('keydown', onKey);
      overlay.classList.add('open');
      confirmBtn.focus();
    });
  }

  // ─── Setup / landing logic ──────────────────────────────────────
  function showView(name) {
    document.body.classList.toggle('view-setup', name === 'setup');
    document.body.classList.toggle('view-inspector', name === 'inspector');
  }

  async function bootstrap() {
    setStatus('checking session…', true);
    try {
      const r = await fetch('/api/status');
      const j = await r.json();
      if (j.connected) {
        // Attached mode: the inspector is borrowing a driver from a paused
        // test (mobile.pause()). Surface "Resume" instead of Disconnect.
        if (j.attached) {
          $('btn-disconnect').style.display = 'none';
          $('btn-resume').style.display = '';
          $('session-meta').textContent = 'paused — ' + formatSessionMeta(j.platform, j.project);
        } else {
          $('session-meta').textContent = formatSessionMeta(j.platform, j.project);
        }
        applyRecordingState(j.recording);
        showLoader('Loading device screen…',
          'Reconnecting to the active session and pulling the latest snapshot.');
        showView('inspector');
        await fetchSnapshot();
        startAutoRefresh();
        hideLoader();
        onInspectorReady();
      } else {
        showView('setup');
        await initSetup(j);
        maybeStartSetupTour();
      }
      setStatus('idle');
    } catch (err) {
      setStatus('bootstrap error: ' + err.message);
    }
  }

  $('btn-resume').onclick = async () => {
    $('btn-resume').disabled = true;
    $('btn-resume').textContent = 'Resuming…';
    try {
      await fetch('/api/resume', { method: 'POST' });
      autoRefreshOn = false;
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;' +
        'height:100vh;font:14px -apple-system,sans-serif;color:#888;text-align:center;">' +
        '<div><div style="font-size:32px;margin-bottom:12px">▶</div>' +
        'Test resumed. You can close this tab.</div></div>';
    } catch (err) {
      $('btn-resume').disabled = false;
      $('btn-resume').textContent = 'Resume ▶';
      setStatus('resume error: ' + err.message);
    }
  };

  // Keys we map to dedicated form fields. Anything else lives in the
  // advanced JSON editor and is merged on top at connect time.
  const KNOWN_CAP_KEYS = new Set([
    'platformName',
    'appium:automationName',
    'appium:deviceName',
    'appium:platformVersion',
    'appium:app',
    'appium:bundleId',
    'appium:appPackage',
    'appium:udid',
    'appium:noReset',
  ]);

  /** Split a flat caps object into form fields + an ordered array of extra rows. */
  function splitCaps(caps) {
    const c = caps || {};
    const platform = c.platformName === 'iOS' ? 'iOS' : 'Android';
    const form = {
      platform,
      device: c['appium:deviceName'] || '',
      version: c['appium:platformVersion'] || '',
      app: c['appium:app'] || '',
      bundle: c['appium:bundleId'] || c['appium:appPackage'] || '',
      udid: c['appium:udid'] || '',
      noReset: c['appium:noReset'] !== false,
    };
    const extras = [];
    for (const [k, v] of Object.entries(c)) {
      if (KNOWN_CAP_KEYS.has(k)) continue;
      extras.push({ key: k, value: stringifyCapValue(v) });
    }
    return { form, extras };
  }

  /** Build a flat caps object from form + extras. Extras override on key collision. */
  function buildCaps(form, extras) {
    const caps = {
      platformName: form.platform,
      'appium:automationName': form.platform === 'iOS' ? 'XCUITest' : 'UiAutomator2',
    };
    if (form.device) caps['appium:deviceName'] = form.device;
    if (form.version) caps['appium:platformVersion'] = form.version;
    if (form.app) caps['appium:app'] = form.app;
    if (form.bundle) {
      if (form.platform === 'iOS') caps['appium:bundleId'] = form.bundle;
      else caps['appium:appPackage'] = form.bundle;
    }
    if (form.udid) caps['appium:udid'] = form.udid;
    if (form.noReset) caps['appium:noReset'] = true;
    for (const row of extras || []) {
      const key = String(row.key || '').trim();
      if (!key) continue;
      caps[key] = parseCapValue(row.value);
    }
    return caps;
  }

  /** Coerce a string value into the most specific JSON type — bool, number, JSON, else string. */
  function parseCapValue(v) {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (s === '') return '';
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if (/^-?\\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\\d+\\.\\d+$/.test(s)) return parseFloat(s);
    if (s[0] === '{' || s[0] === '[' || s[0] === '"') {
      try { return JSON.parse(s); } catch { /* fall through */ }
    }
    return s;
  }

  function stringifyCapValue(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    if (v == null) return '';
    return JSON.stringify(v);
  }

  async function initSetup(initial) {
    // Appium fields.
    $('appium-host').value = initial.appium.host;
    $('appium-port').value = String(initial.appium.port);
    $('appium-path').value = initial.appium.path;

    // Capability fields.
    applyCapsToForm(initial.defaults.capabilities);

    // Re-initialization after disconnect must clear the previous device choice too,
    // otherwise the stale tile shows selected while the (now-empty) cap-device gate
    // keeps Next disabled. Mirrors the reset in setConnectionMode().
    selectedDeviceKey = null;
    selectedCloudDevice = null;

    // Reset wizard state (bootstrap re-runs after disconnect).
    prereqsDoctorDone = false;
    prereqsAppiumDone = false;
    const progressEl = document.getElementById('prereq-progress');
    if (progressEl) progressEl.classList.remove('done');
    $('app-inspect-status').textContent = '';
    $('app-inspect-status').className = 'app-inspect-status';

    // Doctor + appium probes + device list.
    await loadDoctor();
    await refreshAppiumPill();
    await loadDevices();

    // Wire interactions.
    $('btn-appium-recheck').onclick = refreshAppiumPill;
    $('btn-appium-restart').onclick = restartAppium;
    $('btn-appium-start').onclick = startAppium;
    $('btn-caps-reset').onclick = () => applyCapsToForm(initial.defaults.capabilities);
    $('btn-connect').onclick = doConnect;
    $('btn-add-cap').onclick = () => addExtraRow({ key: '', value: '' }, true);
    $('btn-devices-refresh').onclick = loadDevices;
    $('btn-app-browse').onclick = pickAppFile;
    $('btn-step-back').onclick = () => goToStep(wizardStep - 1);
    $('btn-step-next').onclick = () => goToStep(wizardStep + 1);

    // Connection-mode picker (Local / BrowserStack / LambdaTest).
    document.querySelectorAll('.conn-mode-btn').forEach((b) => {
      b.onclick = () => setConnectionMode(b.dataset.connMode);
    });
    // Cloud creds inputs — refresh pill + summary on every keystroke.
    for (const id of ['cloud-user', 'cloud-key']) {
      $(id).addEventListener('input', refreshCloudCredsPill);
      $(id).addEventListener('change', refreshCloudCredsPill);
    }
    for (const id of ['appium-host', 'appium-port', 'appium-path']) {
      $(id).addEventListener('change', () => { refreshAppiumPill(); updateConnectSummary(); });
      $(id).addEventListener('input', updateConnectSummary);
    }
    for (const id of ['cap-platform', 'cap-device', 'cap-version', 'cap-app', 'cap-bundle', 'cap-udid', 'cap-noreset']) {
      $(id).addEventListener('input', updateConnectSummary);
      $(id).addEventListener('change', updateConnectSummary);
    }
    $('cap-platform').addEventListener('change', () => {
      clearAppIfPlatformMismatch($('cap-platform').value);
      updateBundleLabel();
    });
    $('cap-app').addEventListener('change', () => inspectAppPath());
    $('doctor-summary').addEventListener('click', toggleDoctorList);

    // Stepper pills: clicking a completed pill jumps back to it.
    document.querySelectorAll('.wizard-step-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const target = Number(pill.getAttribute('data-step'));
        if (target && target < wizardStep) goToStep(target);
      });
    });

    updateBundleLabel();
    updateConnectSummary();
    goToStep(1);
  }

  // ─── Wizard state ──────────────────────────────────────────────
  let wizardStep = 1;
  let prereqsDoctorDone = false;
  let prereqsAppiumDone = false;
  // Connection mode: 'local' (existing emulator/sim flow), 'browserstack',
  // or 'lambdatest'. Cloud modes skip the local Appium card and use the
  // cloud's own hub.
  let connectionMode = 'local';
  let cloudCredsValid = false;

  function isCloudMode() {
    return connectionMode === 'browserstack' || connectionMode === 'lambdatest';
  }

  function setConnectionMode(mode) {
    // Snapshot current cloud creds before swapping — keeps each provider's
    // values isolated so the user can flip back and forth without losing
    // what they typed for either one.
    snapshotCloudCreds();
    connectionMode = mode;
    document.querySelectorAll('.conn-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.connMode === mode);
    });
    const local = document.getElementById('step1-local-block');
    const cloud = document.getElementById('step1-cloud-block');
    const intro = document.getElementById('step1-intro');
    if (mode === 'local') {
      if (local) local.style.display = '';
      if (cloud) cloud.style.display = 'none';
      if (intro) intro.innerHTML = 'Confirming the CLIs you need (adb, xcrun, Java) are installed and that the Appium server is reachable. If the Appium pill is grey, click <strong>Start Appium</strong> — <strong>Next</strong> unlocks once it turns green.';
    } else {
      if (local) local.style.display = 'none';
      if (cloud) cloud.style.display = '';
      const provLabel = mode === 'browserstack' ? 'BrowserStack' : 'LambdaTest';
      if (intro) intro.innerHTML = 'Connecting to <strong>' + provLabel + '</strong> cloud devices. Enter your credentials below — <strong>Next</strong> unlocks once they are filled in.';
      const titleEl = document.getElementById('cloud-creds-title');
      if (titleEl) titleEl.textContent = provLabel + ' credentials';
      // Restore the new provider's creds: in-memory cache first, env vars
      // as fallback. Always overwrites — no leakage from the previous one.
      loadCloudCredsForMode(mode);
    }
    applyModeToStep3();
    // Selecting a different mode invalidates the previous device choice.
    selectedDeviceKey = null;
    selectedCloudDevice = null;
    $('cap-device').value = '';
    $('cap-version').value = '';
    $('cap-udid').value = '';
    // Drop the previous source's catalog so step 2 doesn't flash stale tiles
    // before the new source's loadDevices() resolves.
    lastDeviceData = { android: [], ios: [], toolsMissing: {} };
    devicePage = { android: 0, ios: 0 };
    updateConnectSummary();
  }

  /** Re-skin the Capabilities form for the current connection mode. */
  function applyModeToStep3() {
    const cloud = isCloudMode();
    // App field placeholder + hint.
    const appInput = document.getElementById('cap-app');
    if (appInput) {
      appInput.placeholder = cloud
        ? (connectionMode === 'browserstack'
            ? 'bs://… (uploaded via BrowserStack app-upload)'
            : 'lt://… (uploaded via LambdaTest app-upload)')
        : 'optional · path to .apk / .ipa / .app';
    }
    // Browse button is meaningless for cloud — no native picker uploads to cloud yet.
    const browseBtn = document.getElementById('btn-app-browse');
    if (browseBtn) browseBtn.style.display = cloud ? 'none' : '';
    // UDID is local-only.
    const udidRow = document.getElementById('cap-udid');
    if (udidRow) {
      const field = udidRow.closest('.field');
      if (field) field.style.display = cloud ? 'none' : '';
    }
  }

  /** Server-side env-var snapshot, fetched once. */
  let cloudEnvCache = null;
  async function loadCloudEnvOnce() {
    if (cloudEnvCache) return cloudEnvCache;
    try {
      const r = await fetch('/api/cloud/env');
      cloudEnvCache = await r.json();
    } catch {
      cloudEnvCache = { browserstack: { user: '', key: '' }, lambdatest: { user: '', key: '' } };
    }
    return cloudEnvCache;
  }

  // Per-provider in-memory cache of what the user has typed. Lets the
  // user toggle BrowserStack ↔ LambdaTest without losing the creds for
  // either one.
  const cloudCredsByProvider = { browserstack: null, lambdatest: null };

  // Save the currently-displayed cloud creds into the cache for the
  // current cloud mode (no-op when local).
  function snapshotCloudCreds() {
    if (!isCloudMode()) return;
    const userEl = document.getElementById('cloud-user');
    const keyEl = document.getElementById('cloud-key');
    if (!userEl || !keyEl) return;
    cloudCredsByProvider[connectionMode] = {
      user: (userEl.value || '').trim(),
      key: (keyEl.value || '').trim(),
    };
  }

  // Populate the cloud-user / cloud-key inputs for the given mode: cached
  // value if the user has typed something for it, else env-var default.
  // Always overwrites — never leaves stale values from another provider.
  async function loadCloudCredsForMode(mode) {
    const userEl = $('cloud-user');
    const keyEl = $('cloud-key');
    let user = '';
    let key = '';
    let fromCache = false;
    const cached = cloudCredsByProvider[mode];
    if (cached && (cached.user || cached.key)) {
      user = cached.user;
      key = cached.key;
      fromCache = true;
    } else {
      const env = await loadCloudEnvOnce();
      const slot = env[mode] || { user: '', key: '' };
      user = slot.user || '';
      key = slot.key || '';
    }
    if (userEl) userEl.value = user;
    if (keyEl) keyEl.value = key;
    const hint = $('cloud-creds-hint');
    if (hint) {
      const envName = mode === 'browserstack'
        ? 'BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY'
        : 'LAMBDATEST_USERNAME / LAMBDATEST_ACCESS_KEY';
      hint.innerHTML = fromCache
        ? '✓ Restored from this session.'
        : ((user || key)
            ? '✓ Prefilled from <code>' + envName + '</code>. Override here for this session.'
            : 'No env vars detected (<code>' + envName + '</code>). Paste credentials above or set the env vars before launching the inspector.');
    }
    refreshCloudCredsPill();
  }

  function refreshCloudCredsPill() {
    const pill = document.getElementById('cloud-creds-pill');
    const label = document.getElementById('cloud-creds-pill-label');
    if (!pill || !label) return;
    const u = ($('cloud-user').value || '').trim();
    const k = ($('cloud-key').value || '').trim();
    if (u && k) {
      pill.className = 'pill live';
      label.textContent = 'creds detected';
      cloudCredsValid = true;
    } else {
      pill.className = 'pill down';
      label.textContent = 'awaiting…';
      cloudCredsValid = false;
    }
    updateConnectSummary();
  }

  // Whether the wizard is allowed to advance forward off the given step (its
  // prerequisites are met). Mirrors the gating in updateConnectSummary.
  function canAdvanceFrom(step) {
    if (step === 1) {
      return isCloudMode() ? cloudCredsValid : $('appium-pill').classList.contains('live');
    }
    // Require an actual selected, booted device — not just a pre-filled
    // cap-device value (config defaults seed it, which would wrongly enable Next).
    if (step === 2) return selectedDeviceKey !== null;
    return true;
  }

  function goToStep(n) {
    if (n < 1 || n > 3) return;
    // Hard-gate forward navigation: never advance past a step whose
    // prerequisites aren't met — even for programmatic callers like the guided
    // tour. Backward navigation and re-selecting the current step are free.
    if (n > wizardStep && !canAdvanceFrom(wizardStep)) return;
    wizardStep = n;
    document.querySelectorAll('.wizard-page').forEach((p) => {
      p.classList.toggle('active', Number(p.getAttribute('data-page')) === n);
    });
    document.querySelectorAll('.wizard-step-pill').forEach((p) => {
      const ps = Number(p.getAttribute('data-step'));
      p.classList.toggle('active', ps === n);
      p.classList.toggle('done', ps < n);
    });
    document.querySelectorAll('.wizard-line').forEach((line, i) => {
      line.classList.toggle('done', i < n - 1);
    });
    $('btn-step-back').style.display = n > 1 ? '' : 'none';
    $('btn-step-next').style.display = n < 3 ? '' : 'none';
    $('btn-connect').style.display = n === 3 ? '' : 'none';
    updateConnectSummary();
    // Reload the catalog whenever step 2 is entered so the list always
    // reflects the currently selected source (loadDevices branches on mode).
    if (n === 2) loadDevices();
  }

  function maybeHidePrereqProgress() {
    if (prereqsDoctorDone && prereqsAppiumDone) {
      const el = document.getElementById('prereq-progress');
      if (el) el.classList.add('done');
    }
  }

  // ─── App-file inspection (step 3) ──────────────────────────────
  async function pickAppFile() {
    try {
      const r = await fetch('/api/file-picker', { method: 'POST' });
      const j = await r.json();
      if (j.ok && j.path) {
        $('cap-app').value = j.path;
        updateConnectSummary();
        inspectAppPath();
      } else if (j.cancelled) {
        // Silent cancel.
      } else if (j.error) {
        showToast(j.error, 'error', { title: 'Browse failed' });
      }
    } catch (err) {
      showToast(err.message, 'error', { title: 'Browse failed' });
    }
  }

  let inspectAppToken = 0;
  async function inspectAppPath() {
    const status = $('app-inspect-status');
    const path = $('cap-app').value.trim();
    if (!path) { status.textContent = ''; status.className = 'app-inspect-status'; return; }
    // Cloud / remote URLs aren't on the local filesystem — the cloud
    // session resolves them on its own; we skip parsing aapt/plutil
    // and just acknowledge the URL so the user sees positive feedback.
    if (/^(bs|lt|https?):\\/\\//i.test(path)) {
      const kind = path.toLowerCase().startsWith('bs://') ? 'BrowserStack URL'
        : path.toLowerCase().startsWith('lt://') ? 'LambdaTest URL'
        : 'remote URL';
      status.textContent = '✓ ' + kind + ' — bundle id will come from the cloud session.';
      status.className = 'app-inspect-status ok';
      return;
    }
    const token = ++inspectAppToken;
    status.innerHTML = '<span class="spinner"></span>Inspecting ' + escapeHtml(path) + '…';
    status.className = 'app-inspect-status busy';
    try {
      const r = await fetch('/api/inspect-app', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (token !== inspectAppToken) return;
      const j = await r.json();
      if (!r.ok || !j.ok) {
        status.textContent = '⚠ ' + (j.error || ('HTTP ' + r.status));
        status.className = 'app-inspect-status err';
        return;
      }
      // Auto-fill the bundle/package field.
      $('cap-bundle').value = j.bundleId;
      // For Android, also set platform (in case user pointed to .apk after picking iOS device).
      if (j.kind === 'apk') $('cap-platform').value = 'Android';
      else if (j.kind === 'ipa' || j.kind === 'app' || j.kind === 'app.zip') $('cap-platform').value = 'iOS';
      updateBundleLabel();
      // For Android with a launchable activity, set appium:appActivity as an extra.
      if (j.appActivity) {
        let foundRow = null;
        document.querySelectorAll('#extras-list .extra-cap').forEach((row) => {
          const k = row.querySelector('.extra-key').value.trim();
          if (k === 'appium:appActivity') foundRow = row;
        });
        if (foundRow) {
          foundRow.querySelector('.extra-val').value = j.appActivity;
        } else {
          addExtraRow({ key: 'appium:appActivity', value: j.appActivity }, false);
        }
      }
      const detail = j.bundleId + (j.appActivity ? ' · ' + j.appActivity : '');
      status.textContent = '✓ ' + j.kind.toUpperCase() + ' · ' + detail;
      status.className = 'app-inspect-status ok';
      updateConnectSummary();
    } catch (err) {
      if (token !== inspectAppToken) return;
      status.textContent = '⚠ ' + err.message;
      status.className = 'app-inspect-status err';
    }
  }

  function applyCapsToForm(caps) {
    const { form, extras } = splitCaps(caps);
    $('cap-platform').value = form.platform;
    $('cap-device').value = form.device;
    $('cap-version').value = form.version;
    $('cap-app').value = form.app;
    $('cap-bundle').value = form.bundle;
    $('cap-udid').value = form.udid;
    $('cap-noreset').checked = form.noReset;
    $('extras-list').innerHTML = '';
    for (const row of extras) addExtraRow(row, false);
    updateBundleLabel();
    updateConnectSummary();
  }

  /** Append a new key/value row to the extras list. */
  function addExtraRow(row, focus) {
    const list = $('extras-list');
    const div = document.createElement('div');
    div.className = 'extra-cap';
    div.innerHTML =
      '<input class="extra-key" list="known-caps" placeholder="key (e.g. appium:autoGrantPermissions)" />' +
      '<input class="extra-val" placeholder="value" />' +
      '<button class="x-btn" type="button" title="Remove">×</button>';
    const keyInp = div.querySelector('.extra-key');
    const valInp = div.querySelector('.extra-val');
    const rmBtn = div.querySelector('.x-btn');
    keyInp.value = row.key || '';
    valInp.value = row.value || '';
    keyInp.addEventListener('input', updateConnectSummary);
    valInp.addEventListener('input', updateConnectSummary);
    rmBtn.addEventListener('click', () => { div.remove(); updateConnectSummary(); });
    list.appendChild(div);
    if (focus) keyInp.focus();
    updateConnectSummary();
  }

  /** Remove local-emulator-only cap rows (appium:avd, …) — wrong for cloud. */
  function stripLocalOnlyExtras() {
    var localOnly = ['appium:avd', 'appium:avdLaunchTimeout', 'appium:avdReadyTimeout'];
    var rows = document.querySelectorAll('#extras-list .extra-cap');
    rows.forEach(function (div) {
      var k = String(div.querySelector('.extra-key').value || '').trim();
      if (localOnly.indexOf(k) !== -1) div.remove();
    });
    updateConnectSummary();
  }

  /** Read all extras rows into an array of {key, value} (skips empty keys). */
  function readExtras() {
    const out = [];
    const rows = document.querySelectorAll('#extras-list .extra-cap');
    rows.forEach((div) => {
      const k = div.querySelector('.extra-key').value;
      const v = div.querySelector('.extra-val').value;
      if (String(k).trim()) out.push({ key: k.trim(), value: v });
    });
    return out;
  }

  function readFormCaps() {
    return {
      platform: $('cap-platform').value || 'Android',
      device: $('cap-device').value.trim(),
      version: $('cap-version').value.trim(),
      app: $('cap-app').value.trim(),
      bundle: $('cap-bundle').value.trim(),
      udid: $('cap-udid').value.trim(),
      noReset: $('cap-noreset').checked,
    };
  }

  // Infer the platform a local app path implies. 'Android' for .apk,
  // 'iOS' for .app/.ipa, or null for unknown / remote (bs:// lt:// http)
  // URLs — null means "don't infer, don't clear".
  function appPlatformFromPath(path) {
    const p = (path || '').trim().toLowerCase();
    if (p.endsWith('.apk')) return 'Android';
    if (p.endsWith('.app') || p.endsWith('.ipa')) return 'iOS';
    return null;
  }

  // When the chosen platform no longer matches the local app already in
  // the form, that app/bundle can't install or launch on the new
  // platform (the .apk-on-iOS "returned nil" crash). Clear them so the
  // user picks the right app (Browse re-detects the bundle id). Only
  // fires on a KNOWN-extension mismatch — a valid same-platform app or a
  // remote/cloud URL is left untouched.
  function clearAppIfPlatformMismatch(newPlatform) {
    const ap = appPlatformFromPath($('cap-app').value);
    if (!ap || ap === newPlatform) return;
    $('cap-app').value = '';
    $('cap-bundle').value = '';
    const s = $('app-inspect-status');
    s.textContent = '';
    s.className = 'app-inspect-status';
    // Leaving Android: drop the Android-only appium:appActivity extra
    // that inspectAppPath auto-adds (meaningless off Android, would be a
    // bogus iOS cap). Accepted edge: if the user manually emptied cap-app
    // first, the early-return above leaves that extra — a benign unknown
    // cap, far less harmful than a wrong app path.
    if (ap === 'Android') {
      document.querySelectorAll('#extras-list .extra-cap').forEach((row) => {
        const k = row.querySelector('.extra-key');
        if (k && k.value.trim() === 'appium:appActivity') row.remove();
      });
    }
    updateConnectSummary();
  }

  function updateBundleLabel() {
    const platform = $('cap-platform').value;
    $('cap-bundle-label').textContent = platform === 'iOS' ? 'Bundle ID' : 'Package';
  }

  /**
   * Step-aware footer: tells the user what they need to do next, and gates
   * the "Next →" button when prerequisites for the current step aren't met.
   */
  function updateConnectSummary() {
    const summary = $('connect-summary');
    const nextBtn = $('btn-step-next');
    if (wizardStep === 1) {
      if (isCloudMode()) {
        const provLabel = connectionMode === 'browserstack' ? 'BrowserStack' : 'LambdaTest';
        if (cloudCredsValid) {
          summary.innerHTML = '<strong>' + provLabel + ' creds set</strong> — continue to pick a device.';
          nextBtn.disabled = false;
        } else {
          summary.innerHTML = 'Enter your <strong>' + provLabel + '</strong> username + access key to continue.';
          nextBtn.disabled = true;
        }
      } else {
        const reachable = $('appium-pill').classList.contains('live');
        if (reachable) {
          summary.innerHTML = '<strong>Appium reachable</strong> — continue to pick a device.';
          nextBtn.disabled = false;
        } else {
          summary.innerHTML =
            'Start the Appium server before continuing. Use <strong>Start Appium</strong> above.';
          nextBtn.disabled = true;
        }
      }
      return;
    }
    if (wizardStep === 2) {
      // Gate on the real selection (a tapped, booted device), not the pre-filled
      // cap-device value — otherwise Next is enabled before any live device is picked.
      if (selectedDeviceKey !== null) {
        const sel = $('cap-device').value.trim();
        summary.innerHTML =
          'Selected <strong>' + escapeHtml(sel) + '</strong> — click <strong>Next</strong> or pick another device.';
        nextBtn.disabled = false;
      } else {
        summary.innerHTML = isCloudMode()
          ? 'Pick a cloud device by tapping its tile to continue.'
          : 'Pick a booted device by tapping its tile to continue.';
        nextBtn.disabled = true;
      }
      return;
    }
    // Step 3 — full connect summary, drives the Connect button label.
    const f = readFormCaps();
    const auto = f.platform === 'iOS' ? 'XCUITest' : 'UiAutomator2';
    const dev = f.device ? ' · <strong>' + escapeHtml(f.device) + '</strong>' : '';
    if (isCloudMode()) {
      const provLabel = connectionMode === 'browserstack' ? 'BrowserStack' : 'LambdaTest';
      summary.innerHTML =
        'Connect to <strong>' + provLabel + '</strong> · <strong>' + f.platform + '</strong> · ' + auto + dev;
    } else {
      const a = readAppiumForm();
      summary.innerHTML =
        'Connect to <strong>' + escapeHtml(a.host) + ':' + a.port + '</strong>' +
        ' · <strong>' + f.platform + '</strong> · ' + auto + dev;
    }
  }

  function toggleDoctorList() {
    const list = $('doctor-list');
    const open = list.classList.toggle('expanded');
    $('doctor-twisty').textContent = open ? '▴' : '▾';
  }

  async function loadDoctor() {
    try {
      const r = await fetch('/api/doctor');
      const { checks } = await r.json();
      const total = checks.length;
      const oks = checks.filter((c) => c.status === 'ok').length;
      const errs = checks.filter((c) => c.status === 'error').length;
      const warns = checks.filter((c) => c.status === 'warn').length;
      const pill = $('doctor-summary-pill');
      const label = $('doctor-summary-label');
      if (errs === 0 && warns === 0) {
        pill.className = 'pill live';
        label.textContent = 'all ' + total + ' checks passed';
      } else if (errs === 0) {
        pill.className = 'pill down';
        label.textContent = warns + ' warning' + (warns === 1 ? '' : 's') + ' · ' + oks + '/' + total + ' ok';
      } else {
        pill.className = 'pill down';
        label.textContent = errs + ' error' + (errs === 1 ? '' : 's') + ' · ' + oks + '/' + total + ' ok';
      }
      $('doctor-list').innerHTML = checks.map((c) => {
        const sym = c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✗';
        // OK rows show their short value inline-right; warn/error details (often
        // long paths/commands) drop to a full-width wrapping line below the name.
        const inline = c.status === 'ok' && c.detail
          ? '<span class="detail">' + escapeHtml(c.detail) + '</span>' : '';
        const block = c.status !== 'ok' && c.detail
          ? '<div class="detail-block">' + escapeHtml(c.detail) + '</div>' : '';
        return '<li>' +
          '<div class="doctor-row">' +
            '<span class="ico ' + c.status + '">' + sym + '</span>' +
            '<span class="name">' + escapeHtml(c.name) + '</span>' +
            inline +
          '</div>' + block +
          '</li>';
      }).join('');
      // Auto-expand if anything failed.
      if (errs > 0 || warns > 0) {
        $('doctor-list').classList.add('expanded');
        $('doctor-twisty').textContent = '▴';
      }
    } catch (err) {
      $('doctor-summary-label').textContent = 'doctor failed: ' + err.message;
    } finally {
      prereqsDoctorDone = true;
      maybeHidePrereqProgress();
    }
  }

  function readAppiumForm() {
    return {
      host: $('appium-host').value.trim() || 'localhost',
      port: Number($('appium-port').value) || 4723,
      path: $('appium-path').value.trim() || '/',
    };
  }

  // ─── Devices card ──────────────────────────────────────────────
  const DEVICE_PAGE_SIZE = 8;
  let deviceTab = 'android';        // active tab
  let devicePage = { android: 0, ios: 0 };  // 0-based page per tab
  let lastDeviceData = { android: [], ios: [], toolsMissing: {} };

  /** Pull the current device list from the server and re-render. */
  async function loadDevices() {
    const refreshBtn = $('btn-devices-refresh');
    refreshBtn.disabled = true;
    // Show a loading placeholder synchronously so switching device source (or a
    // slow cloud fetch) never flashes the previously rendered device list.
    $('devices-warn').innerHTML = '';
    $('device-pagination').innerHTML = '';
    $('device-count-android').textContent = '…';
    $('device-count-ios').textContent = '…';
    $('device-grid').innerHTML =
      '<div class="device-empty"><span class="rec-sel-spinner"></span>Loading devices…</div>';
    try {
      if (isCloudMode()) {
        const u = ($('cloud-user').value || '').trim();
        const k = ($('cloud-key').value || '').trim();
        if (!u || !k) {
          lastDeviceData = { android: [], ios: [], toolsMissing: {} };
          $('devices-warn').innerHTML =
            '<div class="device-warn">Cloud creds missing — go back to step 1.</div>';
          renderDevices();
          return;
        }
        const r = await fetch('/api/cloud/devices', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: connectionMode, user: u, key: k }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
        // Convert cloud catalog → same shape as local devices, state='booted'
        // so the existing tile UI treats them as ready.
        const android = [];
        const ios = [];
        for (const d of j.devices) {
          const synthUdid = connectionMode + ':' + d.platform + ':' + d.deviceName + ':' + d.osVersion;
          const dev = {
            type: d.platform,
            udid: synthUdid,
            name: d.deviceName,
            osVersion: d.osVersion,
            state: 'booted',
            cloud: { provider: connectionMode, realDevice: !!d.realDevice },
          };
          (d.platform === 'ios' ? ios : android).push(dev);
        }
        lastDeviceData = { android, ios, toolsMissing: {} };
        if (android.length === 0 && ios.length > 0) deviceTab = 'ios';
        renderDevices();
      } else {
        const r = await fetch('/api/devices');
        const data = await r.json();
        lastDeviceData = data;
        if (data.android.length === 0 && data.ios.length > 0) deviceTab = 'ios';
        renderDevices();
      }
    } catch (err) {
      $('device-grid').innerHTML = '';
      $('devices-warn').innerHTML =
        '<div class="device-warn">Failed to load devices: ' + escapeHtml(err.message) + '</div>';
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function renderDevices() {
    const data = lastDeviceData;

    // Drop a stale selection: if the selected device is no longer booted (e.g.
    // it was stopped, or shut down between polls), clear it so Next disables —
    // a selection must always point at a currently-live device.
    if (selectedDeviceKey !== null) {
      const all = [...(data.android || []), ...(data.ios || [])];
      const stillLive = all.some((d) => d.state === 'booted' && bootingKey(d) === selectedDeviceKey);
      if (!stillLive) {
        selectedDeviceKey = null;
        selectedCloudDevice = null;
        $('cap-device').value = '';
        updateConnectSummary();
      }
    }

    // Tool-missing warnings.
    const warns = [];
    if (data.toolsMissing?.adb) warns.push("adb not on PATH — Android emulators won't show.");
    if (data.toolsMissing?.emulator) warns.push("emulator not on PATH — Android AVDs won't show (install Android command-line tools).");
    if (data.toolsMissing?.xcrun) warns.push("xcrun not on PATH — iOS simulators won't show (Xcode required).");
    const warnHtml = warns.map((w) => '<div class="device-warn">' + escapeHtml(w) + '</div>').join('');
    // AVDs whose system image is installed in no SDK are shown but flagged
    // unbootable per-tile (see renderTile) rather than hidden here.
    $('devices-warn').innerHTML = warnHtml;

    // Update tab counts and active class.
    $('device-count-android').textContent = String(data.android.length);
    $('device-count-ios').textContent = String(data.ios.length);
    document.querySelectorAll('.device-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.deviceTab === deviceTab);
    });
    // On platforms without xcrun the iOS tab is meaningless — hide it entirely.
    document.querySelectorAll('.device-tab[data-device-tab="ios"]').forEach((t) => {
      t.style.display = data.toolsMissing?.xcrun ? 'none' : '';
    });

    // Render the active tab's slice.
    const list = deviceTab === 'android' ? data.android : data.ios;
    const totalPages = Math.max(1, Math.ceil(list.length / DEVICE_PAGE_SIZE));
    if (devicePage[deviceTab] >= totalPages) devicePage[deviceTab] = totalPages - 1;
    const page = devicePage[deviceTab];
    const slice = list.slice(page * DEVICE_PAGE_SIZE, (page + 1) * DEVICE_PAGE_SIZE);

    if (list.length === 0) {
      const what = deviceTab === 'android' ? 'Android emulators' : 'iOS simulators';
      $('device-grid').innerHTML = '<div class="device-empty">No ' + what + ' found.</div>';
    } else {
      $('device-grid').innerHTML = slice.map((dev, i) => renderTile(dev, page * DEVICE_PAGE_SIZE + i)).join('');
    }

    // Pagination controls (only shown when there's more than one page).
    if (list.length > DEVICE_PAGE_SIZE) {
      $('device-pagination').innerHTML =
        '<button class="icon" id="btn-dev-prev"' + (page === 0 ? ' disabled' : '') + ' type="button">← Prev</button>' +
        '<span class="info">Page ' + (page + 1) + ' of ' + totalPages + ' · ' + list.length + ' total</span>' +
        '<button class="icon" id="btn-dev-next"' + (page === totalPages - 1 ? ' disabled' : '') + ' type="button">Next →</button>';
      const prev = document.getElementById('btn-dev-prev');
      const next = document.getElementById('btn-dev-next');
      if (prev) prev.onclick = () => { devicePage[deviceTab] = Math.max(0, page - 1); renderDevices(); };
      if (next) next.onclick = () => { devicePage[deviceTab] = Math.min(totalPages - 1, page + 1); renderDevices(); };
    } else {
      $('device-pagination').innerHTML = '';
    }

    // Wire per-tile buttons + click-to-select (only for the visible slice).
    document.querySelectorAll('#device-grid .device-tile').forEach((tile) => {
      const idx = Number(tile.dataset.idx);
      const dev = list[idx];
      if (!dev) return;
      const startBtn = tile.querySelector('[data-act="start"]');
      const stopBtn = tile.querySelector('[data-act="stop"]');
      // Action buttons stop event bubbling so a Stop click doesn't
      // re-select the device tile underneath.
      if (startBtn) {
        startBtn.onclick = (e) => { e.stopPropagation(); startDevice(dev); };
      }
      if (stopBtn) {
        stopBtn.onclick = (e) => { e.stopPropagation(); stopDevice(dev); };
      }
      // The tile itself selects when booted. Hover affordance + cursor
      // come from the .selectable class added in renderTile.
      if (dev.state === 'booted') {
        tile.onclick = () => selectDevice(dev);
      }
    });
  }

  // Tab switching.
  document.querySelectorAll('.device-tab').forEach((t) => {
    t.onclick = () => {
      deviceTab = t.dataset.deviceTab;
      renderDevices();
    };
  });

  // Devices we have asked to boot but haven't yet seen 'booted' for. Keyed
  // by AVD name (Android) or UDID (iOS) since the serial of an Android
  // emulator only exists once it comes online.
  const bootingDevices = new Set();
  function bootingKey(dev) {
    return dev.type === 'android'
      ? 'android:' + (dev.avdName || dev.name)
      : 'ios:' + dev.udid;
  }

  // The single device the user has tapped to drive the session. Cross-tab —
  // selecting an iOS sim clears any prior Android selection and vice versa.
  let selectedDeviceKey = null;
  function isSelected(dev) {
    return selectedDeviceKey === bootingKey(dev);
  }

  function renderTile(dev, idx) {
    const isCloud = !!dev.cloud;
    const isBooting = bootingDevices.has(bootingKey(dev)) || dev.state === 'booting';
    const isBooted = dev.state === 'booted';
    // Shutdown AVD whose system image is in no SDK — cannot boot (Start disabled).
    const unbootable = !isCloud && dev.bootable === false && !isBooted && !isBooting;
    const selected = isBooted && isSelected(dev);
    const stateLabel = isCloud
      ? (dev.cloud.realDevice ? 'cloud · real' : 'cloud · sim')
      : isBooting ? 'booting…'
      : isBooted ? 'live'
      : unbootable ? 'image missing'
      : 'shutdown';
    const stateClass = isCloud
      ? 'pill live'
      : isBooting ? 'pill booting'
      : isBooted ? 'pill live'
      : 'pill down';
    const stateIcon = isBooting
      ? '<span class="spinner"></span>'
      : '<span class="led"></span>';
    const baseMeta = isCloud
      ? (dev.osVersion + (dev.type === 'ios' ? ' · iOS' : ' · Android'))
      : ([dev.osVersion, dev.avdName].filter(Boolean).join(' · ') || '—');
    const meta = unbootable && dev.bootHint ? baseMeta + ' · ' + dev.bootHint : baseMeta;
    const showUdid = !isCloud && isBooted;
    let actions = '';
    if (isCloud) {
      // No start/stop on cloud — the device is always available, the
      // session opens on Connect (step 3). The whole tile is the Use button.
    } else if (isBooting) {
      actions += '<button class="icon" disabled>booting…</button>';
    } else if (unbootable) {
      actions += '<button class="icon" disabled title="' + escapeHtml(dev.bootHint || '') +
        '">image missing</button>';
    } else if (dev.state === 'shutdown') {
      actions += '<button class="icon" data-act="start">▶ Start</button>';
    } else if (isBooted) {
      actions += '<button class="icon" data-act="stop">■ Stop</button>';
    } else {
      actions += '<button class="icon" disabled>' + escapeHtml(stateLabel) + '</button>';
    }
    const tileClasses = ['device-tile'];
    if (isBooting) tileClasses.push('booting');
    else if (isBooted) tileClasses.push('booted', 'selectable');
    if (selected) tileClasses.push('selected');
    return (
      '<div class="' + tileClasses.join(' ') + '" ' +
        'data-idx="' + idx + '" data-kind="' + dev.type + '">' +
        '<div class="check">✓</div>' +
        '<div class="top">' +
          '<span class="icon">📱</span>' +
          '<span class="name">' + escapeHtml(dev.name) + '</span>' +
          '<span class="' + stateClass + '">' + stateIcon + '<span>' +
            escapeHtml(stateLabel) + '</span></span>' +
        '</div>' +
        '<div class="meta">' + escapeHtml(meta) + '</div>' +
        (showUdid ? '<div class="udid">' + escapeHtml(dev.udid) + '</div>' : '') +
        (actions ? '<div class="actions">' + actions + '</div>' : '') +
      '</div>'
    );
  }

  async function startDevice(dev) {
    const key = bootingKey(dev);
    setStatus('booting ' + dev.name + '…', true);
    bootingDevices.add(key);
    renderDevices();
    try {
      const body = dev.type === 'android'
        ? { type: 'android', avdName: dev.avdName ?? dev.name }
        : { type: 'ios', udid: dev.udid };
      const r = await fetch('/api/devices/start', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      showToast("Booting " + dev.name + ". This usually takes 20–60 s.",
        'info', { title: 'Device starting' });
      pollUntilBooted(dev);
    } catch (err) {
      bootingDevices.delete(key);
      renderDevices();
      showToast(err.message, 'error', { title: 'Failed to start' });
    } finally {
      setStatus('idle');
    }
  }

  /**
   * Refresh /api/devices on a 3 s cadence until the named device shows up
   * as 'booted' (or we hit the 90 s deadline). Keeps the spinner on the
   * tile up to date the whole way through.
   */
  function pollUntilBooted(dev) {
    const key = bootingKey(dev);
    const deadline = Date.now() + 90_000;
    const tick = async () => {
      if (!bootingDevices.has(key)) return;
      if (Date.now() > deadline) {
        bootingDevices.delete(key);
        renderDevices();
        showToast(
          dev.name + " didn't finish booting within 90 s — click Refresh to recheck.",
          'error', { title: 'Boot timeout' });
        return;
      }
      try {
        const r = await fetch('/api/devices');
        const data = await r.json();
        lastDeviceData = data;
        const list = dev.type === 'android' ? data.android : data.ios;
        const found = list.find((d) => bootingKey(d) === key);
        if (found && found.state === 'booted') {
          bootingDevices.delete(key);
          // Auto-select the device the user just started — no manual click needed.
          // selectDevice() also re-renders (✓) and enables Next (gated on selection).
          selectDevice(found);
          showToast(dev.name + ' is up and ready.', 'success', { title: 'Device booted' });
          return;
        }
        renderDevices();
      } catch { /* network blip — try again */ }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  }

  async function stopDevice(dev) {
    setStatus('stopping ' + dev.name + '…', true);
    try {
      const r = await fetch('/api/devices/stop', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: dev.type, udid: dev.udid }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      showToast(dev.name + ' is shutting down.', 'success', { title: 'Stopped' });
      setTimeout(loadDevices, 2000);
    } catch (err) {
      showToast(err.message, 'error', { title: 'Failed to stop' });
    } finally {
      setStatus('idle');
    }
  }

  /**
   * Tap on a tile = select that device. Cross-tab single-selection: tapping
   * an iOS sim clears any prior Android selection and vice versa. The user
   * then clicks Next to advance to step 3 (no auto-advance — they get to
   * see the checkmark first and re-select if needed).
   */
  // Captured when a cloud device tile is selected — used at connect time
  // to build the right cloud capabilities. null when the active selection
  // is a local emulator/sim.
  let selectedCloudDevice = null;

  function selectDevice(dev) {
    if (dev.state !== 'booted') return;
    selectedDeviceKey = bootingKey(dev);
    $('cap-platform').value = dev.type === 'ios' ? 'iOS' : 'Android';
    $('cap-device').value = dev.name;
    $('cap-version').value = dev.osVersion ?? '';
    if (dev.cloud) {
      selectedCloudDevice = {
        provider: dev.cloud.provider,
        platform: dev.type,
        deviceName: dev.name,
        osVersion: dev.osVersion ?? '',
      };
      $('cap-udid').value = '';
      // Cloud picks the device by name + version — drop any local-emulator-only
      // caps (appium:avd, …) that were seeded from the local config.
      stripLocalOnlyExtras();
    } else {
      selectedCloudDevice = null;
      $('cap-udid').value = dev.udid;
    }
    clearAppIfPlatformMismatch($('cap-platform').value);
    updateBundleLabel();
    updateConnectSummary();
    renderDevices();
  }

  // While a (blocking) start/restart request is in flight, show a spinner pill
  // with a live elapsed-seconds counter so a slow boot doesn't look frozen.
  let appiumStartTimer = null;
  function setAppiumStarting(label) {
    $('appium-pill').className = 'pill booting';
    $('appium-pill-label').textContent = label + '… 0s';
    $('appium-start-hint').style.display = '';
    $('btn-appium-recheck').disabled = true;
    $('btn-appium-restart').disabled = true;
    $('btn-appium-start').disabled = true;
    let secs = 0;
    if (appiumStartTimer) clearInterval(appiumStartTimer);
    appiumStartTimer = setInterval(() => {
      secs += 1;
      $('appium-pill-label').textContent = label + '… ' + secs + 's';
    }, 1000);
  }
  function clearAppiumStarting() {
    if (appiumStartTimer) { clearInterval(appiumStartTimer); appiumStartTimer = null; }
    $('appium-start-hint').style.display = 'none';
    $('btn-appium-recheck').disabled = false;
    $('btn-appium-restart').disabled = false;
    // btn-appium-start re-enable is decided by refreshAppiumPill (reachable?)
  }

  async function refreshAppiumPill() {
    const opts = readAppiumForm();
    const pill = $('appium-pill');
    const label = $('appium-pill-label');
    pill.className = 'pill down';
    label.textContent = 'checking…';
    try {
      const r = await fetch('/api/status');
      const j = await r.json();
      // /api/status reports the server-side default; compare against the
      // form values to decide whether to trust it.
      const reachable = j.appiumReachable && j.appium.host === opts.host && j.appium.port === opts.port;
      if (reachable) {
        pill.className = 'pill live';
        label.textContent = 'reachable on ' + opts.host + ':' + opts.port +
          (j.appiumOurs ? ' (started by inspector)' : '');
        $('btn-appium-start').disabled = true;
        $('btn-appium-start').textContent = 'Already running';
      } else {
        // Probe directly via /api/appium/start with no spawn? Server doesn't
        // expose a probe-only endpoint. Best-effort: tell the server which
        // host:port we want, then re-query status. We do that via a Recheck
        // pre-step that sends the form values to the server.
        const probeR = await fetch('/api/appium/probe?host=' + encodeURIComponent(opts.host) +
          '&port=' + opts.port + '&path=' + encodeURIComponent(opts.path));
        if (probeR.ok) {
          const pj = await probeR.json();
          if (pj.reachable) {
            pill.className = 'pill live';
            label.textContent = 'reachable on ' + opts.host + ':' + opts.port;
            $('btn-appium-start').disabled = true;
            $('btn-appium-start').textContent = 'Already running';
            return;
          }
        }
        pill.className = 'pill down';
        label.textContent = 'not reachable on ' + opts.host + ':' + opts.port;
        $('btn-appium-start').disabled = false;
        $('btn-appium-start').textContent = 'Start Appium';
      }
    } catch (err) {
      pill.className = 'pill down';
      label.textContent = 'check failed';
      $('btn-appium-start').disabled = false;
      $('btn-appium-start').textContent = 'Start Appium';
    } finally {
      prereqsAppiumDone = true;
      maybeHidePrereqProgress();
      updateConnectSummary();
    }
  }

  async function startAppium() {
    const opts = readAppiumForm();
    $('btn-appium-start').textContent = 'Starting…';
    setAppiumStarting('starting Appium');
    try {
      const r = await fetch('/api/appium/start', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      clearAppiumStarting();
      await refreshAppiumPill();
      showToast('Appium server is running on ' + opts.host + ':' + opts.port, 'success', { title: 'Appium started' });
    } catch (e) {
      clearAppiumStarting();
      $('appium-pill').className = 'pill down';
      $('appium-pill-label').textContent = 'not reachable on ' + opts.host + ':' + opts.port;
      $('btn-appium-start').disabled = false;
      $('btn-appium-start').textContent = 'Start Appium';
      showToast(e.message, 'error', { title: 'Failed to start Appium' });
    }
  }

  async function restartAppium() {
    const opts = readAppiumForm();
    const btn = $('btn-appium-restart');
    btn.textContent = 'Restarting…';
    setAppiumStarting('restarting Appium');
    try {
      const r = await fetch('/api/appium/restart', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      clearAppiumStarting();
      await refreshAppiumPill();
      showToast('Appium restarted on ' + opts.host + ':' + opts.port, 'success',
        { title: 'Appium restarted' });
    } catch (e) {
      clearAppiumStarting();
      $('appium-pill').className = 'pill down';
      $('appium-pill-label').textContent = 'not reachable on ' + opts.host + ':' + opts.port;
      showToast(e.message, 'error', { title: 'Failed to restart Appium' });
    } finally {
      btn.textContent = 'Restart Appium';
    }
  }


  async function doConnect() {
    const form = readFormCaps();
    const extras = readExtras();
    let body;
    if (isCloudMode()) {
      // Cloud: hand off the typed shape; server reuses the same provider
      // class the test runner does (see src/providers/index.ts).
      const extraCaps = {};
      for (const row of extras || []) {
        const k = String(row.key || '').trim();
        if (k) extraCaps[k] = row.value;
      }
      body = {
        cloud: {
          provider: connectionMode,
          user: ($('cloud-user').value || '').trim(),
          key: ($('cloud-key').value || '').trim(),
          platform: form.platform === 'iOS' ? 'ios' : 'android',
          deviceName: form.device,
          osVersion: form.version,
          appUrl: form.app,
          appBundleId: form.bundle,
          capabilities: extraCaps,
          projectName: 'taqwright-inspector',
        },
      };
    } else {
      body = { appium: readAppiumForm(), capabilities: buildCaps(form, extras) };
    }

    $('btn-connect').disabled = true;
    $('btn-connect').textContent = 'Connecting…';
    const targetLabel = isCloudMode()
      ? (connectionMode === 'browserstack' ? 'BrowserStack hub' : 'LambdaTest hub')
      : (body.appium.host + ':' + body.appium.port);
    // Let the user abort a slow connect. Aborting the fetch stops the client
    // waiting; the /api/connect/cancel POST tells the server to tear down any
    // session that still materializes (so it doesn't leak as "Running").
    const controller = new AbortController();
    let cancelled = false;
    showLoader(
      'Connecting to ' + targetLabel,
      'Opening a WebDriver session. Cloud sessions can take 30–90 s while the device is provisioned.',
      () => {
        cancelled = true;
        controller.abort();
        fetch('/api/connect/cancel', { method: 'POST' }).catch(() => {});
      },
    );
    try {
      const r = await fetch('/api/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      clearToasts();
      showLoader('Loading device screen…',
        'Capturing the screenshot and UI hierarchy from the device.');
      showView('inspector');
      await fetchSnapshot();
      startAutoRefresh();
      hideLoader();
      onInspectorReady();
    } catch (e) {
      hideLoader();
      // User-initiated cancel — return to setup quietly, no error toast.
      if (!cancelled && e.name !== 'AbortError') {
        showToast(e.message, 'error', { title: 'Connect failed' });
      }
    } finally {
      $('btn-connect').disabled = false;
      $('btn-connect').textContent = 'Connect →';
    }
  }

  // Disconnect handler (shown only when connected).
  $('btn-disconnect').onclick = async () => {
    const ok = await confirmModal({
      title: 'Disconnect session?',
      message: 'This ends the current device session and returns you to setup.',
      confirmLabel: 'Disconnect',
      icon: '🔌',
      danger: true,
    });
    if (!ok) return;
    stopAutoRefresh();
    applyRecordingState(false);
    stickyRelative = null;
    setStatus('disconnecting…', true);
    try {
      await fetch('/api/disconnect', { method: 'POST' });
    } catch {}
    state.selected = null;
    state.nodeMap.clear();
    showView('setup');
    await bootstrap();
  };

  // ─── Guided tour + Help panel ─────────────────────────────────
  // Spotlight coach-marks over the real controls + a static Help reference.
  // (No backticks anywhere in this block — the whole file is a template literal.)
  // Click a real inspector tab (used by the live inspector tour).
  function tourClickTab(name) {
    const t = document.querySelector('.tab[data-tab="' + name + '"]');
    if (t) t.click();
  }
  // Live tour only: the Locators / Attributes panels are empty until an element
  // is selected, so the tour would spotlight a blank panel. If the user hasn't
  // selected anything yet, auto-select a representative node (one with an id /
  // text / content-desc, else the first node) so those steps show real content.
  function tourEnsureSelection() {
    if (state.selected) return;
    let pick = null;
    for (const [, el] of state.nodeMap) {
      if (!el || !el.getAttribute) continue;
      if (
        el.getAttribute('resource-id') ||
        el.getAttribute('text') ||
        el.getAttribute('content-desc') ||
        el.getAttribute('name') ||
        el.getAttribute('label')
      ) {
        pick = el;
        break;
      }
    }
    if (!pick) {
      for (const [, el] of state.nodeMap) {
        pick = el;
        break;
      }
    }
    if (pick) selectElement(pick);
  }
  // Switch the demo stage's mock right-hand tab (Record / Script / Locators / Attributes).
  function showDemoTab(name) {
    ['rec', 'script', 'loc', 'attrs'].forEach((k) => {
      const pane = $('demo-' + k);
      if (pane) pane.classList.toggle('hidden', k !== name);
    });
    document.querySelectorAll('#demo-tabs .tab').forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-demo-tab') === name);
    });
  }
  const SETUP_TOUR = [
    { sel: null, title: 'Welcome to codegen',
      body: 'This quick tour shows how to <b>connect a device</b>, <b>record</b> your actions, and <b>export</b> a runnable test.<br>Use Next / Back or the ← → keys; press Esc to skip.' },
    { sel: '.conn-mode-toggle', title: 'Local or cloud',
      body: 'Choose <b>Local</b> for an emulator / simulator or USB device on this machine, or <b>Cloud</b> for BrowserStack / LambdaTest.' },
    { sel: '.card-env', before: function () { goToStep(1); }, title: 'Step 1 — Prerequisites',
      body: 'The <b>Environment</b> card runs a health check (adb, JDK, Android SDK, Appium drivers). Expand it to see any warnings.' },
    { sel: '.card-appium', before: function () { goToStep(1); }, title: 'Appium server',
      body: 'codegen talks to a local <b>Appium</b> server. If the pill is grey, click <b>Start Appium</b>; Next unlocks once it is green. (Cloud mode shows credentials here instead.)' },
    { sel: '#btn-devices-refresh', before: function () { goToStep(2); }, title: 'Step 2 — Pick a device',
      body: 'Switch the <b>Android / iOS</b> tabs and <b>↻ Refresh</b> the list. <b>Start</b> a shutdown emulator, or pick a running one / a cloud device.' },
    { sel: '#btn-app-browse', before: function () { goToStep(3); }, title: 'Step 3 — App & capabilities',
      body: 'Point at the app under test with <b>Browse…</b>, then tweak or <b>+ Add</b> Appium capabilities (<b>↺ Reset</b> restores config defaults).' },
    { sel: '#btn-connect', before: function () { goToStep(3); }, title: 'Connect',
      body: 'Hit <b>Connect →</b> to open the session and enter the inspector.' },
    { sel: null, title: 'You are set',
      body: 'Connect to start inspecting and recording. You can reopen this tour any time with <b>? Help</b> in the header.' },
  ];
  // LIVE inspector tour — spotlights the REAL panes (used when connected).
  const INSPECTOR_TOUR_LIVE = [
    { sel: null, title: 'The inspector',
      body: 'You are connected. This is where you inspect the UI, drive the device, and record a test.' },
    { sel: '.hier-mode-toggle', title: 'Hierarchy',
      body: 'Browse the UI tree as <b>Tree</b> or raw <b>XML</b>, and filter with the search box. Clicking a node selects it and highlights it on the screen — handy for small or overlapping elements.' },
    { sel: '#screen-host', title: 'Live screen',
      body: 'A live mirror of the device. <b>Click any element</b> to <b>select</b> it — then inspect its Attributes / Locators or record an action on it. (See the <b>ⓘ How to use</b> button above for more.)' },
    { sel: '.tabs', title: 'The four panels',
      body: '<b>Record</b> (capture actions), <b>Recorded script</b> (your test), <b>Locators</b> (ranked selectors), and <b>Attributes</b> for the selected element.' },
    { sel: '#btn-rec-toggle', before: function () { tourClickTab('record'); }, title: 'Record',
      body: 'Press <b>Start record</b>, select an element, then choose an action — Click, Type, Clear, gestures… The <b>Actions / Screen / Assertions</b> sub-tabs switch what you capture. Each step is appended live.' },
    { sel: '#tab-script', before: function () { tourClickTab('script'); }, title: 'Recorded script',
      body: 'Your test in <b>Taqwright</b> (runnable), or <b>Python</b> / <b>Java</b> (steps only). Use <b>⎘ Copy</b>, <b>↓ Export</b> (saves into your tests folder), or Clear.' },
    { sel: '#tab-locators', before: function () { tourEnsureSelection(); tourClickTab('locators'); }, title: 'Locators',
      body: 'Ranked, uniqueness-verified selectors for the selected element — id, accessibility id, UIAutomator / NSPredicate / Class Chain, xpath. The <b>recommended</b> pick is on top; click any to copy.' },
    { sel: '#tab-attrs', before: function () { tourEnsureSelection(); tourClickTab('attrs'); }, title: 'Attributes',
      body: 'The selected element\\'s full attribute set (resource-id, class, text, content-desc, bounds…) plus its xpath.' },
    { sel: '#btn-disconnect', before: function () { tourClickTab('record'); }, title: 'Done',
      body: 'When finished, <b>Disconnect</b> ends the session and returns to setup. Reopen this tour any time with <b>? Help</b>.' },
  ];
  // DEMO inspector tour — targets the mock #demo-stage (a Taqelah-demo login
  // screen) so the walkthrough has a realistic device to point at when NOT connected.
  const INSPECTOR_TOUR_DEMO = [
    { sel: null, title: 'The inspector (example)',
      body: 'This is a <b>demo</b> of the inspector using the Taqelah sample login screen — so you can see the layout before connecting a real device.' },
    { sel: '#demo-hier', before: function () { showDemoTab('rec'); }, title: 'Hierarchy',
      body: 'The UI element tree (this is a Jetpack Compose app, so nodes are <b>EditText</b> / <b>android.view.View</b>). Toggle <b>Tree</b> / raw <b>XML</b> and filter with the search box. Clicking a node selects it and highlights it on the screen.' },
    { sel: '#demo-screen', title: 'Live screen',
      body: 'A live mirror of the device — the Taqelah demo login. <b>Click any element</b> (here the <b>Username</b> field) to <b>select</b> it, then inspect its Attributes / Locators or record an action on it.' },
    { sel: '#demo-tabs', title: 'The four panels',
      body: '<b>Record</b> (capture actions), <b>Recorded script</b> (your test), <b>Locators</b> (ranked selectors), and <b>Attributes</b> for the selected element.' },
    { sel: '#demo-rec', before: function () { showDemoTab('rec'); }, title: 'Record',
      body: 'Press Start record, select an element, then choose an action — Click, Type, Clear, Long press, Scroll to, gestures… The <b>Actions / Screen / Assertions</b> sub-tabs switch what you capture. Each step is appended live.' },
    { sel: '#demo-script', before: function () { showDemoTab('script'); }, title: 'Recorded script',
      body: 'Your test in <b>Taqwright</b> (runnable), or <b>Python</b> / <b>Java</b> (steps only). Use <b>⎘ Copy</b>, <b>↓ Export</b> (saves into your tests folder), or Clear.' },
    { sel: '#demo-loc', before: function () { showDemoTab('loc'); }, title: 'Locators',
      body: 'Ranked, uniqueness-verified selectors for the selected element. This field has <b>no id</b>, so taqwright recommends a <b>hint-based xpath</b> — others (UIAutomator, plain xpath) are offered too. Click any to copy.' },
    { sel: '#demo-attrs', before: function () { showDemoTab('attrs'); }, title: 'Attributes',
      body: 'The selected element\\'s full attribute set (resource-id, class, text, content-desc, bounds…) plus its xpath.' },
    { sel: '#demo-disconnect', before: function () { showDemoTab('rec'); }, title: 'Done',
      body: 'On a real session, <b>Disconnect</b> ends it and returns to setup. Reopen this walkthrough any time with <b>? Help → Inspector tour</b>.' },
  ];

  let tourSteps = [];
  let tourIdx = 0;
  let tourActive = false;
  let tourOnDone = null;

  function tourSeen(key) {
    try {
      return !!localStorage.getItem(key);
    } catch {
      return true; // no storage → behave as already-seen (never nag)
    }
  }
  function markTourSeen(key) {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* ignore */
    }
  }

  function tourTarget(sel) {
    if (!sel) return null;
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null; // hidden / not laid out
    return el;
  }

  function startTour(steps, onDone) {
    if (tourActive || !steps || !steps.length) return;
    tourSteps = steps;
    tourOnDone = onDone || null;
    tourIdx = 0;
    tourActive = true;
    $('tour-overlay').classList.add('show');
    document.addEventListener('keydown', tourKey, true);
    window.addEventListener('resize', tourReposition);
    window.addEventListener('scroll', tourReposition, true);
    renderTourStep();
  }

  function endTour() {
    if (!tourActive) return;
    tourActive = false;
    $('tour-overlay').classList.remove('show');
    document.removeEventListener('keydown', tourKey, true);
    window.removeEventListener('resize', tourReposition);
    window.removeEventListener('scroll', tourReposition, true);
    const cb = tourOnDone;
    tourOnDone = null;
    if (cb) cb();
  }

  function renderTourStep() {
    const step = tourSteps[tourIdx];
    if (step.before) {
      try {
        step.before();
      } catch {
        /* navigation hook is best-effort */
      }
    }
    $('tour-title').textContent = step.title;
    $('tour-text').innerHTML = step.body;
    $('tour-progress').textContent = tourIdx + 1 + ' / ' + tourSteps.length;
    $('tour-back').disabled = tourIdx === 0;
    $('tour-next').textContent = tourIdx === tourSteps.length - 1 ? 'Done ✓' : 'Next →';
    const el = tourTarget(step.sel);
    if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
    positionTour();
  }

  function positionTour() {
    const step = tourSteps[tourIdx];
    const spot = $('tour-spotlight');
    const pop = $('tour-pop');
    const el = tourTarget(step.sel);
    if (!el) {
      // No (visible) target — show the popover centered, no spotlight.
      spot.style.display = 'none';
      pop.style.transform = 'translate(-50%, -50%)';
      pop.style.left = '50%';
      pop.style.top = '50%';
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    spot.style.display = 'block';
    spot.style.left = r.left - pad + 'px';
    spot.style.top = r.top - pad + 'px';
    spot.style.width = r.width + pad * 2 + 'px';
    spot.style.height = r.height + pad * 2 + 'px';
    pop.style.transform = 'none';
    const popW = pop.offsetWidth || 320;
    const popH = pop.offsetHeight || 170;
    const gap = 14;
    let top = r.bottom + gap;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - gap - popH);
    let left = r.left + r.width / 2 - popW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function tourReposition() {
    if (tourActive) positionTour();
  }
  function tourNext() {
    if (tourIdx >= tourSteps.length - 1) {
      endTour();
      return;
    }
    tourIdx++;
    renderTourStep();
  }
  function tourBack() {
    if (tourIdx > 0) {
      tourIdx--;
      renderTourStep();
    }
  }
  function tourKey(e) {
    if (!tourActive) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      endTour();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      tourNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      tourBack();
    }
  }

  function openHelp() {
    $('help-overlay').classList.add('show');
    document.addEventListener('keydown', helpKey, true);
  }
  function closeHelp() {
    $('help-overlay').classList.remove('show');
    document.removeEventListener('keydown', helpKey, true);
  }
  function helpKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeHelp();
    }
  }

  // First-run auto-start — called once the relevant page has finished loading
  // (so the spotlight never lands on a blank/loading area), not on a fixed timer.
  function maybeStartSetupTour() {
    if (tourActive || tourSeen('tw_tour_setup_seen')) return;
    if (!document.body.classList.contains('view-setup')) return;
    startTour(SETUP_TOUR, () => markTourSeen('tw_tour_setup_seen'));
  }
  // Called after the first device snapshot + tree have loaded (loader hidden).
  // First-timers get the inspector tour; everyone else gets a one-time screen
  // hint — never both at once.
  function onInspectorReady() {
    if (tourActive) return;
    if (!document.body.classList.contains('view-inspector')) return;
    if (!tourSeen('tw_tour_inspector_seen')) {
      startInspectorTour(() => markTourSeen('tw_tour_inspector_seen'));
    } else if (!tourSeen('tw_screen_hint_seen')) {
      openScreenHelp();
      markTourSeen('tw_screen_hint_seen');
    }
  }

  // The inspector tour runs against the mock #demo-stage (a Taqelah-demo login
  // screen) so it always has a realistic device to spotlight, connected or not.
  function showDemoStage() {
    const el = $('demo-stage');
    if (el) el.classList.add('show');
  }
  function hideDemoStage() {
    const el = $('demo-stage');
    if (el) el.classList.remove('show');
  }
  function startInspectorTour(onDone) {
    if (tourActive) return;
    // Connected → spotlight the REAL panes. Not connected → illustrate with the
    // mock demo device so there's still something to point at.
    if (document.body.classList.contains('view-inspector')) {
      startTour(INSPECTOR_TOUR_LIVE, onDone);
      return;
    }
    showDemoTab('rec');
    showDemoStage();
    startTour(INSPECTOR_TOUR_DEMO, function () {
      hideDemoStage();
      if (onDone) onDone();
    });
  }

  // ─── Screen "how to use" hint ─────────────────────────────────
  function openScreenHelp() {
    const el = $('screen-help-pop');
    if (el) el.classList.add('show');
  }
  function closeScreenHelp() {
    const el = $('screen-help-pop');
    if (el) el.classList.remove('show');
  }

  function initTutorial() {
    $('btn-help').onclick = openHelp;
    $('help-close').onclick = closeHelp;
    $('help-overlay').onclick = (e) => {
      if (e.target === $('help-overlay')) closeHelp();
    };
    $('help-tour-setup').onclick = () => {
      closeHelp();
      startTour(SETUP_TOUR);
    };
    $('help-tour-inspector').onclick = () => {
      closeHelp();
      startInspectorTour();
    };
    $('tour-next').onclick = tourNext;
    $('tour-back').onclick = tourBack;
    $('tour-skip').onclick = endTour;
    // Screen-pane help affordance.
    const shBtn = $('screen-help-btn');
    if (shBtn)
      shBtn.onclick = () => {
        const el = $('screen-help-pop');
        if (el && el.classList.contains('show')) closeScreenHelp();
        else openScreenHelp();
      };
    const shClose = $('screen-help-close');
    if (shClose) shClose.onclick = closeScreenHelp;
    const shOk = $('screen-help-ok2');
    if (shOk) shOk.onclick = closeScreenHelp;
  }

  initTutorial();
  bootstrap();
})();
</script>
</body>
</html>
`;
