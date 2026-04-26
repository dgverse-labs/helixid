import { randomBytes } from 'node:crypto';
import {
  AuditEvents,
  ErrorCodes,
  VPAgentDIDNotFoundError,
  VPAlreadyConsumedError,
  VPExpiredError,
  VPInvalidStructureError,
  VPMultipleActiveVCError,
  VPNoActiveVCError,
  VPNotFoundError,
  VPVerificationFailedError,
  base58btcDecode,
  hashCanonicalPayload,
  signedVPSchema,
  verifySignature,
  type IAuditLogger,
  type SignedVP
} from '@helix-id/core';
import type { IDIDService } from '../did/IDIDService.js';
import type { IVCService } from '../vc/IVCService.js';
import type { VPRepository } from '../../repositories/vp.repository.js';
import { ServiceNotFoundError, type ServiceRegistryRepository } from './ServiceRegistryRepository.js';
import type { IVPService, VPTemplateParams, VPTemplateResult, VPVerificationResult } from './IVPService.js';

function makeVpId(): string {
  return `vp:helix:${randomBytes(12).toString('hex')}`;
}

function extractPublicKeyHex(doc: Awaited<ReturnType<IDIDService['resolveDID']>>): string {
  const method = doc.verificationMethod?.find((item) => item.type.includes('Ed25519'));
  if (!method) {
    throw new VPAgentDIDNotFoundError();
  }
  if (method.publicKeyHex) {
    return method.publicKeyHex;
  }
  if (method.publicKeyMultibase?.startsWith('z')) {
    return Buffer.from(base58btcDecode(method.publicKeyMultibase.slice(1))).toString('hex');
  }
  throw new VPAgentDIDNotFoundError();
}

export class VPService implements IVPService {
  constructor(
    private readonly vpRepository: VPRepository,
    private readonly didService: IDIDService,
    private readonly vcService: IVCService,
    private readonly serviceRegistry: ServiceRegistryRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly vpTtlSeconds = 300
  ) {}

  async generateVPTemplate(params: VPTemplateParams, requestId: string): Promise<VPTemplateResult> {
    try {
      await this.didService.resolveDID(params.agentDid);
    } catch {
      throw new VPAgentDIDNotFoundError();
    }

    const activeVC = await this.vcService.findActiveBySubjectDid(params.agentDid, params.vcType);
    if (!activeVC) {
      throw new VPNoActiveVCError();
    }

    await this.serviceRegistry.assertExists(params.targetService);

    const vpId = makeVpId();
    const expiresAt = new Date(Date.now() + this.vpTtlSeconds * 1000);
    const unsignedVP = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      id: vpId,
      holder: params.agentDid,
      verifiableCredential: [activeVC],
      nonce: randomBytes(32).toString('hex'),
      expirationDate: expiresAt.toISOString(),
      delegatedBy: params.userDid,
      targetService: params.targetService
    };

    await this.vpRepository.create({
      vpId,
      agentDid: params.agentDid,
      userDid: params.userDid,
      targetService: params.targetService,
      expiresAt
    });

    this.auditLogger.log(AuditEvents.VP_TEMPLATE_ISSUED, {
      requestId,
      vpId,
      agentDid: params.agentDid,
      userDid: params.userDid,
      targetService: params.targetService,
      expiresAt: expiresAt.toISOString()
    });

    return { unsignedVP, vpId, expiresAt: expiresAt.toISOString() };
  }

  async verifyVP(signedVP: SignedVP, requestId: string): Promise<VPVerificationResult> {
    let vpId = 'unknown';
    try {
      const parsed = signedVPSchema.safeParse(signedVP);
      if (!parsed.success) {
        throw new VPInvalidStructureError();
      }

      vpId = parsed.data.id;
      const record = await this.vpRepository.findByVpId(vpId);
      if (!record) {
        throw new VPNotFoundError();
      }
      if (record.consumedAt) {
        throw new VPAlreadyConsumedError();
      }
      if (record.expiresAt.getTime() <= Date.now()) {
        throw new VPExpiredError();
      }

      let didDocument;
      try {
        didDocument = await this.didService.resolveDID(parsed.data.holder);
      } catch {
        throw new VPAgentDIDNotFoundError();
      }

      const publicKeyHex = extractPublicKeyHex(didDocument);
      const { proof, ...payloadWithoutProof } = parsed.data;
      const hash = hashCanonicalPayload(payloadWithoutProof);
      const proofBytes = base58btcDecode(proof.proofValue);
      const signatureHex = Buffer.from(proofBytes).toString('hex');
      const validSignature = await verifySignature(hash, signatureHex, publicKeyHex);
      if (!validSignature) {
        throw new Error('signature_invalid');
      }

      const vc = parsed.data.verifiableCredential[0] as { id?: string; expirationDate?: string };
      if (vc.expirationDate && new Date(vc.expirationDate).getTime() <= Date.now()) {
        throw new Error('vc_expired');
      }
      if (!vc.id) {
        throw new VPInvalidStructureError('Missing VC id');
      }

      const status = await this.vcService.getVCStatus(vc.id);
      if (status === 'revoked') {
        throw new Error('vc_revoked');
      }
      if (status === 'expired') {
        throw new Error('vc_expired');
      }

      const consumed = await this.vpRepository.consumeAtomically(vpId);
      if (!consumed) {
        throw new VPAlreadyConsumedError();
      }

      const verifiedAt = new Date().toISOString();
      this.auditLogger.log(AuditEvents.VP_VERIFIED, {
        requestId,
        vpId,
        agentDid: parsed.data.holder,
        result: 'success',
        verifiedAt
      });

      return {
        valid: true,
        agentDid: record.agentDid,
        userDid: record.userDid,
        targetService: record.targetService,
        verifiedAt
      };
    } catch (error) {
      const internalReason =
        error instanceof Error && 'code' in error ? String((error as { code?: string }).code) : String(error);
      this.auditLogger.log(AuditEvents.VP_REJECTED, {
        requestId,
        vpId,
        internalReason,
        timestamp: new Date().toISOString()
      });
      if (error instanceof ServiceNotFoundError) {
        throw error;
      }
      throw new VPVerificationFailedError();
    }
  }
}

export function mapErrorToResponse(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof VPAgentDIDNotFoundError || error instanceof VPNoActiveVCError || error instanceof VPMultipleActiveVCError) {
    return { statusCode: error.httpStatus, code: error.code, message: error.message };
  }
  if (error instanceof ServiceNotFoundError) {
    return { statusCode: 404, code: ErrorCodes.SERVICE_NOT_FOUND, message: error.message };
  }
  if (error instanceof VPVerificationFailedError) {
    return { statusCode: 400, code: error.code, message: error.message };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}
