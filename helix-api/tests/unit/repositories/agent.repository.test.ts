// Copyright 2026 DgVerse LLP
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    expect(list[0]!.serviceName).toBe('s1');
  });

  it('uses Prisma for enrollment tokens, challenges, and services when provided', async () => {
    const challengeRow = {
      id: 'chdb-1',
      challengeId: 'chal-1',
      nonce: 'nonce',
      did: '',
      purpose: 'agent_onboarding',
      pendingPublicKeyHex: 'a'.repeat(64),
      pendingDomains: '[]',
      pendingDidCreateStateJson: '{}',
      pendingDidCreatePayloadHex: 'aa',
      expiresAt: new Date(),
      verifiedAt: null,
      createdAt: new Date(),
      enrollmentTokenId: 'et-1',
    };
    const prisma = {
      enrollmentToken: {
        create: vi.fn().mockResolvedValue({ id: 'et-1' }),
        findUnique: vi.fn().mockResolvedValue({ id: 'et-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      serviceRegistry: {
        create: vi.fn().mockResolvedValue({ serviceName: 'svc' }),
        findFirst: vi.fn().mockResolvedValue({ serviceName: 'svc' }),
        findUnique: vi.fn().mockResolvedValue({ serviceName: 'svc' }),
        findMany: vi.fn().mockResolvedValue([{ serviceName: 'svc' }]),
      },
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([challengeRow])
        .mockResolvedValueOnce([challengeRow])
        .mockResolvedValueOnce([{ ...challengeRow, verifiedAt: new Date() }]),
    };
    const prismaRepository = new AgentRepository(prisma as never);

    await expect(prismaRepository.createEnrollmentToken({
      tokenHash: 'hash',
      agentName: 'Agent',
      requestedScopes: '[]',
      requestedDomains: '[]',
      expiresAt: new Date(),
    })).resolves.toEqual({ id: 'et-1' });
    await expect(prismaRepository.findEnrollmentTokenByHash('hash')).resolves.toEqual({ id: 'et-1' });
    await expect(prismaRepository.findEnrollmentTokenById('et-1')).resolves.toEqual({ id: 'et-1' });
    await expect(prismaRepository.burnEnrollmentTokenAtomically('hash')).resolves.toBe(true);
    await expect(prismaRepository.createChallenge({
      challengeId: 'chal-1',
      nonce: 'nonce',
      did: '',
      purpose: 'agent_onboarding',
      pendingPublicKeyHex: 'a'.repeat(64),
      pendingDomains: '[]',
      pendingDidCreateStateJson: '{}',
      pendingDidCreatePayloadHex: 'aa',
      expiresAt: new Date(),
      enrollmentTokenId: 'et-1',
    })).resolves.toMatchObject({ challengeId: 'chal-1', pendingDidCreatePayloadHex: 'aa' });
    await expect(prismaRepository.findChallengeById('chal-1')).resolves.toMatchObject({ challengeId: 'chal-1' });
    await expect(prismaRepository.markChallengeVerified('chal-1')).resolves.toMatchObject({ verifiedAt: expect.any(Date) });
    await expect(prismaRepository.createService({
      serviceName: 'svc',
      displayName: 'Service',
      verifiedDomain: 'https://svc.example.com',
      publicKeyMultibase: 'zKey',
      apiEndpoint: 'https://svc.example.com/api',
      metadata: '{}',
    })).resolves.toEqual({ serviceName: 'svc' });
    await expect(prismaRepository.getServiceByName('svc')).resolves.toEqual({ serviceName: 'svc' });
    await expect(prismaRepository.findServiceByName('svc')).resolves.toEqual({ serviceName: 'svc' });
    await expect(prismaRepository.listActiveServices()).resolves.toEqual([{ serviceName: 'svc' }]);

    expect(prisma.enrollmentToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: 'hash', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
  });
});
