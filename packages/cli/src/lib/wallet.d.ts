import { AgentWallet } from '@helixid/sdk-js';
import type { IssuerKeyMaterial } from './issuer-ops.js';
export declare function loadWallet(walletPath: string, passphrase: string): Promise<AgentWallet>;
export declare function loadIssuerKeyMaterial(walletPath: string, passphrase: string): Promise<IssuerKeyMaterial>;
export declare function saveNewWallet(walletPath: string, passphrase: string, did: string, keyPair: {
    publicKey: string;
    privateKey: string;
}): Promise<void>;
//# sourceMappingURL=wallet.d.ts.map