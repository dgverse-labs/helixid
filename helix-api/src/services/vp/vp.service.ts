import { randomBytes } from 'node:crypto';
import {
  AuditEvents,
  ErrorCodes,
  VPAgentDIDNotFoundError,
  VPAlreadyConsumedError,
  VPExpiredError,
  VPInvalidStructureError,
  VPNoActiveVCError,
  VPNotFoundError,
  VPVerificationFailedError,
  VCSignatureInvalidError,
  VCExpiredError,
  VCRevokedError,
  VCIssuerNotFoundError,
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
import { ServiceNotFoundError, type ServiceRegistryRepository } from '../../repositories/service-registry.repository.js';
import type { IVPService, VPTemplateParams, VPTemplateResult, VPVerificationResult } from './IVPService.js';

type DIDVerificationMethodLike = {
  type?: unknown;
  publicKeyHex?: unknown;
  publicKeyMultibase?: unknown;
};

type DIDDocumentLike = {
  verificationMethod?: DIDVerificationMethodLike[];
};

type DIDResolveLike = DIDDocumentLike & {
  document?: DIDDocumentLike;
  didDocument?: DIDDocumentLike;
};

type HelixHttpErrorLike = {
  code: string;
  httpStatus: number;
  message: string;
};

function makeVpId(): string {
  return `vp:helix:${randomBytes(12).toString('hex')}`;
}

function extractPublicKeyHex(doc: Awaited<ReturnType<IDIDService['resolveDID']>>): string {
  const wrapped = doc as DIDResolveLike;
  const document = wrapped.document ?? wrapped.didDocument ?? wrapped;
  const method = document.verificationMethod?.find(
    (item) => typeof item.type === 'string' && item.type.includes('Ed25519'),
  );
  if (!method) {
    throw new VPAgentDIDNotFoundError();
  }
  if (typeof method.publicKeyHex === 'string') {
    return method.publicKeyHex;
  }
  if (typeof method.publicKeyMultibase === 'string' && method.publicKeyMultibase.startsWith('z')) {
    const decoded = base58btcDecode(method.publicKeyMultibase.slice(1));
    return Buffer.from(decoded.slice(2)).toString('hex');
  }
  throw new VPAgentDIDNotFoundError();
}

function decodeBase58ProofValue(proofValue: string): Uint8Array {
  const rawProofValue = proofValue.startsWith('z') ? proofValue.slice(1) : proofValue;
  return base58btcDecode(rawProofValue);
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
      // Check expiry from the VP payload itself (not just the DB record)
      if (new Date(parsed.data.expirationDate).getTime() <= Date.now()) {
        throw new VPExpiredError();
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
      const proofBytes = decodeBase58ProofValue(proof.proofValue);
      const signatureHex = Buffer.from(proofBytes).toString('hex');
      const validSignature = await verifySignature(hash, signatureHex, publicKeyHex);
      if (!validSignature) {
        throw new Error('signature_invalid');
      }

      const vc = parsed.data.verifiableCredential[0] as {
        id?: string;
        issuer?: string;
        expirationDate?: string;
        proof?: { proofValue?: string; verificationMethod?: string; type?: string; created?: string; proofPurpose?: string };
        [key: string]: unknown;
      };

      // Step 6: Check VC expiry from the VC payload itself
      if (vc.expirationDate && new Date(vc.expirationDate).getTime() <= Date.now()) {
        throw new Error('vc_expired');
      }
      if (!vc.id) {
        throw new VPInvalidStructureError('Missing VC id');
      }

      // Step 7: Verify the VC signature (issuer signed the credential).
      if (!vc.issuer || !vc.proof?.proofValue) {
        throw new VCSignatureInvalidError('The Verifiable Credential proof is missing');
      }
      let issuerDidDocument: Awaited<ReturnType<IDIDService['resolveDID']>>;
      try {
        issuerDidDocument = await this.didService.resolveDID(vc.issuer as string);
      } catch {
        throw new VCIssuerNotFoundError();
      }

      const issuerPublicKeyHex = extractPublicKeyHex(issuerDidDocument);
      const { proof: vcProof, ...vcPayload } = vc as Record<string, unknown> & { proof: NonNullable<typeof vc.proof> };
      const vcHash = hashCanonicalPayload(vcPayload);
      const vcProofBytes = decodeBase58ProofValue(vcProof.proofValue!);
      const vcSignatureHex = Buffer.from(vcProofBytes).toString('hex');

      const validVCSignature = await verifySignature(vcHash, vcSignatureHex, issuerPublicKeyHex);
      if (!validVCSignature) {
        throw new VCSignatureInvalidError();
      }

      // Step 8: Check VC revocation status in DB
      const status = await this.vcService.getVCStatus(vc.id);
      if (status === 'revoked') {
        throw new VCRevokedError();
      }
      if (status === 'expired') {
        throw new VCExpiredError();
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

      // Step 10: Return from the cryptographically trusted parsed VP payload, not the DB record
      return {
        valid: true,
        agentDid: parsed.data.holder,
        userDid: parsed.data.delegatedBy,
        targetService: parsed.data.targetService,
        verifiedAt
      };
    } catch (error) {
      const internalReason =
        error instanceof Error ? `${error.message}${'code' in error ? ` [code=${(error as { code?: string }).code}]` : ''}` : String(error);
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
  if (error && typeof error === 'object' && 'code' in error && 'httpStatus' in error) {
    const typed = error as HelixHttpErrorLike;
    return { statusCode: typed.httpStatus, code: typed.code, message: typed.message };
  }
  if (error instanceof ServiceNotFoundError) {
    return { statusCode: 404, code: ErrorCodes.SERVICE_NOT_FOUND, message: error.message };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}
