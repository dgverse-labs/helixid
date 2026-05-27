import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));

interface KeyPair {
  privateKey: string;
  publicKey: string;
}

function generateEd25519SeedKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey: privateDer.subarray(-32).toString('hex'),
    publicKey: publicDer.subarray(-32).toString('hex'),
  };
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

const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const keyPair = generateEd25519SeedKeyPair();
let next = upsertEnvValue(existing, 'HELIX_JWT_SIGNING_KEY', keyPair.privateKey);
next = upsertEnvValue(next, 'HELIX_JWT_PUBLIC_KEY', keyPair.publicKey);
next = upsertEnvValue(next, 'JWT_SESSION_TTL_SECONDS', '600');

writeFileSync(envPath, next);

console.log('Generated HELIX_JWT_SIGNING_KEY and HELIX_JWT_PUBLIC_KEY in .env');
console.log('Hedera DID creation is parked separately in parked-items.md');
