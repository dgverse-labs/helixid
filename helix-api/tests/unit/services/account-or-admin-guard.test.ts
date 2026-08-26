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

import { describe, it, expect } from 'vitest';
import {
  AdminAuthRequiredError,
  AccountQuotaExceededError,
  EmailNotVerifiedError,
  AuditEvents,
} from '../../../src/core/index.js';
import { resolveAccountOrAdmin } from '../../../src/services/auth/account-or-admin-guard.js';
import { AccountRepository } from '../../../src/repositories/account.repository.js';
import { AuditLogRepository } from '../../../src/repositories/audit-log.repository.js';

const ADMIN_KEY = 'super-secret-admin-key';

function fakeAuthService(accountId: string) {
  return { verifyAccessToken: () => ({ accountId, scope: ['account'] }) };
}

async function makeVerifiedAccount(accountRepository: AccountRepository) {
  const account = await accountRepository.create({
    email: 'guard-test@example.com',
    passwordHash: 'irrelevant',
    googleId: null,
  });
  return accountRepository.markEmailVerified(account.id);
}

describe('resolveAccountOrAdmin', () => {
  it('accepts a valid admin key with no accountId', async () => {
    const accountRepository = new AccountRepository();
    const auditLogRepository = new AuditLogRepository();
    const result = await resolveAccountOrAdmin(
      { headers: { 'x-admin-api-key': ADMIN_KEY } },
      {
        authService: fakeAuthService('unused') as never,
        accountRepository,
        auditLogRepository,
        adminApiKey: ADMIN_KEY,
      },
      { requireAuth: true },
    );
    expect(result.accountId).toBeUndefined();
  });

  it('accepts a verified account bearer token and returns its accountId', async () => {
    const accountRepository = new AccountRepository();
    const auditLogRepository = new AuditLogRepository();
    const account = await makeVerifiedAccount(accountRepository);

    const result = await resolveAccountOrAdmin(
      { headers: { authorization: 'Bearer whatever-the-token-is' } },
      {
        authService: fakeAuthService(account.id) as never,
        accountRepository,
        auditLogRepository,
        adminApiKey: ADMIN_KEY,
      },
      { requireAuth: true },
    );
    expect(result.accountId).toBe(account.id);
  });

  it('rejects an unverified account with EmailNotVerifiedError', async () => {
    const accountRepository = new AccountRepository();
    const auditLogRepository = new AuditLogRepository();
    const account = await accountRepository.create({
      email: 'unverified@example.com',
      passwordHash: 'irrelevant',
      googleId: null,
    });

    await expect(
      resolveAccountOrAdmin(
        { headers: { authorization: 'Bearer token' } },
        {
          authService: fakeAuthService(account.id) as never,
          accountRepository,
          auditLogRepository,
          adminApiKey: ADMIN_KEY,
        },
        { requireAuth: true },
      ),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it('rejects a verified account over its daily quota', async () => {
    const accountRepository = new AccountRepository();
    const auditLogRepository = new AuditLogRepository();
    const account = await makeVerifiedAccount(accountRepository);

    // Simulate having already issued 2 VCs today under a quota of 2.
    (auditLogRepository as unknown as { list: () => Promise<unknown[]> }).list = async () => [
      { payload: { accountId: account.id } },
      { payload: { accountId: account.id } },
    ];

    await expect(
      resolveAccountOrAdmin(
        { headers: { authorization: 'Bearer token' } },
        {
          authService: fakeAuthService(account.id) as never,
          accountRepository,
          auditLogRepository,
          adminApiKey: ADMIN_KEY,
        },
        { requireAuth: true, quota: { eventType: AuditEvents.VC_ISSUED, dailyLimit: 2 } },
      ),
    ).rejects.toBeInstanceOf(AccountQuotaExceededError);
  });

  it('throws AdminAuthRequiredError with neither credential when requireAuth is true', async () => {
    const accountRepository = new AccountRepository();
    const auditLogRepository = new AuditLogRepository();
    await expect(
      resolveAccountOrAdmin(
        { headers: {} },
        {
          authService: fakeAuthService('unused') as never,
          accountRepository,
          auditLogRepository,
          adminApiKey: ADMIN_KEY,
        },
        { requireAuth: true },
      ),
    ).rejects.toBeInstanceOf(AdminAuthRequiredError);
  });

  it('preserves the pre-existing open (no-auth) behavior when requireAuth is false', async () => {
    const accountRepository = new AccountRepository();
    const auditLogRepository = new AuditLogRepository();
    const result = await resolveAccountOrAdmin(
      { headers: {} },
      {
        authService: fakeAuthService('unused') as never,
        accountRepository,
        auditLogRepository,
        adminApiKey: ADMIN_KEY,
      },
      { requireAuth: false },
    );
    expect(result.accountId).toBeUndefined();
  });
});
