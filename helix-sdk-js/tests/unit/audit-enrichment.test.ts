// Copyright 2026 DgVerse LLP
//
// Epic: Audit Payload Enrichment + Consent Events.
//   §1  — VP_REJECTED carries best-effort context off the raw, unverified VP.
//   §2a — CONSENT_GRANTED fires when a grant VC lands in the wallet.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWallet } from '../../src/wallet/AgentWallet.js';
import { HelixClient } from '../../src/client/HelixClient.js';
import type { SignedVC } from '@helixid/core';

/** HttpAdapter-shaped mock. `hasAdminApiKey` is what gates audit emission. */
function mockHttp(): { post: ReturnType<typeof vi.fn>; hasAdminApiKey: () => boolean } {
  return { post: vi.fn().mockResolvedValue({}), hasAdminApiKey: () => true };
}

function auditCalls(http: { post: ReturnType<typeof vi.fn> }, path: string): unknown[] {
  return http.post.mock.calls.filter((call) => call[0] === path).map((call) => call[1]);
}

describe('§1 VP_REJECTED enrichment', () => {
  // A structurally plausible VP that still fails verification: the proof is
  // garbage, so verifyVP throws and the rejection audit path runs.
  function rejectableVP(credential: Record<string, unknown>): any {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      id: 'vp:helix:rejected-1',
      holder: 'did:key:zAgent',
      verifiableCredential: [credential],
      nonce: 'a'.repeat(64),
      expirationDate: new Date(Date.now() + 60_000).toISOString(),
      targetService: 'svc:test',
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: 'did:key:zAgent#key-1',
        proofPurpose: 'assertionMethod',
        proofValue: 'not-a-real-signature',
      },
    };
  }

  it('attaches attempted* identifiers pulled off the unverified credential', async () => {
    const http = mockHttp();
    const client = new HelixClient(http as any, 'http://localhost');

    await expect(
      client.verifyVP(
        rejectableVP({
          id: 'vc:helix:attempted-123',
          type: ['VerifiableCredential', 'HelixAgentCredential'],
          credentialSubject: {
            id: 'did:key:zAgent',
            parentVcId: 'vc:helix:parent-999',
            delegatedFrom: 'did:key:zParent',
          },
        }),
      ),
    ).rejects.toThrow();

    const [entry] = auditCalls(http, '/v1/audit-log/vp-verification') as Array<
      Record<string, unknown>
    >;
    expect(entry).toMatchObject({
      result: 'rejected',
      attemptedVcId: 'vc:helix:attempted-123',
      attemptedParentVcId: 'vc:helix:parent-999',
      attemptedDelegatedFrom: 'did:key:zParent',
    });
  });

  it('omits fields rather than inventing them when the VC carries no delegation', async () => {
    const http = mockHttp();
    const client = new HelixClient(http as any, 'http://localhost');

    await expect(
      client.verifyVP(
        rejectableVP({
          id: 'vc:helix:standalone',
          type: ['VerifiableCredential', 'HelixAgentCredential'],
          credentialSubject: { id: 'did:key:zAgent' },
        }),
      ),
    ).rejects.toThrow();

    const [entry] = auditCalls(http, '/v1/audit-log/vp-verification') as Array<
      Record<string, unknown>
    >;
    expect(entry.attemptedVcId).toBe('vc:helix:standalone');
    expect(entry).not.toHaveProperty('attemptedParentVcId');
    expect(entry).not.toHaveProperty('attemptedDelegatedFrom');
  });

  // The whole point of the guarded reads: verification already failed, so the
  // VP is exactly the kind of object that cannot be trusted to have a shape.
  it.each([
    ['credentialSubject is a string', { id: 'vc:x', credentialSubject: 'not-an-object' }],
    ['credentialSubject is null', { id: 'vc:x', credentialSubject: null }],
    ['id is a number', { id: 42, credentialSubject: { parentVcId: 'p' } }],
    ['credential is empty', {}],
  ])('does not throw out of the audit path when %s', async (_label, credential) => {
    const http = mockHttp();
    const client = new HelixClient(http as any, 'http://localhost');

    await expect(client.verifyVP(rejectableVP(credential as Record<string, unknown>))).rejects.toThrow();

    // The rejection audit still fired, and never a non-string in these fields.
    const [entry] = auditCalls(http, '/v1/audit-log/vp-verification') as Array<
      Record<string, unknown>
    >;
    expect(entry).toBeDefined();
    expect(entry.result).toBe('rejected');
    for (const key of ['attemptedVcId', 'attemptedParentVcId', 'attemptedDelegatedFrom']) {
      if (entry[key] !== undefined) expect(typeof entry[key]).toBe('string');
    }
  });

  it('survives a VP with no verifiableCredential array at all', async () => {
    const http = mockHttp();
    const client = new HelixClient(http as any, 'http://localhost');
    const vp = rejectableVP({});
    delete vp.verifiableCredential;

    await expect(client.verifyVP(vp)).rejects.toThrow();
    expect(auditCalls(http, '/v1/audit-log/vp-verification')).toHaveLength(1);
  });
});

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
