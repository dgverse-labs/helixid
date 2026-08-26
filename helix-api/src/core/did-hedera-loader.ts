import { createRequire } from 'node:module';
import type { DIDDocument } from './crypto/did.js';

export type DidHederaResolver = (did: string) => Promise<DIDDocument>;

export function loadDidHederaResolver(): DidHederaResolver | null {
  try {
    const require = createRequire(import.meta.url);
    const module = require('@helixid/did-hedera') as {
      resolveDID?: DidHederaResolver;
      resolveDid?: DidHederaResolver;
      resolveDidHedera?: DidHederaResolver;
      resolver?: { resolveDID?: DidHederaResolver };
    };
    return module.resolveDID
      ?? module.resolveDid
      ?? module.resolveDidHedera
      ?? module.resolver?.resolveDID
      ?? null;
  } catch {
    return null;
  }
}
