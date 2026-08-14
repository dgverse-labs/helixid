import {
  AdminAuthRequiredError,
  AuditEvents,
  ErrorCode,
  HelixError,
  type AuditEventType,
  type IAuditLogger,
} from '@helixid/core';
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
  // Rejection-path correlation context, read off the raw unverified VP by the
  // caller. Kept distinct from the verified delegation fields above so an
  // unverified claim can never be mistaken for a verified one.
  attemptedVcId?: unknown;
  attemptedParentVcId?: unknown;
  attemptedDelegatedFrom?: unknown;
  verifiedAt?: unknown;
  source?: unknown;
}

interface RecordConsentGrantedBody {
  vcId?: unknown;
  agentDid?: unknown;
  issuer?: unknown;
  userDid?: unknown;
  scopes?: unknown;
  durability?: unknown;
  grantedAt?: unknown;
  source?: unknown;
}

/**
 * Event types accepted by the generic ingestion route. An allowlist rather than
 * "any string" so an emitter cannot invent event names that downstream queries
 * and compliance reports would silently miss.
 */
const INGESTIBLE_EVENTS = new Set<AuditEventType>([
  AuditEvents.VC_ISSUED,
  AuditEvents.VC_PRESENTED,
  AuditEvents.VP_VERIFIED,
  AuditEvents.VP_REJECTED,
  AuditEvents.AUTHZ_GRANTED,
  AuditEvents.AUTHZ_DENIED,
  AuditEvents.TOOL_INVOKED,
  AuditEvents.CONSENT_GRANTED,
  AuditEvents.CONSENT_REVOKED,
]);

/**
 * The shared activity-trail envelope. Every field is optional except the event
 * type and a subject, because a single shape has to describe issuance,
 * presentation, verification, authorization and invocation — but the *names*
 * are fixed, which is what makes the trail queryable after the fact.
 */
interface RecordActivityEventBody {
  event?: unknown;
  timestamp?: unknown;
  correlationId?: unknown;
  agentDid?: unknown;
  userDid?: unknown;
  vcId?: unknown;
  credentialType?: unknown;
  issuer?: unknown;
  scopes?: unknown;
  validUntil?: unknown;
  credentialStatus?: unknown;
  serviceDid?: unknown;
  serviceName?: unknown;
  toolName?: unknown;
  requiredScope?: unknown;
  effectiveScopes?: unknown;
  vpId?: unknown;
  result?: unknown;
  reason?: unknown;
  resultSummary?: unknown;
  source?: unknown;
}

