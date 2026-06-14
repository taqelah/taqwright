import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E for the taqwright codegen/inspector UI.
 *
 * These drive a real Chromium against a running `taqwright codegen` server and
 * a live device — they are NOT part of the unit suite (node:test) and are kept
 * out of the library build (tsconfig `include` is `src/**` only). Run them with
 * `npm run test:e2e` after starting Appium + an emulator + `taqwright codegen`
 * (see the local-validation steps in the smoke-android workflow / the plan).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.spec.ts',
  // First connect can cold-start a UiAutomator2 session (+ optional app install).
  timeout: 240_000,
  expect: { timeout: 30_000 },
  // Single device, single server — never parallelize.
  workers: 1,
  retries: 1,
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...devices['Desktop Chrome'],
    // Debug aid: `E2E_CHROME=1 npm run test:e2e -- --headed` runs in your installed
    // Google Chrome instead of bundled Chromium. No effect in CI (env unset).
    ...(process.env.E2E_CHROME ? { channel: 'chrome' } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Debug aid: `SLOWMO=900 npm run test:e2e -- --headed` to watch each step.
    // No effect in CI (env unset).
    launchOptions: process.env.SLOWMO ? { slowMo: Number(process.env.SLOWMO) } : {},
  },
});
