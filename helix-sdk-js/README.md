# helix-sdk-js

TypeScript/JavaScript SDK for Helix ID — `HelixClient`, local signing, agent wallet management.

## Key Design Principles

- **SA-1**: The agent's private key is generated locally and stored in `AgentWallet`. It is never transmitted to helix-api.
- `buildAndSignVP` executes entirely client-side — the API only sees the signed VP.
- `HelixClient` is the only public surface — consumers do not import internal modules.

## Modules

| Module | Purpose |
|---|---|
| `client/` | `HelixClient` — public API surface |
| `wallet/` | `AgentWallet` — encrypted local key/DID/VC storage |
| `vp/` | `VPBuilder` — VP construction and local signing |
| `http/` | `HttpAdapter` — internal HTTP client |
| `audit/` | SDK-side audit log implementation |

## Scripts

```bash
npm run build          # Compile TypeScript
npm run test           # Run tests with coverage
npm run test:security  # Run security tests
npm run lint           # ESLint
npm run typecheck      # Type-check without emitting
```
