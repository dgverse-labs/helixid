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
//
// See docs/proposal-hosted-instance.md ("Decided: accounts, login, and
// DID/key custody"). Password hashing via argon2id. Google sign-in matches
// an existing account by googleId first, falling back to a match on
// (Google-verified) email — a user who registered with a password and
// later uses "Sign in with Google" on the same email lands on the same
// account, no separate confirmation step, since Google guarantees the
// email is verified.

import * as argon2 from 'argon2';
import {
  AccountAlreadyExistsError,
  AccountHasNoPasswordError,
  AccountNotFoundError,
  InvalidCredentialsError,
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
  AuditEvents,
  type IAuditLogger,
} from '@helixid/core';
import type { AccountRepository } from '../../repositories/account.repository.js';
import type { DidRepository } from '../../repositories/did.repository.js';
import type { IssuerKeyRepository } from '../../repositories/issuer-key.repository.js';
import type { RefreshTokenRepository } from '../../repositories/refresh-token.repository.js';
import type { IKeyCustody } from './key-custody.js';
import { provisionAccountIssuerDid } from './provision-issuer-did.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  issueAccessToken,
  verifyAccessToken,
} from './tokens.js';
import type {
  AccountSummary,
  AuthTokens,
  GoogleProfile,
  IAuthService,
  LoginInput,
  RegisterInput,
} from './IAuthService.js';

function toSummary(account: {
  id: string;
  email: string;
  issuerDid: string | null;
  passwordHash: string | null;
  googleId: string | null;
}): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    issuerDid: account.issuerDid,
    hasPassword: account.passwordHash !== null,
    hasGoogle: account.googleId !== null,
  };
}

