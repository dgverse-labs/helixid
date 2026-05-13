import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VPRepository } from '../../../src/services/../../src/repositories/vp.repository.js';
import { prisma } from '../../../src/repositories/vp.repository.js';

vi.mock('../../../src/repositories/vp.repository.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    prisma: {
      vpId: {
        updateMany: vi.fn(),
        findUnique: vi.fn(),
      }
    }
  };
});

describe('VPRepository Unit Tests', () => {
  let repository: VPRepository;

  beforeEach(() => {
    repository = new VPRepository();
    vi.clearAllMocks();
  });

  describe('consumeAtomically', () => {
    it('returns false if prisma updateMany throws', async () => {
      (prisma.vpId.updateMany as any).mockRejectedValue(new Error('Prisma Error'));
      
      const result = await repository.consumeAtomically('vp:helix:123');
      expect(result).toBe(false);
    });
  });
});
