import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { AgentWallet, HelixClient } from '@helix-id/sdk-js';

type AgentVC = {
  id: string;
  validUntil?: string;
  credentialSubject?: {
    privilegeScopes?: string[];
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const exampleRoot = dirname(__dirname);
const walletPath = join(exampleRoot, 'agent', 'wallet.enc');

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredBootstrapToken(): string {
  return process.env.HELIX_BOOTSTRAP_TOKEN ?? required('HELIX_ENROLLMENT_TOKEN');
}

function log(actor: 'Agent Owner' | 'Helix ID' | 'Agent', message: string): void {
  console.log(`[${actor}] ${message}`);
}

async function main(): Promise<void> {
  await mkdir(dirname(walletPath), { recursive: true });

  const wallet = await AgentWallet.create(walletPath, required('WALLET_PASSPHRASE'));
  const client = new HelixClient(required('API_BASE_URL'));
  const vc = await client.enroll(requiredBootstrapToken(), wallet);

  const typedVc = vc as AgentVC;
  log('Agent', `Wallet: ${walletPath}`);
  log('Agent', `DID: ${wallet.did}`);
  log('Helix ID', `VC id: ${typedVc.id}`);
  if (typedVc.credentialSubject?.privilegeScopes?.length) {
    log('Agent', `Scopes: ${typedVc.credentialSubject.privilegeScopes.join(', ')}`);
  }
  if (typedVc.validUntil) {
    log('Agent', `Credential expiry: ${typedVc.validUntil}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
