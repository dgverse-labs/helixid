# helix-core

Shared primitives for the Helix ID platform — VC schemas, crypto utilities, OpenAPI spec, config validation, error types, audit log interface, and StatusList2021 logic.

## Dependency Rule

`helix-core` has **no monorepo siblings as dependencies**. It is a pure library imported by `helix-api` and `helix-sdk-js`. It never imports from them.

## Modules

| Module | Purpose |
|---|---|
| `config/` | Zod-validated environment config — single source for all env vars |
| `crypto/` | DID generation, VP signing, signature verification, key utilities |
| `schemas/` | VC schema definitions — agent VC, user VC, privilege scopes |
| `errors/` | Shared error types and error codes |
| `audit/` | Audit log event interface (implementations live in helix-api and helix-sdk-js) |
| `status-list/` | W3C StatusList2021 bitstring logic |
| `openapi/` | OpenAPI spec — single source of truth for all API contracts |

## Scripts

```bash
npm run build       # Compile TypeScript
npm run test        # Run tests with coverage
npm run lint        # ESLint
npm run typecheck   # Type-check without emitting
```
