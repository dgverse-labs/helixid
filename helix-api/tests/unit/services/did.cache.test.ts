// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DIDService } from '../../../src/services/did/did.service.js';
import { InProcessCache } from '../../../src/cache/InProcessCache.js';
import { ErrorCode, type DIDDocument } from '../../../src/core/index.js';

describe('DIDService cache behavior', () => {
  let repository: any;
  let hedera: any;
  let audit: any;
  let cache: InProcessCache<DIDDocument>;
  let service: DIDService;

  beforeEach(() => {
    repository = {
      findDidById: vi.fn(),
      findDidByPublicKey: vi.fn(),
      createDid: vi.fn(),
      updateDidDocument: vi.fn(),
      deactivateDid: vi.fn(),
    };
    hedera = {
      anchorDocument: vi.fn(),
      fetchMessage: vi.fn(),
      prepareDIDCreation: vi.fn(),
      submitDIDCreation: vi.fn(),
    };
    audit = { log: vi.fn() };
    cache = new InProcessCache<DIDDocument>();
    service = new DIDService(repository, hedera, audit, cache, 60);
  });

  it('returns cached DID documents but still checks durable deactivation state', async () => {
    const did = 'did:hedera:testnet:cache-test';
    const doc = { id: did, verificationMethod: [] } as unknown as DIDDocument;
    await cache.set(did, doc, 60);
    repository.findDidById.mockResolvedValue({ id: did, didDocument: doc, deactivatedAt: null });

    const result = await service.resolveDID(did, 'req-cache');

    expect(result.source).toBe('cache');
    expect(result.didDocument).toBe(doc);
    expect(repository.findDidById).toHaveBeenCalledTimes(1);
    expect(hedera.fetchMessage).not.toHaveBeenCalled();
  });

  it('rejects a cached DID when the durable record is deactivated', async () => {
    const did = 'did:hedera:testnet:deactivated';
    const doc = { id: did, verificationMethod: [] } as unknown as DIDDocument;
    await cache.set(did, doc, 60);
    repository.findDidById.mockResolvedValue({ id: did, didDocument: doc, deactivatedAt: new Date() });

    await expect(service.resolveDID(did, 'req-deactivated'))
      .rejects.toMatchObject({ code: ErrorCode.DID_DEACTIVATED });
    await expect(cache.get(did)).resolves.toBeNull();
  });

  it('invalidates cache after service endpoint updates and deactivation', async () => {
    const did = 'did:hedera:testnet:update';
    const doc = {
      id: did,
      controller: did,
      verificationMethod: [],
      service: [],
    } as unknown as DIDDocument;
    await cache.set(did, doc, 60);
    repository.findDidById.mockResolvedValue({ id: did, didDocument: doc, deactivatedAt: null });
    hedera.anchorDocument.mockResolvedValue({ transactionId: 'tx-1' });

    await service.addServiceEndpoint(
      did,
      { id: '#svc', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' },
      'req-update',
    );

    await expect(cache.get(did)).resolves.toBeNull();

    await cache.set(did, doc, 60);
    await service.deactivateDID(did, 'req-deactivate');

    await expect(cache.get(did)).resolves.toBeNull();
    expect(repository.deactivateDid).toHaveBeenCalled();
  });
});
