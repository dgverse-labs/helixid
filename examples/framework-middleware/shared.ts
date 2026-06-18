import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SignedVP, VerifyVPResult } from '@helix-id/core';
import { AgentWallet, HelixClient, verifyVP } from '@helix-id/sdk-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const exampleRoot = __dirname;
export const walletPath = join(exampleRoot, 'agent', 'wallet.enc');
export const helixApiUrl = process.env.HELIX_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3000';
export const walletPassphrase = process.env.WALLET_PASSPHRASE ?? 'change-this-passphrase';
export const targetService = process.env.HELIX_TARGET_SERVICE ?? 'amazon';
export const userDid = process.env.HELIX_USER_DID ?? 'did:hedera:testnet:user-framework-middleware-demo';
export const requestedScopes = ['read:orders', 'write:orders', 'read:catalog'];
export const requestedDomains = ['https://framework-middleware.example.com'];

export type VerificationWithScopes = VerifyVPResult & {
  scopes: string[];
  privilegeScopes: string[];
  userDid: string;
  targetService: string;
};

export type WalletVC = {
  id: string;
  validUntil?: string;
  expirationDate?: string;
  credentialSubject?: {
    privilegeScopes?: unknown;
  };
};

export function createHelixClient(): HelixClient {
  return new HelixClient(helixApiUrl);
}

export async function ensureAgentDirectory(): Promise<void> {
  await mkdir(dirname(walletPath), { recursive: true });
}

export async function loadWalletSummary(): Promise<{
  wallet: Awaited<ReturnType<AgentWallet['load']>>;
  credential: NonNullable<Awaited<ReturnType<AgentWallet['getLatestCredential']>>>;
  vc: WalletVC;
}> {
  const walletStore = new AgentWallet();
  const wallet = await walletStore.load(walletPassphrase, walletPath);
  const credential = await walletStore.getLatestCredential({ vcType: 'HelixAgentCredential' }, walletPassphrase, walletPath);
  if (!credential) {
    throw new Error(`No HelixAgentCredential found in ${walletPath}. Run pnpm example:middleware:setup first.`);
  }
  return { wallet, credential, vc: JSON.parse(credential.vcJson) as WalletVC };
}

export function decodeHelixVP(encoded: unknown): SignedVP {
  if (typeof encoded !== 'string') {
    throw new Error('Expected a base64url encoded Helix VP string');
  }
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedVP;
}

export function encodeHelixVP(signedVP: SignedVP): string {
  return Buffer.from(JSON.stringify(signedVP), 'utf8').toString('base64url');
}

export function extractScopes(signedVP: SignedVP): string[] {
  const [credential] = signedVP.verifiableCredential as Array<WalletVC | undefined>;
  const scopes = credential?.credentialSubject?.privilegeScopes;
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string') : [];
}

export async function verifyWithScopes(signedVP: SignedVP): Promise<VerificationWithScopes> {
  const verified = await verifyVP(signedVP);
  const scopes = extractScopes(signedVP);
  return {
    ...verified,
    scopes,
    privilegeScopes: scopes,
    userDid: signedVP.delegatedBy,
    targetService: signedVP.targetService,
  };
}

export function logStep(actor: string, message: string): void {
  console.log(`[${actor}] ${message}`);
}
