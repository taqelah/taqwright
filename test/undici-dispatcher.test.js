// Unit tests for ensurePlainGlobalDispatcher in src/undici-dispatcher.ts.
//
// The helper guards against webdriver reusing a foreign (non-Agent) global undici
// dispatcher — on Node >= 26 the default global is a Node-internal wrapper that, handed
// to webdriver's bundled undici@6 fetch with a manual Content-Length, throws
// UND_ERR_INVALID_ARG. The helper installs a plain Agent only when the current global is
// not a plain Agent/MockAgent/ProxyAgent.
//
// The module has a once-only `applied` guard, so each branch is exercised with a fresh
// module instance via a cache-busting import query.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalDispatcher, setGlobalDispatcher, Agent } from 'undici';

async function freshHelper(tag) {
  const mod = await import(`../dist/undici-dispatcher.js?case=${tag}`);
  return mod.ensurePlainGlobalDispatcher;
}

describe('ensurePlainGlobalDispatcher', () => {
  test('replaces a foreign (non-Agent) global dispatcher with a plain Agent', async () => {
    // Simulate Node 26's default: a dispatcher whose constructor name is not "Agent".
    class Dispatcher1Wrapper extends Agent {}
    const foreign = new Dispatcher1Wrapper();
    setGlobalDispatcher(foreign);
    assert.equal(getGlobalDispatcher().constructor.name, 'Dispatcher1Wrapper');

    const ensure = await freshHelper('foreign');
    ensure();

    const after = getGlobalDispatcher();
    assert.equal(after.constructor.name, 'Agent');
    assert.notEqual(after, foreign);
    await after.close();
  });

  test('leaves a plain Agent global dispatcher untouched', async () => {
    const agent = new Agent();
    setGlobalDispatcher(agent);

    const ensure = await freshHelper('plain-agent');
    ensure();

    assert.equal(getGlobalDispatcher(), agent, 'plain Agent should not be replaced');
    await agent.close();
  });

  test('is idempotent — only acts on the first call', async () => {
    class Dispatcher1Wrapper extends Agent {}
    setGlobalDispatcher(new Dispatcher1Wrapper());

    const ensure = await freshHelper('idempotent');
    ensure();
    const first = getGlobalDispatcher();
    assert.equal(first.constructor.name, 'Agent');

    // A foreign dispatcher set after the first call is NOT touched again.
    const foreignAgain = new Dispatcher1Wrapper();
    setGlobalDispatcher(foreignAgain);
    ensure();
    assert.equal(getGlobalDispatcher(), foreignAgain);

    await first.close();
    await foreignAgain.close();
  });
});
