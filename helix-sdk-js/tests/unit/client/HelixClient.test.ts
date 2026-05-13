import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';

describe('HelixClient', () => {
  let client: HelixClient;
  let mockHttp: any;

  beforeEach(() => {
    client = new HelixClient('http://localhost');
    mockHttp = {
      post: vi.fn(),
      get: vi.fn(),
    };
    client.__setTestHttpAdapter(mockHttp);
  });

  describe('User Challenge', () => {
    it('requests user challenge', async () => {
      const mockRes = { challengeId: 'ch1', nonce: 'n1', expiresAt: 'exp' };
      mockHttp.post.mockResolvedValue(mockRes);

      const result = await client.requestUserChallenge('did:test:user');
      expect(result).toEqual(mockRes);
      expect(mockHttp.post).toHaveBeenCalledWith('/v1/challenges', { did: 'did:test:user', purpose: 'user_verification' });
    });

    it('verifies user challenge', async () => {
      const mockRes = { did: 'did:test:user', verified: true };
      mockHttp.post.mockResolvedValue(mockRes);

      const result = await client.verifyUserChallenge('ch1', 'sig');
      expect(result).toEqual(mockRes);
      expect(mockHttp.post).toHaveBeenCalledWith('/v1/challenges/ch1/verify', { signature: 'sig' });
    });
  });

  describe('Service Registry', () => {
    it('lists services', async () => {
      const mockRes = { services: [{ name: 's1' }] };
      mockHttp.get.mockResolvedValue(mockRes);

      const result = await client.listServices();
      expect(result).toEqual(mockRes.services);
      expect(mockHttp.get).toHaveBeenCalledWith('/v1/services');
    });

    it('gets a single service', async () => {
      const mockRes = { name: 's1' };
      mockHttp.get.mockResolvedValue(mockRes);

      const result = await client.getService('s1');
      expect(result).toEqual(mockRes);
      expect(mockHttp.get).toHaveBeenCalledWith('/v1/services/s1');
    });

    it('throws if GET is not implemented', async () => {
      client.__setTestHttpAdapter({ post: vi.fn() }); // No get
      await expect(client.listServices()).rejects.toThrow('GET not implemented by adapter');
      await expect(client.getService('s1')).rejects.toThrow('GET not implemented by adapter');
    });
  });

  describe('Onboarding errors', () => {
    it('throws if no pending keypair', async () => {
      await expect(client.completeOnboarding('ch1', 'n1', 'pass', '/tmp/w')).rejects.toThrow('No pending onboarding keypair');
    });
  });
});
