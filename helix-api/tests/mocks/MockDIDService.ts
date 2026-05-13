import type { DIDDocument, IDIDService } from '../../src/services/did/IDIDService.js';

export class MockDIDService implements IDIDService {
  private shouldThrow = false;
  private createdDid = 'did:hedera:testnet:testid';

  constructor(private readonly document: DIDDocument) {}

  setShouldThrow(value: boolean): void {
    this.shouldThrow = value;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolveDID(_did: string): Promise<DIDDocument> {
    if (this.shouldThrow) {
      throw new Error('DID not found');
    }
    return this.document;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createDID(
    _publicKeyHex: string,
    _subjectType: 'agent' | 'user',
    _domains: string[],
    _requestId: string
  ): Promise<{ did: string; hederaTransactionId: string }> {
    if (this.shouldThrow) {
      throw new Error('DID not found');
    }
    return { did: this.createdDid, hederaTransactionId: 'mock-tx-1' };
  }
}
