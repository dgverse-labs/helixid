import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentWallet, HelixClient, VPBuilder } from '@helixid/sdk-js';
import type { SignedVC, SignedVP } from '@helixid/core';

// Utility helpers for verifier examples
//
// Purpose
// - This module provides a small convenience helper `createFreshSignedVP()` used by
//   the examples. It requests an enrollment token from the API, creates a temporary
//   wallet, enrolls the wallet using `HelixClient.enroll()`, and constructs/signs a
//   fresh VP using `VPBuilder`.
//
// Notes and caveats
// - Designed for examples and local testing only. In production, enrollment token
//   creation is an operator action and typically requires operator authentication
//   (admin API key). This helper posts to `/v1/enrollment-tokens` and therefore
//   assumes a permissive dev environment or test harness.
// - Environment: expects `helixApiUrl` to point at a running Helix API instance.
// - The helper creates ephemeral files under the OS temp directory; these are
//   not intended for persistent use.

export type FreshVerifierVPOptions = {
  helixApiUrl: string;
  targetService: string;
  requiredScope?: string;
  userDid?: string;
  agentName?: string;
};

type EnrollmentTokenResponse = {
  token: string;
  expiresAt: string;
};

export type FreshVerifierVP = {
  signedVP: SignedVP;
  vc: SignedVC;
  agentDid: string;
  userDid: string;
  targetService: string;
  enrollmentExpiresAt: string;
};

function uniqueScopes(requiredScope?: string): string[] {
  const defaults = ['read:catalog', 'read:orders', 'read:inventory'];
  if (!requiredScope) return defaults;
  return Array.from(new Set([...defaults, requiredScope]));
}

async function createEnrollmentToken(input: {
  helixApiUrl: string;
  agentName: string;
  requestedScopes: string[];
}): Promise<EnrollmentTokenResponse> {
  const response = await fetch(`${input.helixApiUrl}/v1/enrollment-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentName: input.agentName,
      requestedScopes: input.requestedScopes,
      requestedDomains: ['https://verifier.example.com'],
      maxDelegationDepth: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Enrollment token creation failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  return (await response.json()) as EnrollmentTokenResponse;
}

export async function createFreshSignedVP(
  options: FreshVerifierVPOptions,
): Promise<FreshVerifierVP> {
  const requestedScopes = uniqueScopes(options.requiredScope);
  const userDid = options.userDid ?? 'did:key:z6MkuXVerifierUserDemo';
  const token = await createEnrollmentToken({
    helixApiUrl: options.helixApiUrl,
    agentName: options.agentName ?? 'Verifier Example Agent',
    requestedScopes,
  });

  const walletDir = await mkdtemp(join(tmpdir(), 'helix-verifier-example-'));
  const walletPath = join(walletDir, 'agent-wallet.enc');
  const wallet = await AgentWallet.create(walletPath, 'verifier-example-passphrase');
  const client = new HelixClient(options.helixApiUrl);

  await client.enroll(token.token, wallet);
  const vc = wallet.credentials[0];
  if (!vc) {
    throw new Error('Enrollment succeeded but wallet has no credential');
  }

  const agentDid = wallet.getDID();
  const signedVP = await new VPBuilder({
    credentials: [vc],
    holderDid: agentDid,
    userDid,
    targetService: options.targetService,
  }).sign(wallet.getPrivateKeyHex(), `${agentDid}#key-1`);

  return {
    signedVP,
    vc,
    agentDid,
    userDid,
    targetService: options.targetService,
    enrollmentExpiresAt: token.expiresAt,
  };
}
