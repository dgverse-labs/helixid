export interface DidCreateOptions {
    method: 'web' | 'hedera' | 'key';
    domain?: string;
    network?: 'testnet' | 'previewnet' | 'mainnet';
    wallet: string;
    /** did:web only — set false (--no-status-list) to skip status-list creation. */
    statusList?: boolean;
    statusListLength?: number;
    statusListOutput?: string;
    statusListBaseUrl?: string;
}
export declare function runDidCreate(options: DidCreateOptions): Promise<void>;
//# sourceMappingURL=did.d.ts.map