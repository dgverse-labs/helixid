import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { ed25519 } from '@noble/curves/ed25519';
import {
  base58btcDecode,
  getBit,
  hashCanonicalPayload,
  multibaseToPublicKeyHex,
} from '../helix-core/src/index.js';

// Use self-verification when the verifier cannot or does not want to call
// POST /v1/vp/verify for every request. The tradeoff is sharp: you now own
// VP signature checks, VC signature checks, DID resolution, expiry, StatusList
// revocation, target service binding, delegatedBy validation, and replay storage.
// Missing one check is a security gap.

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });

const fixturePath = join(__dirname, 'e2e-travel-concierge', 'fixtures', 'vp.json');
const helixApiUrl = process.env.HELIX_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3000';
const issuerPublicKeyHex = process.env.HELIX_ISSUER_PUBLIC_KEY;

type Proof = {
  proofValue: string;
};

type SignedVC = {
  id: string;
  issuer: string;
  validFrom: string;
  validUntil: string;
  credentialStatus: {
    statusListIndex: string;
    statusListCredential: string;
  };
  credentialSubject: {
    privilegeScopes: string[];
  };
  proof: Proof;
  [key: string]: unknown;
};

type SignedVP = {
  id: string;
  holder: string;
  nonce: string;
  expirationDate: string;
  delegatedBy: string;
  targetService: string;
  verifiableCredential: [SignedVC, ...SignedVC[]];
  proof: Proof;
  [key: string]: unknown;
};

function proofToSignatureHex(proofValue: string): string {
  const raw = proofValue.startsWith('z') ? proofValue.slice(1) : proofValue;
  return Buffer.from(base58btcDecode(raw)).toString('hex');
}

async function verifyProof(payload: Record<string, unknown>, proof: Proof, publicKeyHex: string): Promise<boolean> {
  const hash = hashCanonicalPayload(payload);
  return ed25519.verify(proofToSignatureHex(proof.proofValue), hash, publicKeyHex);
}

function publicKeyFromDidDocument(didDocument: { verificationMethod?: Array<{ type?: string; publicKeyHex?: string; publicKeyMultibase?: string }> }): string {
  const method = didDocument.verificationMethod?.find((item) => item.type?.includes('Ed25519'));
  if (!method) throw new Error('DID document has no Ed25519 verification method');
  if (method.publicKeyHex) return method.publicKeyHex;
  if (method.publicKeyMultibase) return multibaseToPublicKeyHex(method.publicKeyMultibase);
  throw new Error('DID document has no public key material');
}

