// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DIDService } from '../../src/services/did/did.service.js';

describe('DIDService Unit Tests', () => {
  let mockRepo: any;
  let mockHedera: any;
  let mockAudit: any;
  let service: DIDService;

  const validPublicKey = 'a'.repeat(64);
  const requestId = 'test-request-id';

  beforeEach(() => {
    mockRepo = {
      findDidByPublicKey: vi.fn(),
      createDid: vi.fn(),
      findDidById: vi.fn(),
      updateDidDocument: vi.fn(),
      deactivateDid: vi.fn(),
    };
    mockHedera = {
      anchorDocument: vi.fn().mockResolvedValue({ transactionId: 'tx-1', topicId: 'topic', sequenceNumber: 1 }),
      fetchMessage: vi.fn(),
    };
    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };
    service = new DIDService(mockRepo, mockHedera, mockAudit);
  });

  describe('createDID', () => {
    it('prevents creating duplicate DIDs for the same public key', async () => {
      mockRepo.findDidByPublicKey.mockResolvedValue({ id: 'did:hedera:testnet:existing' });
      
      await expect(service.createDID(validPublicKey, 'user', [], requestId))
        .rejects.toThrow(/DID already exists/);
      
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'DID_CREATION_FAILED' }));
    });

    it('successfully anchors and persists a new DID', async () => {
      mockRepo.findDidByPublicKey.mockResolvedValue(null);
      mockRepo.createDid.mockResolvedValue({
        id: 'did:hedera:testnet:123',
        didDocument: {},
        hederaTransactionId: 'tx-1'
      });
      
      await service.createDID(validPublicKey, 'agent', ['https://example.com'], requestId);
      
      expect(mockHedera.anchorDocument).toHaveBeenCalled();
      expect(mockRepo.createDid).toHaveBeenCalled();
    });

    it('logs and rethrows anchoring failures', async () => {
      mockRepo.findDidByPublicKey.mockResolvedValue(null);
      mockHedera.anchorDocument.mockRejectedValue(new Error('Hedera down'));

      await expect(service.createDID(validPublicKey, 'agent', [], requestId))
        .rejects.toThrow('Hedera down');
      
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'DID_CREATION_FAILED', reason: 'Hedera anchoring failed' }));
    });
  });

  describe('resolveDID', () => {
    it('throws 404 if DID not in database', async () => {
      mockRepo.findDidById.mockResolvedValue(null);
      await expect(service.resolveDID('did:helix:fake', {}, requestId)).rejects.toThrow(/DID not found/);
    });

    it('resolves from the database by default', async () => {
      const doc = { id: 'did:helix:123' };
      mockRepo.findDidById.mockResolvedValue({ id: 'did:helix:123', didDocument: doc });
      const result = await service.resolveDID('did:helix:123', {}, requestId);
      expect(result.source).toBe('db');
      expect(result.didDocument).toEqual(doc);
    });

    it('resolves live from Hedera if requested', async () => {
      const doc = { id: 'did:helix:123', version: 1 };
      const liveDoc = { id: 'did:helix:123', version: 2 };
      mockRepo.findDidById.mockResolvedValue({ 
        id: 'did:helix:123', 
        didDocument: doc,
        hederaTopicId: '0.0.1',
        hederaSequenceNumber: 1
      });
      mockHedera.fetchMessage.mockResolvedValue({ contents: JSON.stringify(liveDoc) });

      const result = await service.resolveDID('did:helix:123', { live: true }, requestId);
      expect(result.source).toBe('hedera');
      expect(result.didDocument).toEqual(liveDoc);
    });

    it('fails honestly if live resolution fails', async () => {
      const doc = { id: 'did:helix:123' };
      mockRepo.findDidById.mockResolvedValue({ 
        id: 'did:helix:123', 
        didDocument: doc,
        hederaTopicId: '0.0.1',
        hederaSequenceNumber: 1
      });
      mockHedera.fetchMessage.mockRejectedValue(new Error('Fetch failed'));

      await expect(service.resolveDID('did:helix:123', { live: true }, requestId))
        .rejects.toMatchObject({ code: 'HEDERA_RESOLUTION_FAILED' });
    });
  });

  describe('removeServiceEndpoint', () => {
    it('throws 404 for unknown DID', async () => {
      mockRepo.findDidById.mockResolvedValue(null);
      await expect(service.removeServiceEndpoint('did:123', 'id-1', requestId)).rejects.toThrow(/DID not found/);
    });

    it('throws 410 for deactivated DID', async () => {
      mockRepo.findDidById.mockResolvedValue({ id: 'did:123', deactivatedAt: new Date() });
      await expect(service.removeServiceEndpoint('did:123', 'id-1', requestId)).rejects.toThrow(/Cannot update a deactivated DID/);
    });

    it('successfully removes endpoint', async () => {
      const doc = { id: 'did:123', service: [{ id: 'id-1', type: 't', serviceEndpoint: 'u' }] };
      mockRepo.findDidById.mockResolvedValue({ id: 'did:123', didDocument: doc });
      
      const result = await service.removeServiceEndpoint('did:123', 'id-1', requestId);
      expect(result.service).toBeUndefined();
      expect(mockRepo.updateDidDocument).toHaveBeenCalled();
    });
  });

  describe('deactivateDID', () => {
    it('is idempotent if already deactivated', async () => {
      mockRepo.findDidById.mockResolvedValue({ id: 'did:123', deactivatedAt: new Date() });
      await service.deactivateDID('did:123', requestId);
      expect(mockRepo.deactivateDid).not.toHaveBeenCalled();
    });

    it('swallows Hedera failure and proceeds with local deactivation', async () => {
      mockRepo.findDidById.mockResolvedValue({ id: 'did:123', deactivatedAt: null });
      mockHedera.anchorDocument.mockRejectedValue(new Error('Hedera unreachable'));

      await service.deactivateDID('did:123', requestId);
      expect(mockRepo.deactivateDid).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'DID_DEACTIVATED' }));
    });
  });
});
