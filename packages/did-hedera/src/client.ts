import { createRequire } from 'node:module';
import type { Config } from '@helixid/core';
import type { Client } from '@hashgraph/sdk';
import { buildHederaClient, extractTopicId, patchAccountIdFromString } from './hiero-client.js';
import type {
  HederaDIDCreationRequest,
  HederaDIDCreationResult,
  HederaMessage,
  HederaTransactionResult,
  IHederaClient,
} from './types.js';
import { fetchTopicMessage } from './mirror.js';

type HieroRegistrar = {
  generateCreateDIDRequest(
    options: { multibasePublicKey: string },
    providers: { client: Client },
  ): Promise<{
    state: unknown;
    signingRequest: { serializedPayload: Uint8Array };
  }>;
  submitCreateDIDRequest(
    options: {
      state: unknown;
      signature: Uint8Array;
      waitForDIDVisibility: boolean;
      visibilityTimeoutMs: number;
    },
    providers: { client: Client },
  ): Promise<{ did: string; didDocument: unknown }>;
};

const require = createRequire(import.meta.url);
const registrar = require('@hiero-did-sdk/registrar') as HieroRegistrar;

export class HieroHederaClient implements IHederaClient {
  constructor(
    private readonly config: Pick<
      Config,
      'HEDERA_NETWORK' | 'HEDERA_OPERATOR_ID' | 'HEDERA_OPERATOR_KEY'
    > = {
      HEDERA_NETWORK: 'testnet',
      HEDERA_OPERATOR_ID: '',
      HEDERA_OPERATOR_KEY: '',
    },
    private readonly registrarClient: HieroRegistrar = registrar,
  ) {
    patchAccountIdFromString();
  }

  async prepareDIDCreation(publicKeyMultibase: string): Promise<HederaDIDCreationRequest> {
    const client = this.getClient();
    try {
      const request = await this.registrarClient.generateCreateDIDRequest(
        { multibasePublicKey: publicKeyMultibase },
        { client },
      );
      return {
        stateJson: JSON.stringify(request.state),
        signingPayloadHex: Buffer.from(request.signingRequest.serializedPayload).toString('hex'),
      };
    } finally {
      client.close();
    }
  }

  async submitDIDCreation(stateJson: string, signatureHex: string): Promise<HederaDIDCreationResult> {
    const client = this.getClient();
    try {
      const state = JSON.parse(stateJson) as {
        message?: number[] | { type?: string; data?: number[] } | Record<string, number>;
      };
      const mutableState = state as { message?: unknown };
      if (Array.isArray(state.message)) {
        mutableState.message = Uint8Array.from(state.message);
      } else if (
        state.message &&
        typeof state.message === 'object' &&
        'type' in state.message &&
        state.message.type === 'Buffer' &&
        'data' in state.message &&
        Array.isArray(state.message.data)
      ) {
        mutableState.message = Uint8Array.from(state.message.data);
      } else if (state.message && typeof state.message === 'object') {
        mutableState.message = Uint8Array.from(
          Object.keys(state.message as Record<string, number>)
            .sort((a, b) => Number(a) - Number(b))
            .map((key) => (state.message as Record<string, number>)[key]!),
        );
      }

      const result = await this.registrarClient.submitCreateDIDRequest(
        {
          state: mutableState,
          signature: Buffer.from(signatureHex, 'hex'),
          waitForDIDVisibility: true,
          visibilityTimeoutMs: 180_000,
        },
        { client },
      );

      return {
        did: result.did,
        didDocument: result.didDocument,
        transactionId: `hiero-did:${result.did}`,
        topicId: extractTopicId(result.did),
        sequenceNumber: 0,
      };
    } finally {
      client.close();
    }
  }

  async anchorDocument(_payload: string): Promise<HederaTransactionResult> {
    void _payload;
    throw new Error('Use prepareDIDCreation/submitDIDCreation for live did:hedera anchoring.');
  }

  async fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage> {
    const network = this.config.HEDERA_NETWORK;
    const message = await fetchTopicMessage(network, topicId, sequenceNumber || undefined);
    return {
      sequenceNumber: message.sequenceNumber,
      consensusTimestamp: message.consensusTimestamp,
      contents: message.contents,
    };
  }

  private getClient(): Client {
    return buildHederaClient({
      network: this.config.HEDERA_NETWORK,
      operatorId: this.config.HEDERA_OPERATOR_ID,
      operatorKey: this.config.HEDERA_OPERATOR_KEY,
    });
  }
}
