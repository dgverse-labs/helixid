import { HelixClient } from '../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../helix-sdk-js/src/wallet/AgentWallet.js';

const API_BASE_URL = 'http://localhost:3000';
const WALLET_FILE_PATH = new URL('./helix-manual-agent-wallet.json', import.meta.url).pathname;
const WALLET_PASSPHRASE = 'manual-passphrase';
const AGENT_NAME = 'Manual Short VC Test Agent';
const PRIVILEGE_SCOPES = ['read:orders'];
const EXPIRES_IN_SECONDS = 1;

async function main() {
  const wallet = await new AgentWallet().load(WALLET_PASSPHRASE, WALLET_FILE_PATH);
  const client = new HelixClient(API_BASE_URL);

  const issued = await client.issueVC({
    subjectDid: wallet.did,
    subjectType: 'agent',
    privilegeScopes: PRIVILEGE_SCOPES,
    agentName: AGENT_NAME,
    expiresInSeconds: EXPIRES_IN_SECONDS,
  });

  console.log('short VC issued', {
    vcId: issued.vcId,
    subjectDid: wallet.did,
    expiresAt: issued.expiresAt,
    statusListIndex: issued.statusListIndex,
  });

  await new Promise((resolve) => setTimeout(resolve, (EXPIRES_IN_SECONDS + 1) * 1000));

  const details = await client.getVC(issued.vcId);
  console.log('status after wait', {
    vcId: issued.vcId,
    status: details.status,
    expiresAt: details.expiresAt,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
