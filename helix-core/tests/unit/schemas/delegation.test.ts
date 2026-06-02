import { describe, expect, it } from 'vitest';
import {
  validateScopeSubset,
  validateChainIntegrity,
  extractChainFromVC,
  type AgentVC,
} from '../../../src/schemas/vc.js';

function vc(
  id: string,
  subjectDid: string,
  scopes: string[],
  delegation: Partial<AgentVC['credentialSubject']> = {},
): AgentVC {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id,
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: 'did:hedera:testnet:issuer',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 60_000).toISOString(),
    credentialStatus: {
      id: 'https://example.com/status#0',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '0',
      statusListCredential: 'https://example.com/status',
    },
    credentialSubject: {
      id: subjectDid,
      type: 'HelixAgent',
      privilegeScopes: scopes,
      agentName: subjectDid,
      ...delegation,
    },
  };
}

describe('delegation schema helpers', () => {
  it('allows child scopes that are a subset of parent scopes', () => {
    expect(() => validateScopeSubset(['read:orders', 'write:orders'], ['read:orders'])).not.toThrow();
    expect(() => validateScopeSubset(['read:orders'], ['read:orders'])).not.toThrow();
  });

  it('rejects scope escalation', () => {
    expect(() => validateScopeSubset(['read:orders'], ['read:orders', 'write:orders'])).toThrow('write:orders');
  });

  it('accepts a valid root to child chain', () => {
    const root = vc('vc:root', 'did:agent:a', ['read:orders'], {
      delegationDepth: 0,
      maxDelegationDepth: 1,
    });
    const child = vc('vc:child', 'did:agent:b', ['read:orders'], {
      delegatedFrom: 'did:agent:a',
      delegationDepth: 1,
      maxDelegationDepth: 1,
      parentVcId: 'vc:root',
    });

    expect(() => validateChainIntegrity([root, child])).not.toThrow();
  });

  it('rejects a broken delegatedFrom link', () => {
    const root = vc('vc:root', 'did:agent:a', ['read:orders'], { delegationDepth: 0, maxDelegationDepth: 1 });
    const child = vc('vc:child', 'did:agent:b', ['read:orders'], {
      delegatedFrom: 'did:agent:x',
      delegationDepth: 1,
      maxDelegationDepth: 1,
      parentVcId: 'vc:root',
    });

    expect(() => validateChainIntegrity([root, child])).toThrow('delegatedFrom');
  });

  it('rejects too-short and malformed chains', () => {
    const root = vc('vc:root', 'did:agent:a', ['read:orders'], { delegationDepth: 0, maxDelegationDepth: 1 });
    const child = vc('vc:child', 'did:agent:b', ['read:orders'], {
      delegatedFrom: 'did:agent:a',
      delegationDepth: 1,
      maxDelegationDepth: 1,
      parentVcId: 'vc:root',
    });

    expect(() => validateChainIntegrity([])).toThrow('root and leaf');
    expect(() => validateChainIntegrity([undefined as unknown as AgentVC, child])).toThrow('root credential missing');
    expect(() => validateChainIntegrity([root, undefined as unknown as AgentVC])).toThrow('missing link');
  });

  it('rejects root depth, parent id, and max-depth mismatches', () => {
    const root = vc('vc:root', 'did:agent:a', ['read:orders'], { delegationDepth: 0, maxDelegationDepth: 1 });
    const badRoot = vc('vc:root', 'did:agent:a', ['read:orders'], { delegationDepth: 1, maxDelegationDepth: 1 });
    const child = vc('vc:child', 'did:agent:b', ['read:orders'], {
      delegatedFrom: 'did:agent:a',
      delegationDepth: 1,
      maxDelegationDepth: 1,
      parentVcId: 'vc:other',
    });
    const changedMaxDepth = vc('vc:child', 'did:agent:b', ['read:orders'], {
      delegatedFrom: 'did:agent:a',
      delegationDepth: 1,
      maxDelegationDepth: 2,
      parentVcId: 'vc:root',
    });

    expect(() => validateChainIntegrity([badRoot, child])).toThrow('root credential depth');
    expect(() => validateChainIntegrity([root, child])).toThrow('parentVcId');
    expect(() => validateChainIntegrity([root, changedMaxDepth])).toThrow('maxDelegationDepth');
  });

  it('rejects chain scope escalation and leaf depth overflow', () => {
    const root = vc('vc:root', 'did:agent:a', ['read:orders'], { delegationDepth: 0, maxDelegationDepth: 0 });
    const escalatingChild = vc('vc:child', 'did:agent:b', ['read:orders', 'write:orders'], {
      delegatedFrom: 'did:agent:a',
      delegationDepth: 1,
      maxDelegationDepth: 0,
      parentVcId: 'vc:root',
    });
    const overflowingChild = vc('vc:child', 'did:agent:b', ['read:orders'], {
      delegatedFrom: 'did:agent:a',
      delegationDepth: 1,
      maxDelegationDepth: 0,
      parentVcId: 'vc:root',
    });

    expect(() => validateChainIntegrity([root, escalatingChild])).toThrow('write:orders');
    expect(() => validateChainIntegrity([root, overflowingChild])).toThrow('exceeds root maxDelegationDepth');
  });

  it('rejects non-sequential depths and max depth overflow', () => {
    const root = vc('vc:root', 'did:agent:a', ['read:orders'], { delegationDepth: 0, maxDelegationDepth: 1 });
    const child = vc('vc:child', 'did:agent:b', ['read:orders'], {
      delegatedFrom: 'did:agent:a',
      delegationDepth: 2,
      maxDelegationDepth: 1,
      parentVcId: 'vc:root',
    });

    expect(() => validateChainIntegrity([root, child])).toThrow('sequential');
  });

  it('extracts parent and leaf vc ids', () => {
    const root = vc('vc:root', 'did:agent:a', ['read:orders']);
    const child = vc('vc:child', 'did:agent:b', ['read:orders'], { parentVcId: 'vc:root' });

    expect(extractChainFromVC(root)).toEqual(['vc:root']);
    expect(extractChainFromVC(child)).toEqual(['vc:root', 'vc:child']);
  });
});
