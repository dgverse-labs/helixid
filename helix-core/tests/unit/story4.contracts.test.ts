import { describe, expect, it } from 'vitest';
import { AuditEvents, ErrorCodes } from '../../src/index.js';

describe('story4 contracts', () => {
  it('exposes Story 4 error codes', () => {
    expect(ErrorCodes.ENROLLMENT_TOKEN_NOT_FOUND).toBe('ENROLLMENT_TOKEN_NOT_FOUND');
    expect(ErrorCodes.CHALLENGE_SIGNATURE_INVALID).toBe('CHALLENGE_SIGNATURE_INVALID');
    expect(ErrorCodes.SERVICE_ALREADY_EXISTS).toBe('SERVICE_ALREADY_EXISTS');
  });

  it('exposes Story 4 audit events', () => {
    expect(AuditEvents.ENROLLMENT_TOKEN_GENERATED).toBe('ENROLLMENT_TOKEN_GENERATED');
    expect(AuditEvents.AGENT_ONBOARDED).toBe('AGENT_ONBOARDED');
    expect(AuditEvents.USER_DID_VERIFIED).toBe('USER_DID_VERIFIED');
  });
});
