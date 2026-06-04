import { Locator } from '../locator/index.js';
import type { Mobile } from '../mobile/index.js';
import type { Tracer } from './index.js';

/**
 * Methods on `Locator` that are pure chain shapers — they return a new Locator
 * synchronously and do no Appium I/O. The tracer skips recording for these
 * (the returned Locator is re-wrapped so subsequent action calls still trace).
 *
 * Keep this in lockstep with the chain methods on `Locator`. If you add a new
 * chain-shape method, add its name here too — otherwise the tracer will record
 * a useless "executed in 0ms" entry.
 */
const CHAIN_METHODS = new Set(['filter', 'first', 'last', 'nth', 'locator', 'and', 'or']);

/**
 * Properties on `Mobile` that must not be wrapped — anything returning the
 * raw WebDriver client, the platform enum, or other primitives unrelated to
 * traceable actions.
 */
const MOBILE_PASS_THROUGH = new Set(['raw', 'getPlatform']);

/**
 * Wrap a `Mobile` instance so every async method call (and every Locator
 * returned from `mobile.getByX(...)`) is funneled through the tracer.
 */
export function wrapForTracing(mobile: Mobile, tracer: Tracer): Mobile {
  return new Proxy(mobile, {
    get(target, prop, receiver): unknown {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      const name = String(prop);
      if (MOBILE_PASS_THROUGH.has(name) || typeof orig !== 'function') {
        return orig;
      }
      const fn = orig as (...args: unknown[]) => unknown;
      return (...args: unknown[]): unknown => {
        const result = fn.apply(target, args);
        if (result instanceof Locator) {
          // mobile.getByText(...) etc. — wrap the returned Locator so its
          // own methods trace. The getBy call itself is synchronous and
          // does no I/O, so don't record an entry for it.
          return wrapLocator(result, tracer);
        }
        if (isPromise(result)) {
          return tracer.record(`mobile.${name}`, args, () => result);
        }
        return result;
      };
    },
  }) as Mobile;
}

function wrapLocator(loc: Locator, tracer: Tracer): Locator {
  return new Proxy(loc, {
    get(target, prop, receiver): unknown {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof orig !== 'function') return orig;
      const name = String(prop);
      const fn = orig as (...args: unknown[]) => unknown;

      if (CHAIN_METHODS.has(name)) {
        return (...args: unknown[]): unknown => {
          const r = fn.apply(target, args);
          return r instanceof Locator ? wrapLocator(r, tracer) : r;
        };
      }

      return (...args: unknown[]): unknown => {
        const r = fn.apply(target, args);
        if (isPromise(r)) {
          return tracer
            .record(`locator.${name}`, args, () => r)
            .then((resolved) => wrapResolved(resolved, tracer));
        }
        return r;
      };
    },
  });
}

/**
 * Post-resolution wrapping: `all()` returns `Promise<Locator[]>` — each item
 * must be re-wrapped so subsequent action calls on those locators trace too.
 * Most other resolution methods return primitives (`count` → number,
 * `getText` → string, …) and pass through unchanged.
 */
function wrapResolved(value: unknown, tracer: Tracer): unknown {
  if (Array.isArray(value) && value.every((v) => v instanceof Locator)) {
    return value.map((l) => wrapLocator(l as Locator, tracer));
  }
  return value;
}

function isPromise(v: unknown): v is Promise<unknown> {
  return (
    v !== null && typeof v === 'object' && typeof (v as { then?: unknown }).then === 'function'
  );
}
