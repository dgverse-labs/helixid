import { requirePassphrase } from '../lib/env.js';
import { success } from '../lib/output.js';
import { loadIssuerKeyMaterial } from '../lib/wallet.js';

export async function runIssuerInit(options: { wallet: string }): Promise<void> {
  const passphrase = requirePassphrase();
  const issuer = await loadIssuerKeyMaterial(options.wallet, passphrase);

  success('Issuer ready');
  console.log('');
  console.log(`DID:                 ${issuer.did}`);
  console.log(`Public key:          ed25519:${issuer.publicKeyHex}`);
  console.log(`Verification method: ${issuer.did}#key-1`);
}
