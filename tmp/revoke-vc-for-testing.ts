const API_BASE_URL = 'http://localhost:3000';
const VC_ID = process.argv[2];
const HELIX_ADMIN_API_KEY = 'local-admin-key-please-rotate';

async function main() {
  if (!VC_ID) throw new Error('Usage: pnpm exec tsx tmp/revoke-vc-for-testing.ts <vc-id>');
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
