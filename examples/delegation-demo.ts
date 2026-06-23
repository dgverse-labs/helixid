import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Core helpers
import {
  generateKeyPair,
  publicKeyToMultibase,
  selfIssueVC,
  buildDelegationVC,
  MaxDelegationDepthExceededError,
  ScopeEscalationDeniedError,
} from '../helix-core/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });

async function main(): Promise<void> {
  console.log('=== HelixID Delegation Demo ===');

  // Create three ephemeral agent keypairs (A, B, C) and derive did:key DIDs
  const keyA = generateKeyPair();
  const keyB = generateKeyPair();
  const keyC = generateKeyPair();

  const didA = `did:key:${publicKeyToMultibase(keyA.publicKey)}`;
  const didB = `did:key:${publicKeyToMultibase(keyB.publicKey)}`;
  const didC = `did:key:${publicKeyToMultibase(keyC.publicKey)}`;

  console.log(`Agent A DID: ${didA}`);
  console.log(`Agent B DID: ${didB}`);
  console.log(`Agent C DID: ${didC}`);

  // Step 1: Issuer (simulated by self-issuing for demo) grants Agent A a VC
  // with a set of scopes and maxDelegationDepth = 1.
  console.log('\n[Step 1] Self-issue root VC to Agent A (maxDelegationDepth = 1)');

  const rootVC = await selfIssueVC(
    {
      scopes: ['read:catalog', 'read:orders', 'read:inventory'],
      expiresIn: '24h',
      maxDelegationDepth: 1,
    },
    { did: didA, privateKeyHex: keyA.privateKey },
  );

  console.log('  rootVC.id:', rootVC.id);
  console.log('  scopes:', (rootVC.credentialSubject.privilegeScopes || []).join(', '));
  console.log('  delegationDepth:', rootVC.credentialSubject.delegationDepth);
  console.log('  maxDelegationDepth:', rootVC.credentialSubject.maxDelegationDepth);

  // Step 2: Agent A delegates a strict subset of scopes to Agent B (allowed)
  console.log('\n[Step 2] Agent A delegates to Agent B (subset of scopes)');
  const delegatedToB = await buildDelegationVC(
    {
      to: didB,
      scopes: ['read:orders'], // subset of A's scopes
      expiresIn: 60 * 60, // seconds
      fromVC: rootVC,
    },
    { did: didA, privateKeyHex: keyA.privateKey },
  );

  console.log('  delegation VC id:', delegatedToB.id);
  console.log('  delegated scopes:', delegatedToB.credentialSubject.privilegeScopes.join(', '));
  console.log('  delegationDepth (child):', delegatedToB.credentialSubject.delegationDepth);
  console.log('  maxDelegationDepth (child):', delegatedToB.credentialSubject.maxDelegationDepth);

  // Step 3: Agent B attempts to delegate the same scope to Agent C.
  // This should be blocked because maxDelegationDepth was 1 on the root credential,
  // and the delegated VC already has delegationDepth = 1.
  console.log('\n[Step 3] Agent B attempts to delegate to Agent C (should be blocked)');

  try {
    const delegatedByBToC = await buildDelegationVC(
      {
        to: didC,
        scopes: ['read:orders'],
        expiresIn: 60 * 60,
        fromVC: delegatedToB,
      },
      { did: didB, privateKeyHex: keyB.privateKey },
    );

    console.error('  ERROR: Unexpected success — delegation should have been blocked by max depth');
    console.log('  delegatedByBToC id:', delegatedByBToC.id);
  } catch (error: unknown) {
    if (
      error instanceof MaxDelegationDepthExceededError ||
      // In case runtime class identity differs, fall back to checking the error code
      (error && typeof (error as any).code === 'string' && (error as any).code === 'MAX_DELEGATION_DEPTH_EXCEEDED')
    ) {
      console.log('  Expected failure: max delegation depth exceeded — delegation blocked');
    } else {
      console.error('  Delegation failed with unexpected error:', error);
    }
  }

  // OPTIONAL: show scope escalation is also blocked. Agent B tries to delegate a scope
  // it does not have (e.g. read:inventory) — this should throw a scope escalation error.
  console.log('\n[Optional] Agent B attempts scope-escalation delegation to Agent C (should be blocked)');
  try {
    const escalation = await buildDelegationVC(
      {
        to: didC,
        scopes: ['read:inventory'], // B does NOT have this scope
        expiresIn: 60 * 60,
        fromVC: delegatedToB,
      },
      { did: didB, privateKeyHex: keyB.privateKey },
    );

    console.error('  ERROR: Unexpected success — scope escalation should have been blocked', escalation.id);
  } catch (error: unknown) {
    if (
      error instanceof ScopeEscalationDeniedError ||
      (error && typeof (error as any).code === 'string' && (error as any).code === 'SCOPE_ESCALATION_DENIED')
    ) {
      console.log('  Expected failure: scope escalation denied — delegation blocked');
    } else {
      console.error('  Unexpected error during scope escalation attempt:', error);
    }
  }

  console.log('\n=== Demo complete ===');
}

main().catch((err) => {
  console.error('Fatal error in delegation demo:', err);
  process.exitCode = 1;
});
