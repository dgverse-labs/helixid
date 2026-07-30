// Shared two-SP harness for the cross-epic suite.
//
// Boots real SP servers on real ports with real did:web identities, so every
// assertion below runs against the shipped code paths — real DID resolution,
// real signing, real verifyVP, real status-list fetches.

import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEd25519Proof,
  generateKeyPair,
  publicKeyToMultibase,
  type SignedVC,
} from '@helixid/core';
import { AgentWallet } from '@helixid/sdk-js';
import {
  AGENT_PRIVILEGE_SCOPES,
  AIRLINE,
  HOTEL,
  type SpDefinition,
} from '../helixid-config/index.js';
import { createSpApp, type SpApp } from '../sp-shared/app.js';
import { provisionSpIdentity, statePath } from '../sp-shared/identity.js';
import { SpStore } from '../sp-shared/store.js';

export interface RunningSp {
  spApp: SpApp;
  server: Server;
  store: SpStore;
  baseUrl: string;
  mcpUrl: string;
  serviceDid: string;
  stateFile: string;
  definition: SpDefinition;
}

export interface Harness {
  workDir: string;
  airline: RunningSp;
  hotel: RunningSp;
  wallet: AgentWallet;
  agentDid: string;
  platformDid: string;
  stop: () => Promise<void>;
}

async function startSp(
  workDir: string,
  definition: SpDefinition,
  port: number,
  host = 'localhost',
): Promise<RunningSp> {
  const { identity, statusList } = await provisionSpIdentity({
    dir: workDir,
    spId: definition.id,
    host,
    port,
  });
  const stateFile = statePath(workDir, definition.id);
  const store = await SpStore.open(stateFile, statusList);
  const baseUrl = `http://${host}:${port}`;

  const spApp = createSpApp({
    definition: { ...definition, port },
    issuer: {
      did: identity.did,
      privateKeyHex: identity.privateKeyHex,
      publicKeyHex: identity.publicKeyHex,
    },
    baseUrl,
    store,
  });

  const server = await new Promise<Server>((resolve) => {
    const listening = spApp.app.listen(port, host, () => resolve(listening));
  });

  return {
    spApp,
    server,
    store,
    baseUrl,
    mcpUrl: `${baseUrl}/api/mcp`,
    serviceDid: identity.did,
    stateFile,
    definition,
  };
}

/** Issues a platform-signed agent VC into a fresh file-backed wallet. */
export async function makeEnrolledWallet(
  workDir: string,
  scopes: string[] = [...AGENT_PRIVILEGE_SCOPES],
  fileName = 'agent.enc',
): Promise<{ wallet: AgentWallet; agentDid: string; platformDid: string }> {
  const platform = generateKeyPair();
  const platformDid = `did:key:${publicKeyToMultibase(platform.publicKey)}`;
  const wallet = await AgentWallet.create(join(workDir, fileName), 'demo-passphrase');
  const agentDid = wallet.did;

  const now = Date.now();
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: `vc:helix:agent:${agentDid.slice(-10)}`,
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: platformDid,
    validFrom: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 24 * 3600_000).toISOString(),
    credentialSubject: {
      id: agentDid,
      type: 'HelixAgent',
      privilegeScopes: scopes,
      agentName: 'Travel Planner Agent',
      delegationDepth: 0,
      maxDelegationDepth: 0,
    },
  };
  const agentVC = {
    ...payload,
    proof: await createEd25519Proof(payload, platform.privateKey, `${platformDid}#key-1`),
  } as SignedVC;

  await wallet.addCredential(agentVC);
  return { wallet, agentDid, platformDid };
}

export async function startHarness(airlinePort: number, hotelPort: number): Promise<Harness> {
  const workDir = await mkdtemp(join(tmpdir(), 'helix-crossepic-'));
  const airline = await startSp(workDir, AIRLINE, airlinePort);
  const hotel = await startSp(workDir, HOTEL, hotelPort);
  const { wallet, agentDid, platformDid } = await makeEnrolledWallet(workDir);

  return {
    workDir,
    airline,
    hotel,
    wallet,
    agentDid,
    platformDid,
    stop: async () => {
      await new Promise<void>((resolve) => airline.server.close(() => resolve()));
      await new Promise<void>((resolve) => hotel.server.close(() => resolve()));
      await rm(workDir, { recursive: true, force: true });
    },
  };
}

/** Drives the SP's two consent routes exactly as the widget does. */
export async function grantConsent(
  sp: RunningSp,
  agentDid: string,
  userDid: string,
  scopeOverride?: string[],
): Promise<SignedVC> {
  const catalogRes = await fetch(
    `${sp.baseUrl}/api/consent/scopes?agentDid=${encodeURIComponent(agentDid)}`,
  );
  const { scopeOptions } = (await catalogRes.json()) as { scopeOptions: Array<{ scope: string }> };
  const scopes = scopeOverride ?? scopeOptions.map((option) => option.scope);

  const acceptRes = await fetch(`${sp.baseUrl}/api/consent/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentDid, userDid, scopes, durability: 'standing' }),
  });
  const body = (await acceptRes.json()) as { grantVC: SignedVC };
  return body.grantVC;
}
