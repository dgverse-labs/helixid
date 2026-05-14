import { ErrorCodes, type ErrorCode } from './codes.js';

export { ErrorCodes, type ErrorCode };

export class HelixError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

// ─── B1: DID & Hedera ────────────────────────────────────────────────────────

export class InvalidPublicKeyError extends HelixError {
  constructor(message = 'The provided public key is invalid.') {
    super(ErrorCodes.INVALID_PUBLIC_KEY, message, 400);
  }
}

export class InvalidDIDFormatError extends HelixError {
  constructor(did: string) {
    super(ErrorCodes.INVALID_DID_FORMAT, `The DID format is invalid: ${did}`, 400);
  }
}

export class DIDNotFoundError extends HelixError {
  constructor(did: string) {
    super(ErrorCodes.DID_NOT_FOUND, `DID not found: ${did}`, 404);
  }
}

export class DIDAlreadyExistsError extends HelixError {
  constructor(message = 'A DID with this public key already exists.') {
    super(ErrorCodes.DID_ALREADY_EXISTS, message, 409);
  }
}

export class DIDDeactivatedError extends HelixError {
  constructor(did: string) {
    super(ErrorCodes.DID_DEACTIVATED, `DID has been deactivated: ${did}`, 410);
  }
}

export class InvalidServiceEndpointUrlError extends HelixError {
  constructor(url: string) {
    super(ErrorCodes.INVALID_SERVICE_ENDPOINT_URL, `Invalid service endpoint URL (must be https://): ${url}`, 400);
  }
}

export class ServiceEndpointNotFoundError extends HelixError {
  constructor(id: string) {
    super(ErrorCodes.SERVICE_ENDPOINT_NOT_FOUND, `Service endpoint not found: ${id}`, 404);
  }
}

export class ServiceEndpointAlreadyExistsError extends HelixError {
  constructor(id: string) {
    super(ErrorCodes.SERVICE_ENDPOINT_ALREADY_EXISTS, `Service endpoint already exists: ${id}`, 409);
  }
}

export class HederaAnchorFailedError extends HelixError {
  constructor(message = 'Failed to anchor document on Hedera.') {
    super(ErrorCodes.HEDERA_ANCHOR_FAILED, message, 502);
  }
}

export class HederaResolutionFailedError extends HelixError {
  constructor(message = 'Failed to resolve document from Hedera.') {
    super(ErrorCodes.HEDERA_RESOLUTION_FAILED, message, 502);
  }
}

export class InternalError extends HelixError {
  constructor(message = 'An internal error occurred.') {
    super(ErrorCodes.INTERNAL_ERROR, message, 500);
  }
}

export class VPNotFoundError extends HelixError {
  constructor(message = 'VP not found') {
    super(ErrorCodes.VP_NOT_FOUND, message, 404);
  }
}

export class VPExpiredError extends HelixError {
  constructor(message = 'VP has expired') {
    super(ErrorCodes.VP_EXPIRED, message, 400);
  }
}

export class VPAlreadyConsumedError extends HelixError {
  constructor(message = 'VP was already consumed') {
    super(ErrorCodes.VP_ALREADY_CONSUMED, message, 400);
  }
}

export class VPVerificationFailedError extends HelixError {
  constructor(message = 'The Verifiable Presentation could not be verified.') {
    super(ErrorCodes.VP_VERIFICATION_FAILED, message, 400);
  }
}

export class VPInvalidStructureError extends HelixError {
  constructor(message = 'VP payload is invalid') {
    super(ErrorCodes.VP_INVALID_STRUCTURE, message, 400);
  }
}

export class VPAgentDIDNotFoundError extends HelixError {
  constructor(message = 'Agent DID not found') {
    super(ErrorCodes.VP_AGENT_DID_NOT_FOUND, message, 404);
  }
}

export class VPNoActiveVCError extends HelixError {
  constructor(message = 'No active VC found for agent') {
    super(ErrorCodes.VP_NO_ACTIVE_VC, message, 400);
  }
}

export class VPMultipleActiveVCError extends HelixError {
  constructor(message = 'Multiple active VCs found for agent') {
    super(ErrorCodes.VP_MULTIPLE_ACTIVE_VC, message, 400);
  }
}

