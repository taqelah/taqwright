# TODO — Mobile network capture for LIME

Port taqwright's MITM network-capture engine (`src/network/`) into the LIME projects so device HTTP/HTTPS traffic can be intercepted and shown live.

Full plan: `~/.claude/plans/serene-dreaming-bentley.md`

Work happens in two repos (not this one):

- `lime-agent/` — engine port + capture lifecycle (Steps 1–5)
- `lime/` — server relay + UI (Steps 6–7)

Source being copied from: this repo's `src/network/`.

---

- [ ] **Step 1 — Port engine into lime-agent (ESM/TS → CJS).**
      Create `lime-agent/src/network/{proxy,ca,har,android,ios-sim,host-proxy,index}.js` copied from `taqwright/src/network/`. Convert imports→`require` (drop `.js`), strip TS types, `module.exports`. In `index.js` replace the `Platform` enum with string literals `'android'`/`'ios'`. Rename CA dir `~/.taqwright/network-ca`→`~/.lime/network-ca`, HAR `creator`→`'LIME'`. Add `"node-forge": "^1.3.1"` to lime-agent `dependencies`.

- [ ] **Step 2 — Live per-entry streaming.**
      Add `onEntry` callback to `createHarBuilder` (fire on response + error) → thread through `startProxy` → `prepareNetworkProxy`. Flat `NETWORK_ENTRY` payload: `{ id, startedDateTime, time, method, url, status, statusText, mimeType, reqBodySize, resBodySize, reqBodyText?, resBodyText? (omit >~64 KiB), error? }`. Full HAR via `flush()`/`GET_NETWORK_HAR`.

- [ ] **Step 3 — Real-device support (v1).**
      `localLanIp()` in `lime-agent/src/agent/platform.js`. Parameterize `startProxy` with `bindHost` (default `127.0.0.1`); real device → second `0.0.0.0` listener scoped to active session, bind down on teardown. `configureDeviceForCapture` real-device branch: no auto CA-push, return `{ realDevice:true, hostIp, port, certPem }`.

- [ ] **Step 4 — lime-agent lifecycle.**
      New `network-capture-manager.js` (enable/disable/getHar/clear singleton) + `handlers/network-handlers.js`; wire cases into `message-router.js`; call `disable()` on shutdown/WS close.

- [ ] **Step 5 — Protocol.**
      Add `ENABLE_NETWORK_CAPTURE`, `DISABLE_NETWORK_CAPTURE`, `GET_NETWORK_HAR`, `NETWORK_CLEAR` (round-trips) + `NETWORK_ENTRY` (unsolicited push, no requestId) to `lime-agent/src/protocol.js`; fold real-device info into enable `:result`. Run `npm run sync` to regenerate `lime/src/protocol.js`.

- [ ] **Step 6 — Server relay (lime).**
      Trigger enable/disable from `device.js` `/api/connect` + `/api/disconnect` (opt-in `networkCaptureEnabled`). Forward `NETWORK_ENTRY` → per-user SSE in `agent-ws.js` (new `networkStreams` Map in `context.js`). Endpoints: `GET /api/network/stream`, `POST /api/network/start|stop|clear`, `GET /api/network/har`, `GET /api/network/ca.pem`. Pass-through, no DB table in v1.

- [ ] **Step 7 — UI (Network tab).**
      In `lime/src/ui/codegen.js` add a live Network tab (streaming table, row expander, Start/Stop, Clear, Export HAR, real-device panel with cert download + setup instructions). Update `codegen.css`, bump `codegen.html` cache-bust, add `api-client.js` helpers, opt-in `networkCaptureEnabled` in `settings-service.js` + connect dialog.

- [ ] **Verification.**
      Android userdebug AVD (auto CA + proxy, decrypted HTTPS bodies, HAR opens in DevTools, proxy cleared on disconnect); iOS Simulator (host proxy + simctl keychain, HTTP/2 blind-tunnel); real device manual path (cert download, Wi-Fi proxy, pinned-host blind-tunnel); crash-restore of macOS host proxy on `kill -9`.
