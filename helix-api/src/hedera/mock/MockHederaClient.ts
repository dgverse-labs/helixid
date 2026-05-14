/**
 * MockHederaClient — test double for IHederaClient (HR-3).
 * In-memory implementation — never makes network calls.
 * Exposes anchoredPayloads[] for test assertions.
 * Call reset() in afterEach to clear state.
 */

import type { HederaTransactionResult, IHederaClient } from '../IHederaClient.js';

interface StoredMessage {
  payload: string;
  sequenceNumber: number;
  consensusTimestamp: string;
}

export class MockHederaClient implements IHederaClient {
  private readonly messages = new Map<number, StoredMessage>();
  private sequenceCounter = 0;

  /** All payloads that have been anchored — for test assertions. */
  public get anchoredPayloads(): string[] {
    return Array.from(this.messages.values()).map((m) => m.payload);
  }

  /** Clear all in-memory state — call in afterEach. */
  reset(): void {
    this.messages.clear();
    this.sequenceCounter = 0;
  }

  async anchorDocument(payload: string): Promise<HederaTransactionResult> {
    this.sequenceCounter += 1;
    const seqNum = this.sequenceCounter;
    const txId = `mock-tx-${Date.now()}-${seqNum}`;
    const msg: StoredMessage = {
      payload,
      sequenceNumber: seqNum,
      consensusTimestamp: new Date().toISOString(),
    };
    this.messages.set(seqNum, msg);
    return {
      transactionId: txId,
      sequenceNumber: seqNum,
      topicId: 'mock-topic-0.0.1234',
    };
  }

  async fetchMessage(topicId: string, sequenceNumber: number): Promise<{
    sequenceNumber: number;
    consensusTimestamp: string;
    contents: string;
  }> {
    const msg = this.messages.get(sequenceNumber);
    if (!msg) {
      throw new Error(`MockHederaClient: no message at sequenceNumber ${sequenceNumber} for topic ${topicId}`);
    }
    return {
      sequenceNumber: msg.sequenceNumber,
      consensusTimestamp: msg.consensusTimestamp,
      contents: msg.payload,
    };
  }

  /** Legacy — kept for backward compatibility with VP flow */
  async resolveDocument(topicId: string, sequenceNumber: number): Promise<string> {
    const result = await this.fetchMessage(topicId, sequenceNumber);
    return result.contents;
  }
}
