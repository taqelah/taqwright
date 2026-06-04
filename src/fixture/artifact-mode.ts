/**
 * Pure decision helper for artifact retention modes shared by the `trace`
 * and `video` use-options.
 *
 * Both follow Playwright's familiar artifact lifecycle (`off` / `on` /
 * `on-failure` / `retain-on-failure`). The "should I keep this artifact
 * for this run?" decision is identical for both, so it lives here once
 * instead of being duplicated in the fixture.
 *
 * Extracted into its own side-effect-free module so it can be unit-tested
 * without importing the fixture (which pulls in WebDriver, Playwright, and
 * the Appium auto-start machinery).
 */

/**
 * Artifact lifecycle mode. The public `TraceMode` / `VideoMode` types in
 * `../types/index.js` are kept as their own literal unions for API-doc
 * stability; this is the structurally-identical internal union the shared
 * logic operates on.
 */
export type ArtifactMode = 'off' | 'on' | 'on-failure' | 'retain-on-failure';

/**
 * Whether an artifact captured for a finished test should be kept.
 *
 * - `'off'`                — never (the artifact isn't even produced; this
 *                            still answers `false` so the table is total).
 * - `'on'`                 — always.
 * - `'on-failure'`         — only when the test failed.
 * - `'retain-on-failure'`  — alias of `'on-failure'` on mobile.
 */
export function shouldRetainArtifact(mode: ArtifactMode, failed: boolean): boolean {
  if (mode === 'on') return true;
  if (mode === 'on-failure' || mode === 'retain-on-failure') return failed;
  return false; // 'off'
}