function fail(step: string, reason: string): never {
  console.log(`[Self Verify] ${step}: FAIL - ${reason}`);
  console.log(`[Self Verify] NOT TRUSTED`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!issuerPublicKeyHex) {
    throw new Error('HELIX_ISSUER_PUBLIC_KEY is required for self-verification.');
  }

  console.log('[Self Verify] Step 1 - Parse VP');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { signedVP: SignedVP };
  const signedVP = fixture.signedVP;
  const vc = signedVP.verifiableCredential[0];
  console.log(`  agent DID: ${signedVP.holder}`);
  console.log(`  user DID delegatedBy: ${signedVP.delegatedBy}`);
  console.log(`  vpId: ${signedVP.id}`);
  console.log(`  nonce: ${signedVP.nonce}`);
  console.log(`  VP expires at: ${signedVP.expirationDate}`);
  console.log(`  VC id: ${vc.id}`);

  console.log('[Self Verify] Step 2 - Check VP expiry');
  if (new Date(signedVP.expirationDate).getTime() <= Date.now()) {
    fail('Step 2', 'VP expired. VPs are short-lived; regenerate the fixture with the E2E example.');
  }
  console.log('  PASS');

  // A DID document contains the public verification key controlled by the DID.
  // The resolver endpoint is a convenience for did:hedera; the trust anchor is
  // the Hedera-anchored DID document, not a public key copied into the VC.
  console.log('[Self Verify] Step 3 - Resolve agent DID document');
  const didResponse = await fetch(`${helixApiUrl}/v1/dids/${encodeURIComponent(signedVP.holder)}`);
  if (!didResponse.ok) fail('Step 3', `DID resolution failed with HTTP ${didResponse.status}`);
  const resolved = await didResponse.json() as { didDocument?: { verificationMethod?: Array<{ type?: string; publicKeyHex?: string; publicKeyMultibase?: string }> } } & { verificationMethod?: Array<{ type?: string; publicKeyHex?: string; publicKeyMultibase?: string }> };
  const agentPublicKeyHex = publicKeyFromDidDocument(resolved.didDocument ?? resolved);
  console.log(`  resolved public key: ${agentPublicKeyHex}`);

  // Trust chain: the agent signed the VP, Helix ID signed the VC, and Hedera
  // anchored the DID. These are separate checks with separate keys.
  console.log('[Self Verify] Step 4 - Verify VP signature');
  const { proof: vpProof, ...vpPayload } = signedVP;
  if (!(await verifyProof(vpPayload, vpProof, agentPublicKeyHex))) {
    fail('Step 4', 'VP signature invalid');
  }
  console.log('  PASS');

  // The issuer public key comes from verifier configuration. Fetching it from
  // Helix ID at verification time reintroduces the dependency self-verification
  // is trying to avoid.
  console.log('[Self Verify] Step 5 - Verify VC signature');
  const { proof: vcProof, ...vcPayload } = vc;
  if (!(await verifyProof(vcPayload, vcProof, issuerPublicKeyHex))) {
    fail('Step 5', 'VC signature invalid');
  }
  console.log('  PASS');

  console.log('[Self Verify] Step 6 - Check VC expiry');
  if (new Date(vc.validUntil).getTime() <= Date.now()) {
    fail('Step 6', 'credential expired');
  }
  console.log('  PASS');

  // delegatedBy is the userDID of the user on whose behalf the agent acts. A
  // real verifier should check it against its own user/session records.
  console.log('[Self Verify] Step 7 - Check delegatedBy');
  console.log(`  delegatedBy: ${signedVP.delegatedBy}`);
  console.log('  PASS - demo accepts the simulated user DID');

  // This is the remaining network dependency. BitstringStatusList is embedded in the
  // VC and points at the issuer's status endpoint. Do not skip it: a valid VP
  // from a revoked credential is still invalid.
  console.log('[Self Verify] Step 8 - Check BitstringStatusList revocation');
  const statusRes = await fetch(vc.credentialStatus.statusListCredential);
  if (!statusRes.ok) fail('Step 8', `StatusList fetch failed with HTTP ${statusRes.status}`);
  const statusList = await statusRes.json() as { credentialSubject: { encodedList: string } };
  const bit = getBit(statusList.credentialSubject.encodedList, Number(vc.credentialStatus.statusListIndex));
  if (bit === 1) fail('Step 8', 'credential revoked');
  console.log(`  PASS - bit ${bit} at index ${vc.credentialStatus.statusListIndex}`);

  // Replay tracking is your responsibility when self-verifying. Helix ID only
  // consumes vpIds when you call POST /v1/vp/verify.
  // Pseudocode:
  // if (await store.has(vpId)) reject('replay detected');
  // await store.set(vpId, true, { ttl: untilCredentialExpiry });
  console.log('[Self Verify] Step 9 - vpId replay protection');
  console.log(`  CHECK REQUIRED - record ${signedVP.id} in your verifier store and reject it if seen again.`);

  console.log('[Self Verify] Step 10 - Final verdict');
  console.log('[Self Verify] TRUSTED');
  console.log(`  agent DID: ${signedVP.holder}`);
  console.log(`  user DID: ${signedVP.delegatedBy}`);
  console.log(`  credentialSubject.privilegeScopes: ${vc.credentialSubject.privilegeScopes.join(', ')}`);
  console.log(`  credential expiry: ${vc.validUntil}`);
  console.log(`  vpId obligation: ${signedVP.id} must be stored as consumed by this verifier.`);
  console.log('[Self Verify] Foundation for a no-runtime-Helix verification library; next add DID and StatusList caching.');
  console.log('[Self Verify] BitstringStatusList: https://www.w3.org/TR/vc-bitstring-status-list/');
}

main().catch((error: unknown) => {
  console.error(`[Self Verify] NOT TRUSTED - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
