import fs from 'node:fs';
import path from 'node:path';
import {
  type TaqwrightUseOptions,
  type DeviceHandle,
  type DeviceProvider,
} from '../types/index.js';
import { logger } from '../logger.js';
import { ensurePlainGlobalDispatcher } from '../undici-dispatcher.js';

/** WebDriver connection details for a grid's hub. */
export interface CloudHub {
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly protocol: 'https';
}

/**
 * One cloud grid expressed as data + a few small functions. The generic
 * `CloudProvider` below drives the shared lifecycle (upload → open session →
 * sync status); a spec only declares what is specific to its grid — endpoints,
 * the upload body shape, the WebDriver hub, and how to build capabilities.
 *
 * This is deliberately a single shared engine rather than one bespoke class
 * per grid: the upload/session/sync flow is identical across grids, so it
 * lives in exactly one place.
 */
export interface CloudSpec {
  /** The `device.provider` value this spec serves. */
  readonly provider: 'browserstack' | 'lambdatest' | 'digitalai';
  /** Auth scheme. 'basic' (default) = HTTP Basic `user:key`; 'bearer' = `Bearer <accessKey>` + session auth via capability. */
  readonly authScheme?: 'basic' | 'bearer';
  /** Credential env vars: `[user, key]` for basic; `[accessKey]` (no username) for bearer. */
  readonly credentialEnv: readonly [string, string] | readonly [string];
  /** A `buildPath` already on the grid (this scheme) skips the upload step. */
  readonly prebuiltScheme: string;
  /** Env var (per project) that carries the resolved, uploaded app URL. */
  appUrlEnvVar(projectName: string): string;
  /** Build upload: the endpoint plus the request body for url- vs file-based uploads. */
  readonly upload: {
    /** Upload endpoint: a fixed URL, or a function of `buildPath` for tenant-hosted grids (URL vs file uploads may differ). */
    readonly endpoint: string | ((buildPath: string) => string);
    urlBody(buildPath: string, projectName: string): URLSearchParams;
    fileBody(file: Buffer, fileName: string, projectName: string): FormData;
  };
  /** Map the upload response to the app reference (`appUrl`). Defaults to `data.app_url`. */
  uploadResponseToAppRef?(
    data: unknown,
    ctx: { use: TaqwrightUseOptions; appBundleId: string | undefined },
  ): string | undefined;
  /** WebDriver hub: a static object, or a function of `use` for tenant-hosted grids. */
  readonly hub: CloudHub | ((use: TaqwrightUseOptions) => CloudHub);
  /** Build the session capabilities for this grid. */
  buildCapabilities(args: {
    use: TaqwrightUseOptions;
    projectName: string;
    appUrl: string;
  }): Record<string, unknown>;
  /** Build the status-sync REST request. Optional — grids without a status endpoint omit it. */
  syncRequest?(
    sessionId: string,
    details: { status?: string; reason?: string; name?: string },
  ): { url: string; method: string; body: string };
  /** Report status via an in-test `executeScript` command on the live session (alternative to `syncRequest`; takes precedence). */
  reportStatusCommand?(details: {
    status?: string;
    reason?: string;
    name?: string;
  }): { script: string; args: unknown[] } | null;
  /** Surface a failed status-sync as an error (grids that 404 a not-yet-ready session set this false). */
  readonly strictSync: boolean;
  /** Resolve the installed bundle id after the session opens (grid session API). Optional. */
  resolveBundleId?(sessionId: string, authHeader: string): Promise<string | undefined>;
  /** Require an `appBundleId` at construction (grids that can't read it back). */
  readonly requireBundleId?: boolean;
  /** Allow a session with no app (no `buildPath`) — attaches to the device as-is. */
  readonly appOptional?: boolean;
}

/** HTTP Basic credentials header from a username/key pair. */
export function basicAuth(user: string | undefined, key: string | undefined): string {
  return `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`;
}

/**
 * Build the REST `Authorization` header for a spec's auth scheme, reading the
 * access key (and, for basic, the username) from the given env map.
 * 'bearer' → `Bearer <accessKey>`; 'basic' (default) → `Basic base64(user:key)`.
 */
