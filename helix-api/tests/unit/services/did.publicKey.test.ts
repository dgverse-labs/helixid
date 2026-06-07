// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import { describe, expect, it } from 'vitest';
import { generateKeyPair, publicKeyToMultibase } from '@helix-id/core';
import { extractEd25519PublicKeyHexFromDIDDocument } from '../../../src/services/did/publicKey.js';

describe('extractEd25519PublicKeyHexFromDIDDocument', () => {
  it('extracts a lowercase publicKeyHex from a direct DID document', () => {
    expect(
      extractEd25519PublicKeyHexFromDIDDocument({
        verificationMethod: [
          { type: 'JsonWebKey2020', publicKeyHex: 'ignored' },
          { type: 'Ed25519VerificationKey2020', publicKeyHex: 'ABCDEF' },
        ],
      }),
    ).toBe('abcdef');
  });

  it('extracts publicKeyMultibase from didDocument and document wrappers', () => {
    const keyPair = generateKeyPair();
    const publicKeyMultibase = publicKeyToMultibase(keyPair.publicKey);

    expect(
      extractEd25519PublicKeyHexFromDIDDocument({
        didDocument: {
          verificationMethod: [{ type: 'Ed25519VerificationKey2020', publicKeyMultibase }],
        },
      }),
    ).toBe(keyPair.publicKey);

    expect(
      extractEd25519PublicKeyHexFromDIDDocument({
        document: {
          verificationMethod: [{ type: 'Ed25519VerificationKey2020', publicKeyMultibase }],
        },
      }),
    ).toBe(keyPair.publicKey);
  });

  it('rejects DID documents without an Ed25519 verification method', () => {
    expect(() => extractEd25519PublicKeyHexFromDIDDocument({
      verificationMethod: [{ type: 'JsonWebKey2020', publicKeyHex: 'abc' }],
    })).toThrow('Issuer DID document does not contain an Ed25519 verification method');
  });

  it('rejects Ed25519 verification methods without usable key material', () => {
    expect(() => extractEd25519PublicKeyHexFromDIDDocument({
      verificationMethod: [{ type: 'Ed25519VerificationKey2020' }],
    })).toThrow('Issuer DID document does not contain usable public key material');
  });
});
