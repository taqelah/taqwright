// Unit tests for src/fixture/artifact-mode.ts (compiled artifact) — the
// retention decision shared by the `trace` and `video` use-options.
//
// Pure, side-effect-free: importing it does NOT pull in WebDriver,
// Playwright, or the Appium auto-start machinery (that's why the logic was
// extracted out of the `mobile` fixture). The fixture I/O itself is not
// unit-tested — it would only exercise mocks; e2e covers that.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetainArtifact } from '../dist/fixture/artifact-mode.js';

describe('shouldRetainArtifact', () => {
  test("'off' → false regardless of outcome", () => {
    assert.equal(shouldRetainArtifact('off', false), false);
    assert.equal(shouldRetainArtifact('off', true), false);
  });

  test("'on' → true regardless of outcome", () => {
    assert.equal(shouldRetainArtifact('on', false), true);
    assert.equal(shouldRetainArtifact('on', true), true);
  });

  test("'on-failure' → only when failed", () => {
    assert.equal(shouldRetainArtifact('on-failure', false), false);
    assert.equal(shouldRetainArtifact('on-failure', true), true);
  });

  test("'retain-on-failure' → only when failed (alias of on-failure)", () => {
    assert.equal(shouldRetainArtifact('retain-on-failure', false), false);
    assert.equal(shouldRetainArtifact('retain-on-failure', true), true);
  });

  test('exhaustive truth table is total', () => {
    const expected = {
      'off:false': false,
      'off:true': false,
      'on:false': true,
      'on:true': true,
      'on-failure:false': false,
      'on-failure:true': true,
      'retain-on-failure:false': false,
      'retain-on-failure:true': true,
    };
    for (const [key, want] of Object.entries(expected)) {
      const [mode, failedStr] = key.split(':');
      assert.equal(
        shouldRetainArtifact(mode, failedStr === 'true'),
        want,
        `mode=${mode} failed=${failedStr}`,
      );
    }
  });
});