export function cloudAuthHeader(
  spec: CloudSpec,
  env: Record<string, string | undefined> = process.env,
): string {
  if (spec.authScheme === 'bearer') {
    const [keyVar] = spec.credentialEnv;
    return `Bearer ${env[keyVar] ?? ''}`;
  }
  const [userVar, keyVar] = spec.credentialEnv as readonly [string, string];
  return basicAuth(env[userVar], env[keyVar]);
}

/** Resolve a spec's hub (static object or function of `use`) to concrete details. */
export function resolveCloudHub(hub: CloudSpec['hub'], use: TaqwrightUseOptions): CloudHub {
  return typeof hub === 'function' ? hub(use) : hub;
}

/**
 * Assemble the wdio connection object for a cloud session — pure, so it can be
 * verified in isolation. Basic-auth grids carry `user`/`key` on the connection;
 * bearer grids authenticate the session via a capability built by
 * `buildCapabilities`, so no credentials are sent on the connection.
 */
export function buildCloudConnection(
  spec: CloudSpec,
  use: TaqwrightUseOptions,
  appUrl: string,
  projectName: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const credentials =
    spec.authScheme === 'bearer'
      ? {}
      : (() => {
          const [userVar, keyVar] = spec.credentialEnv as readonly [string, string];
          return { user: env[userVar], key: env[keyVar] };
        })();
  return {
    ...resolveCloudHub(spec.hub, use),
    logLevel: 'warn',
    // Cloud device allocation can be slow — especially many parallel sessions
    // queueing for real devices. The wdio default (120s) aborts the `/session`
    // POST before a device is granted; give it room (override via
    // `appium.connectionTimeout`).
    connectionRetryTimeout: use.appium?.connectionTimeout ?? 300_000,
    ...credentials,
    capabilities: spec.buildCapabilities({ use, projectName, appUrl }),
  };
}

/**
 * Generic cloud device provider. Concrete grids subclass this with a
 * `CloudSpec` (see browserstack/ and lambdatest/), supplying no behaviour of
 * their own beyond the spec.
 */
export class CloudProvider implements DeviceProvider {
  sessionId?: string;
  /** The live driver from `getDevice()` — kept so command-based status reporting
   * can run on the still-open session during teardown. */
  protected driver?: DeviceHandle['driver'];
  protected readonly projectName: string;

  constructor(
    private readonly spec: CloudSpec,
    protected readonly use: TaqwrightUseOptions,
    protected readonly appBundleId: string | undefined,
    projectName?: string,
  ) {
    if (use.device.provider !== spec.provider) {
      throw new Error(
        `${spec.provider} provider received device.provider='${use.device.provider}'.`,
      );
    }
    if (spec.requireBundleId && !appBundleId) {
      throw new Error(
        `appBundleId is required for the ${spec.provider} provider — set it on the project.`,
      );
    }
    this.projectName = projectName ?? path.basename(process.cwd());
  }

  private authHeader(): string {
    return cloudAuthHeader(this.spec);
  }

  /** Fail fast if the credential env vars this spec's auth scheme needs are absent. */
  private assertCredentials(): void {
    if (this.spec.authScheme === 'bearer') {
      const [keyVar] = this.spec.credentialEnv;
      if (!process.env[keyVar]) {
        throw new Error(`${keyVar} is required for the ${this.spec.provider} provider.`);
      }
      return;
    }
    const [userVar, keyVar] = this.spec.credentialEnv as readonly [string, string];
    if (!(process.env[userVar] && process.env[keyVar])) {
      throw new Error(
        `${userVar} and ${keyVar} are required for the ${this.spec.provider} provider.`,
      );
    }
  }

  async globalSetup(): Promise<void> {
    if (!this.use.buildPath) {
      if (!this.spec.appOptional) {
        throw new Error('Build path not found. Set `buildPath` in your taqwright config.');
      }
      // No build → no app to install; the session attaches to the device as-is.
      this.assertCredentials();
      process.env[this.spec.appUrlEnvVar(this.projectName)] = '';
      return;
    }
    this.assertCredentials();
    const appUrl = await this.resolveAppUrl(this.use.buildPath);
    process.env[this.spec.appUrlEnvVar(this.projectName)] = appUrl ?? '';
  }

