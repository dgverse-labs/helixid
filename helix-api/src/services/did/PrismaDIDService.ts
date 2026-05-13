import type { IDIDService } from './IDIDService.js';
import { DIDRepository } from '../../repositories/did.repository.js';

export class PrismaDIDService implements IDIDService {
  constructor(private readonly repository: DIDRepository) {}

  async createDID(publicKeyHex: string, subjectType: 'agent' | 'user', _domains: string[], _requestId: string): Promise<{ did: string; hederaTransactionId: string }> {
    const did = `did:helix:${Math.random().toString(16).slice(2, 14)}`;
    
    await this.repository.createDID({
      did,
      publicKeyHex,
      subjectType,
      hederaTransactionId: 'mock-tx',
      metadata: JSON.stringify({ domains: _domains })
    });

    return { did, hederaTransactionId: 'mock-tx' };
  }

  async resolveDID(did: string): Promise<any> {
    const record = await this.repository.findByDid(did);
    if (!record) {
      throw new Error(`DID ${did} not found in database`);
    }

    return {
      id: record.did,
      verificationMethod: [{
        id: `${record.did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        publicKeyHex: record.publicKeyHex
      }]
    };
  }
}
