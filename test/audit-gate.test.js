// The audit gate's decision logic (scripts/audit-gate.mjs), against hand-built
// `npm audit --json` reports — no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../scripts/audit-gate.mjs';

const adv = (name, id, severity = 'high') => ({
  source: 1,
  name,
  dependency: name,
  title: `${name} problem`,
  severity,
  url: `https://github.com/advisories/${id}`,
  range: '*',
});
const report = (...vias) => ({
  vulnerabilities: Object.fromEntries(vias.map((v) => [v.name, { name: v.name, via: [v] }])),
});
const allow = (...entries) => ({ advisories: entries });
const today = new Date('2026-10-02T00:00:00Z');

test('an advisory with no allowlist entry fails', () => {
  const r = evaluate(report(adv('node-forge', 'GHSA-aaaa')), allow(), { today });
  assert.equal(r.failures.length, 1);
});

test('an allowlisted advisory passes until its expiry date, inclusive', () => {
  const entry = { id: 'GHSA-aaaa', package: 'node-forge', expires: '2026-10-02' };
  const r = evaluate(report(adv('node-forge', 'GHSA-aaaa')), allow(entry), { today });
  assert.deepEqual(r.failures, []);
  assert.equal(r.allowed.length, 1);
});

test('an expired entry fails again', () => {
  const entry = { id: 'GHSA-aaaa', package: 'node-forge', expires: '2026-10-01' };
  const r = evaluate(report(adv('node-forge', 'GHSA-aaaa')), allow(entry), { today });
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /expired/);
});

test('an entry is bound to its package: the same id elsewhere still fails', () => {
  const entry = { id: 'GHSA-aaaa', package: 'node-forge', expires: '2099-01-01' };
  const r = evaluate(report(adv('other-pkg', 'GHSA-aaaa')), allow(entry), { today });
  assert.equal(r.failures.length, 1);
});

test('a second advisory on an allowlisted package still fails', () => {
  const entry = { id: 'GHSA-aaaa', package: 'node-forge', expires: '2099-01-01' };
  const rep = {
    vulnerabilities: {
      'node-forge': { via: [adv('node-forge', 'GHSA-aaaa'), adv('node-forge', 'GHSA-bbbb')] },
    },
  };
  const r = evaluate(rep, allow(entry), { today });
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /GHSA-bbbb/);
});

test('dependents that only point at a vulnerable package are judged by that advisory', () => {
  const entry = { id: 'GHSA-aaaa', package: 'node-forge', expires: '2099-01-01' };
  const rep = report(adv('node-forge', 'GHSA-aaaa'));
  rep.vulnerabilities['@taqwright/taqwright'] = { via: ['node-forge'], severity: 'high' };
  const r = evaluate(rep, allow(entry), { today });
  assert.deepEqual(r.failures, []);
});

test('below the level is ignored; unused entries are reported as stale', () => {
  const entry = { id: 'GHSA-zzzz', package: 'gone', expires: '2099-01-01' };
  const r = evaluate(report(adv('x', 'GHSA-mod', 'moderate')), allow(entry), {
    level: 'high',
    today,
  });
  assert.deepEqual(r.failures, []);
  assert.equal(r.stale.length, 1);
});
