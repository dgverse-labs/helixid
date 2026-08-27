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
import { publicKeyToMultibase, multibaseToPublicKeyHex } from './keys.js';

export interface DIDDocument {
  '@context': string[];
  id: string;
  controller: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[] | undefined;
}

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

export type DIDSubjectType = 'agent' | 'user';

/**
 * Construct a did:hedera testnet DID string from a public key.
 * Format: did:hedera:testnet:<first 16 bytes of sha256(pubkey) as hex>
 *
 * Uses hexToBytes for portability (not Buffer.from).
 */
export function deriveDID(publicKeyHex: string): string {
  const pubKeyBytes = Buffer.from(publicKeyHex, 'hex');
  const hash = sha256(pubKeyBytes);
  const identifier = Buffer.from(hash.slice(0, 16)).toString('hex');
  return `did:hedera:testnet:${identifier}`;
}

/**
 * Build a W3C-compliant DID document.
 *
 * @param did - The DID string (did:helix:...)
 * @param publicKeyHex - Hex-encoded Ed25519 public key
 * @param serviceEndpoints - Optional list of service endpoints
 */
export function buildDIDDocument(
  did: string,
  publicKeyHex: string,
  serviceEndpoints: ServiceEndpoint[] = [],
): DIDDocument {
  const verificationMethodId = `${did}#key-1`;
  const multibase = publicKeyToMultibase(publicKeyHex);

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: verificationMethodId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: multibase,
      },
    ],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
    service: serviceEndpoints.length > 0 ? serviceEndpoints : undefined,
  };
}

/**
 * Extract the public key from a DID document.
 * Throws if the document has no Ed25519 verification method.
 */
export function extractPublicKeyFromDIDDocument(document: DIDDocument): string {
  const method = document.verificationMethod.find(
    (vm) => vm.type === 'Ed25519VerificationKey2020',
  );
  if (!method) {
    throw new Error('DID document contains no Ed25519VerificationKey2020 verification method');
  }
  return multibaseToPublicKeyHex(method.publicKeyMultibase);
}

/**
 * Build service endpoints from domain strings.
 */
export function buildServiceEndpoints(domains: string[]): ServiceEndpoint[] {
  return domains.map((domain, index) => ({
    id: `#domain-${index + 1}`,
    type: 'LinkedDomains',
    serviceEndpoint: domain,
  }));
}

/**
 * Add a new service endpoint to an existing DID document.
 * Pure function - returns a new document.
 */
export function addServiceEndpoint(
  document: DIDDocument,
  endpoint: ServiceEndpoint,
): DIDDocument {
  const existing = document.service ?? [];
  if (existing.some((s) => s.id === endpoint.id)) {
    throw new Error(`Service endpoint with id ${endpoint.id} already exists`);
  }
  return { ...document, service: [...existing, endpoint] };
}

/**
 * Remove a service endpoint from an existing DID document.
 * Pure function - returns a new document.
 */
export function removeServiceEndpoint(document: DIDDocument, endpointId: string): DIDDocument {
  const existing = document.service ?? [];
  const filtered = existing.filter((s) => s.id !== endpointId);
  if (filtered.length === existing.length) {
    throw new Error(`Service endpoint with id ${endpointId} not found`);
  }
  return { ...document, service: filtered.length > 0 ? filtered : undefined };
}