  /** Either pass through an already-on-grid build URL or upload the build and read back its URL. */
  private async resolveAppUrl(buildPath: string): Promise<string | undefined> {
    if (buildPath.startsWith(this.spec.prebuiltScheme)) {
      return buildPath;
    }
    let body: URLSearchParams | FormData;
    if (buildPath.startsWith('http')) {
      body = this.spec.upload.urlBody(buildPath, this.projectName);
    } else {
      if (!fs.existsSync(buildPath)) {
        throw new Error(`Build file not found: ${buildPath}`);
      }
      const bytes = await fs.promises.readFile(buildPath);
      body = this.spec.upload.fileBody(bytes, path.basename(buildPath), this.projectName);
    }
    logger.log(`Uploading: ${buildPath}`);
    const endpoint =
      typeof this.spec.upload.endpoint === 'function'
        ? this.spec.upload.endpoint(buildPath)
        : this.spec.upload.endpoint;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: this.authHeader() },
      body,
    });
    const data = await res.json();
    // Grids that return an app URL (BS/LT) read it back here; tenant grids that
    // register the build and reference it differently (Digital.ai → `cloud:`)
    // override `uploadResponseToAppRef`.
    const appRef = this.spec.uploadResponseToAppRef
      ? this.spec.uploadResponseToAppRef(data, { use: this.use, appBundleId: this.appBundleId })
      : (data as { app_url?: string }).app_url;
    if (!appRef) {
      logger.error('Build upload did not return an app reference:', data);
    }
    return appRef;
  }

  async getDevice(): Promise<DeviceHandle> {
    const device = this.use.device as { name?: string; osVersion?: string };
    if (!device.name || !device.osVersion) {
      throw new Error(
        `device.name and device.osVersion are required for the ${this.spec.provider} provider.`,
      );
    }
    const envVar = this.spec.appUrlEnvVar(this.projectName);
    const appUrl = process.env[envVar] ?? '';
    if (!appUrl && !this.spec.appOptional) {
      throw new Error(`process.env.${envVar} is not set — did the build upload run?`);
    }

    const connection = buildCloudConnection(this.spec, this.use, appUrl, this.projectName);

    const WebDriver = (await import('webdriver')).default;
    ensurePlainGlobalDispatcher();
    const driver = await WebDriver.newSession(connection as never);
    this.sessionId = driver.sessionId;
    this.driver = driver as DeviceHandle['driver'];

    const bundleId = this.spec.resolveBundleId
      ? await this.spec.resolveBundleId(this.sessionId, this.authHeader())
      : this.appBundleId;

    return {
      driver,
      bundleId,
      options: { expectTimeout: this.use.expectTimeout ?? 30_000 },
      provider: this.spec.provider,
    };
  }

  async syncTestDetails(details: {
    status?: string;
    reason?: string;
    name?: string;
  }): Promise<void> {
    // Command-based grids (Digital.ai) report status with an in-test driver
    // command on the still-open session. Best-effort — a failed report must
    // never break teardown.
    if (this.spec.reportStatusCommand) {
      const cmd = this.spec.reportStatusCommand(details);
      if (cmd && this.driver) {
        try {
          await this.driver.executeScript(
            cmd.script,
            cmd.args as Parameters<DeviceHandle['driver']['executeScript']>[1],
          );
        } catch (err) {
          logger.error(`Failed to report status to ${this.spec.provider}:`, err);
        }
      }
      return;
    }
    if (!this.sessionId || !this.spec.syncRequest) {
      return;
    }
    const { url, method, body } = this.spec.syncRequest(this.sessionId, details);
    const res = await fetch(url, {
      method,
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok && this.spec.strictSync) {
      throw new Error(`Failed to sync ${this.spec.provider} session details: ${res.statusText}`);
    }
  }
}
