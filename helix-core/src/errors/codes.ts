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
 * All Helix ID error codes.
 * These are the only permitted error codes — no ad hoc strings in helix-api.
 * Grouped by boundary for readability.
 */
export const ErrorCode = {
  // ── B1 — DID & Hedera ───────────────────────────────────────────────────────
  /** Public key submitted during DID creation is not valid Ed25519 */
  INVALID_PUBLIC_KEY: 'INVALID_PUBLIC_KEY',

  /** DID string does not match did:helix:<identifier> format */
  INVALID_DID_FORMAT: 'INVALID_DID_FORMAT',

  /** DID lookup found no record in database or on Hedera */
  DID_NOT_FOUND: 'DID_NOT_FOUND',

  /** Attempted to create a DID for a public key that already has one */
  DID_ALREADY_EXISTS: 'DID_ALREADY_EXISTS',

  /** DID has been deactivated — no further operations permitted */
  DID_DEACTIVATED: 'DID_DEACTIVATED',

  /** Service endpoint URL is not a valid HTTPS URL */
  INVALID_SERVICE_ENDPOINT_URL: 'INVALID_SERVICE_ENDPOINT_URL',

  /** Service endpoint ID not found in the DID document */
  SERVICE_ENDPOINT_NOT_FOUND: 'SERVICE_ENDPOINT_NOT_FOUND',

  /** Service endpoint ID already exists in the DID document */
  SERVICE_ENDPOINT_ALREADY_EXISTS: 'SERVICE_ENDPOINT_ALREADY_EXISTS',

  /** Hedera HCS transaction failed or timed out */
  HEDERA_ANCHOR_FAILED: 'HEDERA_ANCHOR_FAILED',

  /** Hedera DID resolution failed — topic not found or no messages */
  HEDERA_RESOLUTION_FAILED: 'HEDERA_RESOLUTION_FAILED',

  // ── B2 — Verifiable Credentials ──────────────────────────────────────────────
  /** Credential not found in database */
  VC_NOT_FOUND: 'VC_NOT_FOUND',

  /** Attempted to revoke a credential that is already revoked */
  VC_ALREADY_REVOKED: 'VC_ALREADY_REVOKED',

  /** Credential has reached its expiration date */
  VC_EXPIRED: 'VC_EXPIRED',

  /** Subject DID for the VC does not exist in the system */
  VC_SUBJECT_DID_NOT_FOUND: 'VC_SUBJECT_DID_NOT_FOUND',

  /** Privilege scope string does not match the required pattern */
  VC_INVALID_PRIVILEGE_SCOPE: 'VC_INVALID_PRIVILEGE_SCOPE',

  /** All bits in the current status list have been assigned */
  STATUS_LIST_INDEX_EXHAUSTED: 'STATUS_LIST_INDEX_EXHAUSTED',

  /** Status List not found in database */
  STATUS_LIST_NOT_FOUND: 'STATUS_LIST_NOT_FOUND',

  // ── General ────────────────────────────────────────────────────────────────
  /** Generic internal error — details logged, not exposed */
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  /** Request body or query params failed schema validation */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