export class AuthService implements IAuthService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly didRepository: DidRepository,
    private readonly issuerKeyRepository: IssuerKeyRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly keyCustody: IKeyCustody,
    private readonly auditLogger: IAuditLogger,
    private readonly accessTokenSecret: string,
    private readonly didDomain: string,
    private readonly accessTokenTtlSeconds = 900,
    private readonly refreshTokenTtlDays = 30,
  ) {}

  async register(input: RegisterInput): Promise<{ account: AccountSummary; tokens: AuthTokens }> {
    const email = normalizeEmail(input.email);
    const existing = await this.accountRepository.findByEmail(email);
    if (existing) {
      throw new AccountAlreadyExistsError();
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const account = await this.accountRepository.create({ email, passwordHash, googleId: null });

    const issuerDid = await provisionAccountIssuerDid({
      accountId: account.id,
      didDomain: this.didDomain,
      didRepository: this.didRepository,
      issuerKeyRepository: this.issuerKeyRepository,
      keyCustody: this.keyCustody,
    });
    const withDid = await this.accountRepository.setIssuerDid(account.id, issuerDid);

    await this.auditLogger.log(AuditEvents.ACCOUNT_REGISTERED, {
      requestId: `auth:${account.id}`,
      accountId: account.id,
      issuerDid,
    });

    const tokens = await this.issueSession(account.id);
    return { account: toSummary(withDid), tokens };
  }

  async login(input: LoginInput): Promise<{ account: AccountSummary; tokens: AuthTokens }> {
    const email = normalizeEmail(input.email);
    const account = await this.accountRepository.findByEmail(email);
    if (!account) {
      await this.auditLogger.log(AuditEvents.ACCOUNT_LOGIN_FAILED, {
        requestId: `auth:unknown`,
        email,
        reason: 'not_found',
      });
      throw new InvalidCredentialsError();
    }
    if (!account.passwordHash) {
      throw new AccountHasNoPasswordError();
    }

    const valid = await argon2.verify(account.passwordHash, input.password);
    if (!valid) {
      await this.auditLogger.log(AuditEvents.ACCOUNT_LOGIN_FAILED, {
        requestId: `auth:${account.id}`,
        accountId: account.id,
        reason: 'bad_password',
      });
      throw new InvalidCredentialsError();
    }

    await this.auditLogger.log(AuditEvents.ACCOUNT_LOGIN_SUCCEEDED, {
      requestId: `auth:${account.id}`,
      accountId: account.id,
      method: 'password',
    });

    const tokens = await this.issueSession(account.id);
    return { account: toSummary(account), tokens };
  }

  async loginWithGoogle(
    profile: GoogleProfile,
  ): Promise<{ account: AccountSummary; tokens: AuthTokens }> {
    let account = await this.accountRepository.findByGoogleId(profile.googleId);

    if (!account) {
      const email = normalizeEmail(profile.email);
      const existingByEmail = await this.accountRepository.findByEmail(email);

      if (existingByEmail) {
        // Same-email match: link, don't create a duplicate account. Safe
        // without further confirmation because Google guarantees the email
        // is verified (see design doc).
        if (!profile.emailVerified) {
          throw new AccountNotFoundError('Google account email is not verified');
        }
        account = await this.accountRepository.linkGoogleId(existingByEmail.id, profile.googleId);
        await this.auditLogger.log(AuditEvents.ACCOUNT_GOOGLE_LINKED, {
          requestId: `auth:${account.id}`,
          accountId: account.id,
        });
      } else {
        const created = await this.accountRepository.create({
          email,
          passwordHash: null,
          googleId: profile.googleId,
        });
        const issuerDid = await provisionAccountIssuerDid({
          accountId: created.id,
          didDomain: this.didDomain,
          didRepository: this.didRepository,
          issuerKeyRepository: this.issuerKeyRepository,
          keyCustody: this.keyCustody,
        });
        account = await this.accountRepository.setIssuerDid(created.id, issuerDid);
        await this.auditLogger.log(AuditEvents.ACCOUNT_REGISTERED, {
          requestId: `auth:${created.id}`,
          accountId: created.id,
          issuerDid,
          method: 'google',
        });
      }
    }

    await this.auditLogger.log(AuditEvents.ACCOUNT_LOGIN_SUCCEEDED, {
      requestId: `auth:${account.id}`,
      accountId: account.id,
      method: 'google',
    });

    const tokens = await this.issueSession(account.id);
    return { account: toSummary(account), tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(refreshToken);
    const record = await this.refreshTokenRepository.findByTokenHash(tokenHash);
    if (!record) {
      throw new RefreshTokenInvalidError();
    }

    if (record.revokedAt) {
      // Reuse of an already-rotated/revoked token is treated as a
      // compromise signal: burn every session for this account.
      await this.refreshTokenRepository.revokeAllForAccount(record.accountId);
      await this.auditLogger.log(AuditEvents.REFRESH_TOKEN_REUSE_DETECTED, {
        requestId: `auth:${record.accountId}`,
        accountId: record.accountId,
        refreshTokenId: record.id,
      });
      throw new RefreshTokenReuseDetectedError();
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new RefreshTokenExpiredError();
    }

    const tokens = await this.issueSession(record.accountId, record.id);
    await this.auditLogger.log(AuditEvents.REFRESH_TOKEN_ROTATED, {
      requestId: `auth:${record.accountId}`,
      accountId: record.accountId,
      previousTokenId: record.id,
    });
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    const record = await this.refreshTokenRepository.findByTokenHash(tokenHash);
    if (!record || record.revokedAt) return;
    await this.refreshTokenRepository.revoke(record.id);
    await this.auditLogger.log(AuditEvents.ACCOUNT_LOGOUT, {
      requestId: `auth:${record.accountId}`,
      accountId: record.accountId,
    });
  }

  verifyAccessToken(accessToken: string): { accountId: string; scope: string[] } {
    const payload = verifyAccessToken(accessToken, this.accessTokenSecret);
    return { accountId: payload.accountId, scope: payload.scope };
  }

  /** Issues a fresh access + refresh token pair; if replacing, revokes the old refresh token and links it to the new one. */
  private async issueSession(accountId: string, replacingTokenId?: string): Promise<AuthTokens> {
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

    const created = await this.refreshTokenRepository.create({ accountId, tokenHash, expiresAt });
    if (replacingTokenId) {
      await this.refreshTokenRepository.revoke(replacingTokenId, created.id);
    }

    const accessToken = issueAccessToken(accountId, this.accessTokenSecret, this.accessTokenTtlSeconds);
    return { accessToken, refreshToken: rawRefreshToken, expiresIn: this.accessTokenTtlSeconds };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
