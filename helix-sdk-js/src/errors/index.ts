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
  ServiceAlreadyExistsError
} from '@helix-id/core';

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
