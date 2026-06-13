#!/usr/bin/env node
// `npm init taqwright` → npm runs this `create-taqwright` package, which is a
// thin delegator to the real scaffolder: `taqwright init`. Keeping the logic
// in one place (taqwright's own `init` subcommand) avoids the two
// implementations drifting. Every arg after the initializer name is forwarded
// verbatim, e.g. `npm init taqwright my-app --platform ios -y`.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);

let taqwrightBin;
try {
  // taqwright's `exports` map only exposes its main entry (no
  // `./package.json`), so resolve the exported entry, then walk up to the
  // package root to read its `bin`. Reading package.json off disk (vs.
  // resolving it as a specifier) is not gated by `exports`.
  const mainEntry = require.resolve('@taqwright/taqwright');
  let pkgRoot = dirname(mainEntry);
  while (pkgRoot !== dirname(pkgRoot) && !existsSync(join(pkgRoot, 'package.json'))) {
    pkgRoot = dirname(pkgRoot);
  }
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.taqwright;
  taqwrightBin = join(pkgRoot, binRel);
} catch {
  console.error(
    'create-taqwright: could not locate the `taqwright` package.\n' +
      'Try instead:  npm i -D @taqwright/taqwright && npx taqwright init',
  );
  process.exit(1);
}

// Run with the current Node (don't rely on the bin being chmod'd / on PATH);
// inherit stdio so taqwright init's interactive prompts work through npx.
const child = spawn(process.execPath, [taqwrightBin, 'init', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on('error', (err) => {
  console.error(`create-taqwright: failed to run \`taqwright init\` — ${err.message}`);
  process.exit(1);
});
