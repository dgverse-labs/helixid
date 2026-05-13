// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  Client,
  TopicMessageSubmitTransaction,
  TopicMessageQuery,
  TopicId,
} from '@hashgraph/sdk';
import { config } from '@helix-id/core';
import type { IHederaClient, HederaTransactionResult } from './IHederaClient.js';

/**
 * Production implementation of IHederaClient using the official Hashgraph SDK.
 * Anchors DID documents to a configured HCS topic.
 */
export class HieroHederaClient implements IHederaClient {
  private client: Client;
  private topicId: string;

  constructor() {
    const {
      HEDERA_NETWORK,
      HEDERA_OPERATOR_ID,
      HEDERA_OPERATOR_KEY,
      HEDERA_TOPIC_ID,
    } = config;

    this.client = Client.forName(HEDERA_NETWORK);
    this.client.setOperator(HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY);
    this.topicId = HEDERA_TOPIC_ID;
  }

  async anchorDocument(payload: string): Promise<HederaTransactionResult> {
    const transaction = new TopicMessageSubmitTransaction({
      topicId: this.topicId,
      message: payload,
    });

    const response = await transaction.execute(this.client);
    const receipt = await response.getReceipt(this.client);

    return {
      transactionId: response.transactionId.toString(),
      topicId: this.topicId,
      sequenceNumber: receipt.topicSequenceNumber?.toNumber(),
    };
  }

  async resolveDocument(topicId: string, sequenceNumber: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let resolvedPayload = '';
      
      const query = new TopicMessageQuery()
        .setTopicId(topicId)
        .setStartTime(0)
        .setLimit(1); // We want a specific one, but query doesn't support seq directly easily

      // Note: Standard Hedera Mirror Node queries for specific sequence numbers 
      // are usually done via REST API for efficiency.
      // This is a simplified implementation for the interface.
      
      const subscription = query.subscribe(
        this.client,
        (error) => reject(error),
        (message) => {
          if (message.sequenceNumber.toNumber() === sequenceNumber) {
            resolvedPayload = Buffer.from(message.contents).toString();
            subscription.unsubscribe();
            resolve(resolvedPayload);
          }
        }
      );

      // Timeout safety
      setTimeout(() => {
        subscription.unsubscribe();
        if (!resolvedPayload) {
          reject(new Error('Timed out waiting for Hedera HCS message resolution'));
        }
      }, 30000);
    });
  }
}
