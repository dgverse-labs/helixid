import { HelixClient } from '../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../helix-sdk-js/src/wallet/AgentWallet.js';

const API_BASE_URL = 'http://localhost:3000';
const WALLET_FILE_PATH = new URL('./helix-manual-agent-wallet.json', import.meta.url).pathname;
const WALLET_PASSPHRASE = 'manual-passphrase';
const VC_ID = process.argv[2];

async function main() {
  const client = new HelixClient(API_BASE_URL);
  const wallet = await new AgentWallet().load(WALLET_PASSPHRASE, WALLET_FILE_PATH);
  const vcId = VC_ID ?? wallet.credentials.at(-1)?.vcId;
  if (!vcId) throw new Error('Usage: pnpm exec tsx tmp/check-vc-status.ts <vc-id> or use a wallet with credentials');
  const details = await client.getVC(vcId);

  console.log('VC details', {
    vcId: details.vcId,
    status: details.status,
    expiresAt: details.expiresAt,
    revokedAt: details.revokedAt,
    renewedByVcId: details.renewedByVcId,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
