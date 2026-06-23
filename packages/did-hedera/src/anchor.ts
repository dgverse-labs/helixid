import type { Client } from '@hashgraph/sdk';
import { HederaAnchorFailedError } from '@helixid/core';
import { buildHederaClient, extractTopicId, privateKeyFromHex } from './hiero-client.js';
import type { HederaAnchorOptions } from './types.js';

type HieroRegistrar = {
  createDID: (
    options: { privateKey: ReturnType<typeof privateKeyFromHex> },
    providers: { client: Client },
  ) => Promise<{ did: string; transactionId?: string }>;
};

type HieroResolver = {
  resolveDID: (did: string) => Promise<unknown>;
};

async function loadRegistrar(): Promise<HieroRegistrar> {
  return import('@hiero-did-sdk/registrar') as Promise<HieroRegistrar>;
}

async function loadResolver(): Promise<HieroResolver> {
  return import('@hiero-did-sdk/resolver') as Promise<HieroResolver>;
}

/**
 * Registers a did:hedera identity via the Hiero DID registrar.
 * Operator HBAR is debited for the HCS transaction.
 */
export async function anchorDidHedera(options: HederaAnchorOptions): Promise<{
  did: string;
  topicId: string;
  transactionId: string;
  didDocument: unknown;
}> {
  console.warn(
    `[did-hedera] Submitting paid Hedera HCS transaction on ${options.network}. ` +
      'Operator account HBAR balance will be debited.',
  );

  const client = buildHederaClient(options);
  const privateKey = privateKeyFromHex(options.privateKeyHex);
  const { createDID } = await loadRegistrar();
  const { resolveDID } = await loadResolver();

  try {
    const { did, transactionId } = await createDID({ privateKey }, { client });
    const didDocument = await resolveDID(did);
    const topicId = extractTopicId(did);

    return {
      did,
      topicId,
      transactionId: transactionId ?? `hiero-did:${did}`,
      didDocument,
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
