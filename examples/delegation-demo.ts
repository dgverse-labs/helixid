import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { config as loadEnv } from 'dotenv';

import {
  AgentWallet,
  HelixClient,
  MaxDelegationDepthExceededError,
  ScopeEscalationDeniedError,
  delegate,
  type SignedVC,
} from '@helixid/sdk-js';

// Delegation demo, rewritten against the SDK-API-only architecture
// (docs/proposal-sdk-api-only.md, docs/proposal-retire-core-package.md).
//
// This intentionally no longer mirrors the pre-retirement version of this
// file, which built delegation VCs entirely offline via the now-retired
// @helixid/core buildDelegationVC(). Delegation-VC construction — including
// the scope-subset and max-depth checks — moved server-side: the SDK's
// delegate() only produces the local signature via the API's prepare/finalize
// endpoints (see helix-sdk-py's equivalent examples/agent_delegation_demo.py,
// which this follows). Requires a running helix-api instance:
//
//   HELIX_API_URL=http://127.0.0.1:3579 \
//   HELIX_ADMIN_API_KEY=your-admin-key \
//   pnpm exec tsx examples/delegation-demo.ts

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });

const helixApiUrl = process.env.HELIX_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3000';

async function createEnrollmentToken(input: {
  agentName: string;
  requestedScopes: string[];
  maxDelegationDepth: number;
}): Promise<string> {
  const response = await fetch(`${helixApiUrl}/v1/enrollment-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentName: input.agentName,
      requestedScopes: input.requestedScopes,
      requestedDomains: ['https://api.example.invalid'],
      maxDelegationDepth: input.maxDelegationDepth,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Enrollment token creation failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function onboardAgent(
  client: HelixClient,
  agentName: string,
  scopes: string[],
  maxDelegationDepth: number,
): Promise<{ wallet: AgentWallet; vc: SignedVC }> {
  // Two-step challenge/response onboarding, not client.enroll() -- live-verified
  // (2026-09-01) that the single-roundtrip /v1/enroll path issues the agent's VC
  // before its DID is registered and fails on a foreign-key violation for any
  // brand-new agent. See the equivalent note in verifier-example-utils.ts.
  const token = await createEnrollmentToken({ agentName, requestedScopes: scopes, maxDelegationDepth });
  const walletDir = await mkdtemp(join(tmpdir(), 'helix-delegation-demo-'));
  const walletPath = join(walletDir, 'wallet.enc');
  const passphrase = 'delegation-demo-passphrase';
  const challenge = await client.requestOnboardingChallenge(token, ['https://api.example.invalid']);
  await client.completeOnboarding(challenge.challengeId, challenge.nonce, passphrase, walletPath);
  const wallet = await AgentWallet.load(walletPath, passphrase, client);
  const vc = wallet.credentials[0];
  if (!vc) throw new Error('Onboarding succeeded but wallet has no credential');
  return { wallet, vc };
}

async function main(): Promise<void> {
  console.log('=== HelixID Delegation Demo (helix-sdk-js) ===');
  console.log(`API: ${helixApiUrl}\n`);

  const client = new HelixClient(helixApiUrl);

  console.log('[Step 1] Onboard delegator agent (maxDelegationDepth=1, scopes: read:orders, write:orders)');
  const delegator = await onboardAgent(client, 'Delegator Agent', ['read:orders', 'write:orders'], 1);
  console.log(`  delegator DID: ${delegator.wallet.did}`);
  console.log(`  delegator VC id: ${delegator.vc.id}\n`);

  console.log('[Step 2] Onboard sub-agent (no delegation authority of its own)');
  const subAgent = await onboardAgent(client, 'Sub-Agent', [], 0);
  console.log(`  sub-agent DID: ${subAgent.wallet.did}\n`);

  console.log("[Step 3] Delegator delegates 'read:orders' to sub-agent via delegate()");
  console.log('  (prepare/finalize: server builds the payload, only the signature is local)');
  const delegatedVC = await delegate(
    { to: subAgent.wallet.did, scopes: ['read:orders'], expiresIn: 3600, fromVC: delegator.vc },
    delegator.wallet,
  );
  console.log(`  sub-agent VC id: ${delegatedVC.id}`);
  console.log(`  delegated scopes: ${delegatedVC.credentialSubject.privilegeScopes?.join(', ')}`);
  console.log(`  delegationDepth: ${delegatedVC.credentialSubject.delegationDepth}\n`);

  console.log('[Step 4] Sub-agent attempts to delegate further (should be blocked -- it has no delegation authority)');
  try {
    await delegate(
      { to: 'did:key:z6MkSomeOtherAgentPlaceholder', scopes: ['read:orders'], expiresIn: 3600, fromVC: delegatedVC },
      subAgent.wallet,
    );
    console.error('  ERROR: unexpected success -- delegation should have been blocked');
    process.exitCode = 1;
    return;
  } catch (error: unknown) {
    // Live-verified (2026-09-01): an agent with zero remaining delegation
    // depth has an empty effective delegable-scope set, so the API reports
    // this as ScopeEscalationDeniedError rather than
    // MaxDelegationDepthExceededError. Either is an acceptable "delegation
    // blocked" outcome for this demo -- see the equivalent note in
    // helix-sdk-py's examples/agent_delegation_demo.py. Which one the API
    // *should* return for an exhausted-depth agent is tracked separately,
    // not fixed here.
    if (error instanceof MaxDelegationDepthExceededError || error instanceof ScopeEscalationDeniedError) {
      console.log(`  Expected failure: ${error.code} -- delegation blocked as designed`);
    } else {
      throw error;
    }
  }

  console.log('\n=== Demo complete ===');
}

main().catch((error: unknown) => {
  console.error('Fatal error in delegation demo:', error);
  process.exitCode = 1;
});
