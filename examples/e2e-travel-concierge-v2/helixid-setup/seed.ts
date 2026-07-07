// helixid-setup — the run-once seeder.
//
// Mental model: this is a migration, not a service. It runs, enrolls exactly one
// agent against the live HelixID API, writes the encrypted wallet to a shared
// volume, prints the Console URL, and exits 0 so docker-compose starts the MCP
// server and agent that depend on it.
//
// Everything here is a real API call. The enrollment token is minted through the
// live admin endpoint; the credential is issued by the live issuer. Nothing is
// stubbed.
import 'dotenv/config';
import { mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AgentWallet, HelixClient } from '@helixid/sdk-js';
import { AGENT_NAME, AGENT_REQUESTED_SCOPES, env } from '../config.js';

function log(actor: 'Setup' | 'Agent Owner' | 'Helix ID' | 'Agent', message: string): void {
  console.log(`[${actor}] ${message}`);
}

async function waitForApi(url: string, attempts = 60): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        log('Setup', `HelixID API is healthy at ${url}.`);
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`HelixID API at ${url} did not become healthy in time.`);
}

async function walletExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await waitForApi(env.helixApiUrl);
  await mkdir(dirname(env.walletPath), { recursive: true });

  // Re-running the demo should not re-enroll. If a wallet with a credential is
  // already on the shared volume, reuse it. (docker-compose down -v is the reset
  // path — documented in the README.)
  if (await walletExists(env.walletPath)) {
    const store = new AgentWallet();
    const wallet = await store.load(env.walletPassphrase, env.walletPath);
    const credential = await store.getLatestCredential(
      { vcType: 'HelixAgentCredential' },
      env.walletPassphrase,
      env.walletPath,
    );
    if (credential) {
      log('Setup', `Existing wallet found for ${wallet.did}; skipping enrollment.`);
      log('Agent', `VC id: ${credential.vcId}`);
      log('Setup', 'Seed complete (reused). Open Console at http://localhost:8080 → Audit.');
      return;
    }
  }

  // 1) Agent owner mints a one-use enrollment token (open endpoint; carries the
  //    requested scopes and agent name).
  log('Agent Owner', `Minting a one-use enrollment token for "${AGENT_NAME}".`);
  const tokenRes = await fetch(`${env.helixApiUrl}/v1/enrollment-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentName: AGENT_NAME,
      requestedScopes: AGENT_REQUESTED_SCOPES,
      requestedDomains: [],
      maxDelegationDepth: 0,
    }),
  });
  const tokenBody = (await tokenRes.json()) as { token?: string; expiresAt?: string; error?: unknown };
  if (!tokenRes.ok || !tokenBody.token) {
    throw new Error(`Failed to mint enrollment token: HTTP ${tokenRes.status} ${JSON.stringify(tokenBody)}`);
  }
  log('Agent Owner', `Token expires at ${tokenBody.expiresAt}.`);

  // 2) The agent creates a local did:key wallet and enrolls. POST /v1/enroll is
  //    the single-roundtrip bootstrap-proof path — it does NOT anchor a DID on
  //    Hedera, so it works fully locally.
  log('Agent', 'Creating a local did:key wallet and enrolling (POST /v1/enroll).');
  const wallet = await AgentWallet.create(env.walletPath, env.walletPassphrase);
  const client = new HelixClient(env.helixApiUrl);
  const vc = (await client.enroll(tokenBody.token, wallet)) as {
    id: string;
    credentialSubject?: { privilegeScopes?: string[] };
    validUntil?: string;
  };

  log('Helix ID', `Issued credential ${vc.id}.`);
  log('Agent', `DID: ${wallet.did}`);
  log('Agent', `Scopes: ${(vc.credentialSubject?.privilegeScopes ?? []).join(', ')}`);
  if (vc.validUntil) log('Agent', `Credential expiry: ${vc.validUntil}`);
  log('Agent', `Encrypted wallet written to ${env.walletPath}.`);
  log('Setup', 'Seed complete. Enrollment, token and issuance events are now in Console → Audit (http://localhost:8080).');
}

main().catch((error: unknown) => {
  console.error('[Setup] Seeding failed:', error);
  process.exit(1);
});
