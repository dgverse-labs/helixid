import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../src/errors/codes.js';
import { AuditEvents } from '../../src/audit/index.js';
import * as Errors from '../../src/errors/index.js';

describe('story4 contracts', () => {
  it('exposes Story 4 error codes', () => {
    expect(ErrorCodes.ENROLLMENT_TOKEN_NOT_FOUND).toBe('ENROLLMENT_TOKEN_NOT_FOUND');
    expect(ErrorCodes.CHALLENGE_SIGNATURE_INVALID).toBe('CHALLENGE_SIGNATURE_INVALID');
    expect(ErrorCodes.AGENT_ALREADY_ONBOARDED).toBe('AGENT_ALREADY_ONBOARDED');
  });

  it('exposes Story 4 audit events', () => {
    expect(AuditEvents.AGENT_ONBOARDED).toBe('AGENT_ONBOARDED');
    expect(AuditEvents.ENROLLMENT_TOKEN_GENERATED).toBe('ENROLLMENT_TOKEN_GENERATED');
  });

  it('instantiates all error classes correctly', () => {
    const errorClasses = [
      Errors.VPNotFoundError,
      Errors.VPExpiredError,
      Errors.VPAlreadyConsumedError,
      Errors.VPVerificationFailedError,
      Errors.VPInvalidStructureError,
      Errors.VPAgentDIDNotFoundError,
      Errors.VPNoActiveVCError,
      Errors.VPMultipleActiveVCError,
      Errors.EnrollmentTokenNotFoundError,
      Errors.EnrollmentTokenExpiredError,
      Errors.EnrollmentTokenAlreadyUsedError,
      Errors.ChallengeNotFoundError,
      Errors.ChallengeExpiredError,
      Errors.ChallengeAlreadyVerifiedError,
      Errors.ChallengeSignatureInvalidError,
      Errors.AgentAlreadyOnboardedError,
      Errors.ServiceNotFoundError,
      Errors.ServiceAlreadyExistsError
    ];
    for (const ErrorClass of errorClasses) {
      const err = new ErrorClass();
      expect(err).toBeInstanceOf(Errors.HelixError);
      expect(err.code).toBeDefined();
    }
  });
});
