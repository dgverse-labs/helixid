import { ErrorCodes, type ErrorCode } from './codes.js';

export { ErrorCodes, type ErrorCode };

export class HelixError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
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
