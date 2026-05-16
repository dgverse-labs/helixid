// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export interface HederaTransactionResult {
  transactionId: string;
  sequenceNumber: number;   // Required as per Phase 2 spec
  topicId: string;
}

export interface HederaMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  contents: string;  // Raw JSON string of anchored document
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
 * Interface for Hedera HCS operations (HR-2).
 * Allows switching between real implementation (Hiero SDK) and mocks.
 */
export interface IHederaClient {
  /**
   * Prepares a did:hedera creation operation for local agent signing.
   */
  prepareDIDCreation(publicKeyMultibase: string): Promise<HederaDIDCreationRequest>;

  /**
   * Submits a locally signed did:hedera creation operation.
   */
  submitDIDCreation(stateJson: string, signatureHex: string): Promise<HederaDIDCreationResult>;

  /**
   * Anchors a payload to a Hedera HCS topic.
   */
  anchorDocument(payload: string): Promise<HederaTransactionResult>;

  /**
   * Fetches a specific message from a Hedera HCS topic.
   */
  fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage>;
}
