import { type TaqwrightUseOptions, type DeviceProvider } from '../types/index.js';
import { EmulatorProvider } from './emulator/index.js';
import { LocalDeviceProvider } from './local/index.js';
import { BrowserStackDeviceProvider } from './browserstack/index.js';
import { LambdaTestDeviceProvider } from './lambdatest/index.js';
import { DigitalAiDeviceProvider } from './digitalai/index.js';

export { EmulatorProvider } from './emulator/index.js';
export { LocalDeviceProvider } from './local/index.js';
export { BrowserStackDeviceProvider } from './browserstack/index.js';
export { LambdaTestDeviceProvider } from './lambdatest/index.js';
export { DigitalAiDeviceProvider } from './digitalai/index.js';
export type { DeviceHandle } from '../types/index.js';

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

// Registry keys that run on a remote grid (no local Appium server, no pool).
const CLOUD_PROVIDERS = new Set<string>(['browserstack', 'lambdatest', 'digitalai']);

/** True for providers that run on a remote cloud grid. */
export function isCloudProvider(provider: string | undefined): boolean {
  return provider !== undefined && CLOUD_PROVIDERS.has(provider);
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
