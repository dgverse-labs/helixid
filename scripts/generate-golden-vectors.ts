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

/**
 * Golden vector generator — see docs/proposal-sdk-api-only.md
 * ("Decided: how payload/encoding parity is guaranteed for what stays local").
 *
 * Generates deterministic fixtures straight from helix-core's own
 * implementation (not hand-derived from a spec) covering:
 *   - toCanonicalJson / hashCanonicalPayload   (canonical-json.json)
 *   - signData / verifySignature               (signing.json)
 *   - full VPBuilder.sign() output              (vp-builder.json)
 *
 * Every SDK's test suite (helix-sdk-js today, helix-sdk-py once it exists)
 * asserts byte-for-byte equality against these fixtures, not against a
 * description of the algorithm. Regenerate whenever helix-core's crypto
 * files change; CI should fail if regenerating produces a diff that wasn't
 * committed (see "CI wiring" in the proposal).
 *
 * Run: pnpm --filter @helixid/api exec tsx ../scripts/generate-golden-vectors.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  toCanonicalJson,
  hashCanonicalPayload,
  signData,
  derivePublicKey,
  verifySignature,
  VPBuilder,
  type SignedVC,
} from '../helix-core/src/index.js';

const OUT_DIR = fileURLToPath(new URL('../fixtures/golden-vectors/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

// Fixed test keypair. NOT a real key — hardcoded 32-byte seed of 0x01..0x20,
// used only so every regeneration produces the identical public key/signatures.
const TEST_PRIVATE_KEY_HEX = Array.from({ length: 32 }, (_, i) => (i + 1).toString(16).padStart(2, '0')).join('');
const TEST_PUBLIC_KEY_HEX = derivePublicKey(TEST_PRIVATE_KEY_HEX);
const TEST_VERIFICATION_METHOD = 'did:key:z6MkTestGoldenVectorKey#key-1';

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

// ---------------------------------------------------------------------------
// 1. Canonical JSON + hash vectors
// ---------------------------------------------------------------------------

interface CanonicalJsonCase {
  name: string;
  input: unknown;
}

const canonicalJsonCases: CanonicalJsonCase[] = [
  { name: 'empty_object', input: {} },
  { name: 'flat_object_unordered_keys', input: { zeta: 1, alpha: 2, mid: 3 } },
  {
    name: 'nested_object',
    input: { outer: { z: 1, a: { deep: true, arr: [3, 1, 2] } }, top: 'value' },
  },
  { name: 'array_of_primitives', input: [3, 1, 2, 'b', 'a', true, false, null] },
  {
    name: 'array_of_objects',
    input: [{ b: 1, a: 2 }, { d: 3, c: 4 }],
  },
  { name: 'unicode_strings', input: { name: 'héllo wörld 你好 🎉', emoji: '🔑✨' } },
  {
    name: 'numeric_edge_cases',
    input: { zero: 0, negative: -42, float: 3.14159, large: 9007199254740991, negZeroCheck: -0 },
  },
  { name: 'null_and_booleans', input: { isNull: null, isTrue: true, isFalse: false } },
  {
    name: 'realistic_vp_like_payload',
    input: {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      id: 'vp:helix:00000000-0000-4000-8000-000000000000',
      holder: 'did:key:z6MkHolderExample',
      nonce: 'deadbeef'.repeat(8),
      targetService: 'https://api.example.invalid/v1/tools/lookup',
    },
  },
];

const canonicalJsonVectors = canonicalJsonCases.map(({ name, input }) => {
  const canonical = toCanonicalJson(input);
  const hash = hashCanonicalPayload(input);
  return {
    name,
    input,
    canonical_string: canonical,
    hash_hex: toHex(hash),
  };
});

// ---------------------------------------------------------------------------
// 2. Signing vectors (sign + verify round trip over the same payloads)
// ---------------------------------------------------------------------------

async function buildSigningVectors() {
  const vectors = [];
  for (const { name, input } of canonicalJsonCases) {
    const hash = hashCanonicalPayload(input);
    const signatureHex = signData(hash, TEST_PRIVATE_KEY_HEX);
    const isValid = await verifySignature(hash, signatureHex, TEST_PUBLIC_KEY_HEX);
    vectors.push({
      name,
      input,
      private_key_hex: TEST_PRIVATE_KEY_HEX,
      public_key_hex: TEST_PUBLIC_KEY_HEX,
      hash_hex: toHex(hash),
      signature_hex: signatureHex,
      verifies: isValid,
    });
  }
  return vectors;
}

// ---------------------------------------------------------------------------
// 3. Full VPBuilder.sign() vectors — deterministic via override hooks
// ---------------------------------------------------------------------------

function sampleAgentVC(overrides: Partial<Record<string, unknown>> = {}): SignedVC {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc:helix:agent:00000000-0000-4000-8000-000000000001',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: 'did:key:z6MkIssuerExample',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T23:59:59.000Z',
    credentialSubject: {
      id: 'did:key:z6MkAgentExample',
      type: 'HelixAgent',
      privilegeScopes: ['read:calendar', 'read:email'],
      agentName: 'golden-vector-test-agent',
    },
    proof: {
      type: 'Ed25519Signature2020',
      created: '2026-01-01T00:00:00.000Z',
      verificationMethod: TEST_VERIFICATION_METHOD,
      proofPurpose: 'assertionMethod',
      proofValue: 'zGoldenVectorPlaceholderProofValue',
    },
    ...overrides,
  } as unknown as SignedVC;
}

interface VpBuilderCase {
  name: string;
  credentials: SignedVC[];
  holderDid: string;
  targetService: string;
  userDid?: string;
}

const vpBuilderCases: VpBuilderCase[] = [
  {
    name: 'single_agent_credential_no_user',
    credentials: [sampleAgentVC()],
    holderDid: 'did:key:z6MkHolderExample',
    targetService: 'https://api.example.invalid/v1/tools/lookup',
  },
  {
    name: 'agent_plus_delegation_grant_with_user',
    credentials: [
      sampleAgentVC(),
      sampleAgentVC({
        id: 'vc:helix:grant:00000000-0000-4000-8000-000000000002',
        type: ['VerifiableCredential', 'DelegationGrantCredential'],
        credentialSubject: {
          id: 'did:key:z6MkAgentExample',
          type: 'HelixAgent',
          privilegeScopes: ['read:calendar'],
          agentName: 'golden-vector-test-agent',
          delegatedFrom: 'did:key:z6MkParentAgentExample',
          delegationDepth: 1,
          maxDelegationDepth: 2,
          parentVcId: 'vc:helix:agent:00000000-0000-4000-8000-000000000001',
        },
      }),
    ],
    holderDid: 'did:key:z6MkHolderExample',
    targetService: 'https://api.example.invalid/v1/tools/calendar',
    userDid: 'did:key:z6MkUserExample',
  },
];

const FIXED_ID = 'vp:helix:00000000-0000-4000-8000-0000000000ff';
const FIXED_NONCE = 'ab'.repeat(32);
const FIXED_EXPIRES_AT = new Date('2026-01-01T00:05:00.000Z');
const FIXED_PROOF_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

async function buildVpBuilderVectors() {
  const vectors = [];
  for (const testCase of vpBuilderCases) {
    const builder = new VPBuilder({
      credentials: testCase.credentials,
      holderDid: testCase.holderDid,
      targetService: testCase.targetService,
      userDid: testCase.userDid,
    });
    const signedVP = await builder.sign(TEST_PRIVATE_KEY_HEX, TEST_VERIFICATION_METHOD, {
      id: FIXED_ID,
      nonce: FIXED_NONCE,
      expiresAt: FIXED_EXPIRES_AT,
      proofCreatedAt: FIXED_PROOF_CREATED_AT,
    });
    vectors.push({
      name: testCase.name,
      input: {
        credentials: testCase.credentials,
        holderDid: testCase.holderDid,
        targetService: testCase.targetService,
        userDid: testCase.userDid,
      },
      overrides: {
        id: FIXED_ID,
        nonce: FIXED_NONCE,
        expiresAt: FIXED_EXPIRES_AT.toISOString(),
        proofCreatedAt: FIXED_PROOF_CREATED_AT.toISOString(),
      },
      private_key_hex: TEST_PRIVATE_KEY_HEX,
      verification_method: TEST_VERIFICATION_METHOD,
      signed_vp: signedVP,
    });
  }
  return vectors;
}

// ---------------------------------------------------------------------------
// Write fixtures
// ---------------------------------------------------------------------------

async function main() {
  const meta = {
    generated_from: 'helix-core',
    generator: 'scripts/generate-golden-vectors.ts',
    note:
      'Regenerate whenever helix-core/src/crypto/vp.ts, crypto/keys.ts, proof.ts, or ' +
      'vp-builder.ts change. Every SDK asserts byte-for-byte equality against these ' +
      'fixtures — do not hand-edit.',
  };

  writeFileSync(
    `${OUT_DIR}canonical-json.json`,
    JSON.stringify({ ...meta, vectors: canonicalJsonVectors }, null, 2) + '\n',
  );

  const signingVectors = await buildSigningVectors();
  writeFileSync(
    `${OUT_DIR}signing.json`,
    JSON.stringify({ ...meta, vectors: signingVectors }, null, 2) + '\n',
  );

  const vpBuilderVectors = await buildVpBuilderVectors();
  writeFileSync(
    `${OUT_DIR}vp-builder.json`,
    JSON.stringify({ ...meta, vectors: vpBuilderVectors }, null, 2) + '\n',
  );

  console.log(`Wrote ${canonicalJsonVectors.length} canonical-json vectors`);
  console.log(`Wrote ${signingVectors.length} signing vectors`);
  console.log(`Wrote ${vpBuilderVectors.length} vp-builder vectors`);
  console.log(`Output: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
