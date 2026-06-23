import { writeFile } from 'node:fs/promises';
import { AgentWallet, VPBuilder } from '../helix-sdk-js/src/index.js';

const WALLET_FILE_PATH = new URL('../helix-api/wallet.enc', import.meta.url).pathname;
const WALLET_PASSPHRASE = process.env.WALLET_PASSPHRASE ?? 'manual-passphrase';
const USER_DID = process.env.USER_DID ?? 'did:web:user.example.com';
const TARGET_SERVICE = process.env.TARGET_SERVICE ?? 'orders-service';
const VC_TYPE = 'HelixAgentCredential';
const SIGNED_VP_REQUEST_FILE = new URL('./signed-vp-request.json', import.meta.url);
const SIGNED_VP_FILE = new URL('./signed-vp.json', import.meta.url);

async function main() {
  const wallet = await AgentWallet.load(WALLET_FILE_PATH, WALLET_PASSPHRASE);
  const explicitVcId = process.argv[2];

  const credential = explicitVcId
    ? wallet.credentials.find((item) => item.id === explicitVcId)
    : wallet.credentials.find((item) => item.type.includes(VC_TYPE));

  if (!credential) {
    throw new Error(
      explicitVcId
        ? `Wallet has no credential with id ${explicitVcId}`
        : `Wallet has no credential of type ${VC_TYPE}`,
    );
  }

  const signedVP = await new VPBuilder({
    vc: credential,
    holderDid: wallet.did,
    userDid: USER_DID,
    targetService: TARGET_SERVICE,
  }).sign(wallet.getPrivateKeyHex(), `${wallet.did}#key-1`);

  await writeFile(SIGNED_VP_FILE, JSON.stringify(signedVP, null, 2));
  await writeFile(SIGNED_VP_REQUEST_FILE, JSON.stringify({ signedVP, session: true }, null, 2));

  console.log('signed VP created', {
    vpId: signedVP.id,
    vcId: credential.id,
    holderDid: wallet.did,
    targetService: TARGET_SERVICE,
    signedVpPath: SIGNED_VP_FILE.pathname,
    requestBodyPath: SIGNED_VP_REQUEST_FILE.pathname,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
