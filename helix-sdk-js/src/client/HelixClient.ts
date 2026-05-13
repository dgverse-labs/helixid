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
  generateKeyPair, 
  KeyPair, 
  DIDDocument, 
  ServiceEndpoint,
  SignedVC,
  getBit
} from '@helix-id/core';
import { HttpAdapter } from '../http/HttpAdapter.js';

export interface CreateDIDOptions {
  subjectType: 'agent' | 'user';
  domains?: string[];
}

export interface CreateDIDResult {
  did: string;
  keyPair: KeyPair;
  didDocument: DIDDocument;
  hederaTransactionId: string;
}

export interface ResolveDIDOptions {
  live?: boolean;
}

export interface IssueVCOptions {
  subjectDid: string;
  subjectType: 'agent' | 'user';
  privilegeScopes?: string[];
  agentName?: string;
  userId?: string;
  expiresInSeconds?: number;
}

/**
 * HelixClient — public surface of the SDK (AC-5).
 * All SDK consumers interact with helix-api through this class.
 */
export class HelixClient {
  constructor(
    private readonly http: HttpAdapter,
    private readonly baseUrl: string,
  ) {}

  /**
   * Create a new Helix DID.
   * SA-1 Compliance: Private key is generated locally and never transmitted.
   */
  async createDID(options: CreateDIDOptions): Promise<CreateDIDResult> {
    const keyPair = generateKeyPair(); // Local, never transmitted

    const response = await this.http.post<any>('/v1/dids', {
      publicKeyHex: keyPair.publicKey,
      subjectType: options.subjectType,
      domains: options.domains ?? [],
    });

    return {
      did: response.id,
      didDocument: response.didDocument,
      hederaTransactionId: response.hederaTransactionId,
      keyPair,
    };
  }

  /**
   * Resolve a DID document.
   */
  async resolveDID(did: string, options?: ResolveDIDOptions): Promise<{ did: string; didDocument: DIDDocument; source: 'cache' | 'hedera' }> {
    const query = options?.live ? '?live=true' : '';
    const response = await this.http.get<any>(`/v1/dids/${encodeURIComponent(did)}${query}`);
    
    // API returns document directly or result object if deactivated
    const didDocument = response.id ? response : response.document;
    
    return {
      did,
      didDocument,
      source: options?.live ? 'hedera' : 'cache'
    };
  }

  /**
   * Add a service endpoint.
   */
  async addServiceEndpoint(did: string, endpoint: ServiceEndpoint): Promise<{ did: string; didDocument: DIDDocument }> {
    const didDocument = await this.http.post<DIDDocument>(`/v1/dids/${encodeURIComponent(did)}/services`, endpoint);
    return { did, didDocument };
  }

  /**
   * Remove a service endpoint.
   */
  async removeServiceEndpoint(did: string, endpointId: string): Promise<{ did: string; didDocument: DIDDocument }> {
    const didDocument = await this.http.delete<DIDDocument>(`/v1/dids/${encodeURIComponent(did)}/services/${encodeURIComponent(endpointId)}`);
    return { did, didDocument };
  }

  /**
   * Deactivate a DID.
   */
  async deactivateDID(did: string, reason: string): Promise<{ did: string; deactivated: true }> {
    await this.http.post(`/v1/dids/${encodeURIComponent(did)}/deactivate`, { reason });
    return { did, deactivated: true };
  }

  // ── Boundary 2: Verifiable Credentials ─────────────────────────────────────

  /**
   * Issue a new Verifiable Credential.
   */
  async issueVC(options: IssueVCOptions): Promise<any> {
    return this.http.post('/v1/vcs', options);
  }

  /**
   * Get VC details.
   */
  async getVC(vcId: string): Promise<any> {
    return this.http.get(`/v1/vcs/${encodeURIComponent(vcId)}`);
  }

  /**
   * Revoke a Verifiable Credential.
   */
  async revokeVC(vcId: string): Promise<any> {
    return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/revoke`);
  }

  /**
   * Renew a Verifiable Credential.
   */
  async renewVC(vcId: string, overrides: any = {}): Promise<any> {
    return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/renew`, overrides);
  }

  /**
   * Fetch a Status List Credential.
   */
  async getStatusList(listId: string): Promise<any> {
    return this.http.get(`/v1/status-list/${encodeURIComponent(listId)}`);
  }

  /**
   * Check the revocation status of a VC client-side (self-verification).
   * Does not call Helix ID API; fetches the status list directly.
   */
  async checkVCStatus(vc: SignedVC): Promise<'active' | 'revoked' | 'expired'> {
    // 1. Check expiration
    if (vc.expirationDate && new Date(vc.expirationDate) < new Date()) {
      return 'expired';
    }

    // 2. Check revocation via StatusList2021
    if (vc.credentialStatus && vc.credentialStatus.type === 'StatusList2021Entry') {
      const { statusListCredential, statusListIndex } = vc.credentialStatus;
      
      // Fetch the status list (could be cached)
      const listCredential = await this.http.get<any>(statusListCredential);
      const encodedList = listCredential.credentialSubject.encodedList;
      
      const isRevoked = getBit(encodedList, parseInt(statusListIndex, 10));
      if (isRevoked) return 'revoked';
    }

    return 'active';
  }
}