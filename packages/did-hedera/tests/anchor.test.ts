import { PrivateKey } from '@hashgraph/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@helix-id/core';
import { anchorDidHedera } from '../src/anchor.js';

const createDIDMock = vi.fn();
const resolveDIDMock = vi.fn();
const closeMock = vi.fn();

vi.mock('@hiero-did-sdk/registrar', () => ({
  createDID: createDIDMock,
}));

vi.mock('@hiero-did-sdk/resolver', () => ({
  resolveDID: resolveDIDMock,
}));

vi.mock('../src/hiero-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/hiero-client.js')>('../src/hiero-client.js');
  return {
    ...actual,
    buildHederaClient: vi.fn(() => ({ close: closeMock })),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('anchorDidHedera', () => {
  it('registers via Hiero registrar and returns did:hedera format', async () => {
    const key = generateKeyPair();
    const didDocument = { id: 'did:hedera:testnet:0.0.55555' };
    createDIDMock.mockResolvedValueOnce({
      did: 'did:hedera:testnet:0.0.55555',
      transactionId: '0.0.1@1700000000.000000002',
    });
    resolveDIDMock.mockResolvedValueOnce(didDocument);

    const result = await anchorDidHedera({
      privateKeyHex: key.privateKey,
      operatorId: '0.0.123',
      operatorKey: PrivateKey.generateED25519().toString(),
      network: 'testnet',
    });

    expect(createDIDMock).toHaveBeenCalled();
    expect(resolveDIDMock).toHaveBeenCalledWith('did:hedera:testnet:0.0.55555');
    expect(result).toEqual({
      did: 'did:hedera:testnet:0.0.55555',
      topicId: '0.0.55555',
      transactionId: '0.0.1@1700000000.000000002',
      didDocument,
    });
    expect(closeMock).toHaveBeenCalled();
  });

  it('throws HEDERA_ANCHOR_FAILED on submission failure', async () => {
    createDIDMock.mockRejectedValueOnce(new Error('insufficient balance'));

    await expect(anchorDidHedera({
      privateKeyHex: generateKeyPair().privateKey,
      operatorId: '0.0.123',
      operatorKey: PrivateKey.generateED25519().toString(),
      network: 'testnet',
    })).rejects.toMatchObject({
      code: 'HEDERA_ANCHOR_FAILED',
      message: 'insufficient balance',
    });
  });
});
