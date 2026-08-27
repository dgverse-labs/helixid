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

export class DIDMethodNotAvailableError extends HelixError {
  constructor(message: string) {
    super('DID_METHOD_NOT_AVAILABLE', message, 501);
  }
}

export class UnsupportedDIDMethodError extends HelixError {
  constructor(did: string) {
    super('UNSUPPORTED_DID_METHOD', `Unsupported DID method: ${did}`, 400, { did });
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
  constructor(
    message = 'Failed to anchor the DID document on Hedera. Please retry.',
    details?: Record<string, unknown>,
  ) {
    super('HEDERA_ANCHOR_FAILED', message, 502, details);
  }
}

export class HederaResolutionFailedError extends HelixError {
  constructor(
    message = 'Failed to resolve the DID document from Hedera.',
    details?: Record<string, unknown>,
  ) {
    super('HEDERA_RESOLUTION_FAILED', message, 502, details);
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

export class AdminAuthRequiredError extends HelixError {
  constructor(message = 'Admin authorization is required') {
    super('ADMIN_AUTH_REQUIRED', message, 403);
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

export class VCNotYetValidError extends HelixError {
  constructor(message = 'The Verifiable Credential is not valid yet') {
    super('VC_NOT_YET_VALID', message, 400);
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

export class SelfSignedVCNotAllowedError extends HelixError {
  constructor(message = 'Self-signed VCs are not allowed unless allowSelfSigned is true') {
    super('SELF_SIGNED_VC_NOT_ALLOWED', message, 403);
  }
}

/**
 * Canonical scope-escalation error for issuance-time and chain-validation
 * failures (delegation and grant issuance both throw this).
 */
export class ScopeEscalationDeniedError extends HelixError {
  constructor(scope: string) {
    super('SCOPE_ESCALATION_DENIED', `Delegated scope is not permitted by the parent credential: ${scope}`, 400);
  }
}

/** Canonical delegation-depth error. */
export class MaxDelegationDepthExceededError extends HelixError {
  constructor(message = 'Maximum delegation depth has been exceeded') {
    super('MAX_DELEGATION_DEPTH_EXCEEDED', message, 400);
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

export class DelegationNotPermittedError extends HelixError {
  constructor(message = 'Delegation is not permitted for this credential') {
    super('DELEGATION_NOT_PERMITTED', message, 403);
  }
}

// Consolidated aliases: DelegationDepthExceededError and
// DelegationScopeEscalationError duplicated the two canonical classes above
// with different codes and no distinct behavior. The names remain exported so
// existing imports (helix-sdk-js error mapping, tests) keep working; the wire
// codes DELEGATION_DEPTH_EXCEEDED / DELEGATION_SCOPE_ESCALATION stay in
// codes.ts because the SDK still maps them from API responses.
export const DelegationDepthExceededError = MaxDelegationDepthExceededError;
export type DelegationDepthExceededError = MaxDelegationDepthExceededError;

export const DelegationScopeEscalationError = ScopeEscalationDeniedError;
export type DelegationScopeEscalationError = ScopeEscalationDeniedError;

export class DelegationChainInvalidError extends HelixError {
  constructor(reason: string) {
    super('DELEGATION_CHAIN_INVALID', `Delegation chain is invalid: ${reason}`, 400, { reason });
  }
}

export class DelegationParentVCNotFoundError extends HelixError {
  constructor(message = 'Parent VC in delegation chain was not found') {
    super('DELEGATION_PARENT_VC_NOT_FOUND', message, 404);
  }
}

export class DelegationParentVCRevokedError extends HelixError {
  constructor(message = 'Parent VC in delegation chain has been revoked') {
    super('DELEGATION_PARENT_VC_REVOKED', message, 400);
  }
}

export class WalletAlreadyExistsError extends HelixError {
  constructor(message = 'Wallet file already exists. Use AgentWallet.load() to load an existing wallet.') {
    super('WALLET_ALREADY_EXISTS', message, 409);
  }
}

export class NoCredentialInWalletError extends HelixError {
  constructor(message = 'Wallet has no credentials') {
    super('NO_CREDENTIAL_IN_WALLET', message, 400);
  }
}

export class CredentialNotForThisAgentError extends HelixError {
  constructor(message = 'Credential subject does not match this wallet DID') {
    super('CREDENTIAL_NOT_FOR_THIS_AGENT', message, 400);
  }
}

export class CredentialAlreadyInWalletError extends HelixError {
  constructor(message = 'Credential is already in this wallet') {
    super('CREDENTIAL_ALREADY_IN_WALLET', message, 409);
  }
}

export class SDKOnlyModeNoAPIError extends HelixError {
  constructor(message = 'This operation requires a HelixID API URL. Pass the API URL to HelixClient constructor: new HelixClient("http://your-api")') {
    super('SDK_ONLY_MODE_NO_API', message, 400);
  }
}

export class InsufficientScopeError extends HelixError {
  constructor(requiredScope: string) {
    super('INSUFFICIENT_SCOPE', `Required scope: ${requiredScope}`, 403);
  }
}

export class VPMissingError extends HelixError {
  constructor(message = 'No _helixVP in tool call input') {
    super('VP_MISSING', message, 401);
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

export class VPSignatureInvalidError extends HelixError {
  constructor(message = 'The Verifiable Presentation signature is invalid') {
    super('VP_SIGNATURE_INVALID', message, 400);
  }
}

export class VPInvalidStructureError extends HelixError {
  constructor(message = 'VP payload is invalid') {
    super('VP_INVALID_STRUCTURE', message, 400);
  }
}

/**
 * Verification-time grant errors (VP doc §4.4). Deliberately NOT part of the
 * B7 issuance-error consolidation — these describe VP verification failures.
 */
export class ConsentGrantSubjectMismatchError extends HelixError {
  constructor(
    message = 'Consent grant does not match the presenting agent or the VP user identifier',
  ) {
    super('CONSENT_GRANT_SUBJECT_MISMATCH', message, 400);
  }
}

export class ConsentGrantInvalidError extends HelixError {
  constructor(message = 'Consent grant credential is structurally invalid') {
    super('CONSENT_GRANT_INVALID', message, 400);
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

export class InvalidJWTError extends HelixError {
  constructor(message = 'JWT is invalid') {
    super('JWT_INVALID', message, 400);
  }
}

export class JWTExpiredError extends HelixError {
  constructor(message = 'JWT has expired') {
    super('JWT_EXPIRED', message, 401);
  }
}

export class JWTPublicKeyNotFoundError extends HelixError {
  constructor(message = 'JWT public key is not configured') {
    super('JWT_PUBLIC_KEY_NOT_FOUND', message, 500);
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

export class PreparedPayloadNotFoundError extends HelixError {
  constructor(message = 'Prepared payload was not found') {
    super('PREPARED_PAYLOAD_NOT_FOUND', message, 404);
  }
}

export class PreparedPayloadExpiredError extends HelixError {
  constructor(message = 'Prepared payload has expired') {
    super('PREPARED_PAYLOAD_EXPIRED', message, 410);
  }
}

export class PreparedPayloadAlreadyConsumedError extends HelixError {
  constructor(message = 'Prepared payload was already consumed') {
    super('PREPARED_PAYLOAD_ALREADY_CONSUMED', message, 409);
  }
}

export class PreparedPayloadSignatureInvalidError extends HelixError {
  constructor(message = 'Prepared payload signature is invalid') {
    super('PREPARED_PAYLOAD_SIGNATURE_INVALID', message, 400);
  }
}

export class PreparedPayloadPurposeMismatchError extends HelixError {
  constructor(message = 'Prepared payload purpose does not match finalize endpoint') {
    super('PREPARED_PAYLOAD_PURPOSE_MISMATCH', message, 400);
  }
}

// -- Agent VC renewal (see docs/proposal-sdk-api-only.md, "renewal" scope) --
// Renewal is issuance-repeated-on-a-timer, signed by the same identity that
// signed the original VC (see PreparedPayloadService.prepareAgentRenewal()).
// These enforce standard credential-renewal hygiene: no renewing a revoked
// credential, no renewing outside the intended window, and no unbounded
// renewal chains that drift indefinitely from the original issuance.

export class RenewalWindowNotOpenError extends HelixError {
  constructor(message = 'VC is not yet within its renewal window') {
    super('RENEWAL_WINDOW_NOT_OPEN', message, 400);
  }
}

export class RenewalWindowExpiredError extends HelixError {
  constructor(message = 'VC renewal grace period has passed; a fresh issuance is required') {
    super('RENEWAL_WINDOW_EXPIRED', message, 400);
  }
}

export class MaxRenewalCountExceededError extends HelixError {
  constructor(message = 'VC has reached its maximum renewal count; a fresh issuance is required') {
    super('MAX_RENEWAL_COUNT_EXCEEDED', message, 400);
  }
}

export class VCMissingCredentialStatusError extends HelixError {
  constructor(message = 'VC has no credentialStatus entry; revocation cannot be checked') {
    super('VC_MISSING_CREDENTIAL_STATUS', message, 400);
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

// ── Hosted accounts & auth (Item #1) ────────────────────────────────────────
// See docs/proposal-hosted-instance.md ("Decided: accounts, login, and
// DID/key custody"). Account-facing auth errors only — key custody
// implementation errors stay as generic InternalError, since their detail
// should never reach a client response.

export class AccountAlreadyExistsError extends HelixError {
  constructor(message = 'An account with this email already exists') {
    super('ACCOUNT_ALREADY_EXISTS', message, 409);
  }
}

export class AccountNotFoundError extends HelixError {
  constructor(message = 'Account was not found') {
    super('ACCOUNT_NOT_FOUND', message, 404);
  }
}

export class InvalidCredentialsError extends HelixError {
  constructor(message = 'Email or password is incorrect') {
    super('INVALID_CREDENTIALS', message, 401);
  }
}

export class AccountHasNoPasswordError extends HelixError {
  constructor(message = 'This account signs in with Google only; no password is set') {
    super('ACCOUNT_HAS_NO_PASSWORD', message, 401);
  }
}

export class RefreshTokenInvalidError extends HelixError {
  constructor(message = 'Refresh token is invalid') {
    super('REFRESH_TOKEN_INVALID', message, 401);
  }
}

export class RefreshTokenExpiredError extends HelixError {
  constructor(message = 'Refresh token has expired; please sign in again') {
    super('REFRESH_TOKEN_EXPIRED', message, 401);
  }
}

export class RefreshTokenReuseDetectedError extends HelixError {
  constructor(
    message = 'This refresh token was already used. All sessions for this account have been signed out as a precaution.',
  ) {
    super('REFRESH_TOKEN_REUSE_DETECTED', message, 401);
  }
}

export class AccessTokenInvalidError extends HelixError {
  constructor(message = 'Access token is invalid') {
    super('ACCESS_TOKEN_INVALID', message, 401);
  }
}

export class AccessTokenExpiredError extends HelixError {
  constructor(message = 'Access token has expired') {
    super('ACCESS_TOKEN_EXPIRED', message, 401);
  }
}

export class GoogleOAuthFailedError extends HelixError {
  constructor(message = 'Google sign-in failed') {
    super('GOOGLE_OAUTH_FAILED', message, 401);
  }
}

export class EmailNotVerifiedError extends HelixError {
  constructor(
    message = 'Please verify your email before issuing credentials or enrollment tokens',
  ) {
    super('EMAIL_NOT_VERIFIED', message, 403);
  }
}

export class EmailVerificationTokenInvalidError extends HelixError {
  constructor(message = 'Verification link is invalid') {
    super('EMAIL_VERIFICATION_TOKEN_INVALID', message, 400);
  }
}

export class EmailVerificationTokenExpiredError extends HelixError {
  constructor(message = 'Verification link has expired; request a new one') {
    super('EMAIL_VERIFICATION_TOKEN_EXPIRED', message, 400);
  }
}

export class AccountQuotaExceededError extends HelixError {
  constructor(message = 'Daily quota exceeded for this account') {
    super('ACCOUNT_QUOTA_EXCEEDED', message, 429);
  }
}

export class CaptchaFailedError extends HelixError {
  constructor(message = 'CAPTCHA verification failed') {
    super('CAPTCHA_FAILED', message, 400);
  }
}
