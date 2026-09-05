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

import { sha256 } from '@noble/hashes/sha2';
import {
  deriveDID,
  buildDIDDocument,
  addServiceEndpoint as addServiceCore,
  removeServiceEndpoint as removeServiceCore,
  publicKeyToMultibase,
  HelixError,
  ErrorCode,
  type IAuditLogger,
  type DIDDocument,
  type ServiceEndpoint,
  type DidMethod,
} from '../../core/index.js';
import type { DidRepository } from '../../repositories/did.repository.js';
import type { IHederaClient } from '../../hedera/IHederaClient.js';
import type { ICache } from '../../cache/ICache.js';
import { NoopCache } from '../../cache/NoopCache.js';
import { extractEd25519PublicKeyHexFromDIDDocument } from './publicKey.js';

/**
 * A short, stable, non-secret identifier derived from an agent's public key
 * — used as the did:web path segment (`:agents:<slug>`). Same construction
 * as deriveDID()'s did:hedera identifier, minus the Hedera-specific prefix.
 */
function deriveAgentSlug(publicKeyHex: string): string {
  const hash = sha256(Buffer.from(publicKeyHex, 'hex'));
  return Buffer.from(hash.slice(0, 16)).toString('hex');
}

type DIDRecord = {
  id: string;
  didDocument: DIDDocument;
  hederaTransactionId: string;
  hederaTopicId?: string | null;
  hederaSequenceNumber?: number | null;
  deactivatedAt?: Date | null;
};

function toDIDDocument(value: unknown): DIDDocument {
  return value as DIDDocument;
}

export interface DIDCreationProof {
  stateJson: string;
  signatureHex: string;
}

function withServiceEndpoints(document: DIDDocument, serviceEndpoints: Array<{ id: string; type: string; serviceEndpoint: string }>): DIDDocument {
  if (serviceEndpoints.length === 0) {
    return document;
  }
  return {
    ...document,
    service: [
      ...(document.service ?? []),
      ...serviceEndpoints.map((endpoint) => ({
        ...endpoint,
        id: `${document.id}${endpoint.id}`,
      })),
    ],
  };
}

export interface CreateDIDResult {
  did: string;
  didDocument: DIDDocument;
  hederaTransactionId: string;
}

export interface ResolveDIDResult {
  did: string;
  didDocument: DIDDocument;
  document: DIDDocument;
  deactivated: boolean;
  source: 'cache' | 'db' | 'hedera';
}

/**
 * Interface for DID Service (Boundary 1 contract).
 * B4 and SDK consume this interface.
 */
export interface IDIDService {
  prepareDIDCreation(publicKeyHex: string): Promise<{ stateJson: string; signingPayloadHex: string }>;
  createDID(publicKeyHex: string, subjectType: 'agent' | 'user', domains: string[], requestId: string, creationProof?: DIDCreationProof): Promise<CreateDIDResult>;
  resolveDID(did: string, options?: { live?: boolean } | string, requestId?: string): Promise<ResolveDIDResult>;
  addServiceEndpoint(did: string, endpoint: ServiceEndpoint, requestId: string): Promise<DIDDocument>;
  removeServiceEndpoint(did: string, endpointId: string, requestId: string): Promise<DIDDocument>;
  deactivateDID(did: string, requestId: string): Promise<void>;
  registerResolvedDID(did: string, document: DIDDocument, subjectType: 'agent' | 'user', requestId: string): Promise<void>;
}

export class DIDService implements IDIDService {
  constructor(
    private repository: DidRepository,
    private hedera: IHederaClient,
    private audit: IAuditLogger,
    private cache: ICache<DIDDocument> = new NoopCache<DIDDocument>(),
    private cacheTtlSeconds = 300,
    // Governs how newly-created (agent/user) DIDs are minted, independent of
    // what method the hosted issuer itself uses. Only 'hedera' touches the
    // Hedera client at all — 'web' and 'key' never anchor anywhere, so
    // onboarding works with zero Hedera/network dependency when configured
    // that way (see docs/proposal-sdk-api-only.md's DID_METHOD setting).
    private didMethod: DidMethod = 'hedera',
    private didDomain = '',
  ) {}

