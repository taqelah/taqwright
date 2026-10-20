# Roadmap

This is a living document of what taqwright ships today and what's next. Items within each theme are roughly prioritized top-to-bottom. Have a feature request? [Open an issue](https://github.com/taqelah/taqwright/issues/new/choose).

**Status key**

- **In Progress**: actively being built.
- **Planned**: committed; design is understood.
- **Exploring**: we want it, but scope or feasibility is still open. Not a commitment.

## What's included today

The [README](README.md#api-reference) has the full API.

| Feature                           | Example                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ✅ Android & iOS                  | One API for both, driven by Appium 3 over WebDriver                                                                    |
| ✅ Native, React Native & Flutter | The same spec runs against any of them                                                                                 |
| ✅ Playwright Test runner         | `test.step()`, `test.describe.serial()`, fixtures, `--shard`, `list` / `html` / `json` / `blob` reporters              |
| ✅ Locator API                    | `getByRole()`, `getByText()`, `getByLabel()`, `getByTestId()`, plus xpath / UiAutomator / NSPredicate / class chain    |
| ✅ Touch interactions             | `tap()`, `doubleTap()`, `longPress()`, `fill()`, `dragAndDrop()`, `pinchIn()`, `scrollIntoView()`                      |
| ✅ Locator assertions             | `toBeVisible()`, `toBeEnabled()`, `toBeChecked()`, `toHaveText()`, `toHaveValue()`, `toHaveCount()`, … (auto-retrying) |
| ✅ App lifecycle                  | `launchApp()`, `terminateApp()`, `installApp()`, `uninstallApp()`, `backgroundApp()`, `queryAppState()`                |
| ✅ Device control                 | `setOrientation()`, `setLocation()`, `setLocale()`, `openDeepLink()`, clipboard, `pushFile()` / `pullFile()`, alerts   |
| ✅ WebView                        | `switchToWebView()` / `switchToNative()`                                                                               |
| ✅ Traces                         | Per-action timeline with screenshots, attached to the HTML report: `use.trace: 'on-failure'`                           |
| ✅ Video recording                | `use.video: 'on' \| 'on-failure' \| 'retain-on-failure'`                                                               |
| ✅ Network capture                | HTTPS traffic recorded to `.har` per test: `use.network: 'on-failure'`                                                 |
| ✅ Device logs                    | `getDeviceLogs('logcat' \| 'syslog' \| 'crashlog')`                                                                    |
| ✅ Parallel device pools          | `device.pool` or `device.autoDiscover`; a dedicated Appium session per worker                                          |
| ✅ Cloud devices                  | BrowserStack, LambdaTest, Digital.ai Testing, pCloudy                                                                  |
| ✅ Inspector & codegen            | `taqwright inspect` / `taqwright codegen`: live hierarchy, ranked locators, recorded tests                             |
| ✅ CLI                            | `test`, `show-report`, `merge-reports`, `init`, `install`, `devices`, `doctor`, `inspect`, `codegen`                   |

## What's coming

### Reliability

| Feature                    | Description                                                                                                                                                                 | Status  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Disable Animations**     | Turn off system and app animations before a run for faster, less flaky execution.                                                                                           | Planned |
| **Crash Detection**        | Fail the test when the app under test crashes, and attach the crash report to the test result.                                                                              | Planned |
| **Per-file Session Scope** | Opt in to sharing one device session across the serial tests in a spec file, instead of a fresh session per test ([#124](https://github.com/taqelah/taqwright/issues/124)). | Planned |

### Network

| Feature                  | Description                                                                                                                             | Status  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Network Interception** | Stub, modify, or block HTTP/HTTPS requests in flight to test error states without a live backend. Builds on the existing capture proxy. | Planned |
| **Network Conditioning** | Simulate throttled or degraded networks (slow 3G, high latency, packet loss, offline) to test loading and retry behavior.               | Planned |

### Device control

| Feature                    | Description                                                                                                             | Status    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------- |
| **iOS Permissions**        | `setPermission()` on iOS (camera, location, photos, notifications, …), matching the Android support that already ships. | Planned   |
| **App Launch Options**     | Launch the app with custom arguments and environment variables, without modifying the binary.                           | Planned   |
| **Device Settings**        | Prepare system settings before a test: dark mode, font size, high contrast.                                             | Planned   |
| **Timezone**               | Set the device timezone to verify date/time rendering and timezone-dependent logic.                                     | Planned   |
| **Biometrics**             | Enroll a biometric and match or reject Face ID / Touch ID / fingerprint prompts (simulators and emulators).             | Planned   |
| **Push Notifications**     | Deliver a push notification to the app and assert on or interact with the banner.                                       | Planned   |
| **Media Import**           | Seed the photo library with images and videos before a test, for flows that pick existing media.                        | Planned   |
| **Shake Gesture**          | Trigger a device shake, for apps that use it for undo, bug reporting, or debug menus.                                   | Planned   |
| **GPS Route Replay**       | Replay a route of coordinates for location-aware flows. A fixed location already ships as `setLocation()`.              | Exploring |
| **Camera Injection**       | Mock the image or video returned by the system camera during a test.                                                    | Exploring |
| **Apple Pay / Google Pay** | Drive the system payment sheet in a sandbox environment to test wallet checkout flows.                                  | Exploring |

### Assertions

| Feature                          | Description                                                                                                                                 | Status  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Visual Screenshot Comparison** | `expect(locator).toHaveScreenshot()` / `expect(mobile).toHaveScreenshot()`: pixel diffing against stored baselines to catch UI regressions. | Planned |

### Tooling & AI

| Feature           | Description                                                                                                | Status  |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| **taqwright MCP** | MCP server exposing taqwright's device control, inspector, and codegen to AI agents and coding assistants. | Planned |

### Cloud

| Feature                        | Description                                                                           | Status    |
| ------------------------------ | ------------------------------------------------------------------------------------- | --------- |
| **Additional Cloud Providers** | More device grids behind the same `provider` config (Sauce Labs, AWS Device Farm, …). | Exploring |
