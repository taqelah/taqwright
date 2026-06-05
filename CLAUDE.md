# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is the **taqwright library itself** — an E2E mobile testing layer that puts Playwright's runner on top of Appium 3 / WebDriver. Appium 3.x is the supported runtime; 2.x is allowed on a best-effort basis because every `mobile:` command shape is identical between the two majors (`doctor` warns rather than errors). If you add code that uses an Appium 3-only command, branch on `classifyAppiumVersion()` from [src/doctor.ts](src/doctor.ts) and surface a clear message — don't let users on 2.x hit cryptic server errors. Published privately to GitHub Packages (`npm.pkg.github.com`) as `@taqwright/taqwright`; ships a CLI (`bin: taqwright → dist/bin/index.js` — the command name stays `taqwright` even though the package is scoped). The README is the canonical user-facing docs; this file is for working _on_ the library.

There is no `tests/`, `pages/`, or `fixtures/` directory in this repo — those belong to projects _consuming_ taqwright (the library's own unit tests live in `test/`, singular — see Common commands). `tsconfig.json` deliberately excludes those consumer paths so a misplaced project in a monorepo isn't pulled into the lib build.

## Common commands

```bash
npm install
npm run build      # tsc --build → dist/  (also serves as the typecheck)
npm run clean      # tsc --build --clean
```

There is **no separate `typecheck` script** — `npm run build` is the typecheck. Linting (ESLint, flat config in [eslint.config.js](eslint.config.js)) and formatting (Prettier, [.prettierrc.json](.prettierrc.json)) are their own scripts:

```bash
npm run lint            # eslint .
npm run lint:fix        # eslint . --fix
npm run format          # prettier --write .  (rewrites files)
npm run format:check    # prettier --check .  (CI-safe, no writes)
```

In-repo unit tests live in `test/`, run with Node's built-in runner:

```bash
npm test                # npm run build && node --test test/*.test.js
npm run test:coverage   # same, with --experimental-test-coverage
npm run test:watch
```

**Before pushing, run these locally and make them green first** — the same three gates run in CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)), so a push that skips them just fails remotely:

```bash
npm run format:check    # or `npm run format` to auto-fix, then re-check
npm run lint
npm test                # builds (typecheck) + runs the unit suite
```

[src/inspector/ui.ts](src/inspector/ui.ts) is exempt from Prettier ([.prettierignore](.prettierignore)) — it's one giant template literal; format it by hand per the inspector-UI rules below.

Tests use `node:test` + `node:assert/strict` and import the compiled **`dist/`** output, so the build must run first (`npm test` does it; `dist/` is gitignored). Pure-logic modules (config, capabilities, doctor, recorder, locator-suggester, providers) are tested directly; device-driving code is tested by injecting a hand-rolled fake WebDriver `driver` — see `makeFakeDriver` / `makeLocator` / `makeMobile` in [test/fake-driver.js](test/fake-driver.js). Code needing a real device/network/HTTP layer (most `Mobile`/`Locator` methods, the inspector HTTP handler, `runDoctorChecks`, cloud providers, CLI spawn) is intentionally not unit-covered. Unrelated: `npx taqwright test` is the runner for _consumer_ projects with their own `taqwright.config.ts` — it fails in this repo (no config).

ESM-only (`"type": "module"`, NodeNext). All relative imports inside `src/` must include the `.js` extension even though the sources are `.ts` — NodeNext requires it.

## Architecture

### The config-embedding trick ([src/config.ts](src/config.ts))

`defineConfig(TaqwrightConfig)` does **not** return a TaqwrightConfig — it returns a Playwright `TestConfig` with the taqwright shape stashed under a private symbol key (`TAQWRIGHT_KEY = '__taqwright__'`). This lets users pass `taqwright.config.ts` directly to Playwright's `--config` flag.

Critically, the per-project Playwright `use` block intentionally **does not** carry the taqwright `use` options — only `{ taqwrightProject: name }`. The fixture re-reads the user's config from disk at runtime (`loadTaqwrightConfig()`) using that project name as a key. Don't try to forward taqwright use-options through Playwright's `use` field; serializing `RegExp` device names and other rich types across the worker boundary won't work.

### CLI shape ([src/bin/index.ts](src/bin/index.ts))

The CLI splits into delegators and direct commands:

