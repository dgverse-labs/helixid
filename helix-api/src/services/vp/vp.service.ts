import { randomBytes } from 'node:crypto';
import {
  AuditEvents,
  HelixError,
  VPInvalidStructureError,
  VPVerificationFailedError,
  fetchStatusList,
  issueJWT,
  signedVPSchema,
  verifyVP as verifyVPCore,
  type HelixJWTPayload,
  type IAuditLogger,
  type SignedVP,
  type StatusListCredential,
  type StatusListResolver,
  type VerifyVPResult,
} from '@helixid/core';
import type { IVCService } from '../vc/IVCService.js';
import type { IVPService, VPVerificationResult } from './IVPService.js';

type HelixHttpErrorLike = {
  code: string;
  httpStatus: number;
  message: string;
};

interface JWTSessionOptions {
  signingKey: string;
  issuerDid: string;
  ttlSeconds: number;
}

interface AttemptedVPContext {
  attemptedVcId?: string;
  attemptedParentVcId?: string;
  attemptedDelegatedFrom?: string;
}

/**
 * Pulls identifying fields off the raw, unverified VP so a rejection can still
 * be correlated to the credential that caused it. Read from the request payload
 * rather than the parsed VP on purpose: rejection can happen at schema parsing,
 * before a parsed value exists. Nothing here is validated or trusted — every
 * read is guarded so a malformed VP yields no fields instead of throwing out of
 * the rejection audit.
 */
function readAttemptedVPContext(signedVP: SignedVP): AttemptedVPContext {
  const context: AttemptedVPContext = {};
  try {
    const credential = signedVP?.verifiableCredential?.[0] as Record<string, unknown> | undefined;
    const subject = credential?.['credentialSubject'] as Record<string, unknown> | undefined;
    const vcId = credential?.['id'];
    if (typeof vcId === 'string') context.attemptedVcId = vcId;
    const parentVcId = subject?.['parentVcId'];
    if (typeof parentVcId === 'string') context.attemptedParentVcId = parentVcId;
    const delegatedFrom = subject?.['delegatedFrom'];
    if (typeof delegatedFrom === 'string') context.attemptedDelegatedFrom = delegatedFrom;
  } catch {
    // Correlation fields are optional by design; a garbage VP just yields none.
  }
  return context;
}

export class VPService implements IVPService {
  private readonly statusListResolver: StatusListResolver;

