export { test } from './fixture/index.js';
export { expect, type TaqwrightExpect, type MobileMatchers } from './expect.js';
export { Mobile } from './mobile/index.js';
export { Locator } from './locator/index.js';
export { defineConfig, loadTaqwrightConfig as loadConfig } from './config.js';
export { iosParallelCaps, type IosParallelCapsOptions } from './capabilities-helpers.js';
export {
  Platform,
  type TaqwrightConfig,
  type TaqwrightProjectConfig,
  type TaqwrightUseOptions,
  type AppiumServerConfig,
  type DeviceConfig,
  type EmulatorDeviceConfig,
  type LocalDeviceConfig,
  type ScrollDirection,
  type SwipeDirection,
  type HardwareButton,
  type BoundingBox,
  type ScreenSize,
  type GestureOptions,
  type GesturePointer,
  type TraceMode,
  type VideoMode,
} from './types/index.js';
export type {
  ClickPoint,
  SwipeOptions,
  GetByOptions,
  LaunchAppOptions,
  GeoLocation,
  NetworkConnection,
  DeviceLogEntry,
  ScreenRecordingOptions,
  PauseOptions,
} from './mobile/index.js';
export type {
  WaitForOptions,
  ActionOptions,
  LongPressOptions,
  ScrollIntoViewOptions,
  ElementSwipeOptions,
  DragOptions,
  LocatorFilterOptions,
  SelectOptionInput,
  PressSequentiallyOptions,
} from './locator/index.js';
