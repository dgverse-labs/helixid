import { requirePassphrase } from '../lib/env.js';
import { error } from '../lib/output.js';
import { loadWallet } from '../lib/wallet.js';

export async function runWalletInspect(options: { wallet: string }): Promise<void> {
  const passphrase = requirePassphrase();
  const wallet = await loadWallet(options.wallet, passphrase);

  if (options.wallet.includes('privateKey') || process.argv.includes('--private-key')) {
    error('Refusing to print private key');
  }

  const credentials = wallet.credentials;

  console.log(`DID: ${wallet.getDID()}`);
  console.log(`Public key: ed25519:${wallet.getPublicKey()}`);
  console.log(`Credentials: ${credentials.length}`);

  for (const vc of credentials) {
    const subject = vc.credentialSubject;
    const scopes = 'privilegeScopes' in subject ? subject.privilegeScopes.join(', ') : '(none)';
    console.log('');
    console.log(`  VC ID:   ${vc.id}`);
    console.log(`  Scopes:  ${scopes}`);
    console.log(`  Expires: ${vc.validUntil ?? '(none)'}`);
  }
}
