// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VPRepository } from '../../../src/repositories/vp.repository.js';

describe('VPRepository Unit Tests', () => {
  let mockPrisma: any;
  let repository: VPRepository;

  beforeEach(() => {
    mockPrisma = {
      vpId: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    repository = new VPRepository(mockPrisma);
  });

  it('creates a presentation', async () => {
    await repository.create({ vpId: 'vp1', agentDid: 'a', userDid: 'u', targetService: 's', expiresAt: new Date() });
    expect(mockPrisma.vpId.create).toHaveBeenCalled();
  });

  it('finds by ID', async () => {
    await repository.findByVpId('vp1');
    expect(mockPrisma.vpId.findUnique).toHaveBeenCalled();
  });

  it('consumes atomically', async () => {
    mockPrisma.vpId.updateMany.mockResolvedValue({ count: 1 });
    const res = await repository.consumeAtomically('vp1');
    expect(res).toBe(true);
  });

  it('returns false on consumeAtomically error', async () => {
    mockPrisma.vpId.updateMany.mockRejectedValue(new Error('db error'));
    const res = await repository.consumeAtomically('vp1');
    expect(res).toBe(false);
  });
});
