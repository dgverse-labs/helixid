// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  listVCs: vi.fn(),
  getVC: vi.fn(),
  revokeVC: vi.fn(),
  listServices: vi.fn(),
  registerService: vi.fn(),
  createEnrollmentToken: vi.fn(),
  getAuditLog: vi.fn(),
  constructorCalls: [] as unknown[][],
}));

vi.mock('@helixid/sdk-js', () => ({
  HelixClient: class {
    listVCs = mocks.listVCs;
    getVC = mocks.getVC;
    revokeVC = mocks.revokeVC;
    listServices = mocks.listServices;
    registerService = mocks.registerService;
    createEnrollmentToken = mocks.createEnrollmentToken;
    getAuditLog = mocks.getAuditLog;
    constructor(...args: unknown[]) {
      mocks.constructorCalls.push(args);
    }
  },
}));

async function importApi() {
  vi.resetModules();
  return import('../../src/api/client');
}

describe('api/client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.constructorCalls.length = 0;
    delete window.__HELIXID_CONFIG__;
    vi.unstubAllEnvs();
  });

  describe('configuration', () => {
    it('prefers runtime config injected via window.__HELIXID_CONFIG__', async () => {
      window.__HELIXID_CONFIG__ = {
        API_BASE_URL: 'http://runtime:4000',
        ADMIN_API_KEY: 'runtime-key',
      };
      await importApi();
      expect(mocks.constructorCalls[0]).toEqual([
        'http://runtime:4000',
        { adminApiKey: 'runtime-key' },
      ]);
    });

    it('falls back to VITE_* env vars for local dev', async () => {
      vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4000');
      vi.stubEnv('VITE_ADMIN_API_KEY', 'dev-key');
      await importApi();
      expect(mocks.constructorCalls[0]).toEqual([
        'http://localhost:4000',
        { adminApiKey: 'dev-key' },
      ]);
    });
  });

  describe('api surface', () => {
    it('listAgents delegates to client.listVCs', async () => {
      const { api } = await importApi();
      mocks.listVCs.mockResolvedValue([{ vcId: 'vc:1' }]);
      await expect(api.listAgents({ status: 'active' })).resolves.toEqual([{ vcId: 'vc:1' }]);
      expect(mocks.listVCs).toHaveBeenCalledWith({ status: 'active' });

      mocks.listVCs.mockRejectedValue(new Error('list failed'));
      await expect(api.listAgents()).rejects.toThrow('list failed');
    });

    it('getAgent delegates to client.getVC', async () => {
      const { api } = await importApi();
      mocks.getVC.mockResolvedValue({ vcId: 'vc:1' });
      await expect(api.getAgent('vc:1')).resolves.toEqual({ vcId: 'vc:1' });
      expect(mocks.getVC).toHaveBeenCalledWith('vc:1');

      mocks.getVC.mockRejectedValue(new Error('not found'));
      await expect(api.getAgent('vc:x')).rejects.toThrow('not found');
    });

    it('revokeAgent delegates to client.revokeVC', async () => {
      const { api } = await importApi();
      mocks.revokeVC.mockResolvedValue({ vcId: 'vc:1', revoked: true });
      await expect(api.revokeAgent('vc:1')).resolves.toEqual({ vcId: 'vc:1', revoked: true });
      expect(mocks.revokeVC).toHaveBeenCalledWith('vc:1');

      mocks.revokeVC.mockRejectedValue(new Error('already revoked'));
      await expect(api.revokeAgent('vc:1')).rejects.toThrow('already revoked');
    });

    it('listServices delegates to client.listServices', async () => {
      const { api } = await importApi();
      mocks.listServices.mockResolvedValue([{ serviceName: 'orders' }]);
      await expect(api.listServices()).resolves.toEqual([{ serviceName: 'orders' }]);

      mocks.listServices.mockRejectedValue(new Error('down'));
      await expect(api.listServices()).rejects.toThrow('down');
    });

    it('registerService delegates to client.registerService', async () => {
      const { api } = await importApi();
      const input = {
        serviceName: 'orders',
        displayName: 'Orders',
        verifiedDomain: 'orders.example.com',
        publicKeyMultibase: 'z6Mk',
        apiEndpoint: 'https://orders.example.com',
      };
      mocks.registerService.mockResolvedValue({ serviceName: 'orders' });
      await expect(api.registerService(input)).resolves.toEqual({ serviceName: 'orders' });
      expect(mocks.registerService).toHaveBeenCalledWith(input);

      mocks.registerService.mockRejectedValue(new Error('conflict'));
      await expect(api.registerService(input)).rejects.toThrow('conflict');
    });

    it('createEnrollmentToken delegates to client.createEnrollmentToken', async () => {
      const { api } = await importApi();
      const input = { agentName: 'billing', requestedScopes: ['read:orders'] };
      mocks.createEnrollmentToken.mockResolvedValue({ token: 'enroll:abc', expiresAt: 'later' });
      await expect(api.createEnrollmentToken(input)).resolves.toEqual({
        token: 'enroll:abc',
        expiresAt: 'later',
      });
      expect(mocks.createEnrollmentToken).toHaveBeenCalledWith(input);

      mocks.createEnrollmentToken.mockRejectedValue(new Error('bad scopes'));
      await expect(api.createEnrollmentToken(input)).rejects.toThrow('bad scopes');
    });

    it('getAuditLog delegates to client.getAuditLog', async () => {
      const { api } = await importApi();
      mocks.getAuditLog.mockResolvedValue([{ id: '1' }]);
      await expect(api.getAuditLog({ limit: 20 })).resolves.toEqual([{ id: '1' }]);
      expect(mocks.getAuditLog).toHaveBeenCalledWith({ limit: 20 });

      mocks.getAuditLog.mockRejectedValue(new Error('audit down'));
      await expect(api.getAuditLog()).rejects.toThrow('audit down');
    });
  });
});
