import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentWallet, HelixClient } from '../helix-sdk-js/src/index.js';

const REPO_ROOT = new URL('../', import.meta.url).pathname;
const API_BASE_URL =
  process.env.HELIX_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3000';
const WALLET_PASSPHRASE = process.env.WALLET_PASSPHRASE ?? 'manual-passphrase';
const VC_ID = process.argv[2];

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function resolveWalletPath(): Promise<string | null> {
  const explicit = process.env.WALLET_FILE_PATH;
  if (explicit) {
    const candidate = resolve(REPO_ROOT, explicit);
    return (await firstExistingPath([candidate])) ?? candidate;
  }

  return firstExistingPath([
    resolve(REPO_ROOT, 'helix-api/wallet.enc'),
    resolve(REPO_ROOT, 'wallet.enc'),
    resolve(REPO_ROOT, 'tmp/helix-manual-agent-wallet.json'),
    resolve(REPO_ROOT, 'tmp/agent-c-wallet.json'),
  ]);
}

async function main() {
  const client = new HelixClient(API_BASE_URL);
  const walletPath = await resolveWalletPath();

  const vcId =
    VC_ID ??
    (async () => {
      if (!walletPath) return undefined;
      const wallet = await AgentWallet.load(walletPath, WALLET_PASSPHRASE);
      if (wallet.credentials.length !== 1) return undefined;
      return wallet.credentials[0]?.id;
    })();

  const resolvedVcId = await vcId;
  if (!resolvedVcId) {
    throw new Error(
      'Usage: pnpm --filter @helix-id/api exec tsx ../tmp/check-vc-status.ts <vc-id>\n' +
        'If vc-id is omitted, set WALLET_FILE_PATH or keep exactly one credential in a known wallet path.',
    );
  }

  const details = await client.getVC(resolvedVcId);

  console.log('VC details', {
    apiBaseUrl: API_BASE_URL,
    vcId: details.vcId,
    status: details.status,
    expiresAt: details.expiresAt,
    revokedAt: details.revokedAt,
    renewedByVcId: details.renewedByVcId,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
