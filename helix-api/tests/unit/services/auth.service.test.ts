// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unit tests for AuthService against the in-memory tier of each
// repository (no Prisma/sqlite needed) — register, login, DID
// auto-provisioning, refresh rotation, and reuse detection.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AccountAlreadyExistsError,
  InvalidCredentialsError,
  RefreshTokenReuseDetectedError,
  AccountHasNoPasswordError,
} from '@helixid/core';
import { AuthService } from '../../../src/services/auth/auth.service.js';
import { AesGcmKeyCustody } from '../../../src/services/auth/key-custody.js';
import { AccountRepository } from '../../../src/repositories/account.repository.js';
import { DidRepository } from '../../../src/repositories/did.repository.js';
import { IssuerKeyRepository } from '../../../src/repositories/issuer-key.repository.js';
import { RefreshTokenRepository } from '../../../src/repositories/refresh-token.repository.js';

const NOOP_AUDIT_LOGGER = { log: () => undefined };
const MASTER_KEY = 'a'.repeat(64);
const ACCESS_SECRET = 'test-access-token-secret-please-ignore';
const DID_DOMAIN = 'hosted.helixid.test';

function makeService() {
  const accountRepository = new AccountRepository();
  const didRepository = new DidRepository();
  const issuerKeyRepository = new IssuerKeyRepository();
  const refreshTokenRepository = new RefreshTokenRepository();
  const keyCustody = new AesGcmKeyCustody(MASTER_KEY);
  const service = new AuthService(
    accountRepository,
    didRepository,
    issuerKeyRepository,
    refreshTokenRepository,
    keyCustody,
    NOOP_AUDIT_LOGGER,
    ACCESS_SECRET,
    DID_DOMAIN,
    900,
    30,
  );
  return { service, accountRepository, didRepository, issuerKeyRepository, refreshTokenRepository };
}

describe('AuthService.register', () => {
  it('creates an account, auto-provisions an issuer DID, and returns session tokens', async () => {
    const { service, didRepository, issuerKeyRepository } = makeService();

    const { account, tokens } = await service.register({
      email: 'Ada@Example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(account.email).toBe('ada@example.com'); // normalized
    expect(account.hasPassword).toBe(true);
    expect(account.hasGoogle).toBe(false);
    expect(account.issuerDid).toBe(`did:web:${DID_DOMAIN}:accounts:${account.id}`);
    expect(tokens.accessToken.split('.')).toHaveLength(3);
    expect(tokens.refreshToken.startsWith('rft_')).toBe(true);

    const didRecord = await didRepository.findDidById(account.issuerDid!);
    expect(didRecord).not.toBeNull();

    const keyRecord = await issuerKeyRepository.findByAccountId(account.id);
    expect(keyRecord).not.toBeNull();
    expect(keyRecord!.did).toBe(account.issuerDid);
  });

  it('rejects a duplicate email', async () => {
    const { service } = makeService();
    await service.register({ email: 'dup@example.com', password: 'password123' });
    await expect(
      service.register({ email: 'dup@example.com', password: 'different123' }),
    ).rejects.toBeInstanceOf(AccountAlreadyExistsError);
  });
});

describe('AuthService.login', () => {
  it('accepts correct credentials and rejects incorrect ones', async () => {
    const { service } = makeService();
    await service.register({ email: 'bob@example.com', password: 'password123' });

    const { account } = await service.login({ email: 'bob@example.com', password: 'password123' });
    expect(account.email).toBe('bob@example.com');

    await expect(
      service.login({ email: 'bob@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    await expect(
      service.login({ email: 'nobody@example.com', password: 'whatever123' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects password login for a Google-only account', async () => {
    const { service } = makeService();
    await service.loginWithGoogle({
      googleId: 'g-123',
      email: 'google-user@example.com',
      emailVerified: true,
    });

    await expect(
      service.login({ email: 'google-user@example.com', password: 'anything123' }),
    ).rejects.toBeInstanceOf(AccountHasNoPasswordError);
  });
});

describe('AuthService.loginWithGoogle', () => {
  it('links to an existing password account by verified email instead of creating a duplicate', async () => {
    const { service, accountRepository } = makeService();
    const { account: passwordAccount } = await service.register({
      email: 'linked@example.com',
      password: 'password123',
    });

    const { account: googleAccount } = await service.loginWithGoogle({
      googleId: 'g-456',
      email: 'linked@example.com',
      emailVerified: true,
    });

    expect(googleAccount.id).toBe(passwordAccount.id);
    expect(googleAccount.hasGoogle).toBe(true);
    expect(googleAccount.hasPassword).toBe(true);

    const stored = await accountRepository.findById(passwordAccount.id);
    expect(stored!.googleId).toBe('g-456');
  });

  it('creates a new account and provisions a DID when no match exists', async () => {
    const { service } = makeService();
    const { account } = await service.loginWithGoogle({
      googleId: 'g-789',
      email: 'fresh@example.com',
      emailVerified: true,
    });
    expect(account.issuerDid).toBe(`did:web:${DID_DOMAIN}:accounts:${account.id}`);
  });
});

describe('AuthService.refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const { service } = makeService();
    const { tokens } = await service.register({ email: 'rot@example.com', password: 'password123' });

    const rotated = await service.refresh(tokens.refreshToken);
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    expect(rotated.accessToken).not.toBe(tokens.accessToken);

    // The old token is now revoked and must not work again.
    await expect(service.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
      RefreshTokenReuseDetectedError,
    );
  });

  it('reuse detection revokes the entire session chain, including the newest token', async () => {
    const { service } = makeService();
    const { tokens } = await service.register({ email: 'reuse@example.com', password: 'password123' });

    const rotated = await service.refresh(tokens.refreshToken);
    // Presenting the original (already-rotated) token again is reuse.
    await expect(service.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
      RefreshTokenReuseDetectedError,
    );
    // The precaution burns every session for the account, including the
    // legitimately-rotated one.
    await expect(service.refresh(rotated.refreshToken)).rejects.toThrow();
  });
});

describe('AuthService.logout + verifyAccessToken', () => {
  it('logout revokes the refresh token; access tokens verify until they expire', async () => {
    const { service } = makeService();
    const { account, tokens } = await service.register({
      email: 'logout@example.com',
      password: 'password123',
    });

    const verified = service.verifyAccessToken(tokens.accessToken);
    expect(verified.accountId).toBe(account.id);

    await service.logout(tokens.refreshToken);
    await expect(service.refresh(tokens.refreshToken)).rejects.toThrow();
  });
});
