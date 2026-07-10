// Shared enrollment used by both the seeder (initial Concierge) and the agent's
// runtime onboarding route (later Search Agent). One real path: mint a one-use
// enrollment token (if not supplied), create a local did:key wallet, and enroll
// via POST /v1/enroll — the single-roundtrip bootstrap-proof flow that needs no
// Hedera. Nothing here is stubbed.
import { mkdir } from 'node:fs/promises';
import { AgentWallet, HelixClient } from '@helixid/sdk-js';
import { env, walletPathFor } from '../config.js';
import type { Persona } from './types.js';

export interface EnrollInput {
  id: string;
  displayName: string;
  scopes: string[];
  /** If omitted, a one-use token is minted from `scopes`. */
  bootstrapToken?: string;
}

export interface EnrollResult {
  persona: Persona;
  vcId: string;
  did: string;
}

async function mintToken(displayName: string, scopes: string[]): Promise<string> {
  const res = await fetch(`${env.helixApiUrl}/v1/enrollment-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentName: displayName,
      requestedScopes: scopes,
      requestedDomains: [],
      maxDelegationDepth: 0,
    }),
  });
  const body = (await res.json()) as { token?: string; error?: unknown };
  if (!res.ok || !body.token) {
    throw new Error(`Failed to mint enrollment token: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return body.token;
}

export async function enrollPersona(input: EnrollInput): Promise<EnrollResult> {
  await mkdir(env.walletsDir, { recursive: true });
  const walletFile = walletPathFor(input.id);
  const token = input.bootstrapToken ?? (await mintToken(input.displayName, input.scopes));

  const wallet = await AgentWallet.create(walletFile, env.walletPassphrase);
  const client = new HelixClient(env.helixApiUrl);
  const vc = (await client.enroll(token, wallet)) as {
    id: string;
    credentialSubject?: { privilegeScopes?: string[] };
  };

  // Trust the credential's actual scopes (a supplied token may differ from the
  // requested scopes).
  const scopes = vc.credentialSubject?.privilegeScopes ?? input.scopes;
  const persona: Persona = { id: input.id, displayName: input.displayName, scopes, walletFile };
  return { persona, vcId: vc.id, did: wallet.did };
}
