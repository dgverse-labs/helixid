import { type SignedVC } from '@helixid/core';
import type { AgentWallet } from './wallet/AgentWallet.js';
export interface DelegateOptions {
    to: string;
    scopes: string[];
    expiresIn: number;
    fromVC?: SignedVC;
}
export declare function delegate(options: DelegateOptions, wallet: AgentWallet): Promise<SignedVC>;
//# sourceMappingURL=delegation.d.ts.map