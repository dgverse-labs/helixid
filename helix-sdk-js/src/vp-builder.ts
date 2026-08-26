// Duplicated from helix-core's vp-builder.ts (see
// docs/proposal-retire-core-package.md) -- VPBuilder.sign() is local-signing
// logic, one of the explicit carveouts that stays client-side per
// proposal-sdk-api-only.md (private-key operations never call the API).
export { VPBuilder } from './core/vp-builder-impl.js';
export type { VPBuilderOptions } from './core/vp-builder-impl.js';
