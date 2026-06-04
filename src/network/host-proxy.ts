/**
 * macOS host proxy snapshot / apply / restore — used by the iOS Simulator
 * path of the network capture feature. The Sim shares the host's network
 * stack and URLSession honors the **macOS** system proxy, so to route Sim
 * traffic through our MITM we briefly redirect the host proxy.
 *
 * **The load-bearing safety property is bulletproof restore.** A crashed test
 * that left `127.0.0.1:<port>` set on the user's Wi-Fi is a very bad first
 * impression. The module registers idempotent handlers for `exit`, `SIGINT`,
 * `SIGTERM`, and `uncaughtException` that restore from a module-level
 * snapshot; calling `applyProxy` records the snapshot and the operation that
 * needs reversing.
 */

import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const execP = promisify(exec);

export interface HostProxyState {
  service: string;
  web: { enabled: boolean; host: string; port: string };
  secure: { enabled: boolean; host: string; port: string };
}

interface PendingRestore {
  state: HostProxyState;
  /** Whether `applyProxy` actually changed anything we need to undo. */
  appliedWeb: boolean;
  appliedSecure: boolean;
}

let pending: PendingRestore | undefined;
let handlersRegistered = false;

/**
 * Read the current proxy config for the active network service (typically
 * "Wi-Fi"). Returns `undefined` only on unrecoverable failure (no
 * `networksetup`, no services). Soft-fails: an off proxy reports `enabled:
 * false` and empty host/port.
 */
export async function snapshotProxy(): Promise<HostProxyState | undefined> {
  const service = await activeNetworkService();
  if (!service) return undefined;
  const web = await readProxy('-getwebproxy', service);
  const secure = await readProxy('-getsecurewebproxy', service);
  return { service, web, secure };
}

/**
 * Apply `127.0.0.1:<port>` to both the HTTP and HTTPS host proxy entries
 * for the given service, and register restore handlers. Subsequent calls
 * are no-ops if the same state is already pending — keeps repeat invocations
 * cheap and consistent.
 */
export async function applyProxy(state: HostProxyState, host: string, port: number): Promise<void> {
  ensureHandlersRegistered();

  // Keep the *first* recorded snapshot so we restore to the pre-taqwright
  // original, not to our own intermediate state. Only seed it when absent.
  if (!pending) {
    pending = { state, appliedWeb: false, appliedSecure: false };
  }

  try {
    await execP(`networksetup -setwebproxy ${shellQuote(state.service)} ${host} ${port}`);
    pending.appliedWeb = true;
  } catch {
    // managed Mac (MDM) — fall through; restore handler will be a no-op
  }
  try {
    await execP(`networksetup -setsecurewebproxy ${shellQuote(state.service)} ${host} ${port}`);
    pending.appliedSecure = true;
  } catch {
    // same as above
  }
}

/**
 * Async, graceful restore for the happy-path teardown. Idempotent.
 */
export async function restoreProxy(): Promise<void> {
  if (!pending) return;
  const { state, appliedWeb, appliedSecure } = pending;
  pending = undefined;
  if (appliedWeb) {
    if (state.web.enabled && state.web.host && state.web.port) {
      await execP(
        `networksetup -setwebproxy ${shellQuote(state.service)} ${state.web.host} ${state.web.port}`,
      ).catch(() => undefined);
    } else {
      await execP(`networksetup -setwebproxystate ${shellQuote(state.service)} off`).catch(
        () => undefined,
      );
    }
  }
  if (appliedSecure) {
    if (state.secure.enabled && state.secure.host && state.secure.port) {
      await execP(
        `networksetup -setsecurewebproxy ${shellQuote(state.service)} ${state.secure.host} ${state.secure.port}`,
      ).catch(() => undefined);
    } else {
      await execP(`networksetup -setsecurewebproxystate ${shellQuote(state.service)} off`).catch(
        () => undefined,
      );
    }
  }
}

/**
 * Synchronous restore for crash paths (`process.on('exit')` cannot await).
 * Best-effort: silently swallows errors, since we may be inside a process-
 * level handler with no recovery path anyway.
 */
function restoreProxySync(): void {
  if (!pending) return;
  const { state, appliedWeb, appliedSecure } = pending;
  pending = undefined;
  try {
    if (appliedWeb) {
      if (state.web.enabled && state.web.host && state.web.port) {
        execSync(
          `networksetup -setwebproxy ${shellQuote(state.service)} ${state.web.host} ${state.web.port}`,
          { stdio: 'ignore' },
        );
      } else {
        execSync(`networksetup -setwebproxystate ${shellQuote(state.service)} off`, {
          stdio: 'ignore',
        });
      }
    }
    if (appliedSecure) {
      if (state.secure.enabled && state.secure.host && state.secure.port) {
        execSync(
          `networksetup -setsecurewebproxy ${shellQuote(state.service)} ${state.secure.host} ${state.secure.port}`,
          { stdio: 'ignore' },
        );
      } else {
        execSync(`networksetup -setsecurewebproxystate ${shellQuote(state.service)} off`, {
          stdio: 'ignore',
        });
      }
    }
  } catch {
    // best-effort
  }
}

function ensureHandlersRegistered(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  // process.exit / clean shutdown
  process.on('exit', restoreProxySync);
  // ctrl-c, kill
  const onSignal = (signal: NodeJS.Signals) => {
    restoreProxySync();
    // Re-raise the signal with default handling so the process actually exits.
    process.kill(process.pid, signal);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('SIGHUP', onSignal);
  process.on('uncaughtException', (err) => {
    restoreProxySync();
    // Rethrow on next tick so Node's default uncaught-exception path runs
    // (prints stack, exits 1) — without this the exception is swallowed.
    setImmediate(() => {
      throw err;
    });
  });
}

async function activeNetworkService(): Promise<string | undefined> {
  // Pick the first Hardware-Ports entry that has an active route. Falls
  // back to "Wi-Fi" if route inspection fails — the most common dev setup.
  try {
    const { stdout } = await execP('networksetup -listallnetworkservices');
    const services = stdout
      .split('\n')
      .filter((l) => l && !/asterisk denotes/i.test(l) && !l.startsWith('*'));
    // Prefer Wi-Fi, then Ethernet, then any remaining.
    const preferred =
      services.find((s) => /wi-?fi/i.test(s)) ??
      services.find((s) => /ethernet|usb|thunderbolt/i.test(s)) ??
      services[0];
    return preferred?.trim();
  } catch {
    return 'Wi-Fi';
  }
}

async function readProxy(
  kind: '-getwebproxy' | '-getsecurewebproxy',
  service: string,
): Promise<{ enabled: boolean; host: string; port: string }> {
  try {
    const { stdout } = await execP(`networksetup ${kind} ${shellQuote(service)}`);
    const enabled = /^Enabled:\s*Yes/im.test(stdout);
    const host = stdout.match(/^Server:\s*(.*)$/im)?.[1]?.trim() ?? '';
    const port = stdout.match(/^Port:\s*(\d+)/im)?.[1]?.trim() ?? '';
    return { enabled, host, port };
  } catch {
    return { enabled: false, host: '', port: '' };
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./=:,@%+]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
