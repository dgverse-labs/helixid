import type { DIDDocument, ServiceEndpoint } from '@helix-id/core';

export type { DIDDocument, ServiceEndpoint };

export interface CreateDIDResult {
  did: string;
  didDocument: DIDDocument;
  hederaTransactionId: string;
}

export interface DIDCreationProof {
  stateJson: string;
  signatureHex: string;
}

export interface ResolveDIDResult {
  did: string;
  didDocument: DIDDocument;
  document: DIDDocument;
  deactivated: boolean;
  source: 'cache' | 'hedera';
}

export interface IDIDService {
  prepareDIDCreation(publicKeyHex: string): Promise<{ stateJson: string; signingPayloadHex: string }>;

  createDID(
    publicKeyHex: string,
    subjectType: 'agent' | 'user',
    domains: string[],
    requestId: string,
    creationProof?: DIDCreationProof,
  ): Promise<CreateDIDResult>;

  resolveDID(did: string, requestId?: string): Promise<ResolveDIDResult>;

  resolveDIDFromHedera?(did: string, requestId: string): Promise<ResolveDIDResult>;

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

  deactivateDID(did: string, reasonOrRequestId: string, requestId?: string): Promise<void>;
}
