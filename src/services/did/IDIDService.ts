import type { DIDDocument, ServiceEndpoint } from '../../core/index.js';

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
  source: 'cache' | 'db' | 'hedera';
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

  /**
   * Persists a DID document that was resolved *locally* (a self-describing
   * did:key, or a did:web fetched from its host) but was never registered
   * via createDID() -- e.g. a client-supplied agentDid on the single-
   * roundtrip /v1/enroll path. Without this, a caller that only validates
   * "is this DID resolvable" before referencing it in a VC's subjectDid
   * hits a foreign-key violation under FK-enforcing storage (Postgres);
   * SQLite's lax FK enforcement was masking this gap.
   */
  registerResolvedDID(
    did: string,
    document: DIDDocument,
    subjectType: 'agent' | 'user',
    requestId: string,
  ): Promise<void>;

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
