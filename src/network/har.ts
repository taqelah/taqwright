/**
 * Pure HAR 1.2 builder. No I/O — the proxy feeds it events, the fixture
 * serializes the result with `JSON.stringify` at teardown.
 *
 * Spec ref: http://www.softwareishard.com/blog/har-12-spec/. The shape this
 * produces is the minimum a HAR viewer (Chrome DevTools "Import HAR…",
 * online viewers) will accept — request/response with headers, status,
 * timing, optional body — so the artifact is readable without taqwright-
 * specific tooling.
 */

import { URL } from 'node:url';

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarRequestInit {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarHeader[];
  bodyBytes?: number;
  bodyText?: string;
  startedAt: Date;
}

export interface HarResponseInit {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarHeader[];
  mimeType: string;
  bodyBytes?: number;
  bodyText?: string;
  endedAt: Date;
}

export interface HarEntryHandle {
  id: number;
  onResponse(r: HarResponseInit): void;
  onError(err: string): void;
}

export interface HarLog {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    comment?: string;
    entries: HarEntry[];
  };
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: HarHeader[];
    queryString: HarHeader[];
    cookies: HarHeader[];
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: HarHeader[];
    cookies: HarHeader[];
    content: { size: number; mimeType: string; text?: string };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
  comment?: string;
  _error?: string;
}

export interface HarBuilder {
  /** Open an entry for an in-flight request. Returns a handle for the response/error callback. */
  startEntry(req: HarRequestInit): HarEntryHandle;
  /** Append a free-form comment line to `log.comment` (used for warnings). */
  addComment(line: string): void;
  /** Snapshot the current state as a serializable HAR object. */
  toJson(): HarLog;
}

export function createHarBuilder(meta: { creator: string; version?: string }): HarBuilder {
  const entries: HarEntry[] = [];
  const comments: string[] = [];
  let nextId = 0;

  return {
    startEntry(req) {
      const id = nextId++;
      const entry: HarEntry = {
        startedDateTime: req.startedAt.toISOString(),
        time: 0,
        request: {
          method: req.method,
          url: req.url,
          httpVersion: req.httpVersion,
          headers: req.headers,
          queryString: parseQuery(req.url),
          cookies: [],
          headersSize: -1,
          bodySize: req.bodyBytes ?? -1,
          ...(req.bodyText !== undefined
            ? {
                postData: {
                  mimeType: headerValue(req.headers, 'content-type') ?? 'application/octet-stream',
                  text: req.bodyText,
                },
              }
            : {}),
        },
        response: {
          status: 0,
          statusText: '',
          httpVersion: '',
          headers: [],
          cookies: [],
          content: { size: 0, mimeType: '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: 0, wait: -1, receive: -1 },
      };
      entries.push(entry);
      const startedAt = req.startedAt.getTime();
      return {
        id,
        onResponse(r) {
          entry.time = Math.max(0, r.endedAt.getTime() - startedAt);
          entry.response.status = r.status;
          entry.response.statusText = r.statusText;
          entry.response.httpVersion = r.httpVersion;
          entry.response.headers = r.headers;
          entry.response.content.mimeType = r.mimeType;
          entry.response.content.size = r.bodyBytes ?? 0;
          if (r.bodyText !== undefined) entry.response.content.text = r.bodyText;
          entry.response.bodySize = r.bodyBytes ?? -1;
          entry.response.redirectURL = headerValue(r.headers, 'location') ?? '';
          entry.timings.wait = entry.time;
        },
        onError(err) {
          entry._error = err;
        },
      };
    },
    addComment(line) {
      comments.push(line);
    },
    toJson() {
      return {
        log: {
          version: '1.2',
          creator: { name: meta.creator, version: meta.version ?? '0' },
          ...(comments.length ? { comment: comments.join('\n') } : {}),
          entries,
        },
      };
    },
  };
}

function parseQuery(url: string): HarHeader[] {
  try {
    const u = new URL(url);
    const out: HarHeader[] = [];
    for (const [name, value] of u.searchParams) out.push({ name, value });
    return out;
  } catch {
    return [];
  }
}

function headerValue(headers: HarHeader[], name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value;
  }
  return undefined;
}
