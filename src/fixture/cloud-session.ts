/**
 * The attachment that ties a test to its cloud grid session.
 *
 * A report wants each result's session, for the video and the provider's own
 * logs. Without this the only join is the session NAME, which the `rawDriver`
 * fixture writes to the dashboard after the test (`syncTestDetails`) on a
 * best-effort request whose failure is swallowed. When that write does not
 * land — or two tests share a title — the result loses its video link, and
 * nothing says why. The id is exact, so it is attached instead: at session
 * start, so a test that fails, times out or crashes still carries it.
 *
 * Pure and side-effect-free, so it is unit-tested without the fixture (which
 * pulls in WebDriver and Playwright).
 */

/** The attachment name report readers look for (lime-cli report reads exactly this). */
export const CLOUD_SESSION_ATTACHMENT = 'taqwright-session';

// A WebDriver session id is a short token (a UUID or a provider's hex id); anything
// longer is not one, and an attachment is no place for a blob.
const MAX_SESSION_ID = 200;

/**
 * What to pass to `testInfo.attach` for a cloud session, or `null` when the
 * driver has no session id. Small and inline on purpose: Playwright's JSON
 * reporter serialises a small text body inline, which is the only form a
 * report reader can read from the report file alone.
 */
export function cloudSessionAttachment(
  handle: { driver?: { sessionId?: string } } | undefined,
): { name: string; body: string; contentType: string } | null {
  const id = String(handle?.driver?.sessionId ?? '').trim();
  if (!id || id.length > MAX_SESSION_ID) return null;
  return { name: CLOUD_SESSION_ATTACHMENT, body: id, contentType: 'text/plain' };
}
