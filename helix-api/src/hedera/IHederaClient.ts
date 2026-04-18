// IHederaClient — interface for all Hedera DID operations (HR-2).
// Production implementation wraps the Hiero DID SDK.
// Tests use MockHederaClient which records calls without writing to the network.

export interface HederaTransactionResult {
  transactionId: string;
  topicSequenceNumber?: number;
}

export interface IHederaClient {
  anchorDocument(payload: string): Promise<HederaTransactionResult>;
  resolveDocument(topicId: string, sequenceNumber: number): Promise<string>;
}
