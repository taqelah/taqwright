/**
 * The telemetry reporter: one anonymous event at the end of a `taqwright test` run (see
 * ./event.ts for what it contains and every way to switch it off).
 *
 * A Playwright reporter because only Playwright knows how many tests ran, how long the run
 * took and whether it passed. It prints nothing (`printsToStdio` is false), so it never mixes
 * into another reporter's output — `--reporter json` writes the report to stdout.
 *
 * The platforms and providers are read from the taqwright config Playwright loaded, for the
 * projects that actually ran, by name. Nothing else from the config — no device names, app
 * ids or paths — goes anywhere.
 */
import { createRequire } from 'node:module';
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';
import { loadTaqwrightConfigFile } from '../config.js';
import { buildEvent, telemetryEnabled, telemetryUrl } from './event.js';
import { sendTelemetry } from './send.js';
import { readStoredTelemetry } from './store.js';

type ProjectFacts = { platform?: string; provider?: string };

export interface TelemetryReporterOptions {
  /** Tests only: the project facts by name, instead of reading the config file. */
  projects?: Record<string, ProjectFacts>;
  /** Tests only: `telemetry` from the config, instead of reading the config file. */
  configTelemetry?: boolean;
  env?: Record<string, string | undefined>;
  argv?: string[];
  fetchImpl?: (url: string, init: RequestInit) => Promise<unknown>;
  home?: string;
}

function packageVersion(): string {
  try {
    return (createRequire(import.meta.url)('../../package.json') as { version: string }).version;
  } catch {
    return '';
  }
}

export default class TelemetryReporter implements Reporter {
  private testCount = 0;
  private projectNames: string[] = [];
  private configFile: string | undefined;
  private listOnly = false;

  constructor(private readonly opts: TelemetryReporterOptions = {}) {}

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const argv = this.opts.argv ?? process.argv;
    // `--list` is not a run.
    this.listOnly = argv.includes('--list');
    this.testCount = suite.allTests().length;
    this.configFile = config.configFile;
    this.projectNames = suite.suites.map((s) => s.project()?.name ?? s.title).filter(Boolean);
  }

  async onEnd(result: FullResult): Promise<void> {
    try {
      if (this.listOnly || this.testCount === 0) return;
      const env = this.opts.env ?? process.env;
      const { projects, configTelemetry } = await this.facts();
      if (
        !telemetryEnabled({ env, configTelemetry, stored: readStoredTelemetry(this.opts.home) })
      ) {
        return;
      }
      const url = telemetryUrl(env);
      if (!url) return;
      const version = packageVersion();
      const event = buildEvent({
        version,
        nodeVersion: process.versions.node,
        osPlatform: process.platform,
        env,
        cmd: 'test',
        projects: this.projectNames.map((n) => projects[n] ?? {}),
        testCount: this.testCount,
        durationMs: result.duration,
        passed: result.status === 'passed',
      });
      if (event) await sendTelemetry(event, { url, version, fetchImpl: this.opts.fetchImpl });
    } catch {
      // Telemetry never fails, delays past its timeout, or reports on a run.
    }
  }

  private async facts(): Promise<{
    projects: Record<string, ProjectFacts>;
    configTelemetry?: boolean;
  }> {
    if (this.opts.projects) {
      return { projects: this.opts.projects, configTelemetry: this.opts.configTelemetry };
    }
    const cfg = this.configFile ? await loadTaqwrightConfigFile(this.configFile) : undefined;
    const projects: Record<string, ProjectFacts> = {};
    for (const p of cfg?.projects ?? []) {
      projects[p.name] = {
        platform: p.use?.platform,
        provider: (p.use?.device as { provider?: string } | undefined)?.provider,
      };
    }
    return { projects, configTelemetry: cfg?.telemetry };
  }
}
