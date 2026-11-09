/**
 * Per-file session cache behind `use.sessionScope: 'file'`.
 *
 * Playwright only offers `test` and `worker` fixture scopes. A file scope is
 * built from a worker-scoped cache keyed by the spec file: the first test of a
 * file opens a session, later tests from the same file reuse it, and the cache
 * closes it when the worker moves to another file (or at worker teardown).
 *
 * Kept free of Playwright and WebDriver so it can be unit-tested with plain
 * `open` / `close` functions — the fixture supplies the real ones.
 */

/** What the cache knows about a file's tests when it closes that file's session. */
export interface FileSessionSummary {
  /** Absolute path of the spec file the session served. */
  file: string;
  /** Number of tests that ran on the session. */
  tests: number;
  /** `true` when any test on the session did not pass. */
  failed: boolean;
  /** The first failure's reason, when there was one. */
  reason?: string;
}

/** A finished test's outcome, as the fixture reads it from `testInfo`. */
export interface FileSessionTestResult {
  status: string;
  error?: string;
}

export interface FileSessionCacheOptions<S> {
  /** Opens a session for `file`. A throw leaves the cache empty. */
  open(file: string): Promise<S>;
  /** Closes a session. Errors are swallowed by the cache. */
  close(session: S, summary: FileSessionSummary): Promise<void>;
}

export class FileSessionCache<S> {
  private current: { file: string; session: S; summary: FileSessionSummary } | null = null;

  constructor(private readonly opts: FileSessionCacheOptions<S>) {}

  /**
   * The session for `file`: the cached one when it served the same file,
   * otherwise a new one (after closing the previous file's session).
   * `isNew` tells the caller this test is the first on the session.
   */
  async acquire(file: string): Promise<{ session: S; isNew: boolean }> {
    if (this.current && this.current.file === file) {
      return { session: this.current.session, isNew: false };
    }
    await this.release();
    const session = await this.opts.open(file);
    this.current = { file, session, summary: { file, tests: 0, failed: false } };
    return { session, isNew: true };
  }

  /** Adds a finished test's outcome to the open session's summary. */
  record(result: FileSessionTestResult): void {
    if (!this.current) return;
    const summary = this.current.summary;
    summary.tests += 1;
    if (result.status !== 'passed' && result.status !== 'skipped') {
      if (!summary.failed) summary.reason = result.error ?? result.status;
      summary.failed = true;
    }
  }

  /** The spec file the open session serves, or `undefined` when none is open. */
  get file(): string | undefined {
    return this.current?.file;
  }

  /** Closes the open session, if any. Never throws. */
  async release(): Promise<void> {
    const c = this.current;
    if (!c) return;
    this.current = null;
    try {
      await this.opts.close(c.session, c.summary);
    } catch {
      // the session may already be gone — never block the next file over it
    }
  }
}
