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
// Shared guard for routes that both the self-hosted operator (admin key)
// and hosted end-user accounts (bearer access token) can call — currently
// VC issuance and enrollment-token generation. See
// docs/proposal-hosted-rate-limiting.md ("Per-account quotas") and
// proposal-hosted-instance.md.
//
// - Admin key present and valid -> operator call. No accountId, no quota,
//   no email-verification gate (matches pre-hosted behavior exactly).
// - Bearer token present and valid -> hosted-account call. Must be
//   email-verified, must be under its daily quota for this event type.
//   Returns the accountId so the caller can tag the resulting audit log
//   row (that's what makes quota counting possible next time).
// - Neither present -> same "no auth" behavior the route had before this
//   guard existed (some routes, like enrollment-token generation, were
//   previously open with no gate at all; this guard preserves that when
//   `adminApiKey` is unset and no bearer token is given).

import {
  AdminAuthRequiredError,
  EmailNotVerifiedError,
  type AuditEventType,
} from '../../core/index.js';
import type { AccountRepository } from '../../repositories/account.repository.js';
import type { AuditLogRepository } from '../../repositories/audit-log.repository.js';
import type { IAuthService } from './IAuthService.js';
import { assertUnderDailyQuota } from './quota.js';

export interface AccountOrAdminGuardDeps {
  authService: IAuthService;
  accountRepository: AccountRepository;
  auditLogRepository: AuditLogRepository;
  adminApiKey?: string | undefined;
}

export interface AccountOrAdminGuardResult {
  /** Set only for a hosted-account bearer-token call; undefined for the operator admin key or no-auth. */
  accountId?: string | undefined;
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolves the caller as operator (admin key), a hosted account (bearer
 * token — additionally quota- and verification-gated if `quota` is given),
 * or unauthenticated. Throws AdminAuthRequiredError only when
 * `requireAuth` is true and neither credential is present/valid —
 * routes that were previously open with no gate at all should pass
 * `requireAuth: false` to preserve that.
 */
export async function resolveAccountOrAdmin(
  request: { headers: Record<string, string | string[] | undefined> },
  deps: AccountOrAdminGuardDeps,
  options: {
    requireAuth: boolean;
    quota?: { eventType: AuditEventType; dailyLimit: number } | undefined;
  },
): Promise<AccountOrAdminGuardResult> {
  const adminKeyHeader = getHeader(request.headers, 'x-admin-api-key');
  if (deps.adminApiKey && adminKeyHeader === deps.adminApiKey) {
    return {};
  }

  const authHeader = getHeader(request.headers, 'authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (bearerToken) {
    const { accountId } = deps.authService.verifyAccessToken(bearerToken);

    const account = await deps.accountRepository.findById(accountId);
    if (!account?.emailVerifiedAt) {
      throw new EmailNotVerifiedError();
    }

    if (options.quota) {
      await assertUnderDailyQuota({
        auditLogRepository: deps.auditLogRepository,
        accountId,
        eventType: options.quota.eventType,
        dailyLimit: options.quota.dailyLimit,
      });
    }

    return { accountId };
  }

  if (options.requireAuth) {
    throw new AdminAuthRequiredError();
  }

  return {};
}
