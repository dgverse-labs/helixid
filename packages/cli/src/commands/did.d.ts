export interface DidCreateOptions {
    method: 'web' | 'hedera' | 'key';
    domain?: string;
    network?: 'testnet' | 'previewnet' | 'mainnet';
    wallet: string;
}
export declare function runDidCreate(options: DidCreateOptions): Promise<void>;
//# sourceMappingURL=did.d.ts.map