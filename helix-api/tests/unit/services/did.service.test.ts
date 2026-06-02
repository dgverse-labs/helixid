// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DIDService } from '../../../src/services/did/did.service.js';
import { ErrorCode, HelixError } from '@helix-id/core';

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
      prepareDIDCreation: vi.fn(),
      submitDIDCreation: vi.fn(),
    };
    audit = { log: vi.fn() };
    service = new DIDService(repository, hedera, audit);
  });

  describe('createDID branches', () => {
    it('prepares DID creation with a multibase public key', async () => {
        hedera.prepareDIDCreation.mockResolvedValue({ stateJson: '{}', signingPayloadHex: 'aa' });

        const result = await service.prepareDIDCreation('a'.repeat(64));

        expect(hedera.prepareDIDCreation).toHaveBeenCalledWith(expect.stringMatching(/^z/));
        expect(result).toEqual({ stateJson: '{}', signingPayloadHex: 'aa' });
    });

    it('creates a DID from a signed Hiero creation proof and appends service endpoints', async () => {
        const didDocument = {
          id: 'did:hedera:testnet:agent_0.0.1',
          controller: 'did:hedera:testnet:agent_0.0.1',
          verificationMethod: [{ publicKeyMultibase: 'zAgent' }],
        };
        repository.findDidByPublicKey.mockResolvedValue(null);
        hedera.submitDIDCreation.mockResolvedValue({
          did: 'did:hedera:testnet:agent_0.0.1',
          didDocument,
          transactionId: 'tx-live',
          topicId: '0.0.1',
          sequenceNumber: 2,
        });
        repository.createDid.mockImplementation(async (data: any) => ({
          id: data.id,
          didDocument: data.didDocument,
          hederaTransactionId: data.hederaTransactionId,
        }));

        const result = await service.createDID(
          'a'.repeat(64),
          'agent',
          ['https://agent.example.com'],
          'req-1',
          { stateJson: '{"message":[1]}', signatureHex: 'aa' },
        );

        expect(hedera.submitDIDCreation).toHaveBeenCalledWith('{"message":[1]}', 'aa');
        expect(repository.createDid).toHaveBeenCalledWith(expect.objectContaining({
          id: 'did:hedera:testnet:agent_0.0.1',
          hederaTransactionId: 'tx-live',
          hederaTopicId: '0.0.1',
          hederaSequenceNumber: 2,
        }));
        expect(result.didDocument.service).toEqual([
          {
            id: 'did:hedera:testnet:agent_0.0.1#domain-1',
            type: 'LinkedDomains',
            serviceEndpoint: 'https://agent.example.com',
          },
        ]);
    });

    it('preserves HelixError failures during anchoring', async () => {
        repository.findDidByPublicKey.mockResolvedValue(null);
        hedera.anchorDocument.mockRejectedValue(
          new HelixError(ErrorCode.DID_ALREADY_EXISTS, 'known', 409),
        );

        await expect(service.createDID('a'.repeat(64), 'agent', [], 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.DID_ALREADY_EXISTS });
    });

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
        expect((res.didDocument as unknown as { live?: boolean }).live).toBe(true);
    });

    it('fails honestly if live fetch fails', async () => {
        repository.findDidById.mockResolvedValue({ didDocument: { id: 'did:1' } });
        hedera.fetchMessage.mockRejectedValue(new Error('fail'));
        await expect(service.resolveDID('did:1', { live: true }))
            .rejects.toMatchObject({ code: 'HEDERA_RESOLUTION_FAILED' });
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

    it('adds an endpoint, anchors, persists, and audits', async () => {
        const doc = {
          id: 'did:1',
          service: [],
        };
        const endpoint = { id: 'svc-1', type: 'DemoService', serviceEndpoint: 'https://svc.example.com' };
        repository.findDidById.mockResolvedValue({ didDocument: doc, deactivatedAt: null });
        hedera.anchorDocument.mockResolvedValue({ transactionId: 'tx-add' });

        const result = await service.addServiceEndpoint('did:1', endpoint as any, 'req-1');

        expect(result.service).toEqual([endpoint]);
        expect(repository.updateDidDocument).toHaveBeenCalledWith('did:1', result, expect.objectContaining({
          updateType: 'add_service_endpoint',
          hederaTransactionId: 'tx-add',
        }));
        expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
          event: 'DID_UPDATED',
          updateType: 'add_service_endpoint',
        }));
    });
  });

  describe('deactivateDID branches', () => {
    it('throws if DID does not exist', async () => {
        repository.findDidById.mockResolvedValue(null);

        await expect(service.deactivateDID('did:missing', 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.DID_NOT_FOUND });
    });

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
