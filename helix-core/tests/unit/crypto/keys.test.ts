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
  generateKeyPair,
  derivePublicKey,
  signData,
  verifySignature,
  publicKeyToMultibase,
  multibaseToPublicKeyHex,
  normalizeEd25519PrivateKeyHex,
} from '../../../src/crypto/keys.js';

describe('generateKeyPair', () => {
  it('produces a 64-char hex private key and 64-char hex public key', () => {
    const kp = generateKeyPair();
    expect(kp.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique keypairs on each call', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe('derivePublicKey', () => {
  it('derives the same public key that generateKeyPair returns', () => {
    const kp = generateKeyPair();
    expect(derivePublicKey(kp.privateKey)).toBe(kp.publicKey);
  });

  it('accepts an Ed25519 PKCS8 DER seed wrapper', () => {
    const kp = generateKeyPair();
    const derWrapped = `302e020100300506032b657004220420${kp.privateKey}`;
    expect(derivePublicKey(derWrapped)).toBe(kp.publicKey);
  });

  it('throws on invalid hex input', () => {
    expect(() => derivePublicKey('not-hex')).toThrow();
  });
});

describe('signData / verifySignature', () => {
  it('signature verifies with matching public key', () => {
    const kp = generateKeyPair();
    const message = 'test message';
    const sig = signData(message, kp.privateKey);
    const messageBytes = new TextEncoder().encode(message);
    expect(verifySignature(messageBytes, sig, kp.publicKey)).toBe(true);
  });

  it('signature fails with wrong public key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const message = 'test message';
    const sig = signData(message, kp1.privateKey);
    const messageBytes = new TextEncoder().encode(message);
    expect(verifySignature(messageBytes, sig, kp2.publicKey)).toBe(false);
  });

  it('signature fails if message is altered', () => {
    const kp = generateKeyPair();
    const message = new TextEncoder().encode('test message');
    const tampered = new TextEncoder().encode('test messagX');
    const sig = signData(message, kp.privateKey);
    expect(verifySignature(tampered, sig, kp.publicKey)).toBe(false);
  });

  it('signs with an Ed25519 PKCS8 DER seed wrapper', () => {
    const kp = generateKeyPair();
    const message = new TextEncoder().encode('test');
    const derWrapped = `302e020100300506032b657004220420${kp.privateKey}`;
    const sig = signData(message, derWrapped);
    expect(verifySignature(message, sig, kp.publicKey)).toBe(true);
  });

  it('returns false for malformed signature hex', () => {
    const kp = generateKeyPair();
    const message = new TextEncoder().encode('test');
    expect(verifySignature(message, 'not-hex', kp.publicKey)).toBe(false);
  });

  it('returns false for malformed public key hex', () => {
    const kp = generateKeyPair();
    const message = 'test';
    const sig = signData(message, kp.privateKey);
    const messageBytes = new TextEncoder().encode(message);
    expect(verifySignature(messageBytes, sig, 'not-hex')).toBe(false);
  });
});

describe('normalizeEd25519PrivateKeyHex', () => {
  it('normalizes raw and PKCS8 DER seed keys', () => {
    const kp = generateKeyPair();
    expect(normalizeEd25519PrivateKeyHex(kp.privateKey)).toBe(kp.privateKey);
    expect(normalizeEd25519PrivateKeyHex(`302e020100300506032b657004220420${kp.privateKey}`)).toBe(kp.privateKey);
  });

  it('rejects unsupported key formats', () => {
    expect(normalizeEd25519PrivateKeyHex('not-a-key')).toBeNull();
  });
});

describe('publicKeyToMultibase / multibaseToPublicKeyHex', () => {
  it('roundtrips: encode → decode returns original hex', () => {
    const kp = generateKeyPair();
    const multibase = publicKeyToMultibase(kp.publicKey);
    expect(multibase.startsWith('z')).toBe(true);
    expect(multibaseToPublicKeyHex(multibase)).toBe(kp.publicKey);
  });

  it('throws on non-base58btc multibase prefix', () => {
    expect(() => multibaseToPublicKeyHex('u' + 'abc')).toThrow();
  });

  it('multiple different keys produce different multibase strings', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    expect(publicKeyToMultibase(kp1.publicKey)).not.toBe(publicKeyToMultibase(kp2.publicKey));
  });
});
