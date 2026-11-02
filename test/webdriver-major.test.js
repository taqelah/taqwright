// webdriver stays on 9 until a run on a cloud grid passes on 10.
//
// taqwright 1.2.0 moved to webdriver 10, which reads a new session's id only from the reply's
// `value`. TestMu (LambdaTest) answers in the older shape, with the id at the top level, which
// webdriver 9 also accepts (`response.value.sessionId || response.sessionId`). On 10 every cloud
// test failed before reaching a device: "WebDriver new session response is missing a session id
// or capabilities". This repo's CI drives a local Appium, which answers in the new shape, so
// nothing here could see it — hence a pin, and this test, until the cloud path is verified.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('webdriver is pinned to major 9 (cloud grids reject 10; see the comment above)', () => {
  assert.match(pkg.dependencies.webdriver, /^\^?9\./);
});