- **Delegators** — `taqwright test` and `taqwright show-report` locate the user's `taqwright.config.ts` (`findConfigFile()`), then `spawn` Playwright's own `cli.js` (resolved out of `node_modules`). For `test`: `test --config <path>` plus forwarded flags (`--list`, `--shard`, `--reporter`, …); unknown flags are forwarded too (`allowUnknownOption(true)`). Before spawning, `maybeAutoStartAppium(configPath)` ([src/auto-appium.ts](src/auto-appium.ts)) probes the configured Appium endpoint and spawns `npx appium` if `appium.autoStart === true` and nothing is listening; the spawned process is killed on exit.
- **Direct commands**:
  - `init [dir]` — interactive scaffolder ([src/bin/init.ts](src/bin/init.ts)). Detects whether `taqwright` is `npm link`-ed globally and runs `npm link taqwright` instead of fetching from the registry.
  - `inspect` / `codegen` — boots the inspector HTTP server ([src/bin/inspect.ts](src/bin/inspect.ts) → [src/inspector/server.ts](src/inspector/server.ts)). `codegen` is `inspect --record` and sets `defaults.recordOnConnect`, which makes `session.connect()` flip recording on the moment the WebDriver session is up.
  - `devices` — `adb devices -l` + `xcrun simctl list devices available`.
  - `doctor` — runs `runDoctorChecks()` from [src/doctor.ts](src/doctor.ts) (shared with the inspector's setup view).

### Fixture lifecycle ([src/fixture/index.ts](src/fixture/index.ts))

Four fixtures, layered:

1. **`taqwrightUse`** (worker-scoped) — loads the user's config and resolves the active project's `use` options. The worker scope is deliberate: one Appium session per worker is the model.
2. **`deviceProvider`** (worker-scoped) — `null` for local/emulator (the inline `appiumRemoteOptions` path). For cloud (`isCloudProvider`), builds the provider via `createDeviceProvider()` and runs its one-time `globalSetup()` (creds check + build upload) **once per worker**, then yields the provider instance. No teardown — cloud session lifecycle is per-test in `rawDriver`.
3. **`rawDriver`** (test-scoped) — local: opens a fresh `webdriver` session against Appium with capabilities built by `buildCapabilities()` (always `appium:noReset: true` — the fixture does reset, not Appium). Cloud: calls `deviceProvider.getDevice()` (the provider bakes in the https hub + creds) and in its `finally` calls `syncTestDetails({status,reason,name})` then `deleteSession()`. Yields `WebDriverClient` either way (public escape-hatch contract preserved). Teardown order is `mobile → rawDriver`, so `rawDriver`'s teardown runs last with `testInfo.status` settled and syncs the dashboard before the session is deleted, on the same worker-scoped provider instance — mirrors the inspector's `connectCloud()` / `disconnect()`.
4. **`mobile`** (test-scoped) — when `resetBetweenTests: true` **and not cloud**, runs `mobile: terminateApp → removeApp → installApp → activateApp` via `rawDriver.executeScript(...)` (the first two `.catch(() => {})` because the app may not be installed yet). Then wraps the driver in `Mobile.wrap(...)`. Cloud skips the on-device reset dance (build lives behind a `bs://`/`lt://` URL) and skips taqwright's own `startRecordingScreen` (the provider records server-side); the trace artifact still generates on cloud.

The TypeScript type for `TaqwrightUseOptions` ([src/types/index.ts](src/types/index.ts)) is a discriminated union that **forces** `buildPath` and `appBundleId` when `resetBetweenTests: true` — don't add fallbacks for those at runtime; the type system is the contract.

### Inspector ([src/inspector/](src/inspector/))

The inspector is a localhost HTTP server + single inlined HTML page. Boot path: `taqwright inspect` → [src/bin/inspect.ts](src/bin/inspect.ts) → `startInspectorServer()` in [src/inspector/server.ts](src/inspector/server.ts). The whole UI is one big template literal in [src/inspector/ui.ts](src/inspector/ui.ts) (~3700 LoC of HTML+CSS+inline `<script>`) — no bundler, no asset pipeline, no SSR. The single static asset (the logo) is copied to `dist/images/` by [scripts/copy-assets.mjs](scripts/copy-assets.mjs) at build time.

Stateful pieces:

- **`InspectorSession`** ([src/inspector/session.ts](src/inspector/session.ts)) — single instance per server, holds the optional `WebDriver` client, the optional spawned Appium child, the active provider (cloud only), and the `Recorder`. The HTTP server reads/writes this object directly; there's no DI.
- **`Recorder`** ([src/inspector/recorder.ts](src/inspector/recorder.ts)) — discriminated-union `RecordedAction` (tap, swipe, locatorClick, locatorFill, sendKeys, assertVisible, … ~25 kinds). `renderAction` produces the `await mobile.…` / `await locator.…` source line. `toSpec()` wraps the actions into a runnable `import { test, expect } from 'taqwright'; test('recorded test', …)` file.
- **Locator suggester** ([src/inspector/locator-suggester.ts](src/inspector/locator-suggester.ts)) — generates ranked candidates per category (`id`, `uiautomator`, `predicate`, `classChain`, `xpath`) for an element's attributes. Display order is platform-specific: Android `id → uiautomator → xpath`; iOS `id → predicate → classChain → xpath`. The server verifies each candidate's uniqueness against the live device before returning. Multiline attribute values use `contains(@key, firstLine)` instead of strict `=` because Appium's xpath engine has historically handled literal `\n` inconsistently across driver versions; the `contains` form is robust.

The `/api/...` endpoints live in [src/inspector/server.ts](src/inspector/server.ts); the most load-bearing ones: `GET /api/snapshot` (screenshot + page-source + window rect in parallel), `POST /api/locator-action` (drives the device for a recorded action and pushes to the `Recorder`), `POST /api/connect` / `/api/disconnect`, and the cloud endpoints `GET /api/cloud/env`, `POST /api/cloud/devices`.

### Provider layer

[src/providers/](src/providers/) has four implementations: `emulator`, `local`, `browserstack`, `lambdatest`, plus the `createDeviceProvider(use, projectName)` factory in [src/providers/index.ts](src/providers/index.ts). The interface is in [src/types/index.ts](src/types/index.ts): `globalSetup?()`, `getDevice()` → `DeviceHandle`, `syncTestDetails?({status,reason,name})`.

Two consumers, same pattern — both route cloud through `createDeviceProvider` so caps, app upload, and status reporting stay identical; `isCloudProvider()` ([src/providers/index.ts](src/providers/index.ts)) is the single source of truth for "is this a cloud grid":

1. **Test runner fixture** ([src/fixture/index.ts](src/fixture/index.ts)) — `isCloudProvider()` splits the path. Local/emulator: capabilities built inline via `buildCapabilities()` ([src/capabilities.ts](src/capabilities.ts)), `WebDriver.newSession(appiumRemoteOptions(...))`. Cloud (`browserstack`/`lambdatest`): the worker-scoped `deviceProvider` fixture runs `createDeviceProvider()` → `globalSetup()` **once per worker** (app upload — each Playwright worker is its own process, so N workers = N uploads unless `buildPath` is already a `bs://`/`lt://` URL; a true once-global upload would need Playwright's config `globalSetup` hook). The test-scoped `rawDriver` calls `getDevice()` for a **fresh session per test**, then on teardown `syncTestDetails({status,reason,name})` (from `testInfo`) **before** `deleteSession()`. Creds are read from ambient `process.env.*USERNAME/ACCESS_KEY` (CI convention — no config field); `globalSetup()` throws clearly if absent. The `mobile` reset block (manual `terminateApp/removeApp/installApp/activateApp`) is **skipped for cloud** — the per-test session + `appium:fullReset:true` already gives a clean install, and `installApp` can't take a host-local path or a `bs://`/`lt://` URL. taqwright's own `startRecordingScreen` is also skipped on cloud (`videoOn && !isCloud`) — the provider records server-side, so the iOS `videoType:'libx264'` path stays local-only. `maybeAutoStartAppium` skips cloud projects so a stray `appium.autoStart` never spawns a useless local server. Don't duplicate caps construction inline for cloud; let the provider build them.
2. **Inspector cloud connect** ([src/inspector/session.ts](src/inspector/session.ts) `connectCloud()`) — same factory, payload-driven. The browser sends a `{ cloud: { provider, user, key, deviceName, osVersion, appUrl, … } }` payload; the server sets the provider's required `process.env.*USERNAME/ACCESS_KEY` from the payload (the runner instead inherits them from the shell), builds a `TaqwrightUseOptions`, calls `createDeviceProvider(use, 'inspector')` → `globalSetup()` → `getDevice()`, and stores the returned `DeviceProvider` instance in `session.activeProvider`. On disconnect, `activeProvider.syncTestDetails({status:'passed', …})` marks the dashboard status before `deleteSession()` so cloud sessions don't sit "Running" until idle-timeout.

Both mirror the same sequence (`createDeviceProvider` → `globalSetup` → `getDevice` → use `handle.driver` → `syncTestDetails` → `deleteSession`), no inline caps duplication. The runner difference: provider/`globalSetup` is worker-scoped (build uploaded once per worker; per-process env-var state, so a config-level Playwright `globalSetup` wouldn't reach worker processes), while the session + sync + delete are per-test.

`src/providers/appium.ts` contains side-effecty helpers (start Appium server with `npx appium`, boot emulator, parse APK with `aapt`). The Appium-spawn helper is also used by [src/auto-appium.ts](src/auto-appium.ts), which is invoked by both the test runner CLI (`taqwright test`) and the inspector's `Start Appium` button.

### Mobile / Locator surface

[src/mobile/index.ts](src/mobile/index.ts) (~1000 LoC) exposes a **flat** API: `mobile.getByText(...)`, `mobile.swipe(...)`, `mobile.installApp(...)` — no nested `mobile.screen.*`. Adding nesting would be a breaking change to the documented ergonomic. `mobile.raw` is the escape hatch back to the underlying `webdriver` `Client`.

[src/locator/index.ts](src/locator/index.ts) (~900 LoC) is lazy: a `Locator` resolves the element on each action. Locator strategies (`LocatorStrategy.using`) map directly to WebDriver locator strategies; some are platform-restricted (`-android uiautomator` throws on iOS, `-ios predicate string` / `-ios class chain` throw on Android — enforced in `getByUiSelector` / `getByPredicate` / `getByClassChain`).

Assertion methods (`assertVisible`, `assertHidden`, `assertEnabled`, `assertDisabled`, `assertText`, `assertContainsText`, `assertValue`, …) are on the `Locator` class itself — they are the auto-retrying engine and stay public. The Playwright-style `expect(locator).toBeVisible()` surface ([src/expect.ts](src/expect.ts)) is a **standalone wrapper, not `expect.extend`**: `expect(x)` returns taqwright matchers when `x instanceof Locator` (each delegating to the matching `assert*`), else falls through to Playwright's real `expect` so value assertions and `expect.soft/poll/configure` are unchanged. `expect.extend` is still avoided on purpose — Playwright dispatches its built-in matchers by name against its hardcoded browser `Locator`, so extending its registry for a non-Playwright Locator misfires; a separate wrapper has no such collision. The recorder emits the `await expect(locator).toBeVisible()` form. Public export wiring: `expect` comes from [src/index.ts](src/index.ts) via `src/expect.ts` (not the fixture); `src/expect.ts` maps only the Playwright matchers meaningful on a native element — web-only ones (`toHaveCSS`, `toHaveScreenshot`, …) and `.not` on non-paired matchers throw a clear error rather than misfire.

Cloud-provider parameter naming: `mobile: pinch`, `mobile: scroll`, `mobile: swipe` on iOS XCUITest expect `elementId` (not `element`), matching their Android counterparts. iOS `mobile: pinch` is also unreliable on apps without an attached pinch recognizer — the pinch helpers fall back to a synthesized two-finger W3C pointer gesture.

### Serial-by-default

Workers default to `1` (serial) and `fullyParallel: false`. Single Appium + single device is the common case; multiple workers against the same device collide. To parallelize, the user declares `project.use.device.pool: [{udid, ...}, ...]` and sets `workers`. **`workers` is resolved per-project**: `effectiveWorkers(project, config) = project.workers ?? config.workers ?? 1` ([src/config.ts](src/config.ts)) is the single source of truth, so a project can set its own `workers` while the top-level `config.workers` is just a fallback default. Because Playwright's worker pool is _global_ (no native per-project cap), `defineConfig` sizes Playwright's `workers` to `Math.max(...)` of every project's effective workers, and the `taqwright test` CLI injects `--workers <n>` for the resolved single project (`resolveCliWorkers` — a lone `--project`, or the sole project when unfiltered; ambiguous multi-project runs are left on the global max, and an explicit `--workers` always wins) so the shared pool matches the one project being run — the **one-project-per-run** path. Plain `playwright test` across multiple differently-sized projects is the documented exception, caught by the fixture guard below. The `taqwrightUse` worker fixture reads `workerInfo.parallelIndex`, picks `pool[idx]`, spawns its own Appium on `basePort + idx`, and stamps unique `appium:systemPort` / `appium:wdaLocalPort` / `appium:chromedriverPort` / `appium:mjpegServerPort` so concurrent UiAutomator2 / XCUITest sessions don't fight over driver ports. Worker `idx >= pool.length` throws "no device — pool has N entries" so we never silently double-book. `defineConfig` also fails fast at config load via `findParallelMisconfig` ([src/config.ts](src/config.ts)): each emulator/local-device project whose **own** effective workers `> 1` must have a `device.pool` of `>= effectiveWorkers` entries, else it throws before tests start naming that project; the runtime fixture guard stays as defense-in-depth (cloud providers are exempt — they have no `pool`; `workers: N` on a cloud project legitimately fans out N independent cloud sessions, no pool needed). The CLI's `maybeAutoStartAppium` skips its single-shot pre-spawn when any project has a pool (the worker fixtures own that lifecycle then) and also skips cloud-provider projects (`isCloudProvider`) so a stray `appium.autoStart` never spawns a pointless local Appium for a grid run.

`device.autoDiscover: true` is the hand-written-pool alternative: taqwright resolves the per-worker device set itself. Because cold-booting AVDs/sims is a stateful must-happen-once op (per-worker discovery would race — a booting emulator mutates `listDevices()` output mid-run), the resolution runs in a taqwright-owned Playwright `globalSetup` injected by `defineConfig` ([src/discovery-setup.ts](src/discovery-setup.ts)) — only when ≥1 project opts in, and prepended to the user's own `globalSetup`. It discovers via `listDevices()`, fails fast (`selectDevicePool` in [src/discovery.ts](src/discovery.ts)) when fewer devices than `workers`, pre-boots assigned iOS sims (Android boot is delegated to Appium per worker via `appium:avd`), then publishes a frozen `DevicePoolEntry[]` per project into `process.env[TAQWRIGHT_RESOLVED_POOL__<name>]`. The `taqwrightUse` fixture hydrates `pool` from that env var and runs the **same** partition path as a hand-written pool. `findAutoDiscoverMisconfig` ([src/config.ts](src/config.ts)) enforces it's mutually exclusive with `pool`/`udid`, local-providers-only, not `local-device`+iOS (no multi-UDID physical-iOS enumerator), and not with `appium.autoStartDevice: false`; auto-discover projects are exempted from `findParallelMisconfig` / `findAutoStartDeviceMisconfig` (pool + AVD names resolved at runtime). The pure logic (`toAssignableSlots` stable-sorts by AVD name / sim udid; `selectDevicePool`) is unit-tested against `DeviceListing` literals in [test/discovery.test.js](test/discovery.test.js); the adb/emulator/simctl IO wrappers are not.

### Working on the inspector UI

The entire inspector UI lives inside one `INSPECTOR_HTML` template literal in [src/inspector/ui.ts](src/inspector/ui.ts). Two pitfalls that bite repeatedly:

1. **Backticks in inline JS** — JSDoc comments or string literals containing a backtick close the outer template literal and the file no longer parses. Use plain `//` comments inside the inline `<script>`, never JSDoc with backticks.
2. **Escape sequences** — `'\n'`, `'\t'`, `'\\'` etc. inside the inline JS get processed by the _outer_ template literal at TS compile time, so `s.split('\n')` ends up as a literal newline closing the string at runtime. Double-escape: `s.split('\\n')` in source compiles to `s.split('\n')` at runtime. Same for regex character classes — `/^-?\\d+$/` in source.

After any non-trivial inline-JS change, validate by extracting and `node --check`-ing the rendered script — `tsc` compiles a template literal that produces broken runtime JS without complaining:

```bash
npm run build
node -e "
const m = require('./dist/inspector/ui.js');
const s = [...m.INSPECTOR_HTML.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
require('fs').writeFileSync('/tmp/inline.js', s[0][1]);
" && node --check /tmp/inline.js
```
