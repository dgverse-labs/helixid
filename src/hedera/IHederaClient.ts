// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
export interface HederaDIDCreationRequest {
  stateJson: string;
  signingPayloadHex: string;
}

export interface HederaDIDCreationResult {
  did: string;
  didDocument: unknown;
  transactionId: string;
  topicId: string;
  sequenceNumber: number;
}

export interface HederaMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  contents: string;
}

export interface HederaTransactionResult {
  transactionId: string;
  topicId?: string;
  sequenceNumber?: number;
}

export interface IHederaClient {
  prepareDIDCreation(publicKeyMultibase: string): Promise<HederaDIDCreationRequest>;
  submitDIDCreation(stateJson: string, signatureHex: string): Promise<HederaDIDCreationResult>;
  anchorDocument(payload: string): Promise<HederaTransactionResult>;
  fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage>;
}
