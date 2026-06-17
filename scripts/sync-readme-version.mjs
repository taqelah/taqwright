import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Keeps the README version badge in lockstep with package.json. Wired into the
// npm `version` lifecycle (runs on every `npm version` bump, including
// `--no-git-tag-version`). The badge is a baked static string this script
// re-bakes, so it tracks package.json exactly — including prerelease tags like
// 0.1.0-beta.0 — without depending on a remote source.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = resolve(root, 'README.md');

const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const readme = readFileSync(readmePath, 'utf8');

// Matches the shields.io static badge value between `badge/version-` and the
// trailing `-blue` — tolerant of escaped dashes in prerelease versions
// (shields renders `--` as a literal `-`, so 0.1.0-beta.0 bakes as
// `version-0.1.0--beta.0-blue`).
const badge = /(badge\/version-)[^"]*?(-blue)/;
if (!badge.test(readme)) {
  console.error('sync-readme-version: version badge not found in README.md — leaving it unchanged');
  process.exit(1);
}

// shields.io treats a single `-` as a field separator, so escape dashes as `--`.
const escaped = version.replace(/-/g, '--');
const next = readme.replace(badge, `$1${escaped}$2`);
if (next === readme) {
  console.log(`README version badge already at ${version}`);
} else {
  writeFileSync(readmePath, next);
  console.log(`README version badge → ${version}`);
}
