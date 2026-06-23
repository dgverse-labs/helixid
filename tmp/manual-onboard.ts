import { HelixClient } from '../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../helix-sdk-js/src/wallet/AgentWallet.js';

const API_BASE_URL = process.env.HELIX_API_URL ?? 'http://localhost:3000';
const BOOTSTRAP_TOKEN =
  process.env.HELIX_BOOTSTRAP_TOKEN ?? 'enroll:8b37ab734afdc283255143f7';
const WALLET_PASSPHRASE = process.env.WALLET_PASSPHRASE ?? 'manual-passphrase';
const WALLET_FILE_PATH = process.argv[2] ?? './wallet.enc';

async function main() {
  const wallet = await AgentWallet.create(WALLET_FILE_PATH, WALLET_PASSPHRASE);
  const client = new HelixClient(API_BASE_URL);
  const vc = await client.enroll(BOOTSTRAP_TOKEN, wallet);

  console.log('wallet.did:', wallet.did);
  console.log('vc.id:', vc.id);
  console.log('wallet.file:', WALLET_FILE_PATH);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
