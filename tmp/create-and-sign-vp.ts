import { writeFile } from 'node:fs/promises';
import { HelixClient } from '../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../helix-sdk-js/src/wallet/AgentWallet.js';
import { VPBuilder } from '../helix-sdk-js/src/vp/VPBuilder.js';

const API_BASE_URL = 'http://localhost:3000';
const WALLET_FILE_PATH = new URL('./helix-manual-agent-wallet.json', import.meta.url).pathname;
const WALLET_PASSPHRASE = 'manual-passphrase';
const USER_DID = 'did:hedera:testnet:replace-with-user-did';
const TARGET_SERVICE = 'amazon';
const VC_TYPE = 'HelixAgentCredential';
const SIGNED_VP_REQUEST_FILE = new URL('./signed-vp-request.json', import.meta.url);
const SIGNED_VP_FILE = new URL('./signed-vp.json', import.meta.url);

async function main() {
  const wallet = await new AgentWallet().load(WALLET_PASSPHRASE, WALLET_FILE_PATH);
  const client = new HelixClient(API_BASE_URL);

  console.log('loaded wallet', {
    did: wallet.did,
    credentialCount: wallet.credentials.length,
    walletFilePath: WALLET_FILE_PATH,
  });
  const credential = wallet.credentials
    .filter((item) => item.type.includes(VC_TYPE))
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))[0];
  if (!credential) {
    throw new Error(`Wallet has no credential of type ${VC_TYPE}`);
  }

  const didResponse = await fetch(`${API_BASE_URL}/v1/dids/${encodeURIComponent(wallet.did)}`);
  const didBody = await didResponse.json();
  if (!didResponse.ok) {
    console.error('wallet DID is not resolvable by the running API', {
      status: didResponse.status,
      did: wallet.did,
      body: didBody,
    });
    console.error('Re-run manual onboarding against this same API/database, or switch WALLET_FILE_PATH to a wallet created in this database.');
    process.exit(1);
  }

  const templateResponse = await fetch(`${API_BASE_URL}/v1/vp/template`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentDid: wallet.did,
      userDid: USER_DID,
      targetService: TARGET_SERVICE,
      vcType: VC_TYPE,
      vcId: credential.vcId,
    }),
  });

  const template = await templateResponse.json();
  if (!templateResponse.ok) {
    console.error('template error', template);
    process.exit(1);
  }

  const signedVP = await new VPBuilder(template.unsignedVP).sign(
    wallet.privateKeyHex,
    `${wallet.did}#key-1`,
  );

  await writeFile(SIGNED_VP_FILE, JSON.stringify(signedVP, null, 2));
  await writeFile(SIGNED_VP_REQUEST_FILE, JSON.stringify({ signedVP }, null, 2));

  console.log('vp template', {
    vpId: template.vpId,
    expiresAt: template.expiresAt,
    agentDid: wallet.did,
    userDid: USER_DID,
    targetService: TARGET_SERVICE,
    vcId: credential.vcId,
    embeddedVcId: template.unsignedVP?.verifiableCredential?.[0]?.id,
  });
  console.log('signed VP saved', SIGNED_VP_FILE.pathname);
  console.log('verify request body saved', SIGNED_VP_REQUEST_FILE.pathname);
  console.log('Insomnia: POST /v1/vp/verify with JSON body from signed-vp-request.json');
  void client;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
