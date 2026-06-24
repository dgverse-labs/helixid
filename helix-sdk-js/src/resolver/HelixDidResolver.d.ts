import type { IDidResolver } from './IDidResolver.js';
import type { DIDResolutionResult } from './types.js';
export interface HelixDidResolverOptions {
    baseUrl: string;
}
/**
 * DID Resolver implementation that uses the Helix ID API.
 */
export declare class HelixDidResolver implements IDidResolver {
    private baseUrl;
    constructor(options: HelixDidResolverOptions);
    resolve(did: string, options?: {
        live?: boolean;
    }): Promise<DIDResolutionResult>;
}
//# sourceMappingURL=HelixDidResolver.d.ts.map