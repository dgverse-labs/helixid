import {
  AccountId,
  Client,
  PrivateKey,
  TopicMessageSubmitTransaction,
} from '@hashgraph/sdk';
import { HederaAnchorFailedError } from '@helix-id/core';
import type { HederaAnchorOptions } from './types.js';

/**
 * Publishes a signed StatusList VC to HCS for on-chain audit trail.
 * HTTPS status list files remain authoritative for revocation checks.
 */
export async function publishStatusListToHCS(
  statusListVC: import('@helix-id/core').SignedVC,
  options: HederaAnchorOptions & { topicId: string },
): Promise<{ transactionId: string }> {
  console.warn(
    `[did-hedera] Publishing StatusList VC to HCS topic ${options.topicId} on ${options.network}.`,
  );

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

  try {
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(options.topicId)
      .setMessage(JSON.stringify(statusListVC))
      .execute(client);
    await submitTx.getReceipt(client);
    return { transactionId: submitTx.transactionId.toString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'StatusList HCS publish failed';
    throw new HederaAnchorFailedError(message, {
      network: options.network,
      topicId: options.topicId,
    });
  } finally {
    client.close();
  }
}
