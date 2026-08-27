export * from './IAuthService.js';
export { AuthService } from './auth.service.js';
export { AesGcmKeyCustody, type IKeyCustody, type EncryptedKeyMaterial } from './key-custody.js';
export { buildAccountIssuerDid } from './provision-issuer-did.js';
export { ConsoleEmailSender, type IEmailSender } from './email-sender.js';
export {
  assertUnderVcIssuanceQuota,
  assertUnderEnrollmentTokenQuota,
  assertUnderDailyQuota,
} from './quota.js';
export {
  resolveAccountOrAdmin,
  type AccountOrAdminGuardDeps,
  type AccountOrAdminGuardResult,
} from './account-or-admin-guard.js';
