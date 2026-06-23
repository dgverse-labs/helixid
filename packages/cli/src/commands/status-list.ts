import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { requirePassphrase } from '../lib/env.js';
import { buildCliStatusListPayload, signCredential } from '../lib/issuer-ops.js';
import { success } from '../lib/output.js';
import { loadIssuerKeyMaterial } from '../lib/wallet.js';

export async function runStatusListCreate(options: {
  length: number;
  output: string;
  baseUrl: string;
  wallet: string;
}): Promise<void> {
  const passphrase = requirePassphrase();
  const issuer = await loadIssuerKeyMaterial(options.wallet, passphrase);

  const payload = buildCliStatusListPayload(options.baseUrl, issuer.did, options.length);
  const signed = await signCredential(payload, issuer.did, issuer.privateKeyHex);

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, JSON.stringify(signed, null, 2), 'utf8');

  success('StatusList created');
  console.log('');
  console.log(`Output:   ${options.output}`);
  console.log(`Serve at: ${options.baseUrl}`);
  console.log(`Capacity: ${options.length} credentials`);
}
