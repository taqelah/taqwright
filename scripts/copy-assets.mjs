import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

cpSync(resolve(root, 'src/images'), resolve(root, 'dist/images'), { recursive: true });
console.log('copied src/images → dist/images');

// Onboarding / guide HTML pages — shipped in the npm package so consumers
// can open them from `node_modules/taqwright/dist/docs/` if they want.
if (existsSync(resolve(root, 'docs'))) {
  cpSync(resolve(root, 'docs'), resolve(root, 'dist/docs'), { recursive: true });
  console.log('copied docs → dist/docs');
}
