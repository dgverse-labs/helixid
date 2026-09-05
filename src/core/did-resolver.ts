import { buildDIDDocument, type DIDDocument } from './crypto/did.js';
import { base58btcDecode } from './crypto/vp.js';
import { loadDidHederaResolver } from './did-hedera-loader.js';
import {
  DIDMethodNotAvailableError,
  UnsupportedDIDMethodError,
  ValidationError,
} from './errors/HelixError.js';

const DID_WEB_TTL_MS = 5 * 60 * 1000;
const DID_HEDERA_TTL_MS = 15 * 60 * 1000;
const ED25519_MULTICODEC_PREFIX = [0xed, 0x01] as const;

const cache = new Map<string, { doc: DIDDocument; expiresAt: number }>();

function getCached(did: string): DIDDocument | null {
  const cached = cache.get(did);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(did);
    return null;
  }
  return cached.doc;
}

function setCached(did: string, doc: DIDDocument, ttlMs: number): DIDDocument {
  cache.set(did, { doc, expiresAt: Date.now() + ttlMs });
  return doc;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * Local/demo escape hatch: a did:web host of "localhost" (or another
 * loopback form) is only reachable when the resolver runs on the same
 * machine as the DID subject. When helix-api itself runs in a separate
 * container (e.g. docker-compose demos where each SP has its own did:web
 * identity on "localhost" for the *browser's* benefit), "localhost" from
 * inside helix-api's own container means itself, not the SP -- so a fetch
 * to any URL built from that DID (its document, its status list, ...) would
 * otherwise always fail. DID_WEB_LOOPBACK_RESOLVE_HOST redirects just that
 * fetch's target (e.g. to "host.docker.internal", which routes back out to
 * the host's published ports) without changing the DID or URL otherwise.
 */
export function applyLoopbackResolveOverride(url: string): string {
  const override = process.env['DID_WEB_LOOPBACK_RESOLVE_HOST'];
  if (!override) return url;
  const parsed = new URL(url);
  if (!isLoopbackHost(parsed.hostname)) return url;
  parsed.hostname = override;
  return parsed.toString();
}

function didWebToUrl(did: string): string {
  const parts = did.split(':');
  if (parts.length < 3 || parts[0] !== 'did' || parts[1] !== 'web') {
    throw new ValidationError(`Invalid did:web DID: ${did}`);
  }

  const decoded = parts.slice(2).map(decodeURIComponent);
  let [host, ...pathParts] = decoded;
  if (!host) {
    throw new ValidationError(`Invalid did:web DID: ${did}`);
  }

  // Compatibility: accept legacy/local did:web forms like did:web:localhost:3000
  // and did:web:127.0.0.1:3000 where port was not percent-encoded.
  if (isLoopbackHost(host) && pathParts.length > 0 && /^\d+$/.test(pathParts[0] ?? '')) {
    host = `${host}:${pathParts[0]}`;
    pathParts = pathParts.slice(1);
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    throw new ValidationError(`Invalid did:web DID: ${did}`);
  }

  const path =
    pathParts.length === 0 ? '/.well-known/did.json' : `/${pathParts.join('/')}/did.json`;

  const scheme = isLoopbackHost(hostname) ? 'http' : 'https';
  return applyLoopbackResolveOverride(`${scheme}://${host}${path}`);
}

function resolveDidKey(did: string): DIDDocument {
  const fingerprint = did.slice('did:key:'.length);
  if (!fingerprint.startsWith('z')) {
    throw new ValidationError(`Invalid did:key fingerprint: ${did}`);
  }
  const decoded = base58btcDecode(fingerprint.slice(1));
  if (
    decoded[0] !== ED25519_MULTICODEC_PREFIX[0] ||
    decoded[1] !== ED25519_MULTICODEC_PREFIX[1] ||
    decoded.length !== 34
  ) {
    throw new ValidationError(`Only Ed25519 did:key documents are supported: ${did}`);
  }
  const publicKeyHex = Buffer.from(decoded.slice(2)).toString('hex');
  return buildDIDDocument(did, publicKeyHex);
}

async function resolveDidWeb(did: string): Promise<DIDDocument> {
  const response = await fetch(didWebToUrl(did), {
    headers: { accept: 'application/did+json, application/json' },
  });
  if (!response.ok) {
    throw new ValidationError(`did:web resolution failed with HTTP ${response.status}`);
  }
  const doc = (await response.json()) as DIDDocument;
  if (doc.id !== did || !Array.isArray(doc.verificationMethod)) {
    throw new ValidationError(`Invalid DID document for ${did}`);
  }
  return doc;
}

async function resolveDidHedera(did: string): Promise<DIDDocument> {
  const resolve = loadDidHederaResolver();
  if (!resolve) {
    throw new DIDMethodNotAvailableError(
      'did:hedera resolution requires: npm install @helixid/did-hedera',
    );
  }

  return resolve(did);
}

export async function resolveDID(did: string): Promise<DIDDocument> {
  const cached = getCached(did);
  if (cached) return cached;

  if (did.startsWith('did:key:')) {
    return resolveDidKey(did);
  }
  if (did.startsWith('did:web:')) {
    return setCached(did, await resolveDidWeb(did), DID_WEB_TTL_MS);
  }
  if (did.startsWith('did:hedera:')) {
    return setCached(did, await resolveDidHedera(did), DID_HEDERA_TTL_MS);
  }
  throw new UnsupportedDIDMethodError(did);
}

export function clearDIDCache(): void {
  cache.clear();
}
