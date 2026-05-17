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

import type {
  HederaDIDCreationRequest,
  HederaDIDCreationResult,
  HederaMessage,
  IHederaClient,
  HederaTransactionResult
} from '../IHederaClient.js';

/**
 * Mock implementation of IHederaClient for unit and integration tests.
 * Prevents real network calls during testing.
 */
export class MockHederaClient implements IHederaClient {
  public anchoredPayloads: string[] = [];
  public txCounter = 0;

  async prepareDIDCreation(publicKeyMultibase: string): Promise<HederaDIDCreationRequest> {
    return {
      stateJson: JSON.stringify({ publicKeyMultibase }),
      signingPayloadHex: Buffer.from(`mock-did-create:${publicKeyMultibase}`, 'utf8').toString('hex'),
    };
  }

  async submitDIDCreation(stateJson: string, _signatureHex: string): Promise<HederaDIDCreationResult> {
    void _signatureHex;
    this.txCounter++;
    const state = JSON.parse(stateJson) as { publicKeyMultibase: string };
    const did = `did:hedera:testnet:${this.txCounter.toString(16).padStart(32, '0')}`;
    const didDocument = {
      id: did,
      controller: did,
      verificationMethod: [
        {
          id: `${did}#did-root-key`,
          type: 'Ed25519VerificationKey2020',
          controller: did,
          publicKeyMultibase: state.publicKeyMultibase,
        },
      ],
      authentication: [`${did}#did-root-key`],
      assertionMethod: [`${did}#did-root-key`],
    };
    this.anchoredPayloads.push(JSON.stringify(didDocument));
    return {
      did,
      didDocument,
      transactionId: `mock-tx-${this.txCounter}`,
      topicId: '0.0.12345',
      sequenceNumber: this.txCounter,
    };
  }

  async anchorDocument(payload: string): Promise<HederaTransactionResult> {
    this.txCounter++;
    this.anchoredPayloads.push(payload);
    
    return {
      transactionId: `mock-tx-${this.txCounter}`,
      topicId: '0.0.12345',
      sequenceNumber: this.txCounter,
    };
  }

  async fetchMessage(_topicId: string, sequenceNumber: number): Promise<HederaMessage> {
    return {
      sequenceNumber,
      consensusTimestamp: new Date().toISOString(),
      contents: this.anchoredPayloads[sequenceNumber - 1] ?? this.anchoredPayloads[this.anchoredPayloads.length - 1] ?? '{}',
    };
  }

  async resolveDocument(topicId: string, sequenceNumber: number): Promise<string> {
    return (await this.fetchMessage(topicId, sequenceNumber)).contents;
  }

  reset(): void {
    this.anchoredPayloads = [];
    this.txCounter = 0;
  }
}
