import { AdminAuthRequiredError, AuditEvents, ErrorCode, HelixError, type IAuditLogger } from '@helixid/core';
import type { FastifyPluginAsync } from 'fastify';
import type { AuditLogRepository } from '../../repositories/audit-log.repository.js';

interface AuditLogRouteOptions {
  auditLogRepository: AuditLogRepository;
  auditLogger: IAuditLogger;
  adminApiKey?: string | undefined;
}

interface ListAuditLogQuery {
  eventType?: string;
  since?: string;
  limit?: string;
}

interface RecordVpVerificationBody {
  vpId?: unknown;
  agentDid?: unknown;
  subjectDid?: unknown;
  targetService?: unknown;
  result?: unknown;
  reason?: unknown;
  delegationChain?: unknown;
  delegatedFrom?: unknown;
  delegatedTo?: unknown;
  parentVcId?: unknown;
  delegationDepth?: unknown;
  verifiedAt?: unknown;
  source?: unknown;
}

function requireAdmin(
  adminApiKey: string | undefined,
  request: { headers: Record<string, string | string[] | undefined> },
): void {
  const submitted = request.headers['x-admin-api-key'];
  const submittedKey = Array.isArray(submitted) ? submitted[0] : submitted;
  if (!adminApiKey || submittedKey !== adminApiKey) {
    throw new AdminAuthRequiredError();
  }
}

function normalizeLimit(limit: string | undefined): number {
  if (limit === undefined) return 50;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new HelixError(ErrorCode.VALIDATION_ERROR, 'limit must be an integer between 1 and 500', 400);
  }
  return parsed;
}

function normalizeSince(since: string | undefined): Date | undefined {
  if (!since) return undefined;
  const parsed = new Date(since);
  if (Number.isNaN(parsed.getTime())) {
    throw new HelixError(ErrorCode.VALIDATION_ERROR, 'since must be an ISO timestamp', 400);
  }
  return parsed;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getDelegationParentVcId(payload: Record<string, unknown>): string | undefined {
  const direct = asString(payload.parentVcId);
  if (direct) {
    return direct;
  }

  const delegationChain = payload.delegationChain;
  if (!Array.isArray(delegationChain) || delegationChain.length < 2) {
    return undefined;
  }

  const leafParent = delegationChain[delegationChain.length - 2];
  if (typeof leafParent !== 'object' || leafParent === null) {
    return undefined;
  }

  return asString((leafParent as Record<string, unknown>).vcId);
}

function getDelegatedFrom(payload: Record<string, unknown>): string | undefined {
  const direct = asString(payload.delegatedFrom);
  if (direct) {
    return direct;
  }

  const delegationChain = payload.delegationChain;
  if (!Array.isArray(delegationChain) || delegationChain.length < 2) {
    return undefined;
  }

  const parent = delegationChain[delegationChain.length - 2];
  if (typeof parent !== 'object' || parent === null) {
    return undefined;
  }

  return asString((parent as Record<string, unknown>).subjectDid) ?? asString((parent as Record<string, unknown>).subject);
}

function getDelegatedTo(payload: Record<string, unknown>): string | undefined {
  const direct = asString(payload.delegatedTo);
  if (direct) {
    return direct;
  }

  return asString(payload.subjectDid) ?? asString(payload.agentDid);
}

function getDelegationDepth(payload: Record<string, unknown>): number | undefined {
  const direct = payload.delegationDepth;
  if (typeof direct === 'number' && Number.isInteger(direct) && direct >= 0) {
    return direct;
  }

  const delegationChain = payload.delegationChain;
  if (!Array.isArray(delegationChain)) {
    return undefined;
  }

  return delegationChain.length > 0 ? delegationChain.length - 1 : 0;
}

function isVerificationResult(value: unknown): value is 'success' | 'rejected' {
  return value === 'success' || value === 'rejected';
}

const auditLogRoutes: FastifyPluginAsync<AuditLogRouteOptions> = async (fastify, options) => {
  fastify.post('/vp-verification', async (request, reply) => {
    requireAdmin(options.adminApiKey, request);
    const body = request.body as RecordVpVerificationBody;
    const vpId = asString(body.vpId);
    const agentDid = asString(body.agentDid) ?? asString(body.subjectDid);
    const result = body.result;
    if (!vpId || !agentDid || !isVerificationResult(result)) {
      throw new HelixError(
        ErrorCode.VALIDATION_ERROR,
        'vpId, agentDid, and result must be provided for VP verification audit entries',
        400,
      );
    }

    const timestamp = asString(body.verifiedAt) ?? new Date().toISOString();
    const eventType = result === 'success' ? AuditEvents.VP_VERIFIED : AuditEvents.VP_REJECTED;
    await options.auditLogger.log({
      event: eventType,
      timestamp,
      requestId: request.id,
      vpId,
      agentDid,
      subjectDid: agentDid,
      targetService: asString(body.targetService),
      result,
      reason: asString(body.reason),
      delegationChain: body.delegationChain,
      delegatedFrom: asString(body.delegatedFrom),
      delegatedTo: asString(body.delegatedTo),
      parentVcId: asString(body.parentVcId),
      delegationDepth: typeof body.delegationDepth === 'number' ? body.delegationDepth : undefined,
      source: asString(body.source) ?? 'sdk',
    });

    return reply.status(201).send({ recorded: true, eventType, timestamp });
  });

  fastify.get('', async (request, reply) => {
    requireAdmin(options.adminApiKey, request);
    const query = request.query as ListAuditLogQuery;
    const records = await options.auditLogRepository.list({
      eventType: query.eventType,
      since: normalizeSince(query.since),
      limit: normalizeLimit(query.limit),
    });

    return reply.send(
      records.map((record) => ({
        id: record.id,
        eventType: record.eventType,
        timestamp: record.timestamp.toISOString(),
        subjectDid:
          asString(record.payload.subjectDid) ??
          asString(record.payload.agentDid) ??
          asString(record.payload.did),
        vcId: asString(record.payload.vcId) ?? asString(record.payload.vpId),
        targetService: asString(record.payload.targetService),
        result: asString(record.payload.result),
        delegatedFrom: getDelegatedFrom(record.payload),
        delegatedTo: getDelegatedTo(record.payload),
        parentVcId: getDelegationParentVcId(record.payload),
        delegationDepth: getDelegationDepth(record.payload),
      })),
    );
  });
};

export default auditLogRoutes;
