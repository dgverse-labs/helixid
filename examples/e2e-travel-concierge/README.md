# E2E Travel Concierge

This example shows a travel agent identity moving through a full Helix ID lifecycle.

A user asks an agent to plan a London trip. The agent owner enrolls that agent with limited privileges: it can search flights, book flights, and search hotels, but it cannot book hotels. The current Helix ID scope allow-list is commerce-oriented, so this example maps travel actions to existing scopes: flight search uses `read:catalog`, flight booking uses `write:orders`, hotel search uses `read:inventory`, and hotel booking would require `write:inventory`. The booking platform does not trust the agent just because it sent a request. It asks Helix ID to verify a signed Verifiable Presentation, then checks the verified credential scopes before serving each route.

Without Helix ID, the platform would only see a request from software. With Helix ID, it can verify which DID presented the request, that the credential was issued by Helix ID, that the credential is not expired or revoked, that the VP has not been replayed, and that the presentation is bound to the target service.

## Prerequisites

Prepare Helix ID for real Hedera before running the example:

```sh
pnpm setup:hedera
```

That script generates missing Helix/JWT key material, derives public keys, and updates `.env` without printing private keys. If you need a fresh issuer DID anchored on Hedera, run:

```sh
pnpm setup:hedera -- --create-issuer-did
```

Start a Helix ID API instance with the root `.env` exported and without `HEDERA_MOCK=true`:

```sh
set -a; source .env; set +a
pnpm --filter @helix-id/api start
```

Then point this example at it:

```sh
cp .env.example .env
```

The current API has `amazon` and `helix-delegation` as built-in VP target services, so this example uses `HELIX_TARGET_SERVICE=amazon` by default even though the local verifier is a travel platform.

## Run

Terminal 1:

```sh
pnpm --filter @helix-id/example-e2e-travel-concierge enroll
```

Watch for the agent DID, VC id, scopes, expiry, and `agent/wallet.enc`.

Terminal 2:

```sh
pnpm --filter @helix-id/example-e2e-travel-concierge platform
```

The platform listens on port `3001` and logs every verification and authorization decision.

Terminal 3:

```sh
pnpm --filter @helix-id/example-e2e-travel-concierge agent
```

The agent performs five actions:

1. Searches flights.
2. Searches hotels.
3. Books a flight.
4. Attempts to book a hotel and is denied because `write:inventory` was not granted.
5. Attempts to book another flight after revocation and is denied because the VC is revoked.

## Revocation Moment

Between action 4 and action 5, the agent script prints:

```sh
curl -X POST http://localhost:3000/v1/vcs/{vcId}/revoke \
  -H "x-admin-api-key: $HELIX_ADMIN_API_KEY"
```

Run it, then press Enter in the agent terminal. The next VP verification fails because Helix ID checks credential status on each verification.

## What Each File Demonstrates

`operator/enroll-agent.ts` creates a one-use enrollment token, onboards the agent through the current SDK, and saves the encrypted wallet.

`platform/booking-platform.ts` is a verifier. It does not use the SDK. It calls `/v1/vp/verify`, keeps internal failure reasons in logs, and returns stable public error codes.

`agent/agent.ts` loads the wallet, requests a fresh VP template for each action, signs locally with `VPBuilder`, and presents the signed VP to the platform.

`fixtures/vp.json` is a placeholder for a real VP captured from a successful run.
