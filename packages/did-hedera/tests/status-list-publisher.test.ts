import { PrivateKey, TopicMessageSubmitTransaction } from '@hashgraph/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDIDDocument, generateKeyPair } from '@helix-id/core';
import { publishStatusListToHCS } from '../src/status-list-publisher.js';

const executeMock = vi.fn();
const getReceiptMock = vi.fn();
const closeMock = vi.fn();

const setOperatorMock = vi.fn();

function MockTopicMessageSubmitTransaction(this: {
  execute: typeof executeMock;
  setTopicId: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
}) {
  this.setTopicId = vi.fn().mockReturnThis();
  this.setMessage = vi.fn().mockReturnThis();
  this.execute = executeMock;
}

vi.mock('@hashgraph/sdk', async () => {
  const actual = await vi.importActual<typeof import('@hashgraph/sdk')>('@hashgraph/sdk');
  const mockClient = () => ({ close: closeMock, setOperator: setOperatorMock });
  return {
    ...actual,
    Client: {
      forTestnet: vi.fn(mockClient),
      forMainnet: vi.fn(mockClient),
      forPreviewnet: vi.fn(mockClient),
    },
    TopicMessageSubmitTransaction: vi.fn(MockTopicMessageSubmitTransaction),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('publishStatusListToHCS', () => {
  it('submits the signed StatusList VC to the configured topic', async () => {
    const key = generateKeyPair();
    const didDocument = buildDIDDocument('did:hedera:testnet:0.0.123', key.publicKey);
    const statusListVC = {
      id: 'vc:status-list:1',
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: didDocument.id,
      proof: { type: 'Ed25519Signature2020' },
    };
    getReceiptMock.mockResolvedValue({ status: { toString: () => 'SUCCESS' } });
    executeMock.mockResolvedValue({
      getReceipt: getReceiptMock,
      transactionId: { toString: () => '0.0.1@1700000000.000000003' },
    });

    const result = await publishStatusListToHCS(statusListVC as never, {
      didDocument,
      operatorId: '0.0.123',
      operatorKey: PrivateKey.generateED25519().toString(),
      network: 'testnet',
      topicId: '0.0.456',
    });

    expect(TopicMessageSubmitTransaction).toHaveBeenCalled();
    expect(result).toEqual({ transactionId: '0.0.1@1700000000.000000003' });
    expect(closeMock).toHaveBeenCalled();
  });

  it('throws HEDERA_ANCHOR_FAILED when publish fails', async () => {
    executeMock.mockRejectedValueOnce(new Error('topic unavailable'));

    await expect(publishStatusListToHCS({ id: 'vc:status-list:1' } as never, {
      didDocument: buildDIDDocument('did:hedera:testnet:0.0.123', generateKeyPair().publicKey),
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
