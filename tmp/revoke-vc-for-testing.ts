const API_BASE_URL = 'http://localhost:3000';
const VC_ID = 'vc:helix:2ca5e33bddf847d6827041e4';
const HELIX_ADMIN_API_KEY = 'local-admin-key-please-rotate';

async function main() {
  const response = await fetch(`${API_BASE_URL}/v1/vcs/${encodeURIComponent(VC_ID)}/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-api-key': HELIX_ADMIN_API_KEY,
    },
    body: JSON.stringify({}),
  });

  const body = await response.json();
  console.log('revoke response', {
    status: response.status,
    body,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
