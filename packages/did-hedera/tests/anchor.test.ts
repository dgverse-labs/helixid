import { PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hashgraph/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDIDDocument, generateKeyPair } from '@helix-id/core';
import { anchorDidHedera } from '../src/anchor.js';

const executeMock = vi.fn();
const getReceiptMock = vi.fn();
const closeMock = vi.fn();

const setOperatorMock = vi.fn();

function MockTopicCreateTransaction(this: { execute: typeof executeMock }) {
  this.execute = executeMock;
}

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
    TopicCreateTransaction: vi.fn(MockTopicCreateTransaction),
    TopicMessageSubmitTransaction: vi.fn(MockTopicMessageSubmitTransaction),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('anchorDidHedera', () => {
  it('submits HCS transactions and returns did:hedera format', async () => {
    const key = generateKeyPair();
    const didDocument = buildDIDDocument('did:hedera:testnet:pending', key.publicKey);
    getReceiptMock
      .mockResolvedValueOnce({ topicId: { toString: () => '0.0.55555' }, status: { toString: () => 'SUCCESS' } })
      .mockResolvedValueOnce({ status: { toString: () => 'SUCCESS' } });
    executeMock
      .mockResolvedValueOnce({
        getReceipt: getReceiptMock,
        transactionId: { toString: () => '0.0.1@1700000000.000000001' },
      })
      .mockResolvedValueOnce({
        getReceipt: getReceiptMock,
        transactionId: { toString: () => '0.0.1@1700000000.000000002' },
      });

    const result = await anchorDidHedera({
      didDocument,
      operatorId: '0.0.123',
      operatorKey: PrivateKey.generateED25519().toString(),
      network: 'testnet',
    });

    expect(TopicCreateTransaction).toHaveBeenCalled();
    expect(TopicMessageSubmitTransaction).toHaveBeenCalled();
    expect(result).toEqual({
      did: 'did:hedera:testnet:0.0.55555',
      topicId: '0.0.55555',
      transactionId: '0.0.1@1700000000.000000002',
    });
    expect(closeMock).toHaveBeenCalled();
  });

  it('throws HEDERA_ANCHOR_FAILED on submission failure', async () => {
    executeMock.mockRejectedValueOnce(new Error('insufficient balance'));

    await expect(anchorDidHedera({
      didDocument: buildDIDDocument('did:hedera:testnet:pending', generateKeyPair().publicKey),
      operatorId: '0.0.123',
      operatorKey: PrivateKey.generateED25519().toString(),
      network: 'testnet',
    })).rejects.toMatchObject({
      code: 'HEDERA_ANCHOR_FAILED',
      message: 'insufficient balance',
    });
  });
});
