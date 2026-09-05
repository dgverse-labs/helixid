import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}

loadEnvFile('.env');
if (process.env['NODE_ENV']) {
  loadEnvFile(`.env.${process.env['NODE_ENV']}`);
}
