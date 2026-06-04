/**
 * Hand-rolled MITM HTTP/HTTPS proxy for the network capture artifact.
 *
 * Why hand-rolled instead of `http-mitm-proxy`: that package is CommonJS
 * (NodeNext/ESM interop is fragile in this build) and pulls a long
 * dependency chain. The slice we actually need — plain-HTTP proxying,
 * CONNECT-based HTTPS interception with on-the-fly leaf certs, request /
 * response capture for HAR — fits in this file plus `ca.ts`.
 *
 * Scope and known limitations:
 * - HTTP/1.1 only (we negotiate ALPN `http/1.1`). HTTP/2 traffic is
 *   blind-tunnelled; we still see the host + bytes but not headers/bodies.
 * - WebSockets pass through after the upgrade — bytes after the handshake
 *   are not parsed into HAR entries.
 * - Request and response bodies are captured up to MAX_BODY_CAPTURE bytes
 *   per direction; over that, the stream is still forwarded but the HAR
 *   body field is truncated and `bodyBytes` reflects the real total.
 * - Pinning detection: per host, if the client tears down the TLS handshake
 *   PINNING_THRESHOLD times without sending a single HTTP byte, future
 *   CONNECTs for that host are blind-tunnelled (so the app keeps working)
 *   and one `pinned: <host>` line is written into the HAR comment.
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { type CaBundle } from './ca.js';
import { createHarBuilder, type HarBuilder, type HarHeader, type HarLog } from './har.js';

const MAX_BODY_CAPTURE = 1 * 1024 * 1024; // 1 MiB per direction
const PINNING_THRESHOLD = 3;
const TEXT_MIME =
  /^(text\/|application\/(json|xml|x-www-form-urlencoded|javascript)|application\/[\w.+-]*\+(json|xml))/i;

export interface ProxyHandle {
  port: number;
  attemptLog: string[];
  /** Snapshot the HAR so far. Safe to call multiple times. */
  flush(): Promise<HarLog>;
  /** Close listeners and tear down. */
  stop(): Promise<void>;
}

export interface ProxyOptions {
  port: number;
  ca: CaBundle;
}

