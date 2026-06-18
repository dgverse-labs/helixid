// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
import type { DidMethod } from '@helix-id/core';
import type {
  HederaDIDCreationRequest,
  HederaDIDCreationResult,
  HederaMessage,
  HederaTransactionResult,
  IHederaClient,
} from './IHederaClient.js';

export class DisabledHederaClient implements IHederaClient {
  constructor(private readonly didMethod: DidMethod) {}

  private reject(operation: string): never {
    throw new Error(
      `Hedera ${operation} is disabled when DID_METHOD=${this.didMethod}. ` +
        'Set DID_METHOD=hedera to enable Hedera anchoring.',
    );
  }

  async prepareDIDCreation(_publicKeyMultibase: string): Promise<HederaDIDCreationRequest> {
    void _publicKeyMultibase;
    this.reject('DID creation');
  }

  async submitDIDCreation(_stateJson: string, _signatureHex: string): Promise<HederaDIDCreationResult> {
    void _stateJson;
    void _signatureHex;
    this.reject('DID creation');
  }

  async anchorDocument(_payload: string): Promise<HederaTransactionResult> {
    void _payload;
    this.reject('document anchoring');
  }

  async fetchMessage(_topicId: string, _sequenceNumber: number): Promise<HederaMessage> {
    void _topicId;
    void _sequenceNumber;
    this.reject('message fetch');
  }
}
