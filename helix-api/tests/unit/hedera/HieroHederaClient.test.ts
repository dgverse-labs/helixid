// Copyright 2026 DgVerse LLP
import { describe, it, expect } from 'vitest';
import { HieroHederaClient } from '../../../src/hedera/HieroHederaClient.js';

describe('HieroHederaClient', () => {
  const client = new HieroHederaClient();

  it('anchorDocument throws not configured error', async () => {
    await expect(client.anchorDocument('payload'))
      .rejects.toThrow(/Real Hedera anchoring is not configured/);
  });

  it('fetchMessage throws not configured error', async () => {
    await expect(client.fetchMessage('topic', 1))
      .rejects.toThrow(/Real Hedera resolution is not configured/);
  });
});
