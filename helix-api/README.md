# helix-api

Fastify HTTP API for Helix ID — self-hostable, stateful operations across four boundaries.

## Boundaries

| Boundary | Routes | Description |
|---|---|---|
| B1 | `/did/*` | DID lifecycle, Hedera anchoring, DID resolution |
| B2 | `/vc/*` | VC issuance, revocation, renewal, status list |
| B3 | `/vp/*` | VP template generation, verification, vpId lifecycle |
| B4 | `/agent/*` | Agent onboarding, user DID, challenge-response, service registry |

## Scripts

```bash
npm run dev          # Start with tsx watch (hot reload)
npm run build        # Compile TypeScript
npm run start        # Run compiled output
npm run test         # Run all tests with coverage
npm run test:security # Run security tests only
npm run db:migrate   # Run Prisma migrations
npm run db:generate  # Regenerate Prisma client
npm run db:reset     # Reset database (destructive)
```

## Architecture

- Routes call Services only — never Repositories directly
- Services call Repositories for data access
- Boundaries communicate through internal service interfaces only (§7 of constitution)
- All Hedera interaction goes through `IHederaClient` interface (HR-2)
