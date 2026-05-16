import { HelixClient } from '../helix-sdk-js/src/client/HelixClient.js';

const API_BASE_URL = 'http://localhost:3000';
const VC_ID = 'vc:helix:replace-with-vc-id';

async function main() {
  const client = new HelixClient(API_BASE_URL);
  const details = await client.getVC(VC_ID);

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
