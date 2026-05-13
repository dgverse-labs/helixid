// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0
import { config } from '@helix-id/core';
import type { HederaMessage, HederaTransactionResult, IHederaClient } from './IHederaClient.js';

export class HieroHederaClient implements IHederaClient {
  async anchorDocument(_payload: string): Promise<HederaTransactionResult> {
    throw new Error(
      `Real Hedera anchoring is not configured in this build. Set HEDERA_MOCK=true for local tests. Network: ${config.HEDERA_NETWORK}`,
    );
  }

  async fetchMessage(_topicId: string, _sequenceNumber: number): Promise<HederaMessage> {
    throw new Error('Real Hedera resolution is not configured in this build. Set HEDERA_MOCK=true for local tests.');
  }
}