export async function startProxy(opts: ProxyOptions): Promise<ProxyHandle> {
  const har = createHarBuilder({ creator: 'taqwright', version: '0.0.1' });
  const attemptLog: string[] = [];
  const tlsFailCount = new Map<string, number>();
  const pinnedHosts = new Set<string>();

  const server = http.createServer((req, res) => {
    handleHttp(req, res, har).catch((err) => {
      attemptLog.push(`http ${req.url ?? '?'}: ${(err as Error).message}`);
      safeEnd(res, 502);
    });
  });

  server.on('connect', (req, clientSocket, head) => {
    // http.Server types this as Duplex; in practice it's the underlying
    // net.Socket of the inbound HTTP connection. We need net.Socket-only
    // APIs (.write of a raw HTTP/1.1 line, TLSSocket wrapping), so cast.
    handleConnect({
      req,
      clientSocket: clientSocket as net.Socket,
      head,
      ca: opts.ca,
      har,
      tlsFailCount,
      pinnedHosts,
      attemptLog,
    });
  });

  server.on('clientError', (_err, socket) => {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  });

  // Bind 127.0.0.1: reachable from the iOS Simulator (shares host loopback)
  // and from the Android emulator (`10.0.2.2` NATs to host loopback). Not
  // exposed to the local network.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });

  return {
    port: opts.port,
    attemptLog,
    async flush() {
      for (const line of attemptLog) har.addComment(line);
      return har.toJson();
    },
    async stop() {
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

async function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  har: HarBuilder,
): Promise<void> {
  // For plain HTTP the proxy receives the absolute URL in `req.url`.
  const url = req.url ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    safeEnd(res, 400);
    return;
  }
  const startedAt = new Date();

  const upstream = http.request({
    host: parsed.hostname,
    port: parsed.port || 80,
    method: req.method,
    path: parsed.pathname + parsed.search,
    headers: sanitizeRequestHeaders(req.headers, parsed.host),
  });
  await pipeRequestThrough(req, upstream, parsed.toString(), har, startedAt, res);
}

interface ConnectArgs {
  req: http.IncomingMessage;
  clientSocket: net.Socket;
  head: Buffer;
  ca: CaBundle;
  har: HarBuilder;
  tlsFailCount: Map<string, number>;
  pinnedHosts: Set<string>;
  attemptLog: string[];
}

function handleConnect(a: ConnectArgs): void {
  const [host, portStr] = (a.req.url ?? '').split(':');
  const port = Number.parseInt(portStr ?? '443', 10) || 443;
  if (!host) {
    a.clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  // Already known to pin — don't waste a handshake. Blind-tunnel so the
  // app still functions.
  if (a.pinnedHosts.has(host)) {
    blindTunnel(a.clientSocket, a.head, host, port);
    return;
  }

  a.clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

  const leaf = a.ca.signLeaf(host);
  const tlsSocket = new tls.TLSSocket(a.clientSocket, {
    isServer: true,
    key: leaf.keyPem,
    cert: leaf.certPem,
    ALPNProtocols: ['http/1.1'],
  });

  let sawHttpByte = false;

  tlsSocket.on('data', () => {
    sawHttpByte = true;
  });

  tlsSocket.on('error', (_err: Error) => {
    if (!sawHttpByte) {
      const count = (a.tlsFailCount.get(host) ?? 0) + 1;
      a.tlsFailCount.set(host, count);
      if (count >= PINNING_THRESHOLD && !a.pinnedHosts.has(host)) {
        a.pinnedHosts.add(host);
        a.attemptLog.push(`pinned: ${host}`);
      }
    }
    try {
      tlsSocket.destroy();
    } catch {
      /* ignore */
    }
  });

  // Use a parser-only http.Server (never listen'd) to dispatch decrypted
  // requests on this socket. One Server per CONNECT keeps `host`/`port`
  // captured in closure without leaking state across hosts.
  const parser = http.createServer((req2, res2) => {
    handleDecryptedRequest(req2, res2, host, port, a.har).catch((err) => {
      a.attemptLog.push(`https ${host}${req2.url ?? ''}: ${(err as Error).message}`);
      safeEnd(res2, 502);
    });
  });
  parser.emit('connection', tlsSocket);
}

function blindTunnel(clientSocket: net.Socket, head: Buffer, host: string, port: number): void {
  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    clientSocket.pipe(upstream).pipe(clientSocket);
  });
  upstream.on('error', () => {
    try {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    } catch {
      /* ignore */
    }
  });
  clientSocket.on('error', () => {
    try {
      upstream.destroy();
    } catch {
      /* ignore */
    }
  });
}

async function handleDecryptedRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  host: string,
  port: number,
  har: HarBuilder,
): Promise<void> {
  const startedAt = new Date();
  const url = `https://${host}${port === 443 ? '' : `:${port}`}${req.url ?? '/'}`;

  const upstream = https.request({
    host,
    port,
    method: req.method,
    path: req.url,
    headers: sanitizeRequestHeaders(req.headers, host + (port === 443 ? '' : `:${port}`)),
    // SNI lets the upstream pick the right cert when virtual-hosting.
    servername: host,
  });

  await pipeRequestThrough(req, upstream, url, har, startedAt, res);
}

/**
 * Common path for plain HTTP and decrypted HTTPS: forward request to
 * `upstream`, capture request/response (with size cap) into HAR, stream
 * response back to client.
 */
