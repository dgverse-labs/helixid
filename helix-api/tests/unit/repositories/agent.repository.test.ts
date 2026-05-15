// Copyright 2026 DgVerse LLP
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRepository } from '../../../src/repositories/agent.repository.js';

describe('AgentRepository Unit Tests', () => {
  let repository: AgentRepository;

  beforeEach(() => {
    repository = new AgentRepository();
  });

  it('creates enrollment token', async () => {
    const res = await repository.createEnrollmentToken({ 
      tokenHash: 'h', 
      agentName: 'a', 
      requestedScopes: '[]', 
      requestedDomains: '[]',
      expiresAt: new Date() 
    });
    expect(res.id).toBeDefined();
    expect(res.tokenHash).toBe('h');
  });

  it('finds enrollment token by hash', async () => {
    await repository.createEnrollmentToken({ 
      tokenHash: 'h', 
      agentName: 'a', 
      requestedScopes: '[]', 
      requestedDomains: '[]',
      expiresAt: new Date() 
    });
    const found = await repository.findEnrollmentTokenByHash('h');
    expect(found?.agentName).toBe('a');
  });

  it('burns token atomically', async () => {
    await repository.createEnrollmentToken({ 
      tokenHash: 'h', 
      agentName: 'a', 
      requestedScopes: '[]', 
      requestedDomains: '[]',
      expiresAt: new Date() 
    });
    const res = await repository.burnEnrollmentTokenAtomically('h');
    expect(res).toBe(true);
    const burned = await repository.burnEnrollmentTokenAtomically('h');
    expect(burned).toBe(false);
  });

  it('creates and finds challenge', async () => {
    await repository.createChallenge({ 
      challengeId: 'c', 
      nonce: 'n', 
      did: 'd', 
      purpose: 'agent_onboarding', 
      expiresAt: new Date(),
      pendingPublicKeyHex: '00',
      pendingDomains: '[]',
      enrollmentTokenId: '1'
    });
    const found = await repository.findChallengeById('c');
    expect(found?.nonce).toBe('n');
  });

  it('lists active services', async () => {
    await repository.createService({ 
      serviceName: 's1', 
      displayName: 'S1', 
      verifiedDomain: 'v', 
      publicKeyMultibase: 'z', 
      apiEndpoint: 'a', 
      metadata: '{}' 
    });
    const list = await repository.listActiveServices();
    expect(list.length).toBe(1);
    expect(list[0].serviceName).toBe('s1');
  });
});
