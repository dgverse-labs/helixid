// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';

describe('HelixClient console endpoints', () => {
  let client: HelixClient;
  let mockHttp: { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockHttp = { post: vi.fn(), get: vi.fn() };
    client = new HelixClient(mockHttp as never, 'http://localhost');
  });

  describe('listVCs', () => {
    it('calls GET /v1/vcs without a query string when no filters given', async () => {
      mockHttp.get.mockResolvedValue([]);
      await expect(client.listVCs()).resolves.toEqual([]);
      expect(mockHttp.get).toHaveBeenCalledWith('/v1/vcs');
    });

    it('encodes filters as query params', async () => {
      mockHttp.get.mockResolvedValue([]);
      await client.listVCs({ subjectDid: 'did:hedera:testnet:a b', status: 'revoked', limit: 5 });
      expect(mockHttp.get).toHaveBeenCalledWith(
        '/v1/vcs?subjectDid=did%3Ahedera%3Atestnet%3Aa+b&status=revoked&limit=5',
      );
    });

    it('throws when the adapter has no GET', async () => {
      const postOnly = new HelixClient({ post: vi.fn() } as never, 'http://localhost');
      await expect(postOnly.listVCs()).rejects.toThrow('GET not implemented by adapter');
    });

    it('propagates API errors', async () => {
      mockHttp.get.mockRejectedValue(new Error('boom'));
      await expect(client.listVCs()).rejects.toThrow('boom');
    });
  });

  describe('getAuditLog', () => {
    it('calls GET /v1/audit-log without a query string when no filters given', async () => {
      mockHttp.get.mockResolvedValue([]);
      await expect(client.getAuditLog()).resolves.toEqual([]);
      expect(mockHttp.get).toHaveBeenCalledWith('/v1/audit-log');
    });

    it('encodes filters as query params', async () => {
      mockHttp.get.mockResolvedValue([]);
      await client.getAuditLog({
        eventType: 'onboarding_complete',
        since: '2026-06-01T00:00:00.000Z',
        limit: 20,
      });
      expect(mockHttp.get).toHaveBeenCalledWith(
        '/v1/audit-log?eventType=onboarding_complete&since=2026-06-01T00%3A00%3A00.000Z&limit=20',
      );
    });

    it('throws when the adapter has no GET', async () => {
      const postOnly = new HelixClient({ post: vi.fn() } as never, 'http://localhost');
      await expect(postOnly.getAuditLog()).rejects.toThrow('GET not implemented by adapter');
    });

    it('propagates API errors', async () => {
      mockHttp.get.mockRejectedValue(new Error('audit down'));
      await expect(client.getAuditLog()).rejects.toThrow('audit down');
    });
  });

  describe('createEnrollmentToken', () => {
    it('posts the input to /v1/enrollment-tokens', async () => {
      const result = { token: 'enroll:abc', expiresAt: '2026-06-01T00:15:00.000Z' };
      mockHttp.post.mockResolvedValue(result);

      const input = {
        agentName: 'billing-agent',
        requestedScopes: ['read:orders'],
        requestedDomains: ['example.com'],
        maxDelegationDepth: 1,
      };
      await expect(client.createEnrollmentToken(input)).resolves.toEqual(result);
      expect(mockHttp.post).toHaveBeenCalledWith('/v1/enrollment-tokens', input);
    });

    it('propagates API errors', async () => {
      mockHttp.post.mockRejectedValue(new Error('invalid scopes'));
      await expect(
        client.createEnrollmentToken({ agentName: 'x', requestedScopes: [] }),
      ).rejects.toThrow('invalid scopes');
    });
  });

  describe('registerService', () => {
    const input = {
      serviceName: 'orders-api',
      displayName: 'Orders API',
      verifiedDomain: 'orders.example.com',
      publicKeyMultibase: 'z6Mk...',
      apiEndpoint: 'https://orders.example.com/api',
    };

    it('posts to /v1/services and defaults metadata to an empty object', async () => {
      mockHttp.post.mockResolvedValue({ serviceName: 'orders-api' });
      await expect(client.registerService(input)).resolves.toEqual({ serviceName: 'orders-api' });
      expect(mockHttp.post).toHaveBeenCalledWith('/v1/services', { ...input, metadata: {} });
    });

    it('keeps caller-provided metadata', async () => {
      mockHttp.post.mockResolvedValue({});
      await client.registerService({ ...input, metadata: { tier: 'gold' } });
      expect(mockHttp.post).toHaveBeenCalledWith('/v1/services', {
        ...input,
        metadata: { tier: 'gold' },
      });
    });

    it('propagates API errors', async () => {
      mockHttp.post.mockRejectedValue(new Error('conflict'));
      await expect(client.registerService(input)).rejects.toThrow('conflict');
    });
  });
});
