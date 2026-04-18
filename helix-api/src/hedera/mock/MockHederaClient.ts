import type { HederaTransactionResult, IHederaClient } from '../IHederaClient.js';

// MockHederaClient — test double for IHederaClient.
// Records calls without writing to Hedera testnet (HR-3).
export class MockHederaClient implements IHederaClient {
  public readonly anchored: string[] = [];
  public readonly resolved: Array<{ topicId: string; sequenceNumber: number }> = [];

  async anchorDocument(payload: string): Promise<HederaTransactionResult> {
    this.anchored.push(payload);
    return {
      transactionId: `mock-tx-${Date.now()}`,
      topicSequenceNumber: this.anchored.length,
    };
  }

  async resolveDocument(topicId: string, sequenceNumber: number): Promise<string> {
    this.resolved.push({ topicId, sequenceNumber });
    return JSON.stringify({});
  }
}
