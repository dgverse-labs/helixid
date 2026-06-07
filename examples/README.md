# Helix ID Examples

These examples are intentionally small. They use the current SDK and API names, not future aliases.

Run the real Hedera setup first:

```sh
pnpm setup:hedera
set -a; source .env; set +a
pnpm --filter @helix-id/api start
```

For the VP examples, generate a fresh fixture shortly before running them. VPs are single-use and expire in minutes.

```sh
pnpm --filter @helix-id/example-e2e-travel-concierge enroll
pnpm --filter @helix-id/example-e2e-travel-concierge fixture
```

Then run:

```sh
pnpm example:verify-vp
pnpm example:scope-check
pnpm example:self-verify
pnpm example:revocation-check
```

`verify-vp` consumes the fixture VP. Running it a second time should fail with `VP_VERIFICATION_FAILED`.

`revocation-check` revokes the fixture credential. Generate a new fixture after running it if you want `verify-vp` or `self-verify` to pass again.

## Real Framework Middleware

`framework-middleware` demonstrates the real LangChain and MCP adapters without mocking the Helix client or Hedera path. It uses the live Helix API, creates a real Hedera-backed agent DID during onboarding, stores an encrypted wallet, requests real VP templates, signs VPs locally, and verifies them through the API.

Configure `.env` for real Hedera testnet first:

```sh
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=...
HEDERA_OPERATOR_KEY=...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/helixid
HELIX_ADMIN_API_KEY=...
```

Then run:

```sh
pnpm install
docker compose up -d postgres
pnpm --filter @helix-id/api db:deploy
pnpm setup:hedera -- --create-issuer-did
set -a; source .env; set +a
pnpm --filter @helix-id/api dev
```

In another terminal with the same environment exported:

```sh
pnpm example:middleware:setup
pnpm example:middleware:langchain
pnpm example:middleware:mcp
```

The setup script writes `examples/framework-middleware/agent/wallet.enc`, which is ignored by that example package. The scripts log DIDs, VC ids, scopes, and verification results, but never print private keys or wallet contents.
