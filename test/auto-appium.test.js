// Unit test for isPortOpen — the TCP reachability probe used to decide
// whether Appium is already listening.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { isPortOpen } from '../dist/auto-appium.js';

describe('isPortOpen', () => {
  const server = createServer();

  test('true for a listening port', async () => {
    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    assert.equal(await isPortOpen('127.0.0.1', port), true);
  });

  test('false for a closed port', async () => {
    // Grab an ephemeral port, then close it so nothing is listening.
    const tmp = createServer();
    const port = await new Promise((resolve) => {
      tmp.listen(0, '127.0.0.1', () => resolve(tmp.address().port));
    });
    await new Promise((r) => tmp.close(r));
    assert.equal(await isPortOpen('127.0.0.1', port, 300), false);
  });

  after(() => new Promise((r) => server.close(r)));
});
