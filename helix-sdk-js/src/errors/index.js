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
import { HelixError, ErrorCode, InternalError, ValidationError, DIDNotFoundError, DIDDeactivatedError, DIDAlreadyExistsError, EnrollmentTokenNotFoundError, EnrollmentTokenExpiredError, EnrollmentTokenAlreadyUsedError, ChallengeNotFoundError, ChallengeExpiredError, ChallengeAlreadyVerifiedError, ChallengeSignatureInvalidError, AgentAlreadyOnboardedError, ServiceNotFoundError, ServiceAlreadyExistsError, DelegationNotPermittedError, DelegationDepthExceededError, DelegationScopeEscalationError, DelegationChainInvalidError, DelegationParentVCNotFoundError, DelegationParentVCRevokedError } from '@helixid/core';
/**
 * Maps a structured API error response to a typed HelixError instance.
 * Useful for client-side catch blocks.
 */
export function mapApiError(body) {
    const responseBody = body && typeof body === 'object' ? body : {};
    const errorBody = responseBody['error'];
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
        default:
            // Fallback to base HelixError for unknown codes
            return new HelixError(code, message, Number(responseBody['statusCode'] ?? responseBody['status'] ?? 500));
    }
}
export { HelixError, ErrorCode };
//# sourceMappingURL=index.js.map