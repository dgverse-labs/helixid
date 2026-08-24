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
//
// Contract test for docs/proposal-sdk-api-only.md's golden-vector mechanism.
//
// This is the helix-core side of the check: it re-derives every fixture in
// fixtures/golden-vectors/ from the *current* source and asserts byte-for-byte
// equality against what's committed. If someone changes toCanonicalJson,
// signData, or VPBuilder.sign() without regenerating the fixtures, this test
// fails loudly here — before it ever reaches an SDK's CI.
//
// Each downstream SDK (helix-sdk-js today, helix-sdk-py once it exists) runs
// the mirror-image check: load the same fixture files, run its own
// implementation, assert equality. Neither side hand-derives expected values.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  toCanonicalJson,
  hashCanonicalPayload,
  signData,
  verifySignature,
  VPBuilder,
  type SignedVC,
  type VPBuilderSignOverrides,
} from '../../src/index.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/golden-vectors/', import.meta.url));

function loadFixture<T>(name: string): { vectors: T[] } {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, 'utf8'));
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

describe('golden vectors: canonical-json.json', () => {
  interface CanonicalJsonVector {
    name: string;
    input: unknown;
    canonical_string: string;
    hash_hex: string;
  }

  const { vectors } = loadFixture<CanonicalJsonVector>('canonical-json.json');

  it('has at least one committed vector', () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  it.each(vectors)('$name: canonical string and hash match committed fixture', (vector) => {
    expect(toCanonicalJson(vector.input)).toBe(vector.canonical_string);
    expect(toHex(hashCanonicalPayload(vector.input))).toBe(vector.hash_hex);
  });
});

describe('golden vectors: signing.json', () => {
  interface SigningVector {
    name: string;
    input: unknown;
    private_key_hex: string;
    public_key_hex: string;
    hash_hex: string;
    signature_hex: string;
    verifies: boolean;
  }

  const { vectors } = loadFixture<SigningVector>('signing.json');

  it.each(vectors)('$name: signature matches committed fixture and verifies', async (vector) => {
    const hash = hashCanonicalPayload(vector.input);
    expect(toHex(hash)).toBe(vector.hash_hex);
    expect(signData(hash, vector.private_key_hex)).toBe(vector.signature_hex);
    await expect(verifySignature(hash, vector.signature_hex, vector.public_key_hex)).resolves.toBe(
      vector.verifies,
    );
  });
});

describe('golden vectors: vp-builder.json', () => {
  interface VpBuilderVector {
    name: string;
    input: {
      credentials: SignedVC[];
      holderDid: string;
      targetService: string;
      userDid?: string;
    };
    overrides: {
      id: string;
      nonce: string;
      expiresAt: string;
      proofCreatedAt: string;
    };
    private_key_hex: string;
    verification_method: string;
    signed_vp: unknown;
  }

  const { vectors } = loadFixture<VpBuilderVector>('vp-builder.json');

  it.each(vectors)('$name: full signed VP matches committed fixture byte-for-byte', async (vector) => {
    const builder = new VPBuilder({
      credentials: vector.input.credentials,
      holderDid: vector.input.holderDid,
      targetService: vector.input.targetService,
      userDid: vector.input.userDid,
    });
    const overrides: VPBuilderSignOverrides = {
      id: vector.overrides.id,
      nonce: vector.overrides.nonce,
      expiresAt: new Date(vector.overrides.expiresAt),
      proofCreatedAt: new Date(vector.overrides.proofCreatedAt),
    };
    const signedVP = await builder.sign(vector.private_key_hex, vector.verification_method, overrides);
    expect(signedVP).toEqual(vector.signed_vp);
  });
});
