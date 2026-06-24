import type { DIDDocument } from '@helixid/core';
export interface DIDResolutionMetadata {
    contentType?: string;
    error?: string;
    deactivated?: boolean;
    [key: string]: unknown;
}
export interface DIDDocumentMetadata {
    created?: string;
    updated?: string;
    deactivated?: boolean;
    versionId?: string;
    nextVersionId?: string;
    [key: string]: unknown;
}
export interface DIDResolutionResult {
    '@context'?: string;
    didDocument: DIDDocument | null;
    didResolutionMetadata: DIDResolutionMetadata;
    didDocumentMetadata: DIDDocumentMetadata;
}
//# sourceMappingURL=types.d.ts.map