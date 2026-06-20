// Unit tests for the pure provider helpers in src/providers/index.ts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCloudProvider,
  getProviderClass,
  EmulatorProvider,
  LocalDeviceProvider,
  BrowserStackDeviceProvider,
  LambdaTestDeviceProvider,
  DigitalAiDeviceProvider,
} from '../dist/providers/index.js';

describe('isCloudProvider', () => {
  test('true for the cloud grids', () => {
    assert.equal(isCloudProvider('browserstack'), true);
    assert.equal(isCloudProvider('lambdatest'), true);
    assert.equal(isCloudProvider('digitalai'), true);
  });
  test('false for local providers / undefined', () => {
    assert.equal(isCloudProvider('emulator'), false);
    assert.equal(isCloudProvider('local-device'), false);
    assert.equal(isCloudProvider(undefined), false);
    assert.equal(isCloudProvider('nope'), false);
  });
});

describe('getProviderClass', () => {
  test('resolves each known provider to its class', () => {
    assert.equal(getProviderClass('browserstack'), BrowserStackDeviceProvider);
    assert.equal(getProviderClass('lambdatest'), LambdaTestDeviceProvider);
    assert.equal(getProviderClass('digitalai'), DigitalAiDeviceProvider);
    assert.equal(getProviderClass('emulator'), EmulatorProvider);
    assert.equal(getProviderClass('local-device'), LocalDeviceProvider);
  });
  test('throws on an unknown provider', () => {
    assert.throws(
      () => getProviderClass('saucelabs'),
      /No device provider registered for "saucelabs"/,
    );
  });
});
