/**
 * helix-api/src/services/did/did.service.ts
 *
 * DIDService — implements IDIDService.
 * Business logic for DID lifecycle: create, resolve, update, deactivate.
 * See story1.md §1.9 for full specification.
 */

import {
  publicKeyToMultibase,
  buildDIDDocument,
  buildServiceEndpoints,
  addServiceEndpoint as coreAddServiceEndpoint,
  removeServiceEndpoint as coreRemoveServiceEndpoint,
  type DIDDocument,
  type ServiceEndpoint,
  AuditEvents,
  type IAuditLogger,
  InvalidPublicKeyError,
  InvalidDIDFormatError,
  DIDNotFoundError,
  DIDAlreadyExistsError,
  DIDDeactivatedError,
  InvalidServiceEndpointUrlError,
  ServiceEndpointAlreadyExistsError,
  ServiceEndpointNotFoundError,
  HederaAnchorFailedError,
  HederaResolutionFailedError,
} from '@helix-id/core';
import type { DIDRepository } from '../../repositories/did.repository.js';
import type { IHederaClient } from '../../hedera/IHederaClient.js';
import type { IDIDService, CreateDIDResult, ResolveDIDResult } from './IDIDService.js';

/** did:hedera:testnet format regex */
const DID_HEDERA_PATTERN = /^did:hedera:testnet:[a-zA-Z0-9._-]+(_\d+\.\d+\.\d+)?$/;

/** Valid hex public key — 64 lowercase hex chars */
const PUBLIC_KEY_HEX_PATTERN = /^[0-9a-f]{64}$/i;

function validatePublicKeyHex(key: string): void {
  if (!PUBLIC_KEY_HEX_PATTERN.test(key)) {
    throw new InvalidPublicKeyError(`Public key must be 64 hex characters, got: ${key.length} chars`);
  }
}

function validateDIDFormat(did: string): void {
  if (!DID_HEDERA_PATTERN.test(did)) {
    throw new InvalidDIDFormatError(did);
  }
}

function validateDomains(domains: string[]): void {
  for (const domain of domains) {
    try {
      const url = new URL(domain);
      if (url.protocol !== 'https:') {
        throw new InvalidServiceEndpointUrlError(domain);
      }
    } catch (err) {
      if (err instanceof InvalidServiceEndpointUrlError) throw err;
      throw new InvalidServiceEndpointUrlError(domain);
    }
  }
}

/**
 * Derives a did:hedera:testnet DID string from a hex public key.
 * Uses multibase-encoded public key as the identifier portion.
 */
function deriveDIDFromPublicKey(publicKeyHex: string): string {
  const multibase = publicKeyToMultibase(publicKeyHex);
  return `did:hedera:testnet:${multibase}`;
}

