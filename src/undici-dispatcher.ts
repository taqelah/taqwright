import { getGlobalDispatcher, setGlobalDispatcher, Agent } from 'undici';

let applied = false;

/**
 * Ensure undici's global dispatcher is a plain Agent before creating a WebDriver session.
 *
 * webdriver reuses the global undici dispatcher whenever it is not a plain Agent/MockAgent
 * (see its getDispatcher: it returns the global one for ProxyAgent / custom dispatchers). On
 * Node >= 26 the default global dispatcher is a Node-internal wrapper (e.g. Dispatcher1Wrapper),
 * which webdriver then hands to its bundled undici@6 fetch alongside a manually-set Content-Length
 * header — undici rejects that with `UND_ERR_INVALID_ARG: invalid content-length header`, failing
 * every session at creation. Installing a plain Agent as the global dispatcher keeps the request
 * inside a single compatible undici instance (and lets webdriver re-derive any HTTP_PROXY proxy
 * through its own undici). No-op on Node 24, where the global is already a plain Agent.
 *
 * The global-dispatcher slot is keyed by `Symbol.for('undici.globalDispatcher.1')`, shared across
 * undici instances, so the Agent we set here is read back by webdriver's bundled undici. Idempotent.
 */
export function ensurePlainGlobalDispatcher(): void {
  if (applied) return;
  applied = true;
  try {
    const name = getGlobalDispatcher()?.constructor?.name;
    // Preserve intentionally-set npm-undici agents; only replace foreign wrappers.
    if (name !== 'Agent' && name !== 'MockAgent' && name !== 'ProxyAgent') {
      setGlobalDispatcher(new Agent());
    }
  } catch {
    // undici not resolvable for some reason — leave the runtime as-is.
  }
}
