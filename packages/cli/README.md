# @helix-id/cli

Platform Operator CLI for HelixID setup-time operations. The binary is named `helix`.

All wallet encryption uses `HELIX_WALLET_PASSPHRASE` from the environment — never pass a passphrase on the command line.

## Install

From the monorepo root:

```bash
nvm use
pnpm install
pnpm --filter @helix-id/cli build
```

Run locally during development:

```bash
pnpm exec tsx src/bin/helix.ts did create --method web --domain example.com --wallet ./issuer.enc
```

## Commands

### `helix did create`

Create an encrypted wallet and DID.

```bash
export HELIX_WALLET_PASSPHRASE='your-secret'

# Issuer (did:web)
helix did create --method web --domain example.com --wallet ./issuer.enc

# Agent (did:key)
helix did create --method key --wallet ./agent.enc
```

### `helix issuer init`

Verify an issuer wallet loads correctly.

```bash
helix issuer init --wallet ./issuer.enc
```

### `helix status-list create`

Create a signed BitstringStatusList credential file.

```bash
helix status-list create \
  --length 131072 \
  --output ./public/status/1.json \
  --base-url https://example.com/status/1 \
  --wallet ./issuer.enc
```

### `helix vc issue`

Issue a `HelixAgentCredential` and update the status list file.

```bash
helix vc issue \
  --agent-did did:key:z6Mk... \
  --scopes read:orders,write:bookings \
  --expires 90d \
  --status-list ./public/status/1.json \
  --base-url https://example.com/status/1 \
  --wallet ./issuer.enc \
  --output ./vc-agent-001.json
```

Send the output VC file to the agent out of band. The agent stores it with `wallet.addCredential(vc)`.

### `helix vc self-issue`

Dev-only self-signed credential for local testing.

```bash
helix vc self-issue \
  --scopes read:orders \
  --expires 24h \
  --wallet ./agent.enc
```

### `helix revoke`

Revoke a credential by flipping its status list bit.

```bash
helix revoke \
  --vc-id urn:uuid:abc-123 \
  --status-list ./public/status/1.json \
  --wallet ./issuer.enc
```

### `helix wallet inspect`

Inspect wallet metadata without printing the private key.

```bash
helix wallet inspect --wallet ./agent.enc
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `HELIX_WALLET_PASSPHRASE` | Always | Wallet encryption passphrase |
