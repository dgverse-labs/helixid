import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/did-hedera-loader.js', () => ({
  loadDidHederaResolver: vi.fn(),
}));

import { buildDIDDocument, clearDIDCache, generateKeyPair, resolveDID } from '../../src/index.js';
import { loadDidHederaResolver } from '../../src/did-hedera-loader.js';

afterEach(() => {
  vi.clearAllMocks();
  clearDIDCache();
});

describe('resolveDID did:hedera optional package', () => {
  beforeEach(() => {
    vi.mocked(loadDidHederaResolver).mockReturnValue(null);
  });

  it('throws DID_METHOD_NOT_AVAILABLE when the package is absent', async () => {
    await expect(resolveDID('did:hedera:testnet:0.0.12345')).rejects.toMatchObject({
      code: 'DID_METHOD_NOT_AVAILABLE',
    });
  });

  it('delegates to the loaded did:hedera resolver', async () => {
    const key = generateKeyPair();
    const did = 'did:hedera:testnet:0.0.54321';
    const doc = buildDIDDocument(did, key.publicKey);
    vi.mocked(loadDidHederaResolver).mockReturnValue(async () => doc);

    await expect(resolveDID(did)).resolves.toMatchObject({ id: did });
  });
});
