import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));

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
const next = upsertEnvValue(existing, 'JWT_SESSION_TTL_SECONDS', '600');

writeFileSync(envPath, next);

console.log('Ensured JWT_SESSION_TTL_SECONDS in .env');
console.log('Session JWT signing keys are generated ephemerally at API startup and are not stored in .env.');
console.log('Hedera DID creation is parked separately in parked-items.md');
