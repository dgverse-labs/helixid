import { type KeyPair, type SelfIssueOptions, type ServiceEndpoint, type SignedVC } from '@helixid/core';
import type { HelixClient } from '../client/HelixClient.js';
export interface WalletData {
    did: string;
    publicKeyHex: string;
    privateKeyHex: string;
    credentials: WalletCredential[];
    createdAt: string;
    updatedAt: string;
}
export interface WalletCredential {
    vcId: string;
    vcJson: string;
    type: string[];
    issuer?: string;
    subjectDid?: string;
    addedAt: string;
    updatedAt: string;
}
export interface AgentWalletOptions {
    client?: HelixClient;
    privateKeyHex?: string;
    did?: string;
    walletPath?: string;
    passphrase?: string;
    credentials?: WalletCredential[];
    createdAt?: string;
    updatedAt?: string;
}
export declare class AgentWallet {
    private readonly client;
    private privateKeyHex;
    private publicKeyHex;
    private didValue;
    private walletPath;
    private passphrase;
    private walletCredentials;
    private createdAt;
    private updatedAt;
    constructor(options?: AgentWalletOptions);
    get credentials(): SignedVC[];
    get did(): string;
    getPublicKey(): string;
    getPrivateKeyHex(): string;
    getDID(): string;
    createDID(subjectType: 'agent' | 'user'): Promise<{
        did: string;
    }>;
    addService(endpoint: ServiceEndpoint): Promise<unknown>;
    removeService(endpointId: string): Promise<unknown>;
    deactivate(reason?: string): Promise<void>;
    sign(data: string | Uint8Array): string;
    save(data: WalletData, passphrase: string, filePath: string): Promise<void>;
    private saveCurrent;
    load(passphrase: string, filePath: string): Promise<WalletData>;
    getPrivateKey(passphrase: string, filePath: string): Promise<string>;
    addCredential(vc: SignedVC): Promise<void>;
    addCredential(vcId: string, vcJson: string, filePath: string, passphrase: string): Promise<void>;
    selfIssueVC(options: SelfIssueOptions): Promise<SignedVC>;
    updateCredential(vcId: string, vcJson: string, filePath: string, passphrase: string): Promise<void>;
    removeCredential(vcId: string, filePath: string, passphrase: string): Promise<void>;
    listCredentials(passphrase: string, filePath: string): Promise<WalletCredential[]>;
    getCredential(vcId: string, passphrase: string, filePath: string): Promise<WalletCredential | null>;
    getLatestCredential(options: {
        vcType?: string;
    } | undefined, passphrase: string, filePath: string): Promise<WalletCredential | null>;
    static credentialFromVC(vcId: string, vc: string | Record<string, unknown>): WalletCredential;
    static generateKeypair(): KeyPair;
    static fromKeypairAndCredential(keypair: KeyPair, vc: SignedVC | string | Record<string, unknown>): AgentWallet;
    static create(walletPath: string, passphrase: string): Promise<AgentWallet>;
    static load(walletPath: string, passphrase: string): Promise<AgentWallet>;
    private static fromWalletData;
}
//# sourceMappingURL=AgentWallet.d.ts.map
