import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { getBit } from '../helix-core/src/index.js';

// You are the verifier. This is Path 1: API verification. A Helix ID instance
// must be running, and it must be the same instance that serves the StatusList
// URL embedded in the fixture VC. Helix ID handles VP signature verification,
// VC signature verification, expiry, revocation, target-service registration,
// and single-use vpId replay tracking.

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });

const fixturePath = join(__dirname, 'e2e-travel-concierge', 'fixtures', 'vp.json');
const helixApiUrl = process.env.HELIX_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3000';

type SignedVP = {
  id: string;
  holder: string;
  expirationDate: string;
  delegatedBy: string;
  targetService: string;
  proof?: { proofValue?: string };
  verifiableCredential: Array<{
    id: string;
    validFrom: string;
    validUntil: string;
    credentialStatus: {
      statusListIndex: string;
      statusListCredential: string;
    };
    credentialSubject: {
      privilegeScopes: string[];
    };
    proof?: { proofValue?: string };
  }>;
};

type Fixture = {
  signedVP: SignedVP;
};

type VerifySuccess = {
  valid: true;
  agentDid: string;
  userDid: string;
  targetService: string;
  verifiedAt: string;
};

async function loadFixture(): Promise<SignedVP> {
  // In a real service this VP arrives in an Authorization header or request body,
  // not from disk:
  // const signedVP = req.headers.authorization?.replace('Bearer ', '');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;
  if (!fixture.signedVP?.id || !fixture.signedVP.delegatedBy) {
    throw new Error('Fixture must contain signedVP.id and signedVP.delegatedBy from /v1/vp/template.');
  }
  return fixture.signedVP;
}

async function localDiagnosticHint(signedVP: SignedVP): Promise<string> {
  if (!signedVP.proof?.proofValue) return 'malformed VP: missing proof.proofValue';
  const vc = signedVP.verifiableCredential[0];
  if (!vc) return 'malformed VP: missing embedded VC';
  if (!vc.proof?.proofValue) return 'malformed VC: missing proof.proofValue';
  if (new Date(signedVP.expirationDate).getTime() <= Date.now()) return 'VP expired';
  if (new Date(vc.validUntil).getTime() <= Date.now()) return 'credential expired';

  try {
    const status = await fetch(vc.credentialStatus.statusListCredential);
    if (status.ok) {
      const statusList = await status.json() as { credentialSubject?: { encodedList?: string } };
      const encodedList = statusList.credentialSubject?.encodedList;
      if (encodedList && getBit(encodedList, Number(vc.credentialStatus.statusListIndex)) === 1) {
        return 'credential revoked';
      }
    }
  } catch {
    return 'StatusList could not be fetched for diagnostic hint';
  }

  return 'API denied the VP. Likely replay detected, invalid VP signature, invalid VC signature, or target service mismatch.';
}

async function main(): Promise<void> {
  const signedVP = await loadFixture();
  const vc = signedVP.verifiableCredential[0]!;

  // Helix ID checks the VP Ed25519 signature, the embedded VC Ed25519 signature,
  // credential expiry, BitstringStatusList revocation bit, target service binding,
  // and vpId consumption. This call marks the vpId consumed on success.
  const response = await fetch(`${helixApiUrl}/v1/vp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedVP }),
  });

  const body = await response.json();
  if (!response.ok) {
    console.log('[Verifier] DENIED - VP_VERIFICATION_FAILED');
    console.log(`[Verifier] Internal diagnostic hint: ${await localDiagnosticHint(signedVP)}`);
    console.log(`[Verifier] Helix API response: ${JSON.stringify(body)}`);
    // A real verifier never exposes the internal reason externally; it logs the
    // reason for operators and returns one stable failure code to its caller.
    console.log("[Verifier] External response to caller: { error: 'VP_VERIFICATION_FAILED' }");
    process.exitCode = 1;
    return;
  }

  const verified = body as VerifySuccess;
  console.log('[Verifier] GRANTED');
  console.log(`[Verifier] Agent DID: ${verified.agentDid}`);
  console.log(`[Verifier] User DID: ${verified.userDid}`);
  console.log(`[Verifier] Target service: ${verified.targetService}`);
  console.log(`[Verifier] Scopes: ${vc.credentialSubject.privilegeScopes.join(', ')}`);
  console.log(`[Verifier] Credential expiry: ${vc.validUntil}`);
  console.log(`[Verifier] Verified at: ${verified.verifiedAt}`);
  // The vpId is now consumed. Presenting this same signed VP again will return
  // VP_VERIFICATION_FAILED; internally that is replay detection by design.
  console.log(`[Verifier] Consumed vpId: ${signedVP.id}`);
  console.log('[Verifier] Next: see self-verify.ts for what Helix ID checks internally.');
}

main().catch((error: unknown) => {
  console.error(`[Verifier] DENIED - VP_VERIFICATION_FAILED`);
  console.error(`[Verifier] Internal reason: ${error instanceof Error ? error.message : String(error)}`);
  console.error("[Verifier] External response to caller: { error: 'VP_VERIFICATION_FAILED' }");
  process.exitCode = 1;
});
