import { publicKeyToMultibase } from '../../src/core/index.js';
import type {
  CreateDIDResult,
  DIDCreationProof,
  DIDDocument,
  IDIDService,
  ResolveDIDResult,
  ServiceEndpoint,
} from '../../src/services/did/IDIDService.js';

type MockVerificationMethod = {
  id: string;
  type: string;
  controller?: string;
  publicKeyMultibase?: string;
  publicKeyHex?: string;
};

type MockDIDDocumentInput = Omit<Partial<DIDDocument>, 'verificationMethod'> & {
  id: string;
  verificationMethod: MockVerificationMethod[];
};

export class MockDIDService implements IDIDService {
  private shouldThrow = false;
  private createdDid = 'did:hedera:testnet:testid';
  private readonly document: DIDDocument;

  constructor(document: MockDIDDocumentInput) {
    this.document = this.normalizeDocument(document);
  }

  setShouldThrow(value: boolean): void {
    this.shouldThrow = value;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolveDID(_did: string): Promise<ResolveDIDResult> {
    if (this.shouldThrow) {
      throw new Error('DID not found');
    }
    return this.toResolveResult(this.document, 'cache');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async prepareDIDCreation(_publicKeyHex: string): Promise<{ stateJson: string; signingPayloadHex: string }> {
    return {
      stateJson: '{}',
      signingPayloadHex: Buffer.from('mock-did-create', 'utf8').toString('hex'),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createDID(
    publicKeyHex: string,
    _subjectType: 'agent' | 'user',
    _domains: string[],
    _requestId: string,
    _creationProof?: DIDCreationProof,
  ): Promise<CreateDIDResult> {
    void _subjectType;
    void _domains;
    void _requestId;
    void _creationProof;
    if (this.shouldThrow) {
      throw new Error('DID not found');
    }
    const didDocument = this.normalizeDocument({
      id: this.createdDid,
      verificationMethod: [
        {
          id: `${this.createdDid}#key-1`,
          type: 'Ed25519VerificationKey2020',
          publicKeyHex,
        },
      ],
    });
    return { did: this.createdDid, didDocument, hederaTransactionId: 'mock-tx-1' };
  }

  async addServiceEndpoint(
    _did: string,
    endpoint: ServiceEndpoint,
    _requestId: string,
  ): Promise<DIDDocument> {
    void _did;
    void _requestId;
    return {
      ...this.document,
      service: [...(this.document.service ?? []), endpoint],
    };
  }

  async removeServiceEndpoint(
    _did: string,
    endpointId: string,
    _requestId: string,
  ): Promise<DIDDocument> {
    void _did;
    void _requestId;
    return {
      ...this.document,
      service: (this.document.service ?? []).filter((endpoint) => endpoint.id !== endpointId),
    };
  }

  async deactivateDID(_did: string, _reasonOrRequestId: string, _requestId?: string): Promise<void> {
    void _did;
    void _reasonOrRequestId;
    void _requestId;
    return undefined;
  }

  private toResolveResult(document: DIDDocument, source: 'cache' | 'db' | 'hedera'): ResolveDIDResult {
    return {
      did: document.id,
      didDocument: document,
      document,
      deactivated: false,
      source,
    };
  }

  private normalizeDocument(document: MockDIDDocumentInput): DIDDocument {
    const verificationMethod = document.verificationMethod.map((method) => ({
      id: method.id,
      type: method.type,
      controller: method.controller ?? document.id,
      publicKeyMultibase:
        method.publicKeyMultibase ?? publicKeyToMultibase(method.publicKeyHex ?? 'a'.repeat(64)),
    }));
    const methodIds = verificationMethod.map((method) => method.id);
    return {
      '@context': document['@context'] ?? [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
      ],
      id: document.id,
      controller: document.controller ?? document.id,
      verificationMethod,
      authentication: document.authentication ?? methodIds,
      assertionMethod: document.assertionMethod ?? methodIds,
      service: document.service,
    };
  }
}
