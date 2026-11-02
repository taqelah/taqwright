/**
 * Anonymous usage telemetry: what one event contains, and whether to send it.
 *
 * One event per `taqwright test` run, sent after the run by the telemetry reporter
 * (./reporter.ts). Ten fields, each from a fixed set — the receiving server refuses
 * anything else — and nothing that identifies a person, a project or a test: no test names,
 * paths, app or bundle ids, device names, error text, hostnames or repository names, and no
 * id that would link one run to another. Documented in the README ("Telemetry").
 *
 * Off with any of: `TAQWRIGHT_TELEMETRY=0`, `DO_NOT_TRACK=1`, `telemetry: false` in
 * `taqwright.config.ts`, or `taqwright telemetry disable`. An off switch always wins.
 *
 * Pure: no I/O.
 */

export const TELEMETRY_URL = 'https://www.taqwright.ai/api/telemetry';

export interface TelemetryEvent {
  v: string;
  node: string;
  os: 'darwin' | 'linux' | 'win32' | 'other';
  ci: boolean;
  cmd: 'test';
  platforms: Array<'android' | 'ios'>;
  provider:
    'local' | 'emulator' | 'lambdatest' | 'browserstack' | 'digitalai' | 'pcloudy' | 'other';
  tests: '1-10' | '11-50' | '51-200' | '200+';
  duration: '<1m' | '1-5m' | '5-15m' | '15m+';
  passed: boolean;
}

type Env = Record<string, string | undefined>;

const OFF = new Set(['0', 'false', 'off', 'no']);
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?$/;

/**
 * Whether to send. On unless something says off, and any off switch wins over anything that
 * says on: `TAQWRIGHT_TELEMETRY=1` does not override `DO_NOT_TRACK=1` or a stored `disable`.
 */
export function telemetryEnabled(o: {
  env: Env;
  configTelemetry?: boolean;
  stored?: boolean;
}): boolean {
  const flag = String(o.env.TAQWRIGHT_TELEMETRY ?? '')
    .trim()
    .toLowerCase();
  if (OFF.has(flag)) return false;
  const dnt = String(o.env.DO_NOT_TRACK ?? '')
    .trim()
    .toLowerCase();
  if (dnt === '1' || dnt === 'true') return false;
  if (o.configTelemetry === false) return false;
  if (o.stored === false) return false;
  return true;
}

/**
 * Where to send: the fixed endpoint, or `TAQWRIGHT_TELEMETRY_URL` when it is https — or plain
 * http on this machine only, for testing a local server. Anything else answers `null` and
 * nothing is sent: a mistyped override must never send events somewhere unintended in clear.
 */
export function telemetryUrl(env: Env): string | null {
  const override = env.TAQWRIGHT_TELEMETRY_URL;
  if (!override) return TELEMETRY_URL;
  let u: URL;
  try {
    u = new URL(override);
  } catch {
    return null;
  }
  if (u.protocol === 'https:') return u.href;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
    return u.href;
  }
  return null;
}

/** Whether this run is in CI, from the variables CI systems set. */
export function isCi(env: Env): boolean {
  const ci = String(env.CI ?? '')
    .trim()
    .toLowerCase();
  if (ci && ci !== 'false' && ci !== '0') return true;
  return ['GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL', 'TF_BUILD'].some(
    (k) => !!env[k],
  );
}

export function testsBucket(n: number): TelemetryEvent['tests'] | null {
  if (!(n > 0)) return null;
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  return '200+';
}

export function durationBucket(ms: number): TelemetryEvent['duration'] {
  const m = (Number(ms) || 0) / 60_000;
  if (m < 1) return '<1m';
  if (m < 5) return '1-5m';
  if (m < 15) return '5-15m';
  return '15m+';
}

const PROVIDERS: Record<string, TelemetryEvent['provider']> = {
  'local-device': 'local',
  emulator: 'emulator',
  lambdatest: 'lambdatest',
  browserstack: 'browserstack',
  digitalai: 'digitalai',
  pcloudy: 'pcloudy',
};

/**
 * The event for one run, or `null` when there is nothing to send (no tests ran) or a value
 * would not be accepted (a version that is not plain semver, e.g. a local build).
 */
export function buildEvent(o: {
  version: string;
  nodeVersion: string;
  osPlatform: string;
  env: Env;
  cmd: 'test';
  projects: Array<{ platform?: string; provider?: string }>;
  testCount: number;
  durationMs: number;
  passed: boolean;
}): TelemetryEvent | null {
  const tests = testsBucket(o.testCount);
  if (!tests || !SEMVER.test(o.version)) return null;
  const platforms = (['android', 'ios'] as const).filter((p) =>
    o.projects.some((x) => x.platform === p),
  );
  const providers = new Set(o.projects.map((x) => PROVIDERS[String(x.provider)] ?? 'other'));
  const os = (['darwin', 'linux', 'win32'] as const).find((x) => x === o.osPlatform) ?? 'other';
  return {
    v: o.version,
    node: String(o.nodeVersion).split('.')[0]!.slice(0, 2),
    os,
    ci: isCi(o.env),
    cmd: o.cmd,
    platforms,
    provider: providers.size === 1 ? [...providers][0]! : 'other',
    tests,
    duration: durationBucket(o.durationMs),
    passed: o.passed,
  };
}