function isIngestibleEvent(value: string | undefined): value is AuditEventType {
  return value !== undefined && INGESTIBLE_EVENTS.has(value as AuditEventType);
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
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
      attemptedVcId: asString(body.attemptedVcId),
      attemptedParentVcId: asString(body.attemptedParentVcId),
      attemptedDelegatedFrom: asString(body.attemptedDelegatedFrom),
      source: asString(body.source) ?? 'sdk',
    });

    return reply.status(201).send({ recorded: true, eventType, timestamp });
  });

  // Agent-side consent grants (spec §2a). The agent has first-hand knowledge the
  // moment it stores the grant VC, and already knows this API's URL — so it
  // posts here directly, mirroring /vp-verification above.
  fastify.post('/consent-granted', async (request, reply) => {
    requireAdmin(options.adminApiKey, request);
    const body = request.body as RecordConsentGrantedBody;
    const vcId = asString(body.vcId);
    const agentDid = asString(body.agentDid);
    if (!vcId || !agentDid) {
      throw new HelixError(
        ErrorCode.VALIDATION_ERROR,
        'vcId and agentDid must be provided for consent audit entries',
        400,
      );
    }

    const timestamp = asString(body.grantedAt) ?? new Date().toISOString();
    await options.auditLogger.log({
      event: AuditEvents.CONSENT_GRANTED,
      timestamp,
      requestId: request.id,
      vcId,
      agentDid,
      subjectDid: agentDid,
      issuer: asString(body.issuer),
      userDid: asString(body.userDid),
      scopes: Array.isArray(body.scopes)
        ? body.scopes.filter((scope): scope is string => typeof scope === 'string')
        : undefined,
      durability: asString(body.durability),
      source: asString(body.source) ?? 'sdk',
    });

    return reply.status(201).send({ recorded: true, eventType: AuditEvents.CONSENT_GRANTED, timestamp });
  });

  // Generic activity-trail ingestion. Service Providers and agents both post
  // here; one route with a fixed envelope rather than a bespoke route per event
  // kind, so new event types cost nothing on the API side.
  fastify.post('/events', async (request, reply) => {
    requireAdmin(options.adminApiKey, request);
    const body = request.body as RecordActivityEventBody;
    const event = asString(body.event);
    if (!isIngestibleEvent(event)) {
      throw new HelixError(
        ErrorCode.VALIDATION_ERROR,
        `event must be one of: ${[...INGESTIBLE_EVENTS].sort().join(', ')}`,
        400,
      );
    }

    const agentDid = asString(body.agentDid);
    const serviceDid = asString(body.serviceDid);
    if (!agentDid && !serviceDid) {
      throw new HelixError(
        ErrorCode.VALIDATION_ERROR,
        'at least one of agentDid or serviceDid must be provided',
        400,
      );
    }

    const timestamp = asString(body.timestamp) ?? new Date().toISOString();
    await options.auditLogger.log({
      event,
      timestamp,
      requestId: request.id,
      correlationId: asString(body.correlationId),
      agentDid,
      // Keeps the agent the queryable subject where there is one, so activity
      // rows line up with the DID-keyed events the rest of the log already has.
      subjectDid: agentDid ?? serviceDid,
      userDid: asString(body.userDid),
      vcId: asString(body.vcId),
      credentialType: asString(body.credentialType),
      issuer: asString(body.issuer),
      scopes: asStringArray(body.scopes),
      validUntil: asString(body.validUntil),
      credentialStatus: asString(body.credentialStatus),
      serviceDid,
      serviceName: asString(body.serviceName),
      targetService: serviceDid,
      toolName: asString(body.toolName),
      requiredScope: asString(body.requiredScope),
      effectiveScopes: asStringArray(body.effectiveScopes),
      vpId: asString(body.vpId),
      result: asString(body.result),
      reason: asString(body.reason),
      resultSummary: asString(body.resultSummary),
      source: asString(body.source) ?? 'service',
    });

    return reply.status(201).send({ recorded: true, eventType: event, timestamp });
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
        // Unverified rejection context — deliberately not merged into the
        // verified delegation fields above.
        attemptedVcId: asString(record.payload.attemptedVcId),
        attemptedParentVcId: asString(record.payload.attemptedParentVcId),
        attemptedDelegatedFrom: asString(record.payload.attemptedDelegatedFrom),
        // Consent-grant fields (CONSENT_GRANTED).
        issuer: asString(record.payload.issuer),
        userDid: asString(record.payload.userDid),
        scopes: asStringArray(record.payload.scopes),
        durability: asString(record.payload.durability),
        // Activity-trail fields (VC_PRESENTED, AUTHZ_*, TOOL_INVOKED).
        correlationId: asString(record.payload.correlationId),
        credentialType: asString(record.payload.credentialType),
        validUntil: asString(record.payload.validUntil),
        credentialStatus: asString(record.payload.credentialStatus),
        serviceDid: asString(record.payload.serviceDid),
        serviceName: asString(record.payload.serviceName),
        toolName: asString(record.payload.toolName),
        requiredScope: asString(record.payload.requiredScope),
        effectiveScopes: asStringArray(record.payload.effectiveScopes),
        reason: asString(record.payload.reason) ?? asString(record.payload.internalReason),
        resultSummary: asString(record.payload.resultSummary),
      })),
    );
  });
};

export default auditLogRoutes;
