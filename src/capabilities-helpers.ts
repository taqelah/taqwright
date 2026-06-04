/**
 * Helpers that produce ready-to-use capability blocks for common
 * Appium project shapes. Keeps `taqwright.config.ts` readable when
 * multiple iOS / Android projects need staggered ports.
 */

export interface IosParallelCapsOptions {
  /**
   * Force a fresh WDA build/install per session. Default `true`. Trades
   * slower first-launch for resilience against stale WDA from prior runs.
   */
  useNewWDA?: boolean;
  /** Retry count if WDA fails to launch initially. Default `4`. */
  wdaStartupRetries?: number;
  /** Max wait (ms) for WDA to respond after launch. Default `360000` (6 min). */
  wdaConnectionTimeout?: number;
  /** Max wait (ms) for the WDA process to start. Default `120000` (2 min). */
  wdaLaunchTimeout?: number;
}

/**
 * iOS capability block tuned for parallel runs against multiple
 * simulators. Two parallel iOS sessions would otherwise collide on
 * default WDA / MJPEG ports and on DerivedData. Each `slot` index
 * gets its own offsets:
 *
 *   slot 0 → wdaLocalPort 8100, mjpegServerPort 9100, /tmp/wda-iphone-0
 *   slot 1 → wdaLocalPort 8101, mjpegServerPort 9101, /tmp/wda-iphone-1
 *   …
 *
 * Use one `slot` per project (or per device in a `device.pool` —
 * though pool-based runs already auto-stagger most of this via the
 * worker fixture, so reach for this helper mainly when you have
 * separate iOS projects in the same config).
 *
 * @example
 * ```ts
 * // taqwright.config.ts
 * import { defineConfig, Platform, iosParallelCaps } from '@taqwright/taqwright';
 *
 * export default defineConfig({
 *   projects: [
 *     { name: 'ios-iphone', use: {
 *         platform: Platform.IOS,
 *         // ...,
 *         capabilities: iosParallelCaps(0),
 *     }},
 *     { name: 'ios-ipad', use: {
 *         platform: Platform.IOS,
 *         // ...,
 *         capabilities: iosParallelCaps(1),
 *     }},
 *   ],
 * });
 * ```
 */
export function iosParallelCaps(
  slot: number,
  opts: IosParallelCapsOptions = {},
): Record<string, unknown> {
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error(`iosParallelCaps: slot must be a non-negative integer, got ${slot}`);
  }
  return {
    'appium:wdaLocalPort': 8100 + slot,
    'appium:mjpegServerPort': 9100 + slot,
    'appium:derivedDataPath': `/tmp/wda-${slot}`,
    'appium:useNewWDA': opts.useNewWDA ?? true,
    'appium:wdaStartupRetries': opts.wdaStartupRetries ?? 4,
    'appium:wdaConnectionTimeout': opts.wdaConnectionTimeout ?? 360_000,
    'appium:wdaLaunchTimeout': opts.wdaLaunchTimeout ?? 120_000,
  };
}