export class EnrollmentTokenNotFoundError extends HelixError {
  constructor(message = 'Enrollment token was not found') {
    super(ErrorCodes.ENROLLMENT_TOKEN_NOT_FOUND, message, 404);
  }
}

export class EnrollmentTokenExpiredError extends HelixError {
  constructor(message = 'Enrollment token has expired') {
    super(ErrorCodes.ENROLLMENT_TOKEN_EXPIRED, message, 400);
  }
}

export class EnrollmentTokenAlreadyUsedError extends HelixError {
  constructor(message = 'Enrollment token was already used') {
    super(ErrorCodes.ENROLLMENT_TOKEN_ALREADY_USED, message, 400);
  }
}

export class ChallengeNotFoundError extends HelixError {
  constructor(message = 'Challenge was not found') {
    super(ErrorCodes.CHALLENGE_NOT_FOUND, message, 404);
  }
}

export class ChallengeExpiredError extends HelixError {
  constructor(message = 'Challenge has expired') {
    super(ErrorCodes.CHALLENGE_EXPIRED, message, 410);
  }
}

export class ChallengeAlreadyVerifiedError extends HelixError {
  constructor(message = 'Challenge was already verified') {
    super(ErrorCodes.CHALLENGE_ALREADY_VERIFIED, message, 409);
  }
}

export class ChallengeSignatureInvalidError extends HelixError {
  constructor(message = 'Challenge signature is invalid') {
    super(ErrorCodes.CHALLENGE_SIGNATURE_INVALID, message, 400);
  }
}

export class AgentAlreadyOnboardedError extends HelixError {
  constructor(message = 'Agent is already onboarded') {
    super(ErrorCodes.AGENT_ALREADY_ONBOARDED, message, 409);
  }
}

export class ServiceNotFoundError extends HelixError {
  constructor(message = 'Service was not found') {
    super(ErrorCodes.SERVICE_NOT_FOUND, message, 404);
  }
}

export class ServiceAlreadyExistsError extends HelixError {
  constructor(message = 'Service already exists') {
    super(ErrorCodes.SERVICE_ALREADY_EXISTS, message, 409);
  }
}

export class VCSignatureInvalidError extends HelixError {
  constructor(message = 'The Verifiable Credential signature is invalid') {
    super(ErrorCodes.VC_SIGNATURE_INVALID, message, 400);
  }
}

export class VCExpiredError extends HelixError {
  constructor(message = 'The Verifiable Credential has expired') {
    super(ErrorCodes.VC_EXPIRED, message, 400);
  }
}

export class VCRevokedError extends HelixError {
  constructor(message = 'The Verifiable Credential has been revoked') {
    super(ErrorCodes.VC_REVOKED, message, 400);
  }
}

export class VCIssuerNotFoundError extends HelixError {
  constructor(message = 'The Verifiable Credential issuer DID could not be resolved') {
    super(ErrorCodes.VC_ISSUER_NOT_FOUND, message, 400);
  }
}

// ─── B2: VC Issuance & Management ────────────────────────────────────────────

export class VCNotFoundError extends HelixError {
  constructor(vcId: string) {
    super(ErrorCodes.VC_NOT_FOUND, `Verifiable Credential not found: ${vcId}`, 404);
  }
}

export class VCAlreadyRevokedError extends HelixError {
  constructor(message = 'The Verifiable Credential has already been revoked') {
    super(ErrorCodes.VC_ALREADY_REVOKED, message, 409);
  }
}

export class VCSubjectDIDNotFoundError extends HelixError {
  constructor(did: string) {
    super(ErrorCodes.VC_SUBJECT_DID_NOT_FOUND, `Subject DID not found: ${did}`, 404);
  }
}

export class VCInvalidPrivilegeScopeError extends HelixError {
  constructor(scope: string) {
    super(ErrorCodes.VC_INVALID_PRIVILEGE_SCOPE, `Invalid privilege scope: ${scope}`, 400);
  }
}

export class StatusListIndexExhaustedError extends HelixError {
  constructor(message = 'The status list index space is exhausted. No more VCs can be issued.') {
    super(ErrorCodes.STATUS_LIST_INDEX_EXHAUSTED, message, 503);
  }
}
