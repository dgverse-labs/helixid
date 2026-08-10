// The activity trail an SP emits for one guarded tool call.
//
// The point of these assertions is the *sequence and its verdicts*, not the
// prose: presentation, cryptographic verdict, policy verdict, and action are
// four separate records, and the interesting case is the one where the first
// two succeed and the third still refuses.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDIDCache,
  createEd25519Proof,
  generateKeyPair,
  publicKeyToMultibase,
  VPBuilder,
  type SignedVC,
} from '@helixid/core';
import { AgentWallet } from '@helixid/sdk-js';
import { AIRLINE, AGENT_PRIVILEGE_SCOPES, DEMO_USER_DID } from '../helixid-config/index.js';
import { createSpApp } from '../sp-shared/app.js';
import type { ActivityEvent } from '../sp-shared/audit.js';
import { provisionSpIdentity, statePath } from '../sp-shared/identity.js';
import { SpStore } from '../sp-shared/store.js';

const HOST = 'localhost';
const PORT = 14301;

let workDir: string;
let server: Server;
let baseUrl: string;
let wallet: AgentWallet;
let agentDid: string;
let serviceDid: string;
const recorded: ActivityEvent[] = [];

/** Records instead of POSTing, so assertions read the SP's own emissions. */
const recorder = { emit: (event: ActivityEvent) => void recorded.push(event) };

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  grant: SignedVC | undefined,
  correlationId: string,
): Promise<void> {
  const agentVC = wallet.credentials.find((vc) =>
    (vc.type as string[]).includes('HelixAgentCredential'),
  )!;
  const vp = await new VPBuilder({
    credentials: grant ? [agentVC, grant] : [agentVC],
    holderDid: wallet.getDID(),
    targetService: serviceDid,
    userDid: DEMO_USER_DID,
  }).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`);

  await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: { ...args, _helixVP: vp, _helixCorrelationId: correlationId } },
    }),
  });
}

async function issueGrantFor(scopes: string[]): Promise<SignedVC> {
  const res = await fetch(`${baseUrl}/api/consent/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentDid, userDid: DEMO_USER_DID, scopes, durability: 'standing' }),
  });
  return ((await res.json()) as { grantVC: SignedVC }).grantVC;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'helix-audit-trail-'));
  clearDIDCache();

  const { identity, statusList } = await provisionSpIdentity({
    dir: workDir,
    spId: AIRLINE.id,
    host: HOST,
    port: PORT,
  });
  serviceDid = identity.did;
  baseUrl = `http://${HOST}:${PORT}`;

  const { app } = createSpApp({
    definition: { ...AIRLINE, port: PORT },
    issuer: {
      did: identity.did,
      privateKeyHex: identity.privateKeyHex,
      publicKeyHex: identity.publicKeyHex,
    },
    baseUrl,
    store: await SpStore.open(statePath(workDir, AIRLINE.id), statusList),
    audit: recorder,
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(PORT, HOST, () => resolve(s));
  });

  const platform = generateKeyPair();
  const platformDid = `did:key:${publicKeyToMultibase(platform.publicKey)}`;
  wallet = await AgentWallet.create(join(workDir, 'agent.enc'), 'demo-passphrase');
  agentDid = wallet.did;

  const now = Date.now();
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: `vc:helix:agent:${agentDid.slice(-8)}`,
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: platformDid,
    validFrom: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 24 * 3600_000).toISOString(),
    credentialSubject: {
      id: agentDid,
      type: 'HelixAgent',
      privilegeScopes: AGENT_PRIVILEGE_SCOPES,
      agentName: 'Travel Planner Agent',
      delegationDepth: 0,
      maxDelegationDepth: 0,
    },
  };
  await wallet.addCredential({
    ...payload,
    proof: await createEd25519Proof(payload, platform.privateKey, `${platformDid}#key-1`),
  } as SignedVC);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  recorded.length = 0;
});

