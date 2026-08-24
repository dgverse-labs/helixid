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
// Consumer-side contract test — see docs/proposal-sdk-api-only.md and
// docs/proposal-retire-core-package.md. Mirrors helix-core's own
// tests/unit/golden-vectors.test.ts: same fixture files, this package's own
// import of VPBuilder/signing primitives, asserting byte-for-byte equality.
//
// Today this exercises `@helixid/core` re-exports (see src/vp-builder.ts).
// Once proposal-retire-core-package.md lands and this file becomes a
// verbatim local copy instead of a re-export, this test is what catches a
// missed copy-paste sync — it should need no changes at that point, since it
// only imports from this package's own public surface.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Imports directly from @helixid/core (not this package's own barrel) since
// VPBuilderSignOverrides is a test-only fixture-replay hook, not part of the
// SDK's public surface.
import {
  VPBuilder,
  type SignedVC,
  type VPBuilderSignOverrides,
} from '@helixid/core';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/golden-vectors/', import.meta.url));

function loadFixture<T>(name: string): { vectors: T[] } {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, 'utf8'));
}

describe('golden vectors: vp-builder.json (helix-sdk-js consumer side)', () => {
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
