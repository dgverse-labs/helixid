import {
  buildDIDDocument,
  type DIDDocument,
} from './crypto/did.js';
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

function didWebToUrl(did: string): string {
  const parts = did.split(':');
  if (parts.length < 3 || parts[0] !== 'did' || parts[1] !== 'web') {
    throw new ValidationError(`Invalid did:web DID: ${did}`);
  }
  const [host, ...pathParts] = parts.slice(2).map(decodeURIComponent);
  if (!host) {
    throw new ValidationError(`Invalid did:web DID: ${did}`);
  }
  const path = pathParts.length === 0
    ? '/.well-known/did.json'
    : `/${pathParts.join('/')}/did.json`;
  return `https://${host}${path}`;
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
  const doc = await response.json() as DIDDocument;
  if (doc.id !== did || !Array.isArray(doc.verificationMethod)) {
    throw new ValidationError(`Invalid DID document for ${did}`);
  }
  return doc;
}

async function resolveDidHedera(did: string): Promise<DIDDocument> {
  const resolve = loadDidHederaResolver();
  if (!resolve) {
    throw new DIDMethodNotAvailableError(
      'did:hedera resolution requires: npm install @helix-id/did-hedera',
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
