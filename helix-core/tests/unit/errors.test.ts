import { describe, it, expect } from 'vitest';
import * as Errors from '../../src/errors/HelixError.js';

describe('HelixErrors', () => {
  it('instantiates all error classes', () => {
    const errorClasses = [
      () => new Errors.InvalidPublicKeyError(),
      () => new Errors.InvalidDIDFormatError('did:helix:123'),
      () => new Errors.DIDNotFoundError('did:helix:123'),
      () => new Errors.DIDAlreadyExistsError(),
      () => new Errors.DIDDeactivatedError('did:helix:123'),
      () => new Errors.InvalidServiceEndpointUrlError('http://unsafe.com'),
      () => new Errors.ServiceEndpointNotFoundError('key-1'),
      () => new Errors.ServiceEndpointAlreadyExistsError('key-1'),
      () => new Errors.HederaAnchorFailedError(),
      () => new Errors.HederaResolutionFailedError(),
      () => new Errors.InternalError(),
      () => new Errors.ValidationError('bad input'),
      () => new Errors.AdminAuthRequiredError(),
      () => new Errors.VCNotFoundError('vc-1'),
      () => new Errors.VCAlreadyRevokedError(),
      () => new Errors.VCExpiredError(),
      () => new Errors.VCSubjectDIDNotFoundError('did:helix:1'),
      () => new Errors.VCInvalidPrivilegeScopeError('bad:scope'),
      () => new Errors.StatusListIndexExhaustedError(),
      () => new Errors.VCSignatureInvalidError(),
      () => new Errors.VCRevokedError(),
      () => new Errors.VCIssuerNotFoundError(),
      () => new Errors.VPNotFoundError(),
      () => new Errors.VPExpiredError(),
      () => new Errors.VPAlreadyConsumedError(),
      () => new Errors.VPVerificationFailedError(),
      () => new Errors.VPInvalidStructureError(),
      () => new Errors.VPAgentDIDNotFoundError(),
      () => new Errors.VPNoActiveVCError(),
      () => new Errors.VPMultipleActiveVCError(),
      () => new Errors.EnrollmentTokenNotFoundError(),
      () => new Errors.EnrollmentTokenExpiredError(),
      () => new Errors.EnrollmentTokenAlreadyUsedError(),
      () => new Errors.ChallengeNotFoundError(),
      () => new Errors.ChallengeExpiredError(),
      () => new Errors.ChallengeAlreadyVerifiedError(),
      () => new Errors.ChallengeSignatureInvalidError(),
      () => new Errors.AgentAlreadyOnboardedError(),
      () => new Errors.ServiceNotFoundError(),
      () => new Errors.ServiceAlreadyExistsError(),
    ];

    errorClasses.forEach((createError) => {
      const error = createError();
      expect(error).toBeInstanceOf(Errors.HelixError);
      expect(error.code).toBeDefined();
      expect(error.httpStatus).toBeDefined();
      expect(error.message).toBeDefined();
    });
  });

  it('HelixError holds details', () => {
    const details = { foo: 'bar' };
    const error = new Errors.HelixError('INTERNAL_ERROR', 'msg', 500, details);
    expect(error.details).toEqual(details);
  });
});
