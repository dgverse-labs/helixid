import type { Client } from '@hashgraph/sdk';
import { HederaAnchorFailedError } from './core/HelixError.js';
import { buildHederaClient } from './hiero-client.js';
import type { HederaAnchorOptions } from './types.js';

type HcsMessageServiceClass = new (client: Client) => {
  submitMessage(props: {
    topicId: string;
    message: string;
    waitForChangesVisibility?: boolean;
    waitForChangesVisibilityTimeoutMs?: number;
  }): Promise<{ transactionId: string }>;
};

async function loadHcsMessageService(): Promise<HcsMessageServiceClass> {
  const module = await import('@hiero-did-sdk/hcs');
  return module.HcsMessageService as HcsMessageServiceClass;
}

/**
 * Publishes a signed StatusList VC to HCS for on-chain audit trail.
 * HTTPS status list files remain authoritative for revocation checks.
 */
export async function publishStatusListToHCS(
  statusListVC: import('./core/schemas/vc.js').SignedVC,
  options: HederaAnchorOptions & { topicId: string },
): Promise<{ transactionId: string }> {
  console.warn(
    `[did-hedera] Publishing StatusList VC to HCS topic ${options.topicId} on ${options.network}.`,
  );

  const client = buildHederaClient(options);
  const HcsMessageService = await loadHcsMessageService();

  try {
    const messageService = new HcsMessageService(client);
    const result = await messageService.submitMessage({
      topicId: options.topicId,
      message: JSON.stringify(statusListVC),
      waitForChangesVisibility: true,
      waitForChangesVisibilityTimeoutMs: 60_000,
    });
    return { transactionId: result.transactionId };
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
