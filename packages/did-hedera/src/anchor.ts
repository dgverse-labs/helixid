import {
  AccountId,
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hashgraph/sdk';
import { HederaAnchorFailedError } from '@helix-id/core';
import type { HederaAnchorOptions } from './types.js';

function buildClient(options: HederaAnchorOptions): Client {
  let client: Client;
  if (options.network === 'mainnet') {
    client = Client.forMainnet();
  } else if (options.network === 'previewnet') {
    client = Client.forPreviewnet();
  } else {
    client = Client.forTestnet();
  }

  client.setOperator(
    AccountId.fromString(options.operatorId),
    PrivateKey.fromString(options.operatorKey),
  );
  return client;
}

export async function anchorDidHedera(options: HederaAnchorOptions): Promise<{
  did: string;
  topicId: string;
  transactionId: string;
}> {
  console.warn(
    `[did-hedera] Submitting paid Hedera HCS transaction on ${options.network}. ` +
      'Operator account HBAR balance will be debited.',
  );

  const client = buildClient(options);
  const payload = JSON.stringify(options.didDocument);

  try {
    const createTx = await new TopicCreateTransaction().execute(client);
    const createReceipt = await createTx.getReceipt(client);
    const topicId = createReceipt.topicId?.toString();
    if (!topicId) {
      throw new HederaAnchorFailedError('Topic creation receipt did not include a topic id');
    }

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(payload)
      .execute(client);
    const submitReceipt = await submitTx.getReceipt(client);

    const transactionId = submitTx.transactionId.toString();
    const did = `did:hedera:${options.network}:${topicId}`;

    return {
      did,
      topicId,
      transactionId: submitReceipt.status.toString() === 'SUCCESS'
        ? transactionId
        : transactionId,
    };
  } catch (error) {
    if (error instanceof HederaAnchorFailedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Hedera anchoring failed';
    throw new HederaAnchorFailedError(message, {
      network: options.network,
      operatorId: options.operatorId,
    });
  } finally {
    client.close();
  }
}
