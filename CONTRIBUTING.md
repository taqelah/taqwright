# Contributing to taqwright

Thanks for helping improve taqwright. This is the library itself — an E2E mobile
testing layer that puts Playwright's runner on top of Appium 3 / WebDriver.

## Setup

```bash
npm install
npm run build      # tsc --build → dist/  (also serves as the typecheck)
```

`dist/` is gitignored; the in-repo unit tests import the compiled output, so the
build must run before the tests (`npm test` does it for you).

## The three gates (run before pushing)

CI runs these same checks, so make them green locally first:

```bash
npm run format:check   # or `npm run format` to auto-fix, then re-check
npm run lint
npm test               # builds (typecheck) + runs the unit suite (node:test)
```

- There is **no separate `typecheck` script** — `npm run build` is the typecheck.
- [src/inspector/ui.ts](src/inspector/ui.ts) is exempt from Prettier (one giant
  template literal) — format it by hand.

## Conventions

- **ESM-only** (`"type": "module"`, NodeNext): every relative import inside
  `src/` must include the `.js` extension even though the sources are `.ts`.
- **Tests** live in `test/` (singular), use `node:test` + `node:assert/strict`,
  and import from `dist/`. Pure-logic modules are unit-tested directly;
  device/network code is tested with the fake WebDriver in
  [test/fake-driver.js](test/fake-driver.js).
- **Inspector UI** ([src/inspector/ui.ts](src/inspector/ui.ts)) is one big
  template literal. Use plain `//` comments (never backticks) inside inline
  `<script>`, and double-escape `\\n` / regex char-classes — see
  [CLAUDE.md](CLAUDE.md) for the validation snippet.

## Pull requests

- Branch off `main` (don't commit directly to `main`).
- Keep the three gates green; add unit tests for pure-logic changes.
- Open a PR against `main`; fill in the PR template.
