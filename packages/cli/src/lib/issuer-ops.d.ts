import { type SignedVC } from '@helixid/core';
export interface IssuerKeyMaterial {
    did: string;
    privateKeyHex: string;
    publicKeyHex: string;
}
export interface CliStatusListCredential extends Record<string, unknown> {
    '@context': string[];
    id: string;
    type: string[];
    issuer: string;
    validFrom: string;
    credentialSubject: {
        id: string;
        type: 'BitstringStatusList';
        statusPurpose: 'revocation';
        encodedList: string;
    };
    helixIndexRegistry?: Record<string, number>;
    proof?: SignedVC['proof'];
}
export declare function signCredential(credential: Record<string, unknown>, issuerDid: string, privateKeyHex: string): Promise<SignedVC>;
export declare function buildCliStatusListPayload(baseUrl: string, issuerDid: string, length: number, registry?: Record<string, number>): CliStatusListCredential;
export declare function findNextAvailableIndex(encodedList: string, length: number): number;
export declare function getStatusListLength(encodedList: string): number;
export declare function issueAgentCredential(options: {
    issuer: IssuerKeyMaterial;
    agentDid: string;
    scopes: string[];
    expiresMs: number;
    statusList: CliStatusListCredential;
    baseUrl: string;
    maxDelegationDepth: number;
}): Promise<{
    vc: SignedVC;
    statusList: SignedVC;
    index: number;
}>;
export declare function revokeCredentialInStatusList(options: {
    issuer: IssuerKeyMaterial;
    statusList: CliStatusListCredential;
    vcId: string;
}): Promise<{
    statusList: SignedVC;
    index: number;
    previousBit: 0 | 1;
}>;
export declare function parseStatusListFile(raw: unknown): CliStatusListCredential;
//# sourceMappingURL=issuer-ops.d.ts.map