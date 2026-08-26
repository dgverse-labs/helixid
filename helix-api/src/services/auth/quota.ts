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
// See docs/proposal-hosted-rate-limiting.md ("Per-account quotas") — locked
// values: VC issuance 1000/day, enrollment token generation 2000/day.
// Counts existing audit log rows for the account in a rolling 24h window;
// no new logging infrastructure needed, since VC_ISSUED and
// ENROLLMENT_TOKEN_GENERATED are already audited.
//
// NOTE: this only enforces anything once VC issuance and enrollment-token
// routes are made account-aware (i.e. authenticated by a hosted-account
// bearer token that carries accountId, and that accountId is recorded in
// the audit payload for those events). That wiring doesn't exist yet — see
// the call sites this is intentionally NOT yet wired into.

import { AccountQuotaExceededError, AuditEvents, type AuditEventType } from '../../core/index.js';
import type { AuditLogRepository } from '../../repositories/audit-log.repository.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface QuotaCheckOptions {
  auditLogRepository: AuditLogRepository;
  accountId: string;
  eventType: AuditEventType;
  dailyLimit: number;
}

/**
 * Throws AccountQuotaExceededError if the account has hit its daily limit
 * for the given event type. Fetches a generous window and filters/counts
 * by accountId in the payload — the audit log has no accountId column of
 * its own, so this is a scan rather than an indexed count. Fine at
 * current expected volumes (low thousands/day/account); revisit with a
 * dedicated counter table if the audit log grows large enough to make
 * this slow.
 */
export async function assertUnderDailyQuota(options: QuotaCheckOptions): Promise<void> {
  const { auditLogRepository, accountId, eventType, dailyLimit } = options;
  const since = new Date(Date.now() - ONE_DAY_MS);

  const rows = await auditLogRepository.list({ eventType, since, limit: 100_000 });
  const countForAccount = rows.filter((row) => row.payload.accountId === accountId).length;

  if (countForAccount >= dailyLimit) {
    throw new AccountQuotaExceededError(
      `Daily limit of ${dailyLimit} for ${eventType} reached for this account. Try again after ${new Date(
        Date.now() + ONE_DAY_MS,
      ).toISOString()}.`,
    );
  }
}

export async function assertUnderVcIssuanceQuota(
  auditLogRepository: AuditLogRepository,
  accountId: string,
  dailyLimit: number,
): Promise<void> {
  return assertUnderDailyQuota({
    auditLogRepository,
    accountId,
    eventType: AuditEvents.VC_ISSUED,
    dailyLimit,
  });
}

export async function assertUnderEnrollmentTokenQuota(
  auditLogRepository: AuditLogRepository,
  accountId: string,
  dailyLimit: number,
): Promise<void> {
  return assertUnderDailyQuota({
    auditLogRepository,
    accountId,
    eventType: AuditEvents.ENROLLMENT_TOKEN_GENERATED,
    dailyLimit,
  });
}
