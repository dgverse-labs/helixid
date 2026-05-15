// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0
import type { Config } from '@helix-id/core';
import type { HederaMessage, HederaTransactionResult, IHederaClient } from './IHederaClient.js';

export class HieroHederaClient implements IHederaClient {
  constructor(private readonly config: Pick<Config, 'HEDERA_NETWORK'> = { HEDERA_NETWORK: 'testnet' }) {}

  async anchorDocument(_payload: string): Promise<HederaTransactionResult> {
    throw new Error(
      `Real Hedera anchoring is not configured in this build. Set HEDERA_MOCK=true for local tests. Network: ${this.config.HEDERA_NETWORK}`,
    );
  }

  async fetchMessage(_topicId: string, _sequenceNumber: number): Promise<HederaMessage> {
    throw new Error('Real Hedera resolution is not configured in this build. Set HEDERA_MOCK=true for local tests.');
  }
}
