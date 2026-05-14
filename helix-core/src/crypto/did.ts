/**
 * helix-core/src/crypto/did.ts
 *
 * W3C DID Document building and manipulation utilities.
 * All operations are pure — no I/O, no network, no DB.
 */

import { multibaseToPublicKeyHex, publicKeyToMultibase } from './keys.js';

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface DIDDocument {
  '@context': string[];
  id: string;
  controller: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[];
}

/**
 * Build a W3C-compliant DID document from a DID string and hex public key.
 * Service endpoints are omitted from the document when the array is empty.
 */
export function buildDIDDocument(
  did: string,
  publicKeyHex: string,
  serviceEndpoints: ServiceEndpoint[] = [],
): DIDDocument {
  const keyId = `${did}#key-1`;
  const doc: DIDDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: keyId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: publicKeyToMultibase(publicKeyHex),
      },
    ],
    authentication: [keyId],
    assertionMethod: [keyId],
  };

  if (serviceEndpoints.length > 0) {
    doc.service = serviceEndpoints;
  }

  return doc;
}

/**
 * Extract the hex-encoded public key from the first Ed25519VerificationKey2020
 * verification method in a DID document.
 * Throws if no Ed25519 method is present.
 */
export function extractPublicKeyFromDIDDocument(document: DIDDocument): string {
  const method = document.verificationMethod.find(
    (vm) => vm.type === 'Ed25519VerificationKey2020',
  );
  if (!method) {
    throw new Error('No Ed25519VerificationKey2020 verification method found in DID document.');
  }
  return multibaseToPublicKeyHex(method.publicKeyMultibase);
}

/**
 * Convert an array of https:// domain strings into LinkedDomains service endpoint objects.
 * IDs are `#domain-1`, `#domain-2`, etc.
 */
export function buildServiceEndpoints(domains: string[]): ServiceEndpoint[] {
  return domains.map((domain, index) => ({
    id: `#domain-${index + 1}`,
    type: 'LinkedDomains',
    serviceEndpoint: domain,
  }));
}

/**
 * Return a new DID document with the given endpoint added.
 * Does NOT mutate the original.
 * Throws with message 'already exists' if the endpoint ID is a duplicate.
 */
export function addServiceEndpoint(
  document: DIDDocument,
  endpoint: ServiceEndpoint,
): DIDDocument {
  const existing = document.service ?? [];
  if (existing.some((s) => s.id === endpoint.id)) {
    throw new Error(`Service endpoint already exists: ${endpoint.id}`);
  }
  return { ...document, service: [...existing, endpoint] };
}

/**
 * Return a new DID document with the endpoint identified by `endpointId` removed.
 * Does NOT mutate the original.
 * Sets service to undefined if the last endpoint is removed.
 * Throws with message 'not found' if the endpoint ID does not exist.
 */
export function removeServiceEndpoint(
  document: DIDDocument,
  endpointId: string,
): DIDDocument {
  const existing = document.service ?? [];
  const index = existing.findIndex((s) => s.id === endpointId);
  if (index === -1) {
    throw new Error(`Service endpoint not found: ${endpointId}`);
  }
  const updated = existing.filter((s) => s.id !== endpointId);
  const result: DIDDocument = { ...document };
  if (updated.length > 0) {
    result.service = updated;
  } else {
    delete result.service;
  }
  return result;
}
