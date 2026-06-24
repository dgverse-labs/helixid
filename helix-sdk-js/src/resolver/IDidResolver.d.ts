import type { DIDResolutionResult } from './types.js';
/**
 * Common interface for DID Resolution.
 */
export interface IDidResolver {
    /**
     * Resolves a DID to a DID Document.
     */
    resolve(did: string, options?: {
        live?: boolean;
    }): Promise<DIDResolutionResult>;
}
//# sourceMappingURL=IDidResolver.d.ts.map