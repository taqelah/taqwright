#!/usr/bin/env node
// `npm audit --audit-level=<level>` with a narrow, expiring allowlist.
//
// Why this exists: sometimes an advisory lands with no patched version, in a
// package we cannot drop overnight (node-forge, GHSA-86w9-cpqp-85rv, "<= 1.4.0,
// no fix"). Plain `npm audit` then fails every PR on the repo, and a gate that
// always fails is a gate nobody reads.
//
// An entry in audit-allowlist.json suppresses ONE advisory, for ONE package, and
// only until its `expires` date. Any other advisory, the same advisory in another
// package, or an expired entry still fails. Entries that match nothing are
// reported so they get deleted once upstream ships a fix.
//
// Usage: node scripts/audit-gate.mjs [--level high] [--omit=dev]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

const advisoryId = (via) =>
  String(via.url || '')
    .split('/')
    .pop();

/**
 * Decide the gate from an `npm audit --json` report. Pure, so it can be tested
 * without the network.
 *
 * Only the advisories themselves are judged: `npm audit` also lists every package
 * that merely depends on a vulnerable one (its `via` holds a package name, not an
 * advisory), and those are covered by the decision on the advisory they point at.
 *
 * @returns {{ failures: string[], allowed: string[], stale: object[] }}
 */
export function evaluate(report, allowlist, { level = 'high', today = new Date() } = {}) {
  const min = SEVERITIES.indexOf(level);
  if (min < 0) throw new Error(`unknown --level ${level}`);
  const day = today.toISOString().slice(0, 10);
  const entries = (allowlist && allowlist.advisories) || [];
  const used = new Set();
  const failures = [];
  const allowed = [];
  const seen = new Set();

  for (const vuln of Object.values((report && report.vulnerabilities) || {})) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object' || via === null) continue;
      if (SEVERITIES.indexOf(via.severity) < min) continue;
      const id = advisoryId(via);
      const key = `${via.name} ${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = `${via.severity.padEnd(8)} ${via.name} ${id} — ${via.title || ''}`.trim();
      const entry = entries.find((e) => e.id === id && e.package === via.name);
      if (!entry) {
        failures.push(label);
      } else if (!entry.expires || entry.expires < day) {
        used.add(entry);
        failures.push(`${label} (allowlist entry expired ${entry.expires || '(no date)'})`);
      } else {
        used.add(entry);
        allowed.push(`${label} (allowlisted until ${entry.expires})`);
      }
    }
  }
  const stale = entries.filter((e) => !used.has(e));
  return { failures, allowed, stale };
}

function main(argv) {
  const lvlIdx = argv.indexOf('--level');
  const level = lvlIdx >= 0 ? argv[lvlIdx + 1] : 'high';
  const auditArgs = ['audit', '--json', ...argv.filter((a) => a.startsWith('--omit'))];
  let raw;
  try {
    raw = execFileSync('npm', auditArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
    raw = err.stdout;
    if (!raw) throw err;
  }
  const report = JSON.parse(raw);
  const allowlistPath = fileURLToPath(new URL('../audit-allowlist.json', import.meta.url));
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const { failures, allowed, stale } = evaluate(report, allowlist, { level });

  for (const a of allowed) console.log(`  allowed  ${a}`);
  for (const s of stale)
    console.log(`  stale allowlist entry (matches nothing, delete it): ${s.package} ${s.id}`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL     ${f}`);
    console.log(`\naudit gate FAILED at ${level}: ${failures.length} advisory(ies)`);
    return 1;
  }
  console.log(`\naudit gate passed at ${level} (${allowed.length} allowlisted advisory(ies))`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
