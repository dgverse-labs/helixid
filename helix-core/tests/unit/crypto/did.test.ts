// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from 'vitest';
import {
  deriveDID,
  buildDIDDocument,
  extractPublicKeyFromDIDDocument,
  buildServiceEndpoints,
  addServiceEndpoint,
  removeServiceEndpoint,
} from '../../../src/crypto/did.js';
import { generateKeyPair } from '../../../src/crypto/keys.js';

describe('deriveDID', () => {
  it('returns string matching did:helix pattern', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    expect(did).toMatch(/^did:hedera:testnet:[0-9a-f]{32}$/);
  });

  it('same key always produces same DID (deterministic)', () => {
    const { publicKey } = generateKeyPair();
    expect(deriveDID(publicKey)).toBe(deriveDID(publicKey));
  });

  it('different keys produce different DIDs', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    expect(deriveDID(kp1.publicKey)).not.toBe(deriveDID(kp2.publicKey));
  });
});

describe('buildDIDDocument', () => {
  it('contains correct @context', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
  });

  it('id and controller equal the DID argument', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc.id).toBe(did);
    expect(doc.controller).toBe(did);
  });

  it('verificationMethod[0].type is correct', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc.verificationMethod[0]?.type).toBe('Ed25519VerificationKey2020');
  });

  it('authentication and assertionMethod contain key ID', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    const keyId = `${did}#key-1`;
    expect(doc.authentication).toContain(keyId);
    expect(doc.assertionMethod).toContain(keyId);
  });

  it('service is undefined when no endpoints provided', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc.service).toBeUndefined();
  });

  it('service has correct entries when endpoints provided', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const endpoints = buildServiceEndpoints(['https://example.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    expect(doc.service).toHaveLength(1);
    expect(doc.service?.[0]?.serviceEndpoint).toBe('https://example.com');
  });
});

describe('extractPublicKeyFromDIDDocument', () => {
  it('extracts the original public key (roundtrip)', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(extractPublicKeyFromDIDDocument(doc)).toBe(publicKey);
  });

  it('throws if no Ed25519 verification method present', () => {
    const doc = {
      '@context': [],
      id: 'did:helix:123',
      controller: 'did:helix:123',
      verificationMethod: [],
      authentication: [],
      assertionMethod: [],
    };
    expect(() => extractPublicKeyFromDIDDocument(doc as any)).toThrow();
  });
});

describe('buildServiceEndpoints', () => {
  it('returns array with correct id format', () => {
    const endpoints = buildServiceEndpoints(['https://a.com', 'https://b.com']);
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]?.id).toBe('#domain-1');
    expect(endpoints[1]?.id).toBe('#domain-2');
  });
});

describe('addServiceEndpoint', () => {
  it('adds endpoint and returns new document (pure)', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    const newEndpoint = { id: '#domain-1', type: 'LinkedDomains', serviceEndpoint: 'https://x.com' };
    const updated = addServiceEndpoint(doc, newEndpoint);
    
    expect(updated.service).toHaveLength(1);
    expect(doc.service).toBeUndefined(); // immutability
  });

  it('throws if endpoint ID already exists', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const endpoints = buildServiceEndpoints(['https://a.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    
    expect(() => addServiceEndpoint(doc, endpoints[0]!)).toThrow();
  });
});

describe('removeServiceEndpoint', () => {
  it('removes correct endpoint', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const endpoints = buildServiceEndpoints(['https://a.com', 'https://b.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    
    const updated = removeServiceEndpoint(doc, '#domain-1');
    expect(updated.service).toHaveLength(1);
    expect(updated.service?.[0]?.id).toBe('#domain-2');
  });

  it('service becomes undefined when last endpoint removed', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const endpoints = buildServiceEndpoints(['https://a.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    
    const updated = removeServiceEndpoint(doc, '#domain-1');
    expect(updated.service).toBeUndefined();
  });

  it('throws if endpoint ID not found', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDID(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(() => removeServiceEndpoint(doc, '#none')).toThrow();
  });
});
