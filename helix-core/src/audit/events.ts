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

/**
 * All audit event types for Helix ID.
 */
export type AuditEventType =
  // B1
  | 'DID_CREATED'
  | 'DID_CREATION_FAILED'
  | 'DID_RESOLVED'
  | 'DID_UPDATED'
  | 'DID_UPDATE_FAILED'
  | 'DID_DEACTIVATED'
  // B2
  | 'VC_ISSUED'
  | 'VC_ISSUANCE_FAILED'
  | 'VC_REVOKED'
  | 'VC_REVOCATION_FAILED'
  | 'VC_RENEWED'
  | 'VC_RENEWAL_FAILED'
  | 'VC_STATUS_CHECKED'
  | 'STATUS_LIST_UPDATED';

export interface BaseAuditEvent {
  timestamp: string; // ISO 8601
  event: AuditEventType;
  requestId: string;
}

// ── B1 Events ────────────────────────────────────────────────────────────────

export interface DidCreatedEvent extends BaseAuditEvent {
  event: 'DID_CREATED';
  did: string;
  subjectType: 'agent' | 'user';
  hederaTransactionId: string;
  publicKeyMultibase: string; 
}

export interface DidCreationFailedEvent extends BaseAuditEvent {
  event: 'DID_CREATION_FAILED';
  reason: string;
  publicKeyMultibase?: string;
}

export interface DidResolvedEvent extends BaseAuditEvent {
  event: 'DID_RESOLVED';
  did: string;
  source: 'cache' | 'hedera'; 
}

export interface DidUpdatedEvent extends BaseAuditEvent {
  event: 'DID_UPDATED';
  did: string;
  updateType: 'add_service_endpoint' | 'remove_service_endpoint' | 'deactivate';
  hederaTransactionId: string;
}

export interface DidUpdateFailedEvent extends BaseAuditEvent {
  event: 'DID_UPDATE_FAILED';
  did: string;
  updateType: string;
  reason: string;
}

export interface DidDeactivatedEvent extends BaseAuditEvent {
  event: 'DID_DEACTIVATED';
  did: string;
  reason: string;
}

// ── B2 Events ────────────────────────────────────────────────────────────────

export interface VcIssuedEvent extends BaseAuditEvent {
  event: 'VC_ISSUED';
  vcId: string;
  subjectDid: string;
  subjectType: 'agent' | 'user';
  privilegeScopes?: string[] | undefined;
  expiresAt: string;
  statusListIndex: number;
}

export interface VcRevokedEvent extends BaseAuditEvent {
  event: 'VC_REVOKED';
  vcId: string;
  subjectDid: string;
  reason?: string;
}

export interface VcRenewedEvent extends BaseAuditEvent {
  event: 'VC_RENEWED';
  oldVcId: string;
  newVcId: string;
  subjectDid: string;
}

export interface StatusListUpdatedEvent extends BaseAuditEvent {
  event: 'STATUS_LIST_UPDATED';
  listId: string;
  indexAffected: number;
  newValue: number;
}

export type B1AuditEvent =
  | DidCreatedEvent
  | DidCreationFailedEvent
  | DidResolvedEvent
  | DidUpdatedEvent
  | DidUpdateFailedEvent
  | DidDeactivatedEvent;

export type B2AuditEvent =
  | VcIssuedEvent
  | VcRevokedEvent
  | VcRenewedEvent
  | StatusListUpdatedEvent;

export type AuditEvent = B1AuditEvent | B2AuditEvent;
