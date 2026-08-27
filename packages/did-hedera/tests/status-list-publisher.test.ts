import { PrivateKey } from '@hashgraph/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '../src/core/keys.js';
import { publishStatusListToHCS } from '../src/status-list-publisher.js';

const { submitMessageMock, closeMock } = vi.hoisted(() => ({
  submitMessageMock: vi.fn(),
  closeMock: vi.fn(),
}));

vi.mock('@hiero-did-sdk/hcs', () => ({
  HcsMessageService: class MockHcsMessageService {
    submitMessage = submitMessageMock;
  },
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

describe('publishStatusListToHCS', () => {
  it('submits the signed StatusList VC via HcsMessageService', async () => {
    const statusListVC = {
      id: 'https://example.com/status/1',
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: 'did:web:example.com',
      proof: { type: 'Ed25519Signature2020' },
    };
    submitMessageMock.mockResolvedValueOnce({ transactionId: '0.0.1@1700000000.000000003' });

    const result = await publishStatusListToHCS(statusListVC as never, {
      privateKeyHex: generateKeyPair().privateKey,
      operatorId: '0.0.123',
      operatorKey: PrivateKey.generateED25519().toString(),
      network: 'testnet',
      topicId: '0.0.456',
    });

    expect(submitMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      topicId: '0.0.456',
      message: JSON.stringify(statusListVC),
    }));
    expect(result).toEqual({ transactionId: '0.0.1@1700000000.000000003' });
    expect(closeMock).toHaveBeenCalled();
  });

  it('throws HEDERA_ANCHOR_FAILED when publish fails', async () => {
    submitMessageMock.mockRejectedValueOnce(new Error('topic unavailable'));

    await expect(publishStatusListToHCS({ id: 'https://example.com/status/1' } as never, {
      privateKeyHex: generateKeyPair().privateKey,
      operatorId: '0.0.123',
      operatorKey: PrivateKey.generateED25519().toString(),
      network: 'testnet',
      topicId: '0.0.456',
    })).rejects.toMatchObject({
      code: 'HEDERA_ANCHOR_FAILED',
      message: 'topic unavailable',
    });
  });
});
