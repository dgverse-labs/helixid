import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VPService, mapErrorToResponse } from '../../../src/services/vp/vp.service.js';
import { ServiceNotFoundError } from '../../../src/services/vp/ServiceRegistryRepository.js';
import { VPVerificationFailedError } from '@helix-id/core';

describe('VPService Unit Tests', () => {
  let vpRepository: any;
  let didService: any;
  let vcService: any;
  let serviceRegistry: any;
  let auditLogger: any;
  let vpService: VPService;

  beforeEach(() => {
    vpRepository = {
      findPendingByVpId: vi.fn(),
      consumeAtomically: vi.fn(),
    };
    didService = { resolveDID: vi.fn() };
    vcService = { findActiveBySubjectDid: vi.fn(), getVCStatus: vi.fn() };
    serviceRegistry = { assertExists: vi.fn() };
    auditLogger = { log: vi.fn() };

    vpService = new VPService(
      vpRepository,
      didService,
      vcService,
      serviceRegistry,
      auditLogger
    );
  });

  describe('verifyVP', () => {
    it('throws VPVerificationFailedError for generic errors in verifyVP', async () => {
      vpRepository.findPendingByVpId.mockRejectedValue(new Error('DB Error'));
      
      const signedVP = { id: 'vp:helix:123' } as any;
      await expect(vpService.verifyVP(signedVP, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });
  });

  describe('mapErrorToResponse', () => {
    it('returns 500 for unknown error types', () => {
      const error = new Error('Unknown');
      const response = mapErrorToResponse(error);
      expect(response.statusCode).toBe(500);
      expect(response.code).toBe('INTERNAL_ERROR');
    });
  });
});
