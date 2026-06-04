// Shared fixtures for the locator-suggester suite.
//
// Tests import the COMPILED artifact (the repo philosophy is "build is the
// only tooling"; `dist` is gitignored, so `npm test` builds first). This
// file is the single place the dist path is referenced — if the layout
// ever moves, change it here only.
//
// NOTE: Node's test runner collects every `.js` under `test/`, so this
// module is loaded as a zero-test file. That's harmless — it only exports.

export {
  generateCandidates,
  selectBestPerCategory,
  makeNthSuggestion,
  isPositional,
  pickRecommended,
  CATEGORY_ORDER,
  WEB_CATEGORY_ORDER,
} from '../dist/inspector/locator-suggester.js';

export { Platform } from '../dist/types/index.js';

import { makeNthSuggestion as _makeNthSuggestion } from '../dist/inspector/locator-suggester.js';

/**
 * Build a `LocatorSuggestion` with sane defaults. Override only the fields
 * a case cares about. Omit `descriptor` for a flat (non-positional)
 * candidate; pass one (or use `mkNth`) for a positional one.
 */
export function mkSug({
  category = 'xpath',
  priority = 500,
  code,
  unique = true,
  count,
  descriptor,
  subLabel,
  using,
  value,
} = {}) {
  const usingDefault =
    category === 'id'
      ? 'id'
      : category === 'uiautomator'
        ? '-android uiautomator'
        : category === 'predicate'
          ? '-ios predicate string'
          : category === 'classChain'
            ? '-ios class chain'
            : 'xpath';
  const s = {
    category,
    subLabel: subLabel ?? category,
    priority,
    code: code ?? `mobile.getByXpath("//*")`,
    using: using ?? usingDefault,
    value: value ?? '//*',
    count: count ?? (unique ? 1 : 2),
    unique,
  };
  if (descriptor !== undefined) s.descriptor = descriptor;
  return s;
}

/**
 * Positional fixture produced by the REAL `makeNthSuggestion`, so the
 * fixture can never drift from the function's actual behavior.
 */
export function mkNth(base, idx) {
  return _makeNthSuggestion(base, idx);
}
