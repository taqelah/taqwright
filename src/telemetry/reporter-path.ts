/**
 * How the telemetry reporter joins a run. Two ways in, because a `--reporter` flag REPLACES
 * the config's reporters in Playwright:
 *
 * - `defineConfig` adds it beside the config's reporters (or Playwright's default) — the path
 *   for `taqwright test` and for `npx playwright test --config taqwright.config.ts`.
 * - the `taqwright test` CLI appends it to a `--reporter` value, comma-separated, so a run with
 *   `--reporter json` (as CI pipelines often use) is counted too.
 *
 * The reporter writes nothing to stdout, so it never mixes into another reporter's output.
 */
import { fileURLToPath } from 'node:url';

export const TELEMETRY_REPORTER = fileURLToPath(new URL('./reporter.js', import.meta.url));

type ReporterEntry = [string] | [string, unknown];
type ReporterSetting = string | ReporterEntry[] | undefined;

/** The config's reporters with telemetry added — Playwright's default kept when none were set. */
export function addTelemetryReporter(
  reporter: ReporterSetting,
  env = process.env,
): ReporterEntry[] {
  const list: ReporterEntry[] =
    reporter === undefined
      ? [[env.CI ? 'dot' : 'list']]
      : typeof reporter === 'string'
        ? [[reporter]]
        : [...reporter];
  if (!list.some((r) => r[0] === TELEMETRY_REPORTER)) list.push([TELEMETRY_REPORTER]);
  return list;
}

/** A `--reporter` value with telemetry appended, once. */
export function appendTelemetryReporter(value: string): string {
  return value.split(',').includes(TELEMETRY_REPORTER) ? value : `${value},${TELEMETRY_REPORTER}`;
}
