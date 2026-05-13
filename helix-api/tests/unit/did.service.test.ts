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
import { ErrorCode } from '@helix-id/core';

describe('DIDService', () => {
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
      mockRepo.findDidByPublicKey.mockResolvedValue({ id: 'did:helix:existing' });
      
      await expect(service.createDID(validPublicKey, 'user', requestId))
        .rejects.toThrow(/DID already exists/);
      
      expect(mockRepo.findDidByPublicKey).toHaveBeenCalledWith(validPublicKey);
    });

    it('successfully anchors and persists a new DID', async () => {
      mockRepo.findDidByPublicKey.mockResolvedValue(null);
      mockRepo.createDid.mockResolvedValue({
        did: 'did:helix:123',
        didDocument: {},
        hederaTransactionId: 'tx-1'
      });
      
      await service.createDID(validPublicKey, 'agent', requestId);
      
      expect(mockHedera.anchorDocument).toHaveBeenCalled();
      expect(mockRepo.createDid).toHaveBeenCalledWith(expect.objectContaining({
        subjectType: 'agent',
        publicKey: validPublicKey,
      }));
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'DID_CREATED', requestId }));
    });
  });

  describe('updateServiceEndpoint', () => {
    it('throws 410 Gone when trying to update a deactivated DID', async () => {
      mockRepo.findDidById.mockResolvedValue({ 
        id: 'did:helix:123', 
        deactivatedAt: new Date(),
        didDocument: { id: 'did:helix:123' }
      });

      await expect(service.addServiceEndpoint('did:helix:123', { id: '1', type: 't', serviceEndpoint: 'u' }, requestId))
        .rejects.toThrow(/Cannot update a deactivated DID/);
    });
  });
});
