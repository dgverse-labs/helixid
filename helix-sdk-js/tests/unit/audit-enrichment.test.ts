// Copyright 2026 DgVerse LLP
//
// Epic: Audit Payload Enrichment + Consent Events.
//   §1  — VP_REJECTED enrichment (attemptedVcId/attemptedParentVcId/
//         attemptedDelegatedFrom pulled off the unverified credential) moved
//         server-side with the rest of VP verification (see
//         docs/proposal-sdk-api-only.md). helix-api's vp.service unit tests
//         and its audit-log integration tests own that coverage now; the SDK
//         no longer runs verification or writes this audit entry itself, so
//         there is nothing left here to test.
//   §2a — CONSENT_GRANTED fires when a grant VC lands in the wallet. This is
//         still SDK-side: it's the wallet reacting to a credential it already
//         holds locally, not a verification decision, so it wasn't part of
//         the SDK-API-only migration.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWallet } from '../../src/wallet/AgentWallet.js';
import { HelixClient } from '../../src/client/HelixClient.js';
import type { SignedVC } from '../../src/core/schemas/vc.js';

/** HttpAdapter-shaped mock. `hasAdminApiKey` is what gates audit emission. */
function mockHttp(): { post: ReturnType<typeof vi.fn>; hasAdminApiKey: () => boolean } {
  return { post: vi.fn().mockResolvedValue({}), hasAdminApiKey: () => true };
}

function auditCalls(http: { post: ReturnType<typeof vi.fn> }, path: string): unknown[] {
  return http.post.mock.calls.filter((call) => call[0] === path).map((call) => call[1]);
}

describe('§2a CONSENT_GRANTED', () => {
  let workDir: string;
  let walletPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'helix-consent-audit-'));
    walletPath = join(workDir, 'agent.enc');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function grantVC(agentDid: string): SignedVC {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'vc:helix:grant-1',
      type: ['VerifiableCredential', 'DelegationGrantCredential'],
      issuer: 'did:web:airline.example',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      credentialSubject: {
        id: agentDid,
        type: 'DelegationGrant',
        userDid: 'did:key:zUser',
        scopes: ['book:flight'],
        durability: 'standing',
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: 'did:web:airline.example#key-1',
        proofPurpose: 'assertionMethod',
        proofValue: 'sig',
      },
    } as unknown as SignedVC;
  }

  function agentVC(agentDid: string): SignedVC {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'vc:helix:agent-1',
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: 'did:web:platform.example',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      credentialSubject: {
        id: agentDid,
        type: 'HelixAgent',
        privilegeScopes: ['read:catalog'],
        agentName: 'test-agent',
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: 'did:web:platform.example#key-1',
        proofPurpose: 'assertionMethod',
        proofValue: 'sig',
      },
    } as unknown as SignedVC;
  }

  it('emits the grant payload when a DelegationGrantCredential is stored', async () => {
    const http = mockHttp();
    const client = new HelixClient(http as any, 'http://localhost');
    const wallet = await AgentWallet.create(walletPath, 'pw', client);

    await wallet.addCredential(grantVC(wallet.did));

    const [entry] = auditCalls(http, '/v1/audit-log/consent-granted') as Array<
      Record<string, unknown>
    >;
    expect(entry).toMatchObject({
      vcId: 'vc:helix:grant-1',
      agentDid: wallet.did,
      issuer: 'did:web:airline.example',
      userDid: 'did:key:zUser',
      scopes: ['book:flight'],
      durability: 'standing',
      eventType: 'CONSENT_GRANTED',
    });
  });

  it('stays silent for ordinary (non-grant) credentials', async () => {
    const http = mockHttp();
    const client = new HelixClient(http as any, 'http://localhost');
    const wallet = await AgentWallet.create(walletPath, 'pw', client);

    await wallet.addCredential(agentVC(wallet.did));

    expect(auditCalls(http, '/v1/audit-log/consent-granted')).toHaveLength(0);
  });

  it('still stores the grant when no client is attached', async () => {
    const wallet = await AgentWallet.create(walletPath, 'pw');

    await expect(wallet.addCredential(grantVC(wallet.did))).resolves.toBeUndefined();
    expect(wallet.credentials.map((vc) => vc.id)).toContain('vc:helix:grant-1');
  });

  it('still stores the grant when the audit POST fails', async () => {
    const http = mockHttp();
    http.post.mockRejectedValue(new Error('helix-api unreachable'));
    const client = new HelixClient(http as any, 'http://localhost');
    const wallet = await AgentWallet.create(walletPath, 'pw', client);

    await expect(wallet.addCredential(grantVC(wallet.did))).resolves.toBeUndefined();
    expect(wallet.credentials.map((vc) => vc.id)).toContain('vc:helix:grant-1');
  });

  it('does not emit when the client has no admin key (audit disabled)', async () => {
    const http = { post: vi.fn().mockResolvedValue({}), hasAdminApiKey: () => false };
    const client = new HelixClient(http as any, 'http://localhost');
    const wallet = await AgentWallet.create(walletPath, 'pw', client);

    await wallet.addCredential(grantVC(wallet.did));

    expect(auditCalls(http, '/v1/audit-log/consent-granted')).toHaveLength(0);
  });
});
