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

import type { IHederaClient, HederaTransactionResult } from '../IHederaClient.js';

/**
 * Mock implementation of IHederaClient for unit and integration tests.
 * Prevents real network calls during testing.
 */
export class MockHederaClient implements IHederaClient {
  public anchoredPayloads: string[] = [];
  public txCounter = 0;

  async anchorDocument(payload: string): Promise<HederaTransactionResult> {
    this.txCounter++;
    this.anchoredPayloads.push(payload);
    
    return {
      transactionId: `mock-tx-${this.txCounter}`,
      topicId: '0.0.12345',
      sequenceNumber: this.txCounter,
    };
  }

  async resolveDocument(_topicId: string, _sequenceNumber: number): Promise<string> {
    // Returns the last anchored payload for testing, or a default
    return this.anchoredPayloads[this.anchoredPayloads.length - 1] ?? '{}';
  }

  reset(): void {
    this.anchoredPayloads = [];
    this.txCounter = 0;
  }
}