export class DIDService implements IDIDService {
  constructor(
    private readonly didRepository: DIDRepository,
    private readonly hederaClient: IHederaClient,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async createDID(
    publicKeyHex: string,
    subjectType: 'agent' | 'user',
    domains: string[],
    requestId: string,
  ): Promise<CreateDIDResult> {
    // 1. Validate public key
    validatePublicKeyHex(publicKeyHex);

    // 2. Validate domains
    validateDomains(domains);

    // 3. Derive multibase
    const publicKeyMultibase = publicKeyToMultibase(publicKeyHex);

    // 4. Check for duplicate
    const existing = await this.didRepository.findByPublicKeyMultibase(publicKeyMultibase);
    if (existing) {
      this.auditLogger.log(AuditEvents.DID_CREATION_FAILED, {
        requestId,
        timestamp: new Date().toISOString(),
        reason: 'DID_ALREADY_EXISTS',
        publicKeyMultibase,
      });
      throw new DIDAlreadyExistsError();
    }

    // 5. Derive DID string
    const did = deriveDIDFromPublicKey(publicKeyHex);

    // 6. Build DID document
    const serviceEndpoints = buildServiceEndpoints(domains);
    const didDocument = buildDIDDocument(did, publicKeyHex, serviceEndpoints);

    // 7. Anchor on Hedera
    let hederaResult;
    try {
      hederaResult = await this.hederaClient.anchorDocument(JSON.stringify(didDocument));
    } catch (err) {
      this.auditLogger.log(AuditEvents.DID_CREATION_FAILED, {
        requestId,
        timestamp: new Date().toISOString(),
        reason: 'HEDERA_ANCHOR_FAILED',
        publicKeyMultibase,
      });
      throw new HederaAnchorFailedError(
        err instanceof Error ? err.message : 'Hedera anchor failed',
      );
    }

    // 8. Persist
    const record = await this.didRepository.create({
      did,
      subjectType,
      publicKeyHex,
      publicKeyMultibase,
      hederaTopicId: hederaResult.topicId,
      hederaSequenceNumber: hederaResult.sequenceNumber,
      hederaTransactionId: hederaResult.transactionId,
      didDocumentJson: JSON.stringify(didDocument),
    });

    // 9. Emit audit event (public key multibase, never private key)
    this.auditLogger.log(AuditEvents.DID_CREATED, {
      requestId,
      timestamp: new Date().toISOString(),
      did: record.did,
      subjectType,
      hederaTransactionId: hederaResult.transactionId,
      publicKeyMultibase,
    });

    // 10. Return result
    return {
      did: record.did,
      didDocument,
      hederaTransactionId: hederaResult.transactionId,
    };
  }

  async resolveDID(did: string, requestId: string): Promise<ResolveDIDResult> {
    // 1. Validate format
    validateDIDFormat(did);

    // 2. Fetch from DB
    const record = await this.didRepository.findByDid(did);
    if (!record) throw new DIDNotFoundError(did);

    // 3. Check deactivation
    if (record.deactivated) throw new DIDDeactivatedError(did);

    // 4. Parse and return
    const didDocument = JSON.parse(record.didDocumentJson) as DIDDocument;

    this.auditLogger.log(AuditEvents.DID_RESOLVED, {
      requestId,
      timestamp: new Date().toISOString(),
      did,
      source: 'cache',
    });

    return { did: record.did, didDocument, source: 'cache' };
  }

  async resolveDIDFromHedera(did: string, requestId: string): Promise<ResolveDIDResult> {
    // 1. Validate format
    validateDIDFormat(did);

    // 2. Fetch record for topicId and sequenceNumber
    const record = await this.didRepository.findByDid(did);
    if (!record) throw new DIDNotFoundError(did);
    if (record.deactivated) throw new DIDDeactivatedError(did);

    // 3. Fetch from Hedera
    let hederaMsg;
    try {
      hederaMsg = await this.hederaClient.fetchMessage(
        record.hederaTopicId,
        record.hederaSequenceNumber,
      );
    } catch (err) {
      throw new HederaResolutionFailedError(
        err instanceof Error ? err.message : 'Hedera fetch failed',
      );
    }

    const didDocument = JSON.parse(hederaMsg.contents) as DIDDocument;

    this.auditLogger.log(AuditEvents.DID_RESOLVED, {
      requestId,
      timestamp: new Date().toISOString(),
      did,
      source: 'hedera',
    });

    return { did: record.did, didDocument, source: 'hedera' };
  }

  async addServiceEndpoint(
    did: string,
    endpoint: ServiceEndpoint,
    requestId: string,
  ): Promise<DIDDocument> {
    // 1. Validate
    validateDIDFormat(did);
    try {
      const url = new URL(endpoint.serviceEndpoint);
      if (url.protocol !== 'https:') throw new InvalidServiceEndpointUrlError(endpoint.serviceEndpoint);
    } catch (err) {
      if (err instanceof InvalidServiceEndpointUrlError) throw err;
      throw new InvalidServiceEndpointUrlError(endpoint.serviceEndpoint);
    }

    // 2. Fetch active record
    const record = await this.didRepository.findByDid(did);
    if (!record) throw new DIDNotFoundError(did);
    if (record.deactivated) throw new DIDDeactivatedError(did);

    // 3. Parse document and add endpoint
    const currentDoc = JSON.parse(record.didDocumentJson) as DIDDocument;
    let updatedDoc: DIDDocument;
    try {
      updatedDoc = coreAddServiceEndpoint(currentDoc, endpoint);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        throw new ServiceEndpointAlreadyExistsError(endpoint.id);
      }
      throw err;
    }

    // 4. Re-anchor
    let hederaResult;
    try {
      hederaResult = await this.hederaClient.anchorDocument(JSON.stringify(updatedDoc));
    } catch (err) {
      this.auditLogger.log(AuditEvents.DID_UPDATE_FAILED, {
        requestId,
        timestamp: new Date().toISOString(),
        did,
        updateType: 'add_service_endpoint',
        reason: err instanceof Error ? err.message : 'unknown',
      });
      throw new HederaAnchorFailedError();
    }

    // 5. Update DB
    await this.didRepository.updateDIDDocument(did, JSON.stringify(updatedDoc), hederaResult.transactionId);
    await this.didRepository.createDidUpdate({
      didId: record.id,
      updateType: 'add_service_endpoint',
      updatePayloadJson: JSON.stringify({ endpoint }),
      hederaTransactionId: hederaResult.transactionId,
    });

    // 6. Emit audit event
    this.auditLogger.log(AuditEvents.DID_UPDATED, {
      requestId,
      timestamp: new Date().toISOString(),
      did,
      updateType: 'add_service_endpoint',
      hederaTransactionId: hederaResult.transactionId,
    });

    return updatedDoc;
  }