  /**
   * Prepare a live did:hedera creation request for SDK-side signing. Only
   * meaningful when didMethod === 'hedera' — did:web and did:key are
   * self-issued locally and need no signed creation round-trip, so this
   * returns an empty (falsy) proof request for those, and createDID() below
   * never touches the Hedera client for them.
   */
  async prepareDIDCreation(publicKeyHex: string): Promise<{ stateJson: string; signingPayloadHex: string }> {
    if (this.didMethod !== 'hedera') {
      return { stateJson: '', signingPayloadHex: '' };
    }
    return this.hedera.prepareDIDCreation(publicKeyToMultibase(publicKeyHex));
  }

  /**
   * Create a new DID for the configured method. Satisfies SA-2
   * (Deduplication) and, for didMethod === 'hedera', DID-1 (Anchoring).
   */
  async createDID(publicKeyHex: string, subjectType: 'agent' | 'user', domains: string[] = [], requestId: string, creationProof?: DIDCreationProof): Promise<CreateDIDResult> {
    // 1. Check for existing DID with this public key (SA-2)
    const existing = await this.repository.findDidByPublicKey(publicKeyHex);
    if (existing) {
      await this.audit.log({
        timestamp: new Date().toISOString(),
        event: 'DID_CREATION_FAILED',
        requestId,
        reason: 'DID already exists for this public key',
      });
      throw new HelixError(
        ErrorCode.DID_ALREADY_EXISTS,
        'DID already exists for this public key',
        409
      );
    }

    // 2. Generate service endpoints. Live did:hedera creation itself is
    // submitted through Hiero using an agent-side signature.
    const serviceEndpoints = domains.map((domain, index) => ({
      id: `#domain-${index + 1}`,
      type: 'LinkedDomains',
      serviceEndpoint: domain,
    }));

    let did: string;
    let document: DIDDocument;
    let anchoring: { transactionId: string; topicId?: string; sequenceNumber?: number };

    if (this.didMethod === 'key') {
      // Self-describing, resolvable from the public key alone — no anchoring,
      // no network, no registry entry required to resolve it later.
      did = `did:key:${publicKeyToMultibase(publicKeyHex)}`;
      document = buildDIDDocument(did, publicKeyHex, serviceEndpoints);
      anchoring = { transactionId: `not-anchored:key:${did}` };
    } else if (this.didMethod === 'web') {
      // Hosted at this same instance's /.well-known path — see
      // routes/did-web/index.ts, which serves agent DIDs under
      // /agents/:slug/did.json alongside the issuer's own document.
      did = `did:web:${this.didDomain}:agents:${deriveAgentSlug(publicKeyHex)}`;
      document = buildDIDDocument(did, publicKeyHex, serviceEndpoints);
      anchoring = { transactionId: `not-anchored:web:${did}` };
    } else {
      // 3. Anchor to Hedera
      try {
        if (creationProof) {
          const result = await this.hedera.submitDIDCreation(creationProof.stateJson, creationProof.signatureHex);
          did = result.did;
          document = withServiceEndpoints(result.didDocument as DIDDocument, serviceEndpoints);
          anchoring = {
            transactionId: result.transactionId,
            topicId: result.topicId,
            sequenceNumber: result.sequenceNumber,
          };
        } else {
          did = deriveDID(publicKeyHex);
          document = buildDIDDocument(did, publicKeyHex, serviceEndpoints);
          anchoring = await this.hedera.anchorDocument(JSON.stringify(document));
        }
      } catch (err) {
        await this.audit.log({
          timestamp: new Date().toISOString(),
          event: 'DID_CREATION_FAILED',
          requestId,
          reason: 'Hedera anchoring failed',
        });
        if (err instanceof HelixError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : 'Hedera anchoring failed';
        throw new HelixError(ErrorCode.HEDERA_ANCHOR_FAILED, message, 502);
      }
    }

    // 4. Persist to DB
    const record = await this.repository.createDid({
      id: did,
      subjectType,
      controller: document.controller,
      publicKey: publicKeyHex,
      publicKeyMultibase: document.verificationMethod[0]!.publicKeyMultibase,
      hederaTransactionId: anchoring.transactionId,
      hederaTopicId: anchoring.topicId,
      hederaSequenceNumber: anchoring.sequenceNumber,
      didDocument: document,
    });
    await this.cache.set(did, document, this.cacheTtlSeconds);

    // 5. Audit log
    await this.audit.log({
      timestamp: new Date().toISOString(),
      event: 'DID_CREATED',
      requestId,
      did,
      subjectType,
      hederaTransactionId: anchoring.transactionId,
      publicKeyMultibase: document.verificationMethod[0]!.publicKeyMultibase,
    });

    return {
      did: record.id,
      didDocument: toDIDDocument(record.didDocument),
      hederaTransactionId: record.hederaTransactionId,
    };
  }

  /**
   * Persists a DID document resolved outside the normal createDID() flow --
   * a client-supplied did:key on the single-roundtrip /v1/enroll path, or
   * any DID a caller validated via the core resolver's local/live fallback
   * rather than a DB lookup. Idempotent: a DID already registered (e.g. by
   * a concurrent request) is left as-is rather than erroring.
   */
  async registerResolvedDID(
    did: string,
    document: DIDDocument,
    subjectType: 'agent' | 'user',
    requestId: string,
  ): Promise<void> {
    const existing = await this.repository.findDidById(did);
    if (existing) return;

    const publicKeyHex = extractEd25519PublicKeyHexFromDIDDocument(document);
    const method = did.split(':')[1] ?? 'unknown';

    try {
      await this.repository.createDid({
        id: did,
        subjectType,
        controller: document.controller,
        publicKey: publicKeyHex,
        publicKeyMultibase: document.verificationMethod[0]!.publicKeyMultibase,
        hederaTransactionId: `not-anchored:${method}:${did}`,
        didDocument: document,
      });
      await this.cache.set(did, document, this.cacheTtlSeconds);
      await this.audit.log({
        timestamp: new Date().toISOString(),
        event: 'DID_CREATED',
        requestId,
        did,
        subjectType,
        hederaTransactionId: `not-anchored:${method}:${did}`,
        publicKeyMultibase: document.verificationMethod[0]!.publicKeyMultibase,
      });
    } catch (err) {
      // A concurrent request may have just won this same race -- unique-
      // constraint violation on `id` is the one failure mode that's safe to
      // swallow here (the DID is now registered either way).
      const alreadyExists = await this.repository.findDidById(did);
      if (!alreadyExists) throw err;
    }
  }

  /**
   * Resolve a DID document.
   * Implements cache-first strategy with live override (DID-4).
   */
  async resolveDID(did: string, options: { live?: boolean } | string = {}, requestId = 'req_unknown'): Promise<ResolveDIDResult> {
    const normalizedOptions = typeof options === 'string' ? {} : options;
    const normalizedRequestId = typeof options === 'string' ? options : requestId;
    if (!normalizedOptions.live) {
      const cached = await this.cache.get(did);
      if (cached) {
        const activeRecord = await this.repository.findDidById(did) as unknown as DIDRecord | null;
        if (!activeRecord) {
          await this.cache.delete(did);
          throw new HelixError(ErrorCode.DID_NOT_FOUND, 'DID not found', 404);
        }
        if (activeRecord.deactivatedAt) {
          await this.cache.delete(did);
          throw new HelixError(ErrorCode.DID_DEACTIVATED, 'DID is deactivated', 410, { did });
        }
        await this.audit.log({
          timestamp: new Date().toISOString(),
          event: 'DID_RESOLVED',
          requestId: normalizedRequestId,
          did,
          source: 'cache',
        });
        return {
          did,
          didDocument: cached,
          document: cached,
          deactivated: false,
          source: 'cache',
        };
      }
    }

    const record = await this.repository.findDidById(did) as unknown as DIDRecord | null;
    if (!record) {
      throw new HelixError(ErrorCode.DID_NOT_FOUND, 'DID not found', 404);
    }
    if (record.deactivatedAt) {
      await this.cache.delete(did);
      throw new HelixError(ErrorCode.DID_DEACTIVATED, 'DID is deactivated', 410, { did });
    }

    let document = toDIDDocument(record.didDocument);

    if (normalizedOptions.live) {
      try {
        const message = await this.hedera.fetchMessage(record.hederaTopicId ?? '', record.hederaSequenceNumber ?? 0);
        document = toDIDDocument(JSON.parse(message.contents) as unknown);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Live Hedera DID resolution failed';
        throw new HelixError(ErrorCode.HEDERA_RESOLUTION_FAILED, message, 502);
      }
    }
    if (!normalizedOptions.live) {
      await this.cache.set(did, document, this.cacheTtlSeconds);
    }

    await this.audit.log({
      timestamp: new Date().toISOString(),
      event: 'DID_RESOLVED',
      requestId: normalizedRequestId,
      did,
      source: normalizedOptions.live ? 'hedera' : 'db',
    });

    return {
      did,
      didDocument: document,
      document,
      deactivated: !!record.deactivatedAt,
      source: normalizedOptions.live ? 'hedera' : 'db',
    };
  }

  /**
   * Add a service endpoint to a DID.
   */
  async addServiceEndpoint(did: string, endpoint: ServiceEndpoint, requestId: string): Promise<DIDDocument> {
    const record = await this.repository.findDidById(did);
    if (!record) throw new HelixError(ErrorCode.DID_NOT_FOUND, 'DID not found', 404);
    if (record.deactivatedAt) {
      throw new HelixError(ErrorCode.DID_DEACTIVATED, 'Cannot update a deactivated DID', 410);
    }

    const updatedDoc = addServiceCore(toDIDDocument(record.didDocument), endpoint);
    
    let anchoring;
    try {
      anchoring = await this.hedera.anchorDocument(JSON.stringify(updatedDoc));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Live Hedera DID update anchoring failed';
      throw new HelixError(ErrorCode.HEDERA_ANCHOR_FAILED, message, 501);
    }

    // Persist
    await this.repository.updateDidDocument(did, updatedDoc, {
      updateType: 'add_service_endpoint',
      hederaTransactionId: anchoring.transactionId,
      payload: endpoint,
    });
    await this.cache.delete(did);

    await this.audit.log({
      timestamp: new Date().toISOString(),
      event: 'DID_UPDATED',
      requestId,
      did,
      updateType: 'add_service_endpoint',
      hederaTransactionId: anchoring.transactionId,
    });

    return updatedDoc;
  }

  /**
   * Remove a service endpoint from a DID.
   */
  async removeServiceEndpoint(did: string, endpointId: string, requestId: string): Promise<DIDDocument> {
    const record = await this.repository.findDidById(did);
    if (!record) throw new HelixError(ErrorCode.DID_NOT_FOUND, 'DID not found', 404);
    if (record.deactivatedAt) {
      throw new HelixError(ErrorCode.DID_DEACTIVATED, 'Cannot update a deactivated DID', 410);
    }

    const updatedDoc = removeServiceCore(toDIDDocument(record.didDocument), endpointId);
    
    let anchoring;
    try {
      anchoring = await this.hedera.anchorDocument(JSON.stringify(updatedDoc));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Live Hedera DID update anchoring failed';
      throw new HelixError(ErrorCode.HEDERA_ANCHOR_FAILED, message, 501);
    }

    await this.repository.updateDidDocument(did, updatedDoc, {
      updateType: 'remove_service_endpoint',
      hederaTransactionId: anchoring.transactionId,
      payload: { endpointId },
    });
    await this.cache.delete(did);

    await this.audit.log({
      timestamp: new Date().toISOString(),
      event: 'DID_UPDATED',
      requestId,
      did,
      updateType: 'remove_service_endpoint',
      hederaTransactionId: anchoring.transactionId,
    });

    return updatedDoc;
  }

  /**
   * Deactivate a DID.
   */
  async deactivateDID(did: string, requestId: string): Promise<void> {
    const record = await this.repository.findDidById(did);
    if (!record) throw new HelixError(ErrorCode.DID_NOT_FOUND, 'DID not found', 404);
    if (record.deactivatedAt) return; // Already deactivated

    const deactivatedAt = new Date();
    
    // Anchor deactivation (SA-2/DID-3)
    try {
      await this.hedera.anchorDocument(JSON.stringify({ 
        id: did, 
        deactivated: true,
        timestamp: deactivatedAt.toISOString() 
      }));
    } catch {
      // Swallowed as per Phase 3, §654: Hedera failure does NOT block local deactivation
    }

    await this.repository.deactivateDid(did, deactivatedAt);
    await this.cache.delete(did);

    await this.audit.log({
      timestamp: new Date().toISOString(),
      event: 'DID_DEACTIVATED',
      requestId,
      did,
      reason: 'user_request',
    });
  }
}
