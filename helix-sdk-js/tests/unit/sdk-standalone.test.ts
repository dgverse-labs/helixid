import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentWallet,
  checkScope,
  delegate,
  HelixClient,
  requireScope,
  VPBuilder,
  verifyVP,
  type VerifyVPResult,
} from '../../src/index.js';

describe('standalone SDK exports', () => {
  it('exports core VP helpers without a HelixClient', () => {
    expect(VPBuilder).toBeDefined();
    expect(verifyVP).toBeDefined();
  });

  it('checks and requires scopes from a verification result', () => {
    const result: VerifyVPResult = {
      valid: true,
      agentDid: 'did:key:zAgent',
      privilegeScopes: ['read:orders'],
      effectiveScopes: ['read:orders'],
      vpId: 'vp:helix:test',
      delegationChain: [],
    };

    expect(checkScope(result, 'read:orders')).toBe(true);
    expect(checkScope(result, 'write:orders')).toBe(false);
    expect(() => requireScope(result, 'write:orders')).toThrow('Required scope: write:orders');

    // Enforcement reads effectiveScopes: a grant intersection narrower than
    // privilegeScopes must gate the scope check (§2.7).
    const narrowed: VerifyVPResult = { ...result, effectiveScopes: [] };
    expect(checkScope(narrowed, 'read:orders')).toBe(false);
    expect(() => requireScope(narrowed, 'read:orders')).toThrow('Required scope: read:orders');
  });

  it('delegates from wallet.credentials[0] by default', async () => {
    // Delegation payload construction now happens server-side via
    // prepare/finalize (see docs/proposal-sdk-api-only.md) — the wallet only
    // signs locally, so a HelixClient is required and the only thing left to
    // verify here is that delegate() picks wallet.credentials[0] as fromVC
    // when the caller doesn't supply one explicitly.
    const dir = await mkdtemp(join(tmpdir(), 'helix-sdk-standalone-'));
    const path = join(dir, 'wallet.json');

    try {
      const http = {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
        hasAdminApiKey: vi.fn(() => false),
      };
      const client = new HelixClient(http as any, 'http://api');
      const wallet = await AgentWallet.create(path, 'pass', client);
      const parent = await wallet.selfIssueVC({
        scopes: ['read:orders', 'write:orders'],
        maxDelegationDepth: 1,
      });

      http.post.mockImplementation(async (urlPath: string, body: any) => {
        if (urlPath === '/v1/vcs/delegation/prepare') {
          expect(body).toMatchObject({
            delegatorDid: wallet.getDID(),
            fromVC: parent,
            to: 'did:key:zDelegatee',
            scopes: ['read:orders'],
            expiresIn: 3600,
          });
          return {
            token: 'prepared-token',
            unsignedPayload: {},
            canonicalHash: 'ab'.repeat(32),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          };
        }
        if (urlPath === '/v1/vcs/delegation/finalize') {
          return {
            issuer: wallet.getDID(),
            credentialSubject: {
              id: 'did:key:zDelegatee',
              privilegeScopes: ['read:orders'],
              parentVcId: parent.id,
              delegationDepth: 1,
            },
          };
        }
        throw new Error(`unexpected path: ${urlPath}`);
      });

      const child = await delegate({
        to: 'did:key:zDelegatee',
        scopes: ['read:orders'],
        expiresIn: 3600,
      }, wallet);

      expect(child.issuer).toBe(wallet.getDID());
      expect(child.credentialSubject).toMatchObject({
        id: 'did:key:zDelegatee',
        privilegeScopes: ['read:orders'],
        parentVcId: parent.id,
        delegationDepth: 1,
      });
      expect(http.post).toHaveBeenCalledWith(
        '/v1/vcs/delegation/prepare',
        expect.objectContaining({ fromVC: parent }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects delegate calls when the wallet has no credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-sdk-standalone-'));
    const path = join(dir, 'wallet.json');

    try {
      const wallet = await AgentWallet.create(path, 'pass');
      await expect(delegate({
        to: 'did:key:zDelegatee',
        scopes: ['read:orders'],
        expiresIn: 3600,
      }, wallet)).rejects.toMatchObject({ code: 'NO_CREDENTIAL_IN_WALLET' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
