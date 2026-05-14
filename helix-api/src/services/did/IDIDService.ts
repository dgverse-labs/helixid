/**
 * helix-api/src/services/did/IDIDService.ts
 *
 * Interface for the DID service. B2, B3, B4 depend on this interface.
 * See story1.md §1.9 for specification.
 */

import type { DIDDocument, ServiceEndpoint } from '@helix-id/core';

export type { DIDDocument, ServiceEndpoint };

export interface CreateDIDResult {
  did: string;
  didDocument: DIDDocument;
  hederaTransactionId: string;
}

export interface ResolveDIDResult {
  did: string;
  didDocument: DIDDocument;
  source: 'cache' | 'hedera';
}

export interface IDIDService {
  createDID(
    publicKeyHex: string,
    subjectType: 'agent' | 'user',
    domains: string[],
    requestId: string,
  ): Promise<CreateDIDResult>;

  resolveDID(did: string, requestId: string): Promise<ResolveDIDResult>;

  resolveDIDFromHedera(did: string, requestId: string): Promise<ResolveDIDResult>;

  addServiceEndpoint(
    did: string,
    endpoint: ServiceEndpoint,
    requestId: string,
  ): Promise<DIDDocument>;

  removeServiceEndpoint(
    did: string,
    endpointId: string,
    requestId: string,
  ): Promise<DIDDocument>;

  deactivateDID(did: string, reason: string, requestId: string): Promise<void>;
}
