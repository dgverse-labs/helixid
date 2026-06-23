# Framework Middleware

This example demonstrates the real HelixID LangChain and MCP adapters against a live Helix API. It does not mock the Helix client, VP templates, verification, wallet loading, or onboarding flow.

The setup flow creates a real agent DID through the current Helix onboarding API, saves an encrypted agent wallet, and issues a real `HelixAgentCredential`. The LangChain and MCP scripts then request real VP templates, sign VPs locally from the encrypted wallet, and verify them through the API.

## Who Needs What

The admin prerequisites are for the setup step only. Setup enrolls the agent, issues the VC, and writes the wallet. That is a one-time platform-operator action, not something every LangChain or MCP developer repeats.

| Who | Does what | Needs |
| --- | --- | --- |
| Platform operator | Runs `setup-live.ts` once to onboard the agent | Running Helix API, admin-capable setup environment |
| Framework developer | Adds `HelixIDMiddleware`, `HelixIDToolWrapper`, or MCP middleware to app code | Wallet file, `WALLET_PASSPHRASE`, `HELIX_API_URL` |

The middleware value is that framework developers do not handle cryptography, DID anchoring, VC issuance, or VP construction directly. Once they have an onboarded wallet, a few lines of config make every protected tool call carry a locally signed, verifiable credential.

## Prerequisites

Configure the root `.env` for the local API flow:

```sh
HELIX_ADMIN_API_KEY=...
```

Prepare the environment:

```sh
pnpm install
```

Start the API with the root environment loaded:

```sh
set -a; source .env; set +a
pnpm --filter @helix-id/api dev
```

## Run

In a second terminal, the platform operator runs setup once:

```sh
set -a; source .env; set +a
pnpm example:middleware:setup
```

After setup, a LangChain or MCP developer only needs the generated wallet file, the wallet passphrase, and the Helix API URL:

```sh
export HELIX_API_URL=http://localhost:3000
export WALLET_PASSPHRASE=change-this-passphrase
pnpm example:middleware:langchain
pnpm example:middleware:mcp
```

`setup-live.ts` writes `agent/wallet.enc`. The wallet contains encrypted private key material and is ignored by Git.

## What Each Script Shows

`setup-live.ts` creates a one-use enrollment token, completes real onboarding, stores the encrypted wallet, and prints the agent DID, VC id, granted scopes, and expiry.

`langchain.ts` uses `HelixIDMiddleware` to inject `_helixVP` into tool input, verifies that VP through the live API, then uses `HelixIDToolWrapper` around a small structured tool.

`mcp.ts` uses `attachHelixVP` to add a real `Authorization: HelixVP ...` header, sends that request through `helixidMCPMiddleware`, demonstrates an allowed `read:orders` call, and demonstrates an insufficient-scope denial for `write:inventory`.

## Environment Overrides

- `HELIX_API_URL` or `API_BASE_URL`: Helix API URL, default `http://localhost:3000`
- `WALLET_PASSPHRASE`: wallet passphrase, default `change-this-passphrase`
- `HELIX_TARGET_SERVICE`: VP target service, default `amazon`
- `HELIX_USER_DID`: simulated user DID, default `did:web:user.example.com`
