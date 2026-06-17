import fs from 'node:fs';
import path from 'node:path';
import {
  type TaqwrightUseOptions,
  type DeviceHandle,
  type DeviceProvider,
} from '../types/index.js';
import { logger } from '../logger.js';
import { ensurePlainGlobalDispatcher } from '../undici-dispatcher.js';

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
  readonly provider: 'browserstack' | 'lambdatest';
  /** `[usernameEnvVar, accessKeyEnvVar]` read from the ambient environment. */
  readonly credentialEnv: readonly [string, string];
  /** A `buildPath` already on the grid (this scheme) skips the upload step. */
  readonly prebuiltScheme: string;
  /** Env var (per project) that carries the resolved, uploaded app URL. */
  appUrlEnvVar(projectName: string): string;
  /** Build upload: the endpoint plus the request body for url- vs file-based uploads. */
  readonly upload: {
    readonly endpoint: string;
    urlBody(buildPath: string, projectName: string): URLSearchParams;
    fileBody(file: Buffer, fileName: string, projectName: string): FormData;
  };
  /** WebDriver connection to the grid hub. */
  readonly hub: {
    readonly hostname: string;
    readonly port: number;
    readonly path: string;
    readonly protocol: 'https';
  };
  /** Build the session capabilities for this grid. */
  buildCapabilities(args: {
    use: TaqwrightUseOptions;
    projectName: string;
    appUrl: string;
  }): Record<string, unknown>;
  /** Build the status-sync request (PUT/PATCH the grid's session endpoint). */
  syncRequest(
    sessionId: string,
    details: { status?: string; reason?: string; name?: string },
  ): { url: string; method: string; body: string };
  /** Surface a failed status-sync as an error (grids that 404 a not-yet-ready session set this false). */
  readonly strictSync: boolean;
  /** Resolve the installed bundle id after the session opens (grid session API). Optional. */
  resolveBundleId?(sessionId: string, authHeader: string): Promise<string | undefined>;
  /** Require an `appBundleId` at construction (grids that can't read it back). */
  readonly requireBundleId?: boolean;
}

/** HTTP Basic credentials header from a username/key pair. */
export function basicAuth(user: string | undefined, key: string | undefined): string {
  return `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`;
}

/**
 * Generic cloud device provider. Concrete grids subclass this with a
 * `CloudSpec` (see browserstack/ and lambdatest/), supplying no behaviour of
 * their own beyond the spec.
 */
export class CloudProvider implements DeviceProvider {
  sessionId?: string;
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
    const [userVar, keyVar] = this.spec.credentialEnv;
    return basicAuth(process.env[userVar], process.env[keyVar]);
  }

  async globalSetup(): Promise<void> {
    if (!this.use.buildPath) {
      throw new Error('Build path not found. Set `buildPath` in your taqwright config.');
    }
    const [userVar, keyVar] = this.spec.credentialEnv;
    if (!(process.env[userVar] && process.env[keyVar])) {
      throw new Error(
        `${userVar} and ${keyVar} are required for the ${this.spec.provider} provider.`,
      );
    }
    const appUrl = await this.resolveAppUrl(this.use.buildPath);
    process.env[this.spec.appUrlEnvVar(this.projectName)] = appUrl;
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
    const res = await fetch(this.spec.upload.endpoint, {
      method: 'POST',
      headers: { Authorization: this.authHeader() },
      body,
    });
    const data = (await res.json()) as { app_url?: string };
    if (!data.app_url) {
      logger.error('Build upload did not return an app URL:', data);
    }
    return data.app_url;
  }

  async getDevice(): Promise<DeviceHandle> {
    const device = this.use.device as { name?: string; osVersion?: string };
    if (!device.name || !device.osVersion) {
      throw new Error(
        `device.name and device.osVersion are required for the ${this.spec.provider} provider.`,
      );
    }
    const envVar = this.spec.appUrlEnvVar(this.projectName);
    const appUrl = process.env[envVar];
    if (!appUrl) {
      throw new Error(`process.env.${envVar} is not set — did the build upload run?`);
    }

    const [userVar, keyVar] = this.spec.credentialEnv;
    const connection = {
      ...this.spec.hub,
      logLevel: 'warn',
      // Cloud device allocation can be slow — especially many parallel sessions
      // queueing for real devices. The wdio default (120s) aborts the `/session`
      // POST before a device is granted; give it room (override via
      // `appium.connectionTimeout`).
      connectionRetryTimeout: this.use.appium?.connectionTimeout ?? 300_000,
      user: process.env[userVar],
      key: process.env[keyVar],
      capabilities: this.spec.buildCapabilities({
        use: this.use,
        projectName: this.projectName,
        appUrl,
      }),
    };

    const WebDriver = (await import('webdriver')).default;
    ensurePlainGlobalDispatcher();
    const driver = await WebDriver.newSession(connection as never);
    this.sessionId = driver.sessionId;

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
    if (!this.sessionId) {
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
