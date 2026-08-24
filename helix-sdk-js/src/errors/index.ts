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

import { 
  HelixError, 
  ErrorCode, 
  HelixErrorBody,
  InternalError,
  ValidationError,
  DIDNotFoundError,
  DIDDeactivatedError,
  DIDAlreadyExistsError,
  EnrollmentTokenNotFoundError,
  EnrollmentTokenExpiredError,
  EnrollmentTokenAlreadyUsedError,
  ChallengeNotFoundError,
  ChallengeExpiredError,
  ChallengeAlreadyVerifiedError,
  ChallengeSignatureInvalidError,
  AgentAlreadyOnboardedError,
  ServiceNotFoundError,
  ServiceAlreadyExistsError,
  DelegationNotPermittedError,
  DelegationDepthExceededError,
  DelegationScopeEscalationError,
  DelegationChainInvalidError,
  DelegationParentVCNotFoundError,
  DelegationParentVCRevokedError,
  MaxDelegationDepthExceededError,
  ScopeEscalationDeniedError,
  PreparedPayloadNotFoundError,
  PreparedPayloadExpiredError,
  PreparedPayloadAlreadyConsumedError,
  PreparedPayloadSignatureInvalidError,
  PreparedPayloadPurposeMismatchError,
  VCRevokedError,
  VCMissingCredentialStatusError,
  RenewalWindowNotOpenError,
  RenewalWindowExpiredError,
  MaxRenewalCountExceededError,
  VCExpiredError,
  VCNotYetValidError,
  VCSignatureInvalidError,
  SelfSignedVCNotAllowedError,
  VPMissingError,
  VPExpiredError,
  VPVerificationFailedError,
  VPSignatureInvalidError,
  VPInvalidStructureError,
  ConsentGrantSubjectMismatchError,
  ConsentGrantInvalidError
} from '@helixid/core';

/**
 * Maps a structured API error response to a typed HelixError instance.
 * Useful for client-side catch blocks.
 */
export function mapApiError(body: unknown): HelixError {
  const responseBody = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const errorBody = responseBody['error'] as HelixErrorBody | undefined;
  
  if (!errorBody || !errorBody.code) {
    return new InternalError();
  }

  const { code, message } = errorBody;

  switch (code) {
    case ErrorCode.VALIDATION_ERROR:
      return new ValidationError(message);
    case ErrorCode.DID_NOT_FOUND:
      return new DIDNotFoundError(message);
    case ErrorCode.DID_DEACTIVATED:
      return new DIDDeactivatedError(message);
    case ErrorCode.DID_ALREADY_EXISTS:
      return new DIDAlreadyExistsError();
    case ErrorCode.ENROLLMENT_TOKEN_NOT_FOUND:
      return new EnrollmentTokenNotFoundError(message);
    case ErrorCode.ENROLLMENT_TOKEN_EXPIRED:
      return new EnrollmentTokenExpiredError(message);
    case ErrorCode.ENROLLMENT_TOKEN_ALREADY_USED:
      return new EnrollmentTokenAlreadyUsedError(message);
    case ErrorCode.CHALLENGE_NOT_FOUND:
      return new ChallengeNotFoundError(message);
    case ErrorCode.CHALLENGE_EXPIRED:
      return new ChallengeExpiredError(message);
    case ErrorCode.CHALLENGE_ALREADY_VERIFIED:
      return new ChallengeAlreadyVerifiedError(message);
    case ErrorCode.CHALLENGE_SIGNATURE_INVALID:
      return new ChallengeSignatureInvalidError(message);
    case ErrorCode.AGENT_ALREADY_ONBOARDED:
      return new AgentAlreadyOnboardedError(message);
    case ErrorCode.SERVICE_NOT_FOUND:
      return new ServiceNotFoundError(message);
    case ErrorCode.SERVICE_ALREADY_EXISTS:
      return new ServiceAlreadyExistsError(message);
    case ErrorCode.DELEGATION_NOT_PERMITTED:
      return new DelegationNotPermittedError(message);
    case ErrorCode.DELEGATION_DEPTH_EXCEEDED:
      return new DelegationDepthExceededError(message);
    case ErrorCode.DELEGATION_SCOPE_ESCALATION:
      return new DelegationScopeEscalationError(message);
    case ErrorCode.DELEGATION_CHAIN_INVALID:
      return new DelegationChainInvalidError(message);
    case ErrorCode.DELEGATION_PARENT_VC_NOT_FOUND:
      return new DelegationParentVCNotFoundError(message);
    case ErrorCode.DELEGATION_PARENT_VC_REVOKED:
      return new DelegationParentVCRevokedError(message);
    case ErrorCode.MAX_DELEGATION_DEPTH_EXCEEDED:
      return new MaxDelegationDepthExceededError(message);
    case ErrorCode.SCOPE_ESCALATION_DENIED:
      return new ScopeEscalationDeniedError(message);
    case ErrorCode.PREPARED_PAYLOAD_NOT_FOUND:
      return new PreparedPayloadNotFoundError(message);
    case ErrorCode.PREPARED_PAYLOAD_EXPIRED:
      return new PreparedPayloadExpiredError(message);
    case ErrorCode.PREPARED_PAYLOAD_ALREADY_CONSUMED:
      return new PreparedPayloadAlreadyConsumedError(message);
    case ErrorCode.PREPARED_PAYLOAD_SIGNATURE_INVALID:
      return new PreparedPayloadSignatureInvalidError(message);
    case ErrorCode.PREPARED_PAYLOAD_PURPOSE_MISMATCH:
      return new PreparedPayloadPurposeMismatchError(message);
    case ErrorCode.VC_REVOKED:
      return new VCRevokedError(message);
    case ErrorCode.VC_MISSING_CREDENTIAL_STATUS:
      return new VCMissingCredentialStatusError(message);
    case ErrorCode.RENEWAL_WINDOW_NOT_OPEN:
      return new RenewalWindowNotOpenError(message);
    case ErrorCode.RENEWAL_WINDOW_EXPIRED:
      return new RenewalWindowExpiredError(message);
    case ErrorCode.MAX_RENEWAL_COUNT_EXCEEDED:
      return new MaxRenewalCountExceededError(message);
    case ErrorCode.VC_EXPIRED:
      return new VCExpiredError(message);
    case ErrorCode.VC_NOT_YET_VALID:
      return new VCNotYetValidError(message);
    case ErrorCode.VC_SIGNATURE_INVALID:
      return new VCSignatureInvalidError(message);
    case ErrorCode.SELF_SIGNED_VC_NOT_ALLOWED:
      return new SelfSignedVCNotAllowedError(message);
    case ErrorCode.VP_MISSING:
      return new VPMissingError(message);
    case ErrorCode.VP_EXPIRED:
      return new VPExpiredError(message);
    case ErrorCode.VP_VERIFICATION_FAILED:
      return new VPVerificationFailedError(message);
    case ErrorCode.VP_SIGNATURE_INVALID:
      return new VPSignatureInvalidError(message);
    case ErrorCode.VP_INVALID_STRUCTURE:
      return new VPInvalidStructureError(message);
    case ErrorCode.CONSENT_GRANT_SUBJECT_MISMATCH:
      return new ConsentGrantSubjectMismatchError(message);
    case ErrorCode.CONSENT_GRANT_INVALID:
      return new ConsentGrantInvalidError(message);
    default:
      // Fallback to base HelixError for unknown codes
      return new HelixError(
        code as ErrorCode,
        message,
        Number(responseBody['statusCode'] ?? responseBody['status'] ?? 500),
      );
  }
}

export { HelixError, ErrorCode };
