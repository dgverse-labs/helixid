// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { FastifyPluginAsync } from 'fastify';
import { AdminAuthRequiredError, AuditEvents, ErrorCode, HelixError } from '@helixid/core';
import type { AuditLogRepository } from '../../repositories/audit-log.repository.js';

export interface AuditRouteOptions {
  auditLogRepository: AuditLogRepository;
  adminApiKey?: string | undefined;
}

export interface AuditLogEntry {
  id: string;
  eventType: string;
  timestamp: string;
  subjectDid?: string;
  vcId?: string;
  targetService?: string;
  result?: string;
}

// The Console-facing contract (dev spec §4.2) uses lowercase event names,
// while the audit store keeps the canonical UPPER_SNAKE AuditEvents values.
// These four have explicit public names; everything else is exposed as the
// lowercased canonical name.
const PUBLIC_TO_CANONICAL: Record<string, string> = {
  vc_issued: AuditEvents.VC_ISSUED,
  vc_revoked: AuditEvents.VC_REVOKED,
  vp_verified: AuditEvents.VP_VERIFIED,
  onboarding_complete: AuditEvents.AGENT_ONBOARDED,
};

const CANONICAL_TO_PUBLIC: Record<string, string> = Object.fromEntries(
  Object.entries(PUBLIC_TO_CANONICAL).map(([publicName, canonical]) => [canonical, publicName]),
);

const CANONICAL_EVENT_TYPES = new Set<string>(Object.values(AuditEvents));

function toCanonicalEventType(eventType: string): string | null {
  if (PUBLIC_TO_CANONICAL[eventType]) return PUBLIC_TO_CANONICAL[eventType];
  if (CANONICAL_EVENT_TYPES.has(eventType)) return eventType;
  return null;
}

function toPublicEventType(eventType: string): string {
  return CANONICAL_TO_PUBLIC[eventType] ?? eventType.toLowerCase();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const auditRoutes: FastifyPluginAsync<AuditRouteOptions> = async (fastify, options) => {
  const { auditLogRepository, adminApiKey } = options;

  function requireAdmin(request: { headers: Record<string, string | string[] | undefined> }): void {
    const submitted = request.headers['x-admin-api-key'];
    const submittedKey = Array.isArray(submitted) ? submitted[0] : submitted;
    if (!adminApiKey || submittedKey !== adminApiKey) {
      throw new AdminAuthRequiredError();
    }
  }

  // GET /v1/audit-log - List audit events, newest first
  fastify.get('', async (request, reply) => {
    requireAdmin(request);
    const query = request.query as { eventType?: string; since?: string; limit?: string };

    let eventType: string | undefined;
    if (query.eventType !== undefined) {
      const canonical = toCanonicalEventType(query.eventType);
      if (!canonical) {
        throw new HelixError(
          ErrorCode.VALIDATION_ERROR,
          `Unknown eventType: ${query.eventType}`,
          400,
        );
      }
      eventType = canonical;
    }

    let since: Date | undefined;
    if (query.since !== undefined) {
      since = new Date(query.since);
      if (Number.isNaN(since.getTime())) {
        throw new HelixError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid since timestamp: ${query.since}`,
          400,
        );
      }
    }

    const limit = query.limit === undefined ? 50 : Number.parseInt(query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) {
      throw new HelixError(ErrorCode.VALIDATION_ERROR, `Invalid limit: ${query.limit}`, 400);
    }

    const records = await auditLogRepository.findMany({ eventType, since, limit });
    const entries = records.map((record): AuditLogEntry => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(record.payloadJson) as Record<string, unknown>;
      } catch {
        // Tolerate malformed rows rather than failing the whole listing.
      }
      const subjectDid = asString(payload.subjectDid) ?? asString(payload.agentDid);
      const vcId = asString(payload.vcId);
      const targetService = asString(payload.targetService);
      const result = asString(payload.result);
      return {
        id: record.id,
        eventType: toPublicEventType(record.eventType),
        timestamp: record.timestamp,
        ...(subjectDid ? { subjectDid } : {}),
        ...(vcId ? { vcId } : {}),
        ...(targetService ? { targetService } : {}),
        ...(result ? { result } : {}),
      };
    });
    return reply.send(entries);
  });
};

export default auditRoutes;
