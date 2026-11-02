/**
 * Send one telemetry event. NEVER throws, never retries, never writes to the console, and
 * gives up after `timeoutMs`: a run's result, its exit code and its stdout (which
 * `--reporter json` writes to) are never touched by telemetry.
 */
import type { TelemetryEvent } from './event.js';

export async function sendTelemetry(
  event: TelemetryEvent,
  o: {
    url: string;
    version?: string;
    timeoutMs?: number;
    fetchImpl?: (url: string, init: RequestInit) => Promise<unknown>;
  },
): Promise<void> {
  const doFetch: ((url: string, init: RequestInit) => Promise<unknown>) | undefined =
    o.fetchImpl ?? globalThis.fetch;
  if (!doFetch) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 1500);
  // A pending timer must not hold the process open after the run has finished.
  timer.unref?.();
  try {
    await doFetch(o.url, {
      method: 'POST',
      // Only these two headers: no cookie, no credential, nothing from the environment.
      headers: {
        'content-type': 'application/json',
        'user-agent': `taqwright/${o.version ?? 'unknown'}`,
      },
      body: JSON.stringify(event),
      signal: ctrl.signal,
    });
  } catch {
    // Offline, blocked, timed out: telemetry is best-effort and says nothing.
  } finally {
    clearTimeout(timer);
  }
}
