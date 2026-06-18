import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentWallet,
  checkScope,
  delegate,
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
      vpId: 'vp:helix:test',
      delegationChain: [],
    };

    expect(checkScope(result, 'read:orders')).toBe(true);
    expect(checkScope(result, 'write:orders')).toBe(false);
    expect(() => requireScope(result, 'write:orders')).toThrow('Required scope: write:orders');
  });

  it('delegates from wallet.credentials[0] by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-sdk-standalone-'));
    const path = join(dir, 'wallet.json');

    try {
      const wallet = await AgentWallet.create(path, 'pass');
      const parent = await wallet.selfIssueVC({
        scopes: ['read:orders', 'write:orders'],
        maxDelegationDepth: 1,
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