async function pipeRequestThrough(
  req: http.IncomingMessage,
  upstream: http.ClientRequest,
  url: string,
  har: HarBuilder,
  startedAt: Date,
  res: http.ServerResponse,
): Promise<void> {
  const reqChunks: Buffer[] = [];
  let reqBytes = 0;
  let reqCapped = false;

  req.on('data', (chunk: Buffer) => {
    reqBytes += chunk.length;
    if (!reqCapped) {
      if (reqBytes <= MAX_BODY_CAPTURE) reqChunks.push(chunk);
      else reqCapped = true;
    }
    upstream.write(chunk);
  });
  req.on('end', () => upstream.end());
  req.on('error', () => {
    try {
      upstream.destroy();
    } catch {
      /* ignore */
    }
  });

  let upstreamRes: http.IncomingMessage;
  try {
    upstreamRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
      upstream.once('response', resolve);
      upstream.once('error', reject);
    });
  } catch (err) {
    const entry = har.startEntry({
      method: req.method ?? 'GET',
      url,
      httpVersion: `HTTP/${req.httpVersion}`,
      headers: headerObjectToArray(req.headers),
      bodyBytes: reqBytes || -1,
      startedAt,
    });
    entry.onError((err as Error).message);
    safeEnd(res, 502);
    return;
  }

  const entry = har.startEntry({
    method: req.method ?? 'GET',
    url,
    httpVersion: `HTTP/${req.httpVersion}`,
    headers: headerObjectToArray(req.headers),
    bodyBytes: reqBytes || -1,
    bodyText: tryDecodeText(Buffer.concat(reqChunks), getHeader(req.headers, 'content-type')),
    startedAt,
  });

  // Stream response back to client + capture for HAR
  res.statusCode = upstreamRes.statusCode ?? 0;
  res.statusMessage = upstreamRes.statusMessage ?? '';
  for (const [k, v] of Object.entries(upstreamRes.headers)) {
    if (v === undefined) continue;
    try {
      res.setHeader(k, v as string | string[]);
    } catch {
      /* drop bad headers */
    }
  }

  const resChunks: Buffer[] = [];
  let resBytes = 0;
  let resCapped = false;
  upstreamRes.on('data', (chunk: Buffer) => {
    resBytes += chunk.length;
    if (!resCapped) {
      if (resBytes <= MAX_BODY_CAPTURE) resChunks.push(chunk);
      else resCapped = true;
    }
    res.write(chunk);
  });
  await new Promise<void>((resolve) => {
    upstreamRes.on('end', () => {
      res.end();
      resolve();
    });
    upstreamRes.on('error', () => {
      res.end();
      resolve();
    });
  });

  entry.onResponse({
    status: upstreamRes.statusCode ?? 0,
    statusText: upstreamRes.statusMessage ?? '',
    httpVersion: `HTTP/${upstreamRes.httpVersion}`,
    headers: headerObjectToArray(upstreamRes.headers),
    mimeType: getHeader(upstreamRes.headers, 'content-type') ?? '',
    bodyBytes: resBytes,
    bodyText: tryDecodeText(
      Buffer.concat(resChunks),
      getHeader(upstreamRes.headers, 'content-type'),
    ),
    endedAt: new Date(),
  });
}

function headerObjectToArray(h: http.IncomingHttpHeaders): HarHeader[] {
  const out: HarHeader[] = [];
  for (const [name, value] of Object.entries(h)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) out.push({ name, value: v });
    } else {
      out.push({ name, value: String(value) });
    }
  }
  return out;
}

function getHeader(h: http.IncomingHttpHeaders, name: string): string | undefined {
  const v = h[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function sanitizeRequestHeaders(
  h: http.IncomingHttpHeaders,
  host: string,
): http.OutgoingHttpHeaders {
  // Drop proxy-only hop-by-hop headers; force Host to match upstream.
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(h)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower === 'proxy-connection' || lower === 'proxy-authorization') continue;
    out[name] = value;
  }
  out.host = host;
  return out;
}

function tryDecodeText(buf: Buffer, contentType: string | undefined): string | undefined {
  if (buf.length === 0) return undefined;
  if (!contentType || !TEXT_MIME.test(contentType)) return undefined;
  try {
    return buf.toString('utf-8');
  } catch {
    return undefined;
  }
}

function safeEnd(res: http.ServerResponse, status: number): void {
  try {
    if (!res.headersSent) res.statusCode = status;
    res.end();
  } catch {
    // socket already gone
  }
}
