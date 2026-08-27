// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  base58btcEncode,
  hashCanonicalPayload,
  signBytes,
} from '../src/core/vp-crypto.js';
import { generateKeyPair } from '../src/core/keys.js';
import type { SignedVC } from '../src/core/schemas/vc.js';
import { signCredential } from '../src/lib/issuer-ops.js';

// Frozen copy of signCredential() as it existed before the merge into
// helix-core's createEd25519Proof(). The regression contract is byte-identical
// proof output between this and the new implementation.
async function legacySignCredential(
  credential: Record<string, unknown>,
  issuerDid: string,
  privateKeyHex: string,
): Promise<SignedVC> {
  const signatureHex = await signBytes(hashCanonicalPayload(credential), privateKeyHex);
  return {
    ...credential,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${issuerDid}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: base58btcEncode(Buffer.from(signatureHex, 'hex')),
    },
  } as SignedVC;
}

describe('signCredential regression against pre-merge implementation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces byte-identical output to the legacy implementation', async () => {
    const keyPair = generateKeyPair();
    const issuerDid = 'did:web:issuer.example';
    const payload: Record<string, unknown> = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
      id: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: issuerDid,
      validFrom: '2026-07-29T00:00:00.000Z',
      credentialSubject: {
        id: 'https://issuer.example/status/1#list',
        type: 'BitstringStatusList',
        statusPurpose: 'revocation',
        encodedList: 'H4sIAAAAAAAAA2NgGAUjHwAA6nUFshAAAAA',
      },
    };

    const legacy = await legacySignCredential(payload, issuerDid, keyPair.privateKey);
    const current = await signCredential(payload, issuerDid, keyPair.privateKey);

    expect(JSON.stringify(current)).toBe(JSON.stringify(legacy));
    expect(current.proof.proofValue).toBe(legacy.proof.proofValue);
  });
});
