import type { DIDDocument, IDIDService, CreateDIDResult, ResolveDIDResult } from '../../src/services/did/IDIDService.js';

export class MockDIDService implements IDIDService {
  private shouldThrow = false;
  private createdDid = 'did:hedera:testnet:testid';

  constructor(private readonly document: DIDDocument) {}

  setShouldThrow(value: boolean): void {
    this.shouldThrow = value;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolveDID(_did: string, _requestId = 'mock'): Promise<ResolveDIDResult> {
    if (this.shouldThrow) {
      throw new Error('DID not found');
    }
    return { did: this.document.id, didDocument: this.document, source: 'cache' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolveDIDFromHedera(_did: string, _requestId = 'mock'): Promise<ResolveDIDResult> {
    if (this.shouldThrow) {
      throw new Error('DID not found');
    }
    return { did: this.document.id, didDocument: this.document, source: 'hedera' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createDID(
    _publicKeyHex: string,
    _subjectType: 'agent' | 'user',
    _domains: string[],
    _requestId: string,
  ): Promise<CreateDIDResult> {
    if (this.shouldThrow) {
      throw new Error('DID not found');
    }
    return { did: this.createdDid, didDocument: this.document, hederaTransactionId: 'mock-tx-1' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async addServiceEndpoint(_did: string, _endpoint: import('@helix-id/core').ServiceEndpoint, _requestId: string): Promise<DIDDocument> {
    return this.document;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async removeServiceEndpoint(_did: string, _endpointId: string, _requestId: string): Promise<DIDDocument> {
    return this.document;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deactivateDID(_did: string, _reason: string, _requestId: string): Promise<void> {
    // no-op for mock
  }
}
