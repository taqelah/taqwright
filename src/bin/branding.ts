/**
 * Pure helpers for rebranding Playwright's CLI output as taqwright's.
 *
 * Playwright's end-of-run HTML hint hardcodes `<pm> playwright show-report …`.
 * taqwright exposes a `show-report` delegator, so rewriting the literal
 * `playwright show-report` → `taqwright show-report` yields a real, runnable
 * command. `runPlaywright` ([src/bin/index.ts]) pipes Playwright's stdout
 * through `BrandingBuffer` to apply this.
 *
 * Extracted into its own side-effect-free module so it can be unit-tested
 * without importing the CLI entrypoint (which calls `program.parseAsync`).
 */

/** Rewrite every `playwright show-report` occurrence to `taqwright show-report`. */
export function brandLine(s: string): string {
  return s.split('playwright show-report').join('taqwright show-report');
}

/**
 * Line-buffered branding rewriter. Holds the trailing partial line until
 * its newline arrives so the target substring can't be split across two
 * stdout chunks. Non-TTY Playwright emits newline-terminated output, so in
 * practice nothing is withheld beyond the final (newline-less) line, which
 * `flush()` handles.
 */
export class BrandingBuffer {
  private buf = '';

  /**
   * Feed a stdout chunk. Returns the text to write now (complete,
   * rewritten lines), retaining any trailing partial line internally.
   */
  push(chunk: string): string {
    this.buf += chunk;
    const nl = this.buf.lastIndexOf('\n');
    if (nl === -1) return '';
    const ready = this.buf.slice(0, nl + 1);
    this.buf = this.buf.slice(nl + 1);
    return brandLine(ready);
  }

  /** Return (and clear) the final rewritten remainder, if any. */
  flush(): string {
    if (!this.buf) return '';
    const out = brandLine(this.buf);
    this.buf = '';
    return out;
  }
}
