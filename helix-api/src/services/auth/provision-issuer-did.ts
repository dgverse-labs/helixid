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
//
// See docs/proposal-hosted-instance.md ("DID auto-provisioning"). On first
// account creation, auto-provision one issuer DID server-side:
// did:web:hosted.helixid.io:accounts:<accountId> (Option B — per-account
// path-based DID under HelixID's own domain). The DID Document lives in the
// hosted database and is served dynamically at GET /accounts/:id/did.json —
// this is exactly how did:web with path segments is meant to resolve.

import { buildDIDDocument } from '@helixid/core';
import type { DidRepository } from '../../repositories/did.repository.js';
import type { IssuerKeyRepository } from '../../repositories/issuer-key.repository.js';
import type { IKeyCustody } from './key-custody.js';

/** did:web percent-encodes ':' path separators as literal ':' segments, per the did:web spec. */
export function buildAccountIssuerDid(didDomain: string, accountId: string): string {
  return `did:web:${didDomain}:accounts:${accountId}`;
}

export async function provisionAccountIssuerDid(params: {
  accountId: string;
  didDomain: string;
  didRepository: DidRepository;
  issuerKeyRepository: IssuerKeyRepository;
  keyCustody: IKeyCustody;
}): Promise<string> {
  const { accountId, didDomain, didRepository, issuerKeyRepository, keyCustody } = params;
  const did = buildAccountIssuerDid(didDomain, accountId);

  const { publicKey, encrypted } = keyCustody.generateAndEncrypt();
  const didDocument = buildDIDDocument(did, publicKey);

  await didRepository.createDid({
    id: did,
    subjectType: 'user',
    controller: did,
    publicKey,
    publicKeyMultibase: didDocument.verificationMethod[0]!.publicKeyMultibase,
    hederaTransactionId: `hosted-account:${accountId}`,
    didDocument,
  });

  await issuerKeyRepository.create({
    accountId,
    did,
    encryptedPrivateKey: encrypted.encryptedPrivateKey,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    algorithm: encrypted.algorithm,
  });

  return did;
}
