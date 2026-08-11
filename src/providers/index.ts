import { type TaqwrightUseOptions, type DeviceProvider } from '../types/index.js';
import { type CloudSpec } from './cloud.js';
import { EmulatorProvider } from './emulator/index.js';
import { LocalDeviceProvider } from './local/index.js';
import { BrowserStackDeviceProvider, browserStackSpec } from './browserstack/index.js';
import { LambdaTestDeviceProvider, lambdaTestSpec } from './lambdatest/index.js';
import { DigitalAiDeviceProvider, digitalAiSpec } from './digitalai/index.js';

export { EmulatorProvider } from './emulator/index.js';
export { LocalDeviceProvider } from './local/index.js';
export { BrowserStackDeviceProvider } from './browserstack/index.js';
export { LambdaTestDeviceProvider } from './lambdatest/index.js';
export { DigitalAiDeviceProvider } from './digitalai/index.js';
export type { DeviceHandle } from '../types/index.js';
export type { CloudSpec } from './cloud.js';

// Every provider is constructed the same way; cloud providers also take the
// project name (local ones ignore the extra argument).
type ProviderConstructor = new (
  use: TaqwrightUseOptions,
  appBundleId: string | undefined,
  projectName?: string,
) => DeviceProvider;

// The single source of truth for "which `device.provider` values exist".
// Adding a grid is one entry here — the engine never branches on the string
// anywhere else.
const REGISTRY: Record<string, ProviderConstructor> = {
  emulator: EmulatorProvider,
  'local-device': LocalDeviceProvider,
  browserstack: BrowserStackDeviceProvider,
  lambdatest: LambdaTestDeviceProvider,
  digitalai: DigitalAiDeviceProvider,
};

// The single source of truth for cloud grids: one `CloudSpec` per grid. Adding
// a grid is one entry here (plus its `REGISTRY` class above) — everything the
// inspector/server/capabilities layers need (credential env vars, device
// catalog, permission-cap dialect, UI display metadata) derives from these.
export const CLOUD_SPECS = [browserStackSpec, lambdaTestSpec, digitalAiSpec] as const;

/**
 * Semantic alias for a cloud grid's `device.provider` value, derived from the
 * registered specs. Structurally `string` (specs type `provider` as `string`
 * for open extensibility) — validated at runtime by `getSpec`/`isCloudProvider`
 * — but naming it documents intent at consumer sites that used to hardcode
 * `'browserstack' | 'lambdatest'`.
 */
export type CloudProviderName = (typeof CLOUD_SPECS)[number]['provider'];

// Registry keys that run on a remote grid (no local Appium server, no pool),
// derived from CLOUD_SPECS so a new grid never needs a second edit here.
const CLOUD_PROVIDERS = new Set<string>(CLOUD_SPECS.map((s) => s.provider));

/** True for providers that run on a remote cloud grid. */
export function isCloudProvider(provider: string | undefined): boolean {
  return provider !== undefined && CLOUD_PROVIDERS.has(provider);
}

/** Look up a cloud grid's spec by its `device.provider` key. */
export function getSpec(provider: string): CloudSpec {
  const spec = CLOUD_SPECS.find((s) => s.provider === provider);
  if (!spec) {
    throw new Error(`No cloud spec registered for "${provider}".`);
  }
  return spec;
}

/** Look up a provider's implementing class by its `device.provider` key. */
export function getProviderClass(provider: string): ProviderConstructor {
  const ctor = REGISTRY[provider];
  if (!ctor) {
    throw new Error(`No device provider registered for "${provider}".`);
  }
  return ctor;
}

/** Construct the provider for the given project's resolved `use` options. */
export function createDeviceProvider(
  use: TaqwrightUseOptions,
  projectName?: string,
): DeviceProvider {
  const provider = use.device?.provider;
  if (!provider) {
    throw new Error('device.provider is not set — add it to your taqwright config.');
  }
  const ProviderClass = getProviderClass(provider);
  return new ProviderClass(use, use.appBundleId, projectName);
}
