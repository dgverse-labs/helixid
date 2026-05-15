// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DIDService } from '../../../src/services/did/did.service.js';
import { ErrorCode } from '@helix-id/core';

describe('DIDService Branch Coverage', () => {
  let repository: any;
  let hedera: any;
  let audit: any;
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
    };
    audit = { log: vi.fn() };
    service = new DIDService(repository, hedera, audit);
  });

  describe('createDID branches', () => {
    it('throws if already exists', async () => {
        repository.findDidByPublicKey.mockResolvedValue({ id: 'did:1' });
        await expect(service.createDID('pub', 'agent', [], 'req-1')).rejects.toMatchObject({ code: ErrorCode.DID_ALREADY_EXISTS });
    });

    it('throws if anchoring fails', async () => {
        repository.findDidByPublicKey.mockResolvedValue(null);
        hedera.anchorDocument.mockRejectedValue(new Error('HCS fail'));
        await expect(service.createDID('pub', 'agent', [], 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.HEDERA_ANCHOR_FAILED, httpStatus: 502, message: 'HCS fail' });
    });
  });

  describe('resolveDID branches', () => {
    it('throws if not found', async () => {
        repository.findDidById.mockResolvedValue(null);
        await expect(service.resolveDID('did:1')).rejects.toMatchObject({ code: ErrorCode.DID_NOT_FOUND });
    });

    it('handles live=true with successful fetch', async () => {
        repository.findDidById.mockResolvedValue({ didDocument: { id: 'did:1' }, hederaTopicId: 't1', hederaSequenceNumber: 1 });
        hedera.fetchMessage.mockResolvedValue({ contents: JSON.stringify({ id: 'did:1', live: true }) });
        const res = await service.resolveDID('did:1', { live: true });
        expect(res.source).toBe('hedera');
        expect(res.didDocument.live).toBe(true);
    });

    it('falls back to cache if live fetch fails', async () => {
        repository.findDidById.mockResolvedValue({ didDocument: { id: 'did:1' } });
        hedera.fetchMessage.mockRejectedValue(new Error('fail'));
        const res = await service.resolveDID('did:1', { live: true });
        expect(res.didDocument.id).toBe('did:1');
    });

    it('handles options as string (requestId)', async () => {
        repository.findDidById.mockResolvedValue({ didDocument: { id: 'did:1' } });
        const res = await service.resolveDID('did:1', 'req-123');
        expect(res.did).toBe('did:1');
    });
  });

  describe('addServiceEndpoint branches', () => {
    it('throws if not found', async () => {
        repository.findDidById.mockResolvedValue(null);
        await expect(service.addServiceEndpoint('did:1', {} as any, 'req-1')).rejects.toMatchObject({ code: ErrorCode.DID_NOT_FOUND });
    });

    it('throws if deactivated', async () => {
        repository.findDidById.mockResolvedValue({ deactivatedAt: new Date() });
        await expect(service.addServiceEndpoint('did:1', {} as any, 'req-1')).rejects.toMatchObject({ code: ErrorCode.DID_DEACTIVATED });
    });
  });

  describe('deactivateDID branches', () => {
    it('returns early if already deactivated', async () => {
        repository.findDidById.mockResolvedValue({ deactivatedAt: new Date() });
        await service.deactivateDID('did:1', 'req-1');
        expect(repository.deactivateDid).not.toHaveBeenCalled();
    });

    it('handles anchoring failure silently', async () => {
        repository.findDidById.mockResolvedValue({ deactivatedAt: null });
        hedera.anchorDocument.mockRejectedValue(new Error('fail'));
        await service.deactivateDID('did:1', 'req-1');
        expect(repository.deactivateDid).toHaveBeenCalled();
    });
  });
});
