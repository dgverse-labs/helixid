import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  derivePublicKey,
  generateKeyPair,
  publicKeyToMultibase,
  signBytes,
} from '../helix-core/src/index.js';
import { HieroHederaClient } from '../helix-api/src/hedera/HieroHederaClient.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const args = new Set(process.argv.slice(2));
const createIssuerDid = args.has('--create-issuer-did');

type EnvMap = Record<string, string>;

function parseEnv(contents: string): EnvMap {
  const env: EnvMap = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1).replace(/^["']|["']$/g, '');
  }
  return env;
}

function upsertEnvValue(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(contents)) {
    return contents.replace(pattern, line);
  }
  const separator = contents.endsWith('\n') || contents.length === 0 ? '' : '\n';
  return `${contents}${separator}${line}\n`;
}

function requireEnv(env: EnvMap, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required in .env`);
  }
  return value;
}

function ensureKey(contents: string, env: EnvMap, key: string): { contents: string; value: string; created: boolean } {
  const existing = env[key];
  if (existing) {
    return { contents, value: existing, created: false };
  }
  const generated = generateKeyPair().privateKey;
  env[key] = generated;
  return { contents: upsertEnvValue(contents, key, generated), value: generated, created: true };
}

async function main(): Promise<void> {
  let contents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const env = parseEnv(contents);

  const signingKey = ensureKey(contents, env, 'HELIX_SIGNING_KEY');
  contents = signingKey.contents;

  contents = upsertEnvValue(contents, 'JWT_SESSION_TTL_SECONDS', env.JWT_SESSION_TTL_SECONDS ?? '600');

  const issuerPublicKey = derivePublicKey(signingKey.value);
  contents = upsertEnvValue(contents, 'HELIX_ISSUER_PUBLIC_KEY', issuerPublicKey);
  console.log(`[setup-hedera] HELIX_SIGNING_KEY ${signingKey.created ? 'generated' : 'exists'}; issuer public key ${issuerPublicKey}`);
  console.log('[setup-hedera] JWT session signing keys are generated ephemerally at API startup.');

  const existingIssuerDid = env.HELIX_ISSUER_DID;
  if (!existingIssuerDid || createIssuerDid) {
    const network = requireEnv(env, 'HEDERA_NETWORK') as 'testnet' | 'previewnet' | 'mainnet';
    const client = new HieroHederaClient({
      HEDERA_NETWORK: network,
      HEDERA_OPERATOR_ID: requireEnv(env, 'HEDERA_OPERATOR_ID'),
      HEDERA_OPERATOR_KEY: requireEnv(env, 'HEDERA_OPERATOR_KEY'),
    });

    console.log(`[setup-hedera] Creating issuer DID on Hedera ${network}; this submits a paid network transaction.`);
    const request = await client.prepareDIDCreation(publicKeyToMultibase(issuerPublicKey));
    const signature = await signBytes(Buffer.from(request.signingPayloadHex, 'hex'), signingKey.value);
    const result = await client.submitDIDCreation(request.stateJson, signature);
    contents = upsertEnvValue(contents, 'HELIX_ISSUER_DID', result.did);
    console.log(`[setup-hedera] HELIX_ISSUER_DID updated to ${result.did}`);
  } else {
    console.log(`[setup-hedera] HELIX_ISSUER_DID already set to ${existingIssuerDid}`);
    console.log('[setup-hedera] Pass --create-issuer-did to create and store a fresh issuer DID on Hedera.');
  }

  writeFileSync(envPath, contents);
  console.log('[setup-hedera] .env updated. Private keys were not printed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
