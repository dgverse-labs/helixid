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

import { randomUUID } from 'node:crypto';
import { createEd25519Proof, type LinkedDataProof } from './proof.js';
import { ValidationError } from './errors/HelixError.js';
import { DelegationGrantVCSchema } from './schemas/delegation-grant.js';
import { VC_CONTEXTS, type SignedVC } from './schemas/vc.js';
import {
  getStatusListLength,
  setBit,
  type StatusListCredential,
} from './status-list/index.js';

/** SP-held issuer key material. The SP signs grants with its own key. */
export interface IssuerKeyMaterial {
  did: string;
  privateKeyHex: string;
}

export interface IssueGrantOptions {
  agentDid: string;
  userDid: string;
  scopes: string[];
  durability: 'standing' | 'session';
  serviceDid?: string;
  statusList: StatusListCredential; // current list, unmodified
  statusListCredentialUrl: string; // public URL of the list above
}

// VCBaseSchema requires a concrete validUntil — there is no "no expiry" value.
// A standing grant gets a far-future window; a session grant gets a short one.
const STANDING_GRANT_VALID_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years
const SESSION_GRANT_VALID_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function issueGrant(
  options: IssueGrantOptions,
  issuerWallet: IssuerKeyMaterial,
): Promise<{ grantVC: SignedVC; updatedStatusList: StatusListCredential }> {
  const listLength = getStatusListLength(options.statusList.credentialSubject.encodedList);
  // Random assignment, accepted collision risk — see epic Part E / register D9.
  const index = Math.floor(Math.random() * listLength);

  const now = new Date();
  const validMs =
    options.durability === 'standing' ? STANDING_GRANT_VALID_MS : SESSION_GRANT_VALID_MS;

  const payload = {
    '@context': [...VC_CONTEXTS],
    id: `vc:helix:grant:${randomUUID()}`,
    type: ['VerifiableCredential', 'DelegationGrantCredential'],
    issuer: issuerWallet.did,
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + validMs).toISOString(),
    credentialStatus: {
      id: `${options.statusListCredentialUrl}#${index}`,
      type: 'BitstringStatusListEntry' as const,
      statusPurpose: 'revocation' as const,
      statusListIndex: index.toString(),
      statusListCredential: options.statusListCredentialUrl,
    },
    credentialSubject: {
      id: options.agentDid,
      type: 'DelegationGrant' as const,
      userDid: options.userDid,
      scopes: options.scopes,
      durability: options.durability,
      ...(options.serviceDid !== undefined ? { serviceDid: options.serviceDid } : {}),
    },
  };

  const parsed = DelegationGrantVCSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError(`Invalid grant payload: ${parsed.error.message}`);
  }

  const grantVC = {
    ...payload,
    proof: await createEd25519Proof(payload, issuerWallet.privateKeyHex, `${issuerWallet.did}#key-1`),
  } as SignedVC;

  // Issuance does not set bits — only revocation does, same as the existing
  // agent-VC issuance pattern. The list is returned unchanged for the caller
  // (the SP's own backend) to persist alongside the grant VC.
  return { grantVC, updatedStatusList: options.statusList };
}

export type RevokeGrantTarget = { vc: SignedVC } | { statusListIndex: string };

export type SignedStatusListCredential = StatusListCredential & { proof: LinkedDataProof };

export async function revokeGrant(
  currentStatusList: StatusListCredential,
  issuerWallet: IssuerKeyMaterial,
  target: RevokeGrantTarget,
): Promise<SignedStatusListCredential> {
  const index =
    'vc' in target ? target.vc.credentialStatus?.statusListIndex : target.statusListIndex;

  if (!index) {
    throw new ValidationError(
      'No statusListIndex available to revoke — VC has no credentialStatus, or no index was provided',
    );
  }
  const numericIndex = Number(index);
  if (!Number.isInteger(numericIndex) || numericIndex < 0) {
    throw new ValidationError(`statusListIndex is not a valid list index: ${index}`);
  }

  // Object-in/object-out: the caller persists the updated list however it
  // already stores it (DB row, object storage, file) — no file I/O here.
  const { proof: _staleProof, ...unsigned } = currentStatusList as StatusListCredential & {
    proof?: unknown;
  };
  const payload = {
    ...unsigned,
    credentialSubject: {
      ...unsigned.credentialSubject,
      encodedList: setBit(unsigned.credentialSubject.encodedList, numericIndex, 1),
    },
  };

  return {
    ...payload,
    proof: await createEd25519Proof(payload, issuerWallet.privateKeyHex, `${issuerWallet.did}#key-1`),
  };
}
