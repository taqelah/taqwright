import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end smoke test for `taqwright codegen` (= `taqwright inspect --record`).
 *
 * Walks the inspector wizard the way a user would — Prerequisites → Select
 * device → Connect — against a live Android emulator, and asserts the device
 * screenshot renders. This exercises the real boot path (HTTP server + UI +
 * /api/devices + /api/connect + /api/snapshot) that the unit tests cannot.
 *
 * Preconditions (owned by the caller — local steps or the smoke-android job):
 *   - an Android emulator is booted,
 *   - Appium (+ uiautomator2 driver) is reachable on the inspector's configured
 *     endpoint (default localhost:4723),
 *   - `taqwright codegen --no-open --port 4280` is serving at INSPECTOR_URL.
 */
const BASE = process.env.INSPECTOR_URL ?? 'http://localhost:4280';

/**
 * Return the inspector to the setup wizard if a WebDriver session is live.
 * The session lives server-side (not in the browser context), so a leftover
 * session from a prior run makes bootstrap jump straight to the inspector view.
 * Disconnecting keeps the test idempotent against a shared/reused codegen server.
 */
async function ensureSetupView(page: Page): Promise<void> {
  const disconnect = page.locator('#btn-disconnect');
  if (await disconnect.isVisible().catch(() => false)) {
    await disconnect.click();
    await page.locator('#modal-confirm').click();
    await expect(page.locator('body')).toHaveClass(/view-setup/, { timeout: 30_000 });
  }
}

// The inspector auto-runs a first-run onboarding tour — a modal overlay
// (#tour-overlay) that blocks the wizard, and it fires again after connect. It
// is gated only by localStorage flags (see src/inspector/ui.ts), so a fresh
// browser context would hit it every run. Pre-mark both tours (and the screen
// hint) as seen so the wizard is immediately interactive.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tw_tour_setup_seen', '1');
    localStorage.setItem('tw_tour_inspector_seen', '1');
    localStorage.setItem('tw_screen_hint_seen', '1');
  });
});

// Don't leave a live session behind — keeps re-runs (and a shared server) clean.
test.afterEach(async ({ page }) => {
  await ensureSetupView(page);
});

test('codegen: connect to an Android emulator and load the device screen', async ({ page }) => {
  await page.goto(BASE);
  await ensureSetupView(page);

  // Step 1 — Prerequisites: "Next" stays disabled until Appium is reachable.
  // Force a probe, then wait for the status pill to go live.
  await page.locator('#btn-appium-recheck').click();
  await expect(page.locator('#appium-pill')).toHaveClass(/live/, { timeout: 60_000 });

  const next = page.locator('#btn-step-next');
  await expect(next).toBeEnabled();
  await next.click();

  // Step 2 — Pick a device: only booted devices get the `.selectable` class.
  // Wait for the emulator tile (devices poll on a 3 s cadence) and select it.
  const tile = page.locator('.device-tile.selectable').first();
  await expect(tile).toBeVisible({ timeout: 60_000 });
  await tile.click();
  await expect(page.locator('.device-tile.selected')).toHaveCount(1);
  await next.click();

  // Step 3 — Connect (capabilities pre-filled from the selected device).
  await page.locator('#btn-connect').click();

  // The device screen is "loaded" once the UI switches to the inspector view
  // and the screenshot <img> holds a base64 PNG.
  await expect(page.locator('body')).toHaveClass(/view-inspector/, { timeout: 180_000 });
  await expect(page.locator('#screen-img')).toHaveAttribute('src', /^data:image\/png;base64,/, {
    timeout: 180_000,
  });
});
