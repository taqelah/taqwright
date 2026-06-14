// `prepare` lifecycle guard.
//
// In a DEV checkout (src/ + tsconfig.json present, devDeps installed) we build,
// so `git clone && npm install` and `npm link` produce a ready dist/. But the
// PUBLISHED package is dist-only (no src, no typescript): when `prepare` fires
// there — e.g. `npm link @taqwright/taqwright` against a global install — running
// `tsc` would crash with "tsc: command not found". Skip the build in that case.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (existsSync('src') && existsSync('tsconfig.json')) {
  execSync('npm run build', { stdio: 'inherit' });
} else {
  console.log('prepare: dist-only package (no src) — skipping build.');
}
