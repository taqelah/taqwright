/**
 * Root CA generation + leaf-cert minting for the network capture proxy.
 *
 * The CA is cached under `~/.taqwright/network-ca/` so a fresh
 * `npm install` doesn't invalidate the cert that's already been pushed to
 * an emulator's system store from a previous run. Leaf certs (one per
 * destination host) are minted on demand and held in an LRU.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';

const CA_DIR = path.join(os.homedir(), '.taqwright', 'network-ca');
const CA_CERT_PATH = path.join(CA_DIR, 'ca.pem');
const CA_KEY_PATH = path.join(CA_DIR, 'ca.key');

export interface CaBundle {
  /** PEM of the root certificate. Push this to the emulator's system store. */
  certPem: string;
  /** Path of the PEM on disk — handy for `adb push` / `xcrun simctl keychain`. */
  certPemPath: string;
  /** Filename Android expects under `/system/etc/security/cacerts/` (`<hash>.0`). */
  androidHashName: string;
  /** Sign and return a leaf cert + key for the given hostname (cached). */
  signLeaf(host: string): { keyPem: string; certPem: string };
}

const LEAF_CACHE_MAX = 256;

export async function ensureCa(): Promise<CaBundle> {
  await fs.mkdir(CA_DIR, { recursive: true });

  let certPem: string | undefined;
  let keyPem: string | undefined;
  try {
    certPem = await fs.readFile(CA_CERT_PATH, 'utf-8');
    keyPem = await fs.readFile(CA_KEY_PATH, 'utf-8');
  } catch {
    // generate fresh
  }

  let caCert: forge.pki.Certificate;
  let caKey: forge.pki.rsa.PrivateKey;

  if (certPem && keyPem && isStillValid(certPem)) {
    caCert = forge.pki.certificateFromPem(certPem);
    caKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
  } else {
    const generated = generateCa();
    caCert = generated.cert;
    caKey = generated.key;
    certPem = forge.pki.certificateToPem(caCert);
    keyPem = forge.pki.privateKeyToPem(caKey);
    await fs.writeFile(CA_CERT_PATH, certPem, { mode: 0o644 });
    await fs.writeFile(CA_KEY_PATH, keyPem, { mode: 0o600 });
  }

  const androidHashName = androidSubjectHashOld(caCert);
  const leafCache = new Map<string, { keyPem: string; certPem: string }>();

  return {
    certPem,
    certPemPath: CA_CERT_PATH,
    androidHashName,
    signLeaf(host) {
      const cached = leafCache.get(host);
      if (cached) {
        // LRU touch: re-insert to mark as most recently used.
        leafCache.delete(host);
        leafCache.set(host, cached);
        return cached;
      }
      const { cert, key } = generateLeaf(host, caCert, caKey);
      const pair = {
        keyPem: forge.pki.privateKeyToPem(key),
        certPem: forge.pki.certificateToPem(cert),
      };
      leafCache.set(host, pair);
      if (leafCache.size > LEAF_CACHE_MAX) {
        const oldest = leafCache.keys().next().value;
        if (oldest) leafCache.delete(oldest);
      }
      return pair;
    },
  };
}

function isStillValid(pem: string): boolean {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    const now = Date.now();
    // Refresh in the last 30d of validity so a long-running CI shop doesn't
    // hit an expired CA mid-run.
    const thirtyDays = 30 * 24 * 3600 * 1000;
    return cert.validity.notAfter.getTime() - now > thirtyDays;
  } catch {
    return false;
  }
}

function generateCa(): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [
    { name: 'commonName', value: 'taqwright network capture CA' },
    { name: 'organizationName', value: 'taqwright' },
    { name: 'organizationalUnitName', value: 'network' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

function generateLeaf(
  host: string,
  caCert: forge.pki.Certificate,
  caKey: forge.pki.rsa.PrivateKey,
): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);
  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer(caCert.subject.attributes);
  const altNames = isIp(host) ? [{ type: 7, ip: host }] : [{ type: 2, value: host }];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { name: 'subjectAltName', altNames },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

function randomSerial(): string {
  // forge needs a positive hex string; high bit clear so DER encodes positive.
  const bytes = forge.random.getBytesSync(16);
  let hex = forge.util.bytesToHex(bytes);
  if (parseInt(hex[0]!, 16) > 7) hex = '0' + hex.slice(1);
  return hex;
}

function isIp(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':');
}

/**
 * Replicates OpenSSL's `-subject_hash_old`: MD5 over the DER encoding of the
 * canonical subject sequence, taking the first 4 bytes little-endian as an
 * 8-char lowercase hex string. Android's `/system/etc/security/cacerts/<hash>.0`
 * has historically used this old hash form across all API levels.
 */
function androidSubjectHashOld(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.distinguishedNameToAsn1(cert.subject)).getBytes();
  const md = forge.md.md5.create();
  md.update(der);
  const digestHex = md.digest().toHex();
  // First 4 bytes of MD5, reversed (little-endian).
  const b0 = digestHex.slice(0, 2);
  const b1 = digestHex.slice(2, 4);
  const b2 = digestHex.slice(4, 6);
  const b3 = digestHex.slice(6, 8);
  return `${b3}${b2}${b1}${b0}`;
}
