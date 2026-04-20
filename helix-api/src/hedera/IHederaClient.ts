// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

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