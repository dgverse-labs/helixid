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

import { 
  deriveDID, 
  signData,
  derivePublicKey,
  ServiceEndpoint 
} from '@helix-id/core';
import { HelixClient } from '../client/HelixClient.js';

export interface AgentWalletOptions {
  client: HelixClient;
  privateKeyHex?: string;
}

/**
 * Higher-level abstraction for managing a DID identity.
 * Orchestrates client-side key management and SDK operations.
 */
export class AgentWallet {
  private privateKeyHex: string;
  private publicKeyHex: string;
  private client: HelixClient;
  private did: string;

  constructor(options: AgentWalletOptions) {
    this.client = options.client;

    if (options.privateKeyHex) {
      this.privateKeyHex = options.privateKeyHex;
      this.publicKeyHex = derivePublicKey(options.privateKeyHex);
    } else {
      // In a real high-level wallet, we might still allow passing one in
      // but if not provided, the user would usually call createDID on the client 
      // and then initialize the wallet with the result.
      // For now, we'll keep the auto-generation for convenience.
      const { ed25519 } = require('@noble/curves/ed25519'); // Dynamic to avoid bundle issues
      const { bytesToHex } = require('@noble/curves/abstract/utils');
      const priv = ed25519.utils.randomPrivateKey();
      this.privateKeyHex = bytesToHex(priv);
      this.publicKeyHex = derivePublicKey(this.privateKeyHex);
    }
    
    this.did = deriveDID(this.publicKeyHex);
  }

  getPublicKey(): string {
    return this.publicKeyHex;
  }

  getDID(): string {
    return this.did;
  }

  /**
   * Register the DID on the Helix network.
   * Note: AgentWallet usually wraps an existing key, so we use the client's public surface.
   */
  async createDID(subjectType: 'agent' | 'user'): Promise<any> {
    // Note: client.createDID() generates its own keypair. 
    // To maintain THIS wallet's key, we'd need a client.registerDID(pubkey) or similar.
    // However, following Phase 4 exactly, createDID generates locally.
    // For the remediation, we align AgentWallet to use the client.
    return this.client.createDID({ subjectType });
  }

  async addService(endpoint: ServiceEndpoint): Promise<any> {
    return this.client.addServiceEndpoint(this.did, endpoint);
  }

  async removeService(endpointId: string): Promise<any> {
    return this.client.removeServiceEndpoint(this.did, endpointId);
  }

  async deactivate(reason: string = 'user_request'): Promise<void> {
    await this.client.deactivateDID(this.did, reason);
  }

  /**
   * Sign arbitrary data using the wallet's private key.
   */
  sign(data: string | Uint8Array): string {
    return signData(data, this.privateKeyHex);
  }
}