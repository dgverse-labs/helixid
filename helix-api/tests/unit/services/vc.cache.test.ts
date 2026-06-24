// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStatusList, ErrorCode, generateKeyPair } from '@helixid/core';
import { VCService } from '../../../src/services/vc/vc.service.js';
import { InProcessCache } from '../../../src/cache/InProcessCache.js';

describe('VCService status-list cache behavior', () => {
  let repository: any;
  let didService: any;
  let auditLogger: any;
  let statusListCache: InProcessCache<string>;
  let service: VCService;
  let signingKey: string;

  beforeEach(() => {
    signingKey = generateKeyPair().privateKey;
    repository = {
      createVc: vi.fn(),
      findByVcId: vi.fn(),
      findActiveBySubjectDid: vi.fn(),
      createStatusList: vi.fn(),
      findStatusListById: vi.fn(),
      claimNextIndex: vi.fn(),
      revokeVc: vi.fn(),
      markAsRenewed: vi.fn(),
    };
    didService = { resolveDID: vi.fn() };
    auditLogger = { log: vi.fn() };
    statusListCache = new InProcessCache<string>();
    service = new VCService(
      repository,
      didService,
      auditLogger,
      signingKey,
      'did:hedera:testnet:testissuer',
      'http://localhost:3000',
      statusListCache,
      60,
    );
  });

  it('caches public status list credentials after the first DB read', async () => {
    const encodedList = createStatusList();
    repository.findStatusListById.mockResolvedValue({ listId: 'helix-status-list-1', encodedList, nextIndex: 0 });

    const first = await service.getStatusList('helix-status-list-1');
    const second = await service.getStatusList('helix-status-list-1');

    expect(first.credentialSubject.encodedList).toBe(encodedList);
    expect(second.credentialSubject.encodedList).toBe(encodedList);
    expect(repository.findStatusListById).toHaveBeenCalledTimes(1);
  });

  it('throws STATUS_LIST_NOT_FOUND and does not cache missing lists', async () => {
    repository.findStatusListById.mockResolvedValue(null);

    await expect(service.getStatusList('missing')).rejects.toMatchObject({ code: ErrorCode.STATUS_LIST_NOT_FOUND });
    await expect(statusListCache.get('missing')).resolves.toBeNull();
  });

  it('invalidates status-list cache after VC revocation', async () => {
    const encodedList = createStatusList();
    await statusListCache.set('helix-status-list-1', encodedList, 60);
    repository.findByVcId.mockResolvedValue({
      vcId: 'vc:1',
      subjectDid: 'did:subject',
      statusListIndex: 0,
      revokedAt: null,
    });
    repository.findStatusListById.mockResolvedValue({ listId: 'helix-status-list-1', encodedList, nextIndex: 1 });
    repository.revokeVc.mockResolvedValue({
      vcId: 'vc:1',
      subjectDid: 'did:subject',
      revokedAt: new Date(),
    });

    await service.revokeVC('vc:1', 'req-revoke');

    await expect(statusListCache.get('helix-status-list-1')).resolves.toBeNull();
  });
});
