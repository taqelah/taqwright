import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Keeps the README version badge in lockstep with package.json. Wired into the
// npm `version` lifecycle (runs on every `npm version` bump, including
// `--no-git-tag-version`), because the repo is private — shields.io can't read
// tags/releases/package.json from it, so a dynamic remote badge would 404. The
// badge is a baked static string instead, and this script is what re-bakes it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = resolve(root, 'README.md');

const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const readme = readFileSync(readmePath, 'utf8');

// Matches the shields.io static badge: badge/version-<x.y.z>-blue
const badge = /(badge\/version-)[\d.]+(-blue)/;
if (!badge.test(readme)) {
  console.error('sync-readme-version: version badge not found in README.md — leaving it unchanged');
  process.exit(1);
}

const next = readme.replace(badge, `$1${version}$2`);
if (next === readme) {
  console.log(`README version badge already at ${version}`);
} else {
  writeFileSync(readmePath, next);
  console.log(`README version badge → ${version}`);
}