  constructor(
    private readonly vcService: IVCService,
    private readonly auditLogger: IAuditLogger,
    apiBaseUrl: string,
    private readonly jwtSessionOptions?: JWTSessionOptions,
  ) {
    // §4.3 local-repo fast path: this API's own hosted lists are read straight
    // from the repository; everything else (SP-hosted lists included) goes
    // over HTTP exactly like any other verifier. Either way the result still
    // passes core's schema validation before getBit() — the fast path changes
    // how the bytes are obtained, not whether they're validated.
    const ownListPrefix = `${apiBaseUrl.replace(/\/$/, '')}/v1/status-list/`;
    this.statusListResolver = async (statusListUrl: string): Promise<StatusListCredential> => {
      if (statusListUrl.startsWith(ownListPrefix)) {
        const listId = decodeURIComponent(
          statusListUrl.slice(ownListPrefix.length).split(/[#?]/, 1)[0] ?? '',
        );
        return (await this.vcService.getStatusList(listId)) as StatusListCredential;
      }
      return fetchStatusList(statusListUrl);
    };
  }

  async verifyVP(
    signedVP: SignedVP,
    requestId: string,
    options: { issueSession?: boolean; expectedTargetService?: string; allowSelfSigned?: boolean } = {},
  ): Promise<VPVerificationResult> {
    let vpId = 'unknown';
    try {
      const parsed = signedVPSchema.safeParse(signedVP);
      if (!parsed.success) {
        throw new VPInvalidStructureError();
      }
      vpId = parsed.data.id;

      // Single verification implementation (§2.1): everything — VP checks,
      // credential checks, embedded delegation-chain walk, grant matching,
      // revocation — happens inside core's verifyVP().
      const result: VerifyVPResult = await verifyVPCore(parsed.data as SignedVP, {
        statusListResolver: this.statusListResolver,
        ...(options.expectedTargetService !== undefined
          ? { expectedTargetService: options.expectedTargetService }
          : {}),
        ...(options.allowSelfSigned !== undefined
          ? { allowSelfSigned: options.allowSelfSigned }
          : {}),
      });

      const verifiedAt = new Date().toISOString();
      // §7.3: exactly one VP_VERIFIED event after the core call returns — no
      // mid-verification chain-walk events.
      const chainLeaf = result.delegationChain.at(-1);
      const chainParent = result.delegationChain.at(-2);
      this.auditLogger.log(AuditEvents.VP_VERIFIED, {
        requestId,
        vpId,
        agentDid: result.agentDid,
        result: 'success',
        verifiedAt,
        delegatedFrom: chainParent?.subject,
        delegatedTo: result.delegationChain.length > 1 ? chainLeaf?.subject : undefined,
        delegationDepth: chainLeaf?.delegationDepth,
        ...(result.delegationChain.length > 1
          ? {
              delegationChain: result.delegationChain.map((link) => ({
                vcId: link.vcId,
                issuer: link.issuer,
                subjectDid: link.subject,
                delegationDepth: link.delegationDepth,
              })),
            }
          : {}),
      });

      const response: VPVerificationResult = {
        valid: true,
        agentDid: result.agentDid,
        targetService: parsed.data.targetService,
        verifiedAt,
        privilegeScopes: result.privilegeScopes,
        effectiveScopes: result.effectiveScopes,
        vpId: result.vpId,
        delegationChain: result.delegationChain,
        ...(result.warning !== undefined ? { warning: result.warning } : {}),
      };
      if (parsed.data.delegatedBy !== undefined) {
        response.userDid = parsed.data.delegatedBy;
      }

      if (options.issueSession) {
        if (!this.jwtSessionOptions) {
          throw new Error('jwt_session_not_configured');
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAtSeconds = nowSeconds + this.jwtSessionOptions.ttlSeconds;
        const payload: HelixJWTPayload = {
          iss: this.jwtSessionOptions.issuerDid,
          sub: result.agentDid,
          iat: nowSeconds,
          exp: expiresAtSeconds,
          jti: `jwt:${randomBytes(16).toString('hex')}`,
          userDid: parsed.data.delegatedBy ?? result.agentDid,
          targetService: parsed.data.targetService,
          // §2.7 / §9.4 A2: the session carries enforcement scopes — the grant
          // intersection when a grant was presented, not the raw VC scopes.
          scopes: result.effectiveScopes,
          vpId,
        };
        const token = issueJWT(payload, this.jwtSessionOptions.signingKey);
        const sessionExpiresAt = new Date(expiresAtSeconds * 1000).toISOString();
        this.auditLogger.log(AuditEvents.JWT_ISSUED, {
          requestId,
          jti: payload.jti,
          agentDid: payload.sub,
          userDid: payload.userDid,
          targetService: payload.targetService,
          vpId,
          expiresAt: sessionExpiresAt,
        });
        response.session = {
          token,
          expiresAt: sessionExpiresAt,
          publicKeyEndpoint: '/v1/sessions/public-key',
        };
      }

      return response;
    } catch (error) {
      const internalReason =
        error instanceof Error
          ? `${error.message}${'code' in error ? ` [code=${(error as { code?: string }).code}]` : ''}`
          : String(error);
      // §7.3: exactly one VP_REJECTED event with the failure reason.
      this.auditLogger.log(AuditEvents.VP_REJECTED, {
        requestId,
        vpId,
        internalReason,
        ...readAttemptedVPContext(signedVP),
        timestamp: new Date().toISOString(),
      });
      // Preserve the specific failure (expired, revoked, signature invalid,
      // wrong target service, etc.) for the caller — parity with local
      // verifyVP(), which throws these directly. Only genuinely unexpected
      // (non-HelixError) failures collapse to the generic error, so we don't
      // leak internals we don't recognize as a stable, intentional error type.
      if (error instanceof HelixError) {
        throw error;
      }
      throw new VPVerificationFailedError();
    }
  }
}

export function mapErrorToResponse(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error && typeof error === 'object' && 'code' in error && 'httpStatus' in error) {
    const typed = error as HelixHttpErrorLike;
    return { statusCode: typed.httpStatus, code: typed.code, message: typed.message };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}
