// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VCService } from '../../../src/services/vc/vc.service.js';

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vcId: 'vc:helix:1',
    subjectDid: 'did:hedera:testnet:agent1',
    subjectType: 'agent',
    vcJson: {
      validFrom: '2026-01-01T00:00:00.000Z',
      credentialSubject: { agentName: 'billing-agent' },
    },
    privilegeScopes: ['read:orders'],
    statusListIndex: 0,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    renewedByVcId: null,
    parentVcId: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('VCService.listVCs', () => {
  let repository: any;
  let service: VCService;

  beforeEach(() => {
    repository = { findMany: vi.fn() };
    service = new VCService(
      repository,
      { resolveDID: vi.fn() } as any,
      { log: vi.fn() } as any,
      'a'.repeat(64),
      'did:hedera:testnet:issuer',
      'http://localhost',
    );
  });

  it('maps records to VC summaries', async () => {
    repository.findMany.mockResolvedValue([record()]);

    const result = await service.listVCs({});

    expect(result).toEqual([
      {
        vcId: 'vc:helix:1',
        subjectDid: 'did:hedera:testnet:agent1',
        agentName: 'billing-agent',
        scopes: ['read:orders'],
        status: 'active',
        issuedAt: '2026-06-01T00:00:00.000Z',
        expiresAt: expect.any(String),
      },
    ]);
  });

  it('passes subjectDid through to the repository', async () => {
    repository.findMany.mockResolvedValue([]);

    await service.listVCs({ subjectDid: 'did:1' });

    expect(repository.findMany).toHaveBeenCalledWith({ subjectDid: 'did:1' });
  });

  it('derives revoked and expired statuses and filters by status', async () => {
    repository.findMany.mockResolvedValue([
      record({ vcId: 'vc:active' }),
      record({ vcId: 'vc:revoked', revokedAt: new Date() }),
      record({ vcId: 'vc:expired', expiresAt: new Date(Date.now() - 60_000) }),
    ]);

    const all = await service.listVCs({});
    expect(all.map((s) => s.status)).toEqual(['active', 'revoked', 'expired']);

    const revoked = await service.listVCs({ status: 'revoked' });
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.vcId).toBe('vc:revoked');
  });

  it('applies the limit after status filtering, defaulting to 50', async () => {
    const records = Array.from({ length: 60 }, (_, i) => record({ vcId: `vc:${i}` }));
    repository.findMany.mockResolvedValue(records);

    expect(await service.listVCs({})).toHaveLength(50);
    expect(await service.listVCs({ limit: 5 })).toHaveLength(5);
  });

  it('includes parentVcId from the record or credential subject', async () => {
    repository.findMany.mockResolvedValue([
      record({ vcId: 'vc:col', parentVcId: 'vc:parent-col' }),
      record({
        vcId: 'vc:subject',
        vcJson: {
          credentialSubject: { agentName: 'child', parentVcId: 'vc:parent-subject' },
        },
      }),
    ]);

    const result = await service.listVCs({});
    expect(result[0]!.parentVcId).toBe('vc:parent-col');
    expect(result[1]!.parentVcId).toBe('vc:parent-subject');
  });

  it('parses stringified vcJson and privilegeScopes and falls back to validFrom', async () => {
    repository.findMany.mockResolvedValue([
      record({
        vcJson: JSON.stringify({
          validFrom: '2026-02-02T00:00:00.000Z',
          credentialSubject: { agentName: 'stringy' },
        }),
        privilegeScopes: JSON.stringify(['write:invoices']),
        createdAt: undefined,
      }),
    ]);

    const result = await service.listVCs({});
    expect(result[0]).toMatchObject({
      agentName: 'stringy',
      scopes: ['write:invoices'],
      issuedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('returns empty scopes and omits agentName when absent', async () => {
    repository.findMany.mockResolvedValue([
      record({ vcJson: { credentialSubject: {} }, privilegeScopes: null }),
    ]);

    const result = await service.listVCs({});
    expect(result[0]!.scopes).toEqual([]);
    expect(result[0]).not.toHaveProperty('agentName');
  });
});
