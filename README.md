<h1 align="center">
  <img src="src/images/taqwright_logo.png" alt="Taqwright logo" width="120" />
  <br />
  Taqwright
</h1>

<p align="center">
  <a href="https://github.com/taqelah/taqwright/tags"><img src="https://img.shields.io/badge/version-0.0.27-blue" alt="version" /></a>
  <a href="https://www.npmjs.com/package/@taqwright/taqwright"><img src="https://img.shields.io/npm/dw/@taqwright/taqwright" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue" alt="License: Apache 2.0" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.4%2B-blue?logo=typescript&logoColor=white" alt="TypeScript 5.4+" /></a>
</p>

E2E mobile UI testing on the Playwright runner, with a flat locator API on top of Appium 3.

```ts
import { test, expect } from '@taqwright/taqwright';

test('User can login', async ({ mobile }) => {
  await mobile.getByLabel('Username').fill('admin');
  await mobile.getByLabel('Password').fill('password');
  await mobile.getByText('Login').click();
  await expect(mobile.getByText('Welcome')).toBeVisible();
});
```

> 📚 **Full documentation: [taqwright.dev/docs](https://www.taqwright.dev/docs/category/getting-started)** — install taqwright, write and generate tests, run and debug them, and scale out in parallel.

## Why Taqwright?

If you've used Playwright, you already know Taqwright.

|                          | Taqwright                                                                            | Mobilewright                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **API style**            | Playwright (`getByRole`, `expect`)                                                   | Playwright (`getByRole`, `expect`)                                                                                   |
| **Auto-wait**            | Built-in, every action                                                               | Built-in, every action                                                                                               |
| **Cross-platform**       | iOS + Android, one API                                                               | iOS + Android, one API                                                                                               |
| **Test runner**          | Playwright Test fixtures                                                             | Playwright Test fixtures                                                                                             |
| **Automation engine**    | Appium 3 / WebDriver                                                                 | mobilecli (custom)                                                                                                   |
| **Codegen tool**         | Yes (built-in `codegen`)                                                             | No                                                                                                                   |
| **AI / agents**          | AI test generation — [Taqwright Lime CLI](https://www.taqwright.ai/), Appium MCP     | Depends on accessibility ids — no xpath/platform fallback, so legacy apps without accessibility metadata are limited |
| **Real devices (cloud)** | BrowserStack, LambdaTest — and support for all your favourite cloud device platforms | Vendor-locked to mobile-use.com                                                                                      |
| **Locators**             | Roles / labels + id / xpath / UiAutomator / predicate / class-chain                  | Roles / labels                                                                                                       |

## Requirements

- Node.js **24.x or 25.x** (Node 26+ has a known bug).
- A booted Android emulator, iOS simulator, or connected device.
- [Appium 3.x](https://appium.io) (`npm i -g appium@^3`) running on `localhost:4723`, with the relevant driver installed:
  - Android: `appium driver install uiautomator2`
  - iOS: `appium driver install xcuitest`
- Platform tools on `PATH`: `adb` (Android), `xcrun` (iOS, macOS only), `java` (UiAutomator2).

## Install

taqwright is published on npm:

```bash
npm install --save-dev @taqwright/taqwright
```

In `package.json` it looks like:

```json
"devDependencies": {
  "@taqwright/taqwright": "^0.0.25"
}
```

The package imports as `@taqwright/taqwright` and the CLI command is `taqwright`.

## Quick start

```bash
npx taqwright init               # interactive scaffolder — creates package.json, tsconfig, sample test
npx taqwright doctor             # verify your env (adb, xcrun, java, appium)
npx taqwright devices            # list local emulators / simulators
npx taqwright codegen            # record a test as you tap through the app (Playwright-codegen-style)
npx taqwright test               # run your tests
```

## Configure

Create `taqwright.config.ts` at your project root:

```ts
import { defineConfig, Platform } from '@taqwright/taqwright';

export default defineConfig({
  timeout: 30_000,
  projects: [
    {
      name: 'android',
      use: {
        platform: Platform.ANDROID,
        device: { provider: 'emulator', name: /Pixel 10 Pro XL/ },
        buildPath: '/abs/path/to/app.apk',
        appBundleId: 'com.example.app',
        resetBetweenTests: true,
      },
    },
  ],
});
```

Every `defineConfig` / `use` option is documented in the [Configuration guide](https://www.taqwright.dev/docs/configuration).

## Guides

| Guide                                                                       | What it covers                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Installation](https://www.taqwright.dev/docs/installation)                 | Set up a configured project ready for its first test.               |
| [Writing tests](https://www.taqwright.dev/docs/writing-tests)               | Drive live devices and assert UI state with auto-waiting locators.  |
| [Generating tests](https://www.taqwright.dev/docs/generating-tests)         | Record tests in a browser-based device viewer that ranks selectors. |
| [Running & debugging](https://www.taqwright.dev/docs/running-and-debugging) | Per-action traces, full-run videos, and Playwright reporters.       |
| [Parallel runs](https://www.taqwright.dev/docs/parallel-runs)               | Scale out with local device pools or cloud providers.               |
| [Configuration](https://www.taqwright.dev/docs/configuration)               | Every `defineConfig` / `use` option.                                |

## Acknowledgements

- [**Appium**](https://appium.io) — the underlying mobile automation server taqwright drives.
- [**Playwright**](https://playwright.dev) — test runner, reporter, fixture machinery.
- [**AppWright**](https://github.com/empirical-run/appwright) — thanks for the inspiration.

## License

Apache-2.0
