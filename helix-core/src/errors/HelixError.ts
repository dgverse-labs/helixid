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

import type { ErrorCode } from './codes.js';

export interface HelixErrorBody {
  code: ErrorCode;
  message: string;
  requestId?: string;
  /** Additional context — never contains sensitive data */
  details?: Record<string, unknown> | undefined;
}

/**
 * Base error class for all Helix ID errors.
 * Used by helix-api to construct HTTP error responses.
 * Used by helix-sdk-js to construct typed SDK errors.
 */
export class HelixError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'HelixError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

// ── Convenience constructors ────────────────────────────────────────────────

export class InvalidPublicKeyError extends HelixError {
  constructor() {
    super(
      'INVALID_PUBLIC_KEY',
      'The submitted public key is not a valid 32-byte Ed25519 public key.',
      400,
    );
  }
}

export class InvalidDIDFormatError extends HelixError {
  constructor(did: string) {
    super('INVALID_DID_FORMAT', `The value '${did}' is not a valid Helix DID.`, 400);
  }
}

export class DIDNotFoundError extends HelixError {
  constructor(did: string) {
    super('DID_NOT_FOUND', `DID '${did}' was not found.`, 404);
  }
}

export class DIDAlreadyExistsError extends HelixError {
  constructor() {
    super('DID_ALREADY_EXISTS', 'A DID already exists for this public key.', 409);
  }
}

export class DIDDeactivatedError extends HelixError {
  constructor(did: string) {
    super(
      'DID_DEACTIVATED',
      `DID '${did}' has been deactivated and cannot be used.`,
      410,
    );
  }
}

export class InvalidServiceEndpointUrlError extends HelixError {
  constructor(url: string) {
    super(
      'INVALID_SERVICE_ENDPOINT_URL',
      `Service endpoint URL '${url}' must be a valid HTTPS URL.`,
      400,
    );
  }
}

export class ServiceEndpointNotFoundError extends HelixError {
  constructor(endpointId: string) {
    super(
      'SERVICE_ENDPOINT_NOT_FOUND',
      `Service endpoint '${endpointId}' was not found in the DID document.`,
      404,
    );
  }
}

export class ServiceEndpointAlreadyExistsError extends HelixError {
  constructor(endpointId: string) {
    super(
      'SERVICE_ENDPOINT_ALREADY_EXISTS',
      `A service endpoint with ID '${endpointId}' already exists.`,
      409,
    );
  }
}

export class HederaAnchorFailedError extends HelixError {
  constructor() {
    super(
      'HEDERA_ANCHOR_FAILED',
      'Failed to anchor the DID document on Hedera. Please retry.',
      502,
    );
  }
}

export class HederaResolutionFailedError extends HelixError {
  constructor() {
    super(
      'HEDERA_RESOLUTION_FAILED',
      'Failed to resolve the DID document from Hedera.',
      502,
    );
  }
}

export class InternalError extends HelixError {
  constructor() {
    super('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
  }
}

export class ValidationError extends HelixError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
  }
}

export class VCNotFoundError extends HelixError {
  constructor(vcId: string) {
    super('VC_NOT_FOUND', `Verifiable Credential not found: ${vcId}`, 404);
  }
}

export class VCAlreadyRevokedError extends HelixError {
  constructor(message = 'The Verifiable Credential has already been revoked') {
    super('VC_ALREADY_REVOKED', message, 409);
  }
}

export class VCExpiredError extends HelixError {
  constructor(message = 'The Verifiable Credential has expired') {
    super('VC_EXPIRED', message, 400);
  }
}

export class VCSubjectDIDNotFoundError extends HelixError {
  constructor(did: string) {
    super('VC_SUBJECT_DID_NOT_FOUND', `Subject DID not found: ${did}`, 404);
  }
}

export class VCInvalidPrivilegeScopeError extends HelixError {
  constructor(scope: string) {
    super('VC_INVALID_PRIVILEGE_SCOPE', `Invalid privilege scope: ${scope}`, 400);
  }
}

