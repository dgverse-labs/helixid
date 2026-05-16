// Copyright 2026 DgVerse LLP
import { describe, it, expect } from 'vitest';
import { HieroHederaClient } from '../../../src/hedera/HieroHederaClient.js';

describe('HieroHederaClient', () => {
  const client = new HieroHederaClient();

  it('anchorDocument rejects direct payload anchoring', async () => {
    await expect(client.anchorDocument('payload'))
      .rejects.toThrow(/prepareDIDCreation\/submitDIDCreation/);
  });

  it('fetchMessage throws until live message fetching is implemented', async () => {
    await expect(client.fetchMessage('topic', 1))
      .rejects.toThrow(/Live Hedera message fetching is not implemented/);
  });
});
