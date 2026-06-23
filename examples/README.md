# Helix ID Examples

Start the API first:

```sh
set -a; source .env; set +a
pnpm --filter @helix-id/api start
```

Verifier examples now mint fresh credentials and sign fresh VPs automatically (no fixture file needed).

Then run:

```sh
pnpm example:verify-vp
pnpm example:verify-vp:sdk
pnpm example:verify-vp:session-bridge
pnpm example:scope-check
pnpm example:self-verify
pnpm example:revocation-check
```

## Verifier fast-path patterns (both supported)

### Path A — Verifier-issued JWT session

```sh
JWT_SECRET=replace-with-a-strong-secret \
pnpm --filter @helix-id/api exec tsx ../examples/verifier-session-cycle.ts
```

Flow: verify VP once → issue verifier-owned JWT → subsequent calls verify JWT locally until TTL expiry.

### Path B — VP-result caching (no JWT)

```sh
pnpm --filter @helix-id/api exec tsx ../examples/verifier-vp-cache-cycle.ts
```

Flow: verify VP once → cache verification result by `vpId` with TTL → subsequent calls with same `vpId` are cache hits.

In both paths, the verifier owns policy/infrastructure decisions (scope checks, replay/cache store, TTLs, headers, and secrets).

`verify-vp` creates a fresh VP and verifies it via `/v1/vp/verify`.

`verify-vp:sdk` creates a fresh VP and verifies it locally (no `/v1/vp/verify` call).

`verify-vp:session-bridge` creates a fresh VP, calls `/v1/vp/verify` with `session: true`, and verifies the returned JWT using `/v1/sessions/public-key`.

`verify-vp-session-bridge` uses `HELIX_API_URL` (or `API_BASE_URL`) as-is for API calls.
`verify-vp:sdk` performs local verification and still fetches DID/status resources referenced by the credential as needed.

`scope-check` is the authorization-only subset (scope + target-service checks on an already verified, active payload).

`revocation-check` is self-contained: it onboards a fresh credential, revokes it, verifies the status bit flip, then onboards a replacement credential.

## Real Framework Middleware

`framework-middleware` demonstrates the real LangChain and MCP adapters without mocking the Helix client. It uses the live Helix API, creates a real agent DID during onboarding, stores an encrypted wallet, requests real VP templates, signs VPs locally, and verifies them through the API.

Configure `.env` for the local API flow first:

```sh
HELIX_ADMIN_API_KEY=...
```

Then run:

```sh
pnpm install
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
