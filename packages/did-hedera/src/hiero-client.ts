import { createRequire } from 'node:module';
import { AccountId, Client, PrivateKey } from '@hashgraph/sdk';
import type { HederaAnchorOptions } from './types.js';

const require = createRequire(import.meta.url);

export function patchAccountIdFromString(): void {
  patchAccountIdClass(AccountId);

  try {
    const sdk = require('@hashgraph/sdk') as { AccountId?: typeof AccountId };
    if (sdk.AccountId) {
      patchAccountIdClass(sdk.AccountId);
    }
  } catch {
    // ESM-only runtimes still get the ESM patch above.
  }
}

function patchAccountIdClass(accountIdClass: typeof AccountId): void {
  const originalFromString = accountIdClass.fromString as typeof AccountId.fromString & { _isPatched?: boolean };
  if (originalFromString._isPatched) return;

  const patched = function fromStringPatched(text: string | { toString(): string }) {
    if (typeof text === 'object' && text !== null && text.toString) {
      return originalFromString.call(accountIdClass, text.toString());
    }
    return originalFromString.call(accountIdClass, text as string);
  } as typeof AccountId.fromString & { _isPatched?: boolean };
  patched._isPatched = true;
  accountIdClass.fromString = patched;
}

export function buildHederaClient(
  options: Pick<HederaAnchorOptions, 'network' | 'operatorId' | 'operatorKey'>,
): Client {
  patchAccountIdFromString();

  let client: Client;
  if (options.network === 'mainnet') {
    client = Client.forMainnet();
  } else if (options.network === 'previewnet') {
    client = Client.forPreviewnet();
  } else {
    client = Client.forTestnet();
  }

  client.setOperator(
    AccountId.fromString(options.operatorId),
    PrivateKey.fromString(options.operatorKey),
  );
  return client;
}

export function privateKeyFromHex(privateKeyHex: string): PrivateKey {
  return PrivateKey.fromBytesED25519(Buffer.from(privateKeyHex, 'hex'));
}

export function extractTopicId(did: string): string {
  const match = did.match(/(0\.0\.\d+)$/);
  return match?.[1] ?? '';
}
