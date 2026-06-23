import type { SignedVC } from '@helixid/core';

export interface HederaTransactionResult {
  transactionId: string;
  sequenceNumber: number;
  topicId: string;
}

export interface HederaMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  contents: string;
}

export interface HederaDIDCreationRequest {
  stateJson: string;
  signingPayloadHex: string;
}

export interface HederaDIDCreationResult extends HederaTransactionResult {
  did: string;
  didDocument: unknown;
}

/**
 * Contract for Hedera HCS operations (constitution HR-2).
 * Production implementation wraps the Hiero DID registrar and mirror node reads.
 */
export interface IHederaClient {
  prepareDIDCreation(publicKeyMultibase: string): Promise<HederaDIDCreationRequest>;
  submitDIDCreation(stateJson: string, signatureHex: string): Promise<HederaDIDCreationResult>;
  anchorDocument(payload: string): Promise<HederaTransactionResult>;
  fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage>;
}

export interface HederaAnchorOptions {
  /** Ed25519 private key hex — used for Hiero registrar createDID when anchoring */
  privateKeyHex: string;
  operatorId: string;
  operatorKey: string;
  network: 'testnet' | 'previewnet' | 'mainnet';
  topicId?: string;
}

export type HederaPublishOptions = HederaAnchorOptions & {
  topicId: string;
  statusListVC: SignedVC;
};
