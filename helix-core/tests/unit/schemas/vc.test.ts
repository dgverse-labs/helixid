import { describe, it, expect } from 'vitest';
import { AgentVCSchema, UserVCSchema } from '../../../src/schemas/vc.js';

describe('VC Schemas', () => {
  const validAgentVC = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc:helix:123',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: 'did:helix:issuer',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    credentialStatus: {
      id: 'https://api.test.com/v1/status-list/1#0',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '0',
      statusListCredential: 'https://api.test.com/v1/status-list/1'
    },
    credentialSubject: {
      id: 'did:helix:agent',
      type: 'HelixAgent',
      privilegeScopes: ['read:orders'],
      agentName: 'Test Agent'
    }
  };

  const validUserVC = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc:helix:456',
    type: ['VerifiableCredential', 'HelixUserCredential'],
    issuer: 'did:helix:issuer',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    credentialStatus: {
      id: 'https://api.test.com/v1/status-list/1#1',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '1',
      statusListCredential: 'https://api.test.com/v1/status-list/1'
    },
    credentialSubject: {
      id: 'did:helix:user',
      type: 'HelixUser',
      userId: 'user-123'
    }
  };

  it('validates a correct Agent VC', () => {
    const result = AgentVCSchema.safeParse(validAgentVC);
    expect(result.success).toBe(true);
  });

  it('validates a correct User VC', () => {
    const result = UserVCSchema.safeParse(validUserVC);
    expect(result.success).toBe(true);
  });

  it('fails Agent VC with invalid types', () => {
    const invalid = { ...validAgentVC, type: ['VerifiableCredential'] };
    const result = AgentVCSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('fails User VC with invalid types', () => {
    const invalid = { ...validUserVC, type: ['VerifiableCredential'] };
    const result = UserVCSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
