export interface DIDDocument {
  id: string;
  verificationMethod?: Array<{
    id: string;
    type: string;
    publicKeyMultibase?: string;
    publicKeyHex?: string;
  }>;
}

export interface IDIDService {
  createDID(
    publicKeyHex: string,
    subjectType: 'agent' | 'user',
    domains: string[],
    requestId: string
  ): Promise<{ did: string; hederaTransactionId: string }>;
  resolveDID(did: string): Promise<DIDDocument>;
}
