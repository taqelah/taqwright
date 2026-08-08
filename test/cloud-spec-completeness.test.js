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

// Per-grid expectations. Grids legitimately differ (bearer vs basic auth, REST
// vs in-test status reporting, no status API at all), and the earlier
// `assert.ok(A || B)` style meant each new grid that lacked A weakened the
// guarantee for EVERY grid. Declaring the differences here instead keeps every
// assertion exact: onboarding a grid is a reviewed one-line row, and changing
// a grid's behaviour is a one-grid diff rather than a loosened assertion.
const EXPECTED = {
  browserstack: { needsUser: true, status: 'rest', urlUpload: true, tenant: null, scheme: 'bs://' },
  lambdatest: { needsUser: true, status: 'rest', urlUpload: true, tenant: null, scheme: 'lt://' },
  digitalai: {
    needsUser: false,
    status: 'command',
    urlUpload: true,
    tenant: 'required',
    scheme: 'cloud:',
  },
  pcloudy: {
    needsUser: true,
    status: 'none',
    urlUpload: false,
    tenant: 'default',
    scheme: 'pcloudy:',
  },
};

describe('CLOUD_SPECS registry', () => {
  test('is a non-empty array', () => {
    assert.ok(Array.isArray(CLOUD_SPECS));
    assert.ok(CLOUD_SPECS.length > 0);
  });

  test('provider keys are unique', () => {
    const keys = CLOUD_SPECS.map((s) => s.provider);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('every registered grid has an expectation row (and vice versa)', () => {
    assert.deepEqual(
      CLOUD_SPECS.map((s) => s.provider).sort(),
      Object.keys(EXPECTED).sort(),
      'add a row to EXPECTED when registering a grid — it is what keeps the assertions below exact',
    );
  });

  test('getSpec throws on an unregistered grid', () => {
    assert.throws(() => getSpec('saucelabs'), /No cloud spec registered for "saucelabs"/);
  });
});

for (const spec of CLOUD_SPECS) {
  const expected = EXPECTED[spec.provider];
  describe(`CloudSpec: ${spec.provider}`, () => {
    test('provider is registered + flagged cloud + resolvable', () => {
      assert.ok(isNonEmptyString(spec.provider));
      assert.equal(isCloudProvider(spec.provider), true);
      assert.equal(getSpec(spec.provider), spec);
      // Must also have a class in REGISTRY (getProviderClass throws otherwise).
      assert.ok(getProviderClass(spec.provider));
    });

    test('credentialEnv arity matches this grid’s declared auth shape', () => {
      assert.ok(Array.isArray(spec.credentialEnv));
      assert.ok(spec.credentialEnv.every(isNonEmptyString));
      // Exact, not "1 or 2": a grid that silently loses its username var is a bug.
      assert.equal(spec.credentialEnv.length, expected.needsUser ? 2 : 1);
    });

    test('tenant-URL wiring matches this grid’s declared shape', () => {
      if (expected.tenant === null) {
        assert.equal(spec.tenantUrlEnvVar, undefined);
        assert.equal(spec.tenantUrlDefault, undefined);
        return;
      }
      assert.ok(isNonEmptyString(spec.tenantUrlEnvVar));
      if (expected.tenant === 'required') {
        // No default → the inspector demands the field.
        assert.equal(spec.tenantUrlDefault, undefined);
      } else {
        // Has a default → the field is optional and prefilled with it.
        assert.ok(isNonEmptyString(spec.tenantUrlDefault));
        assert.doesNotThrow(() => new URL(spec.tenantUrlDefault));
      }
    });

    test('build-upload + app-url wiring is present', () => {
      // A non-empty scheme is load-bearing: `resolveAppUrl` tests
      // `buildPath.startsWith(scheme)`, and every string starts with '', so an
      // empty scheme would silently disable uploading for the whole grid.
      assert.ok(isNonEmptyString(spec.prebuiltScheme));
      assert.equal(spec.prebuiltScheme, expected.scheme);
      assert.equal(typeof spec.appUrlEnvVar, 'function');
      assert.ok(isNonEmptyString(spec.appUrlEnvVar('proj')));
      // Tenant-hosted grids resolve the endpoint from a function of
      // `buildPath`, reading their cloud-server env var.
      if (spec.tenantUrlEnvVar) process.env[spec.tenantUrlEnvVar] = 'https://tenant.example.com';
      const endpoint =
        typeof spec.upload?.endpoint === 'function'
          ? spec.upload.endpoint('build.apk')
          : spec.upload?.endpoint;
      assert.ok(isNonEmptyString(endpoint));
      assert.equal(typeof spec.upload.urlBody, 'function');
      assert.equal(typeof spec.upload.fileBody, 'function');
      // Grids with no upload-from-URL API must still expose `urlBody`, but it
      // has to fail loudly rather than build a bogus request.
      if (!expected.urlUpload) {
        assert.throws(() => spec.upload.urlBody('https://example.com/app.apk', 'proj'));
      }
    });

    test('hub connection is fully specified (static object, or resolved from a function)', () => {
      // Tenant-hosted grids (Digital.ai) resolve the hub from an env var, so
      // set one before calling a function-form hub.
      if (spec.tenantUrlEnvVar) process.env[spec.tenantUrlEnvVar] = 'https://tenant.example.com';
      const hub = typeof spec.hub === 'function' ? spec.hub(/** @type {any} */ ({})) : spec.hub;
      assert.ok(isNonEmptyString(hub?.hostname));
      assert.equal(typeof hub.port, 'number');
      assert.ok(isNonEmptyString(hub.path));
      assert.equal(hub.protocol, 'https');
    });

    test('caps builder is a function; status reporting matches the declared mechanism', () => {
      assert.equal(typeof spec.buildCapabilities, 'function');
      assert.equal(typeof spec.strictSync, 'boolean');
      // Exact mechanism, so "forgot to wire status reporting" can never be
      // mistaken for "this grid genuinely has no status API".
      if (expected.status === 'rest') {
        assert.equal(typeof spec.syncRequest, 'function');
        assert.equal(spec.reportStatusCommand, undefined);
        assert.notEqual(spec.noStatusReporting, true);
      } else if (expected.status === 'command') {
        assert.equal(typeof spec.reportStatusCommand, 'function');
        assert.equal(spec.syncRequest, undefined);
        assert.notEqual(spec.noStatusReporting, true);
      } else {
        assert.equal(
          spec.noStatusReporting,
          true,
          'a grid with no status API must opt out explicitly via `noStatusReporting: true`',
        );
        assert.equal(spec.syncRequest, undefined);
        assert.equal(spec.reportStatusCommand, undefined);
      }
    });

    test('permissionCapKeys is a non-empty array of strings', () => {
      assert.ok(Array.isArray(spec.permissionCapKeys));
      assert.ok(spec.permissionCapKeys.length > 0);
      assert.ok(spec.permissionCapKeys.every(isNonEmptyString));
    });

    test('catalog lists a URL and parses to a device array', () => {
      // Tenant-hosted grids (Digital.ai) resolve the list URL from an env var.
      if (spec.tenantUrlEnvVar) process.env[spec.tenantUrlEnvVar] = 'https://tenant.example.com';
      assert.equal(typeof spec.catalog?.listUrl, 'function');
      assert.ok(isNonEmptyString(spec.catalog.listUrl()));
      assert.equal(typeof spec.catalog.parseDevices, 'function');
      // Optional escape hatch for grids whose catalog needs a POST body, a
      // pre-fetched token, or more than one request (pCloudy).
      if (spec.catalog.fetchRaw !== undefined) {
        assert.equal(typeof spec.catalog.fetchRaw, 'function');
      }
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