export class StatusListIndexExhaustedError extends HelixError {
  constructor(message = 'The status list index space is exhausted') {
    super('STATUS_LIST_INDEX_EXHAUSTED', message, 503);
  }
}

export class VCSignatureInvalidError extends HelixError {
  constructor(message = 'The Verifiable Credential signature is invalid') {
    super('VC_SIGNATURE_INVALID', message, 400);
  }
}

export class VCRevokedError extends HelixError {
  constructor(message = 'The Verifiable Credential has been revoked') {
    super('VC_REVOKED', message, 400);
  }
}

export class VCIssuerNotFoundError extends HelixError {
  constructor(message = 'The Verifiable Credential issuer DID could not be resolved') {
    super('VC_ISSUER_NOT_FOUND', message, 400);
  }
}

export class VPNotFoundError extends HelixError {
  constructor(message = 'VP not found') {
    super('VP_NOT_FOUND', message, 404);
  }
}

export class VPExpiredError extends HelixError {
  constructor(message = 'VP has expired') {
    super('VP_EXPIRED', message, 400);
  }
}

export class VPAlreadyConsumedError extends HelixError {
  constructor(message = 'VP was already consumed') {
    super('VP_ALREADY_CONSUMED', message, 400);
  }
}

export class VPVerificationFailedError extends HelixError {
  constructor(message = 'The Verifiable Presentation could not be verified') {
    super('VP_VERIFICATION_FAILED', message, 400);
  }
}

export class VPInvalidStructureError extends HelixError {
  constructor(message = 'VP payload is invalid') {
    super('VP_INVALID_STRUCTURE', message, 400);
  }
}

export class VPAgentDIDNotFoundError extends HelixError {
  constructor(message = 'Agent DID not found') {
    super('VP_AGENT_DID_NOT_FOUND', message, 404);
  }
}

export class VPNoActiveVCError extends HelixError {
  constructor(message = 'No active VC found for agent') {
    super('VP_NO_ACTIVE_VC', message, 400);
  }
}

export class VPMultipleActiveVCError extends HelixError {
  constructor(message = 'Multiple active VCs found for agent') {
    super('VP_MULTIPLE_ACTIVE_VC', message, 400);
  }
}

export class EnrollmentTokenNotFoundError extends HelixError {
  constructor(message = 'Enrollment token was not found') {
    super('ENROLLMENT_TOKEN_NOT_FOUND', message, 404);
  }
}

export class EnrollmentTokenExpiredError extends HelixError {
  constructor(message = 'Enrollment token has expired') {
    super('ENROLLMENT_TOKEN_EXPIRED', message, 400);
  }
}

export class EnrollmentTokenAlreadyUsedError extends HelixError {
  constructor(message = 'Enrollment token was already used') {
    super('ENROLLMENT_TOKEN_ALREADY_USED', message, 409);
  }
}

export class ChallengeNotFoundError extends HelixError {
  constructor(message = 'Challenge was not found') {
    super('CHALLENGE_NOT_FOUND', message, 404);
  }
}

export class ChallengeExpiredError extends HelixError {
  constructor(message = 'Challenge has expired') {
    super('CHALLENGE_EXPIRED', message, 410);
  }
}

export class ChallengeAlreadyVerifiedError extends HelixError {
  constructor(message = 'Challenge was already verified') {
    super('CHALLENGE_ALREADY_VERIFIED', message, 409);
  }
}

export class ChallengeSignatureInvalidError extends HelixError {
  constructor(message = 'Challenge signature is invalid') {
    super('CHALLENGE_SIGNATURE_INVALID', message, 400);
  }
}

export class AgentAlreadyOnboardedError extends HelixError {
  constructor(message = 'Agent is already onboarded') {
    super('AGENT_ALREADY_ONBOARDED', message, 409);
  }
}

export class ServiceNotFoundError extends HelixError {
  constructor(message = 'Service was not found') {
    super('SERVICE_NOT_FOUND', message, 404);
  }
}

export class ServiceAlreadyExistsError extends HelixError {
  constructor(message = 'Service already exists') {
    super('SERVICE_ALREADY_EXISTS', message, 409);
  }
}
