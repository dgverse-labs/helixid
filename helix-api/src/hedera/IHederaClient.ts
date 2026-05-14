// IHederaClient — interface for all Hedera DID operations (HR-2).
// Production implementation wraps the Hiero DID SDK.
// Tests use MockHederaClient which records calls without writing to the network.

export interface HederaTransactionResult {
  transactionId: string;
  sequenceNumber: number;
  topicId: string;
}

export interface HederaMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  /** Raw JSON string of the DID document */
  contents: string;
}

export interface IHederaClient {
  anchorDocument(payload: string): Promise<HederaTransactionResult>;
  fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage>;
  /** @deprecated Use fetchMessage. Kept for legacy VP flow compatibility. */
  resolveDocument?(topicId: string, sequenceNumber: number): Promise<string>;
}