  async removeServiceEndpoint(
    did: string,
    endpointId: string,
    requestId: string,
  ): Promise<DIDDocument> {
    // 1. Validate
    validateDIDFormat(did);

    // 2. Fetch active record
    const record = await this.didRepository.findByDid(did);
    if (!record) throw new DIDNotFoundError(did);
    if (record.deactivated) throw new DIDDeactivatedError(did);

    // 3. Parse document and remove endpoint
    const currentDoc = JSON.parse(record.didDocumentJson) as DIDDocument;
    let updatedDoc: DIDDocument;
    try {
      updatedDoc = coreRemoveServiceEndpoint(currentDoc, endpointId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        throw new ServiceEndpointNotFoundError(endpointId);
      }
      throw err;
    }

    // 4. Re-anchor
    let hederaResult;
    try {
      hederaResult = await this.hederaClient.anchorDocument(JSON.stringify(updatedDoc));
    } catch (err) {
      this.auditLogger.log(AuditEvents.DID_UPDATE_FAILED, {
        requestId,
        timestamp: new Date().toISOString(),
        did,
        updateType: 'remove_service_endpoint',
        reason: err instanceof Error ? err.message : 'unknown',
      });
      throw new HederaAnchorFailedError();
    }

    // 5. Update DB
    await this.didRepository.updateDIDDocument(did, JSON.stringify(updatedDoc), hederaResult.transactionId);
    await this.didRepository.createDidUpdate({
      didId: record.id,
      updateType: 'remove_service_endpoint',
      updatePayloadJson: JSON.stringify({ endpointId }),
      hederaTransactionId: hederaResult.transactionId,
    });

    // 6. Emit audit event
    this.auditLogger.log(AuditEvents.DID_UPDATED, {
      requestId,
      timestamp: new Date().toISOString(),
      did,
      updateType: 'remove_service_endpoint',
      hederaTransactionId: hederaResult.transactionId,
    });

    return updatedDoc;
  }

  async deactivateDID(did: string, reason: string, requestId: string): Promise<void> {
    // 1. Fetch active record
    const record = await this.didRepository.findByDid(did);
    if (!record) throw new DIDNotFoundError(did);
    if (record.deactivated) throw new DIDDeactivatedError(did);

    // 2. Anchor deactivation marker (best-effort — Hedera failure does not block)
    try {
      await this.hederaClient.anchorDocument(
        JSON.stringify({ did, type: 'deactivate', reason, timestamp: new Date().toISOString() }),
      );
    } catch {
      // Best-effort — do not rethrow
    }

    // 3. Deactivate in DB
    await this.didRepository.deactivate(did);

    // 4. Emit audit event
    this.auditLogger.log(AuditEvents.DID_DEACTIVATED, {
      requestId,
      timestamp: new Date().toISOString(),
      did,
      reason,
    });
  }
}