describe('SP activity trail', () => {
  it('records an open, read-only tool as an action needing no credential', async () => {
    await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_flights',
          arguments: {
            origin: 'TVM',
            destination: 'DEL',
            departureDate: '2026-09-01',
            _helixCorrelationId: 'act_open',
          },
        },
      }),
    });

    expect(recorded.map((e) => e.event)).toEqual(['TOOL_INVOKED']);
    expect(recorded[0]).toMatchObject({
      toolName: 'search_flights',
      result: 'success',
      reason: 'OPEN_TOOL_NO_SCOPE_REQUIRED',
      correlationId: 'act_open',
    });
    expect(recorded[0]?.resultSummary).toMatch(/flights? found/);
  });

  it('records issuance when the SP signs a grant', async () => {
    await issueGrantFor(['book:flights']);

    expect(recorded.map((e) => e.event)).toEqual(['VC_ISSUED']);
    expect(recorded[0]).toMatchObject({
      credentialType: 'DelegationGrantCredential',
      issuer: serviceDid,
      agentDid,
      userDid: DEMO_USER_DID,
      scopes: ['book:flights'],
      credentialStatus: 'active',
      result: 'success',
    });
    expect(recorded[0]?.vcId).toBeTruthy();
  });

  it('blocks a guarded tool presented with no credential at all', async () => {
    await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'book_flight', arguments: { flightId: 'HA-401' } },
      }),
    });

    expect(recorded.map((e) => e.event)).toEqual(['AUTHZ_DENIED']);
    expect(recorded[0]).toMatchObject({ reason: 'NO_PRESENTATION', result: 'blocked' });
  });

  it('verifies the presentation but blocks when this SP granted nothing', async () => {
    await callTool('book_flight', { flightId: 'HA-401' }, undefined, 'act_nogrant');

    expect(recorded.map((e) => e.event)).toEqual([
      'VC_PRESENTED',
      'VP_VERIFIED',
      'AUTHZ_DENIED',
    ]);
    expect(recorded.every((e) => e.correlationId === 'act_nogrant')).toBe(true);
    expect(recorded[1]).toMatchObject({ result: 'success' });
    expect(recorded[2]).toMatchObject({
      reason: 'NO_GRANT_FOR_THIS_SERVICE',
      result: 'blocked',
    });
  });

  // The case the whole model exists for: nothing is wrong with the credential,
  // and the action is refused anyway.
  it('verifies successfully and still blocks when the granted scope is insufficient', async () => {
    const grant = await issueGrantFor(['modify:booking']);
    recorded.length = 0;

    await callTool('book_flight', { flightId: 'HA-401' }, grant, 'act_scope');

    expect(recorded.map((e) => e.event)).toEqual([
      'VC_PRESENTED',
      'VP_VERIFIED',
      'AUTHZ_DENIED',
    ]);
    expect(recorded[1]).toMatchObject({ event: 'VP_VERIFIED', result: 'success' });
    expect(recorded[2]).toMatchObject({
      event: 'AUTHZ_DENIED',
      result: 'blocked',
      reason: 'INSUFFICIENT_EFFECTIVE_SCOPE',
      requiredScope: 'book:flights',
      effectiveScopes: ['modify:booking'],
    });
    expect(recorded[2]?.resultSummary).toContain('book:flights');
  });

  it('records the full success chain through to the action and its result', async () => {
    const grant = await issueGrantFor(['book:flights']);
    recorded.length = 0;

    await callTool('book_flight', { flightId: 'HA-401' }, grant, 'act_ok');

    expect(recorded.map((e) => e.event)).toEqual([
      'VC_PRESENTED',
      'VP_VERIFIED',
      'AUTHZ_GRANTED',
      'TOOL_INVOKED',
    ]);
    expect(recorded.every((e) => e.correlationId === 'act_ok')).toBe(true);
    expect(recorded.every((e) => e.result === 'success')).toBe(true);
    expect(recorded[2]).toMatchObject({
      requiredScope: 'book:flights',
      effectiveScopes: ['book:flights'],
      vcId: grant.id,
    });
    // The action record carries the booking the caller actually received.
    expect(recorded[3]?.resultSummary).toMatch(/CONFIRMED — FLT-/);
  });
});
