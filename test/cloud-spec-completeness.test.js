// Structural completeness check for every registered cloud grid's CloudSpec.
//
// Onboarding a new grid means adding one CloudSpec to CLOUD_SPECS (see
// src/providers/index.ts). Every field the inspector / server / capabilities
// layers derive from a spec must be present, or the feature silently misbehaves
// at runtime (no credentials set, device catalog empty, no UI button). This test
// turns each of those silent runtime failures into a loud, up-front red test, so
// a half-finished spec never ships.
//
// Pure structural assertions only — no network. The per-grid behavior (caps
// shape, device parsing) is covered in cloud-devices.test.js.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_SPECS,
  isCloudProvider,
  getSpec,
  getProviderClass,
} from '../dist/providers/index.js';

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

describe('CLOUD_SPECS registry', () => {
  test('is a non-empty array', () => {
    assert.ok(Array.isArray(CLOUD_SPECS));
    assert.ok(CLOUD_SPECS.length > 0);
  });

  test('provider keys are unique', () => {
    const keys = CLOUD_SPECS.map((s) => s.provider);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('getSpec throws on an unregistered grid', () => {
    assert.throws(() => getSpec('saucelabs'), /No cloud spec registered for "saucelabs"/);
  });
});

for (const spec of CLOUD_SPECS) {
  describe(`CloudSpec: ${spec.provider}`, () => {
    test('provider is registered + flagged cloud + resolvable', () => {
      assert.ok(isNonEmptyString(spec.provider));
      assert.equal(isCloudProvider(spec.provider), true);
      assert.equal(getSpec(spec.provider), spec);
      // Must also have a class in REGISTRY (getProviderClass throws otherwise).
      assert.ok(getProviderClass(spec.provider));
    });

    test('credentialEnv is a 2-tuple of non-empty var names', () => {
      assert.ok(Array.isArray(spec.credentialEnv));
      assert.equal(spec.credentialEnv.length, 2);
      assert.ok(spec.credentialEnv.every(isNonEmptyString));
    });

    test('build-upload + app-url wiring is present', () => {
      assert.ok(isNonEmptyString(spec.prebuiltScheme));
      assert.equal(typeof spec.appUrlEnvVar, 'function');
      assert.ok(isNonEmptyString(spec.appUrlEnvVar('proj')));
      assert.ok(isNonEmptyString(spec.upload?.endpoint));
      assert.equal(typeof spec.upload.urlBody, 'function');
      assert.equal(typeof spec.upload.fileBody, 'function');
    });

    test('hub connection is fully specified', () => {
      assert.ok(isNonEmptyString(spec.hub?.hostname));
      assert.equal(typeof spec.hub.port, 'number');
      assert.ok(isNonEmptyString(spec.hub.path));
      assert.equal(spec.hub.protocol, 'https');
    });

    test('caps + status-sync builders are functions', () => {
      assert.equal(typeof spec.buildCapabilities, 'function');
      assert.equal(typeof spec.syncRequest, 'function');
      assert.equal(typeof spec.strictSync, 'boolean');
    });

    test('permissionCapKeys is a non-empty array of strings', () => {
      assert.ok(Array.isArray(spec.permissionCapKeys));
      assert.ok(spec.permissionCapKeys.length > 0);
      assert.ok(spec.permissionCapKeys.every(isNonEmptyString));
    });

    test('catalog lists a URL and parses to a device array', () => {
      assert.equal(typeof spec.catalog?.listUrl, 'function');
      assert.ok(isNonEmptyString(spec.catalog.listUrl()));
      assert.equal(typeof spec.catalog.parseDevices, 'function');
      // Pure: an empty/garbage payload yields an empty array, never throws.
      assert.deepEqual(spec.catalog.parseDevices([]), []);
      assert.deepEqual(spec.catalog.parseDevices(null), []);
    });

    test('display metadata for the UI mode button is present', () => {
      assert.ok(isNonEmptyString(spec.display?.label));
      assert.ok(isNonEmptyString(spec.display.subtitle));
      assert.ok(isNonEmptyString(spec.display.icon));
    });
  });
}
