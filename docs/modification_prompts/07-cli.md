# Prompt 07 — `@helix-id/cli` New Package

## Dependency prerequisite
**Prompts 01 (helix-core), 02 (did-hedera), and 03 (sdk-js) must be complete.** CLI wraps SDK and core — no new crypto.

## Context
Create a new CLI package at `packages/cli/`. The binary is named `helix`. This is for Platform Operator setup-time operations only — not for agent runtime. All commands are one-off or occasional operations. Passphrase always comes from `HELIX_WALLET_PASSPHRASE` env var — never prompt interactively, never accept as a CLI flag (security risk).

---

## Package setup

### `packages/cli/package.json`

```json
{
  "name": "@helix-id/cli",
  "version": "0.1.0",
  "description": "HelixID CLI for Platform Operator setup",
  "bin": {
    "helix": "./dist/bin/helix.js"
  },
  "dependencies": {
    "@helix-id/sdk-js": "workspace:*",
    "@helix-id/core": "workspace:*",
    "commander": "^11.0.0",
    "chalk": "^5.0.0"
  },
  "optionalDependencies": {
    "@helix-id/did-hedera": "workspace:*"
  }
}
```

Add to pnpm workspace.

---

## Commands to implement

### `helix did create`

```bash
helix did create --method web --domain example.com --wallet issuer.enc
helix did create --method hedera --network testnet --wallet issuer.enc
helix did create --method key --wallet agent.enc
```

**`--method web`:**
- Read passphrase from `HELIX_WALLET_PASSPHRASE`
- Generate Ed25519 keypair via SDK
- Construct W3C DID document for `did:web:{domain}`
- Save encrypted issuer wallet to `--wallet` path
- Print to stdout:
  ```
  ✓ Issuer DID created: did:web:example.com

  Serve this file at: https://example.com/.well-known/did.json

  {
    "@context": ["https://www.w3.org/ns/did/v1"],
    "id": "did:web:example.com",
    ...
  }
  ```

**`--method hedera`:**
- Check `@helix-id/did-hedera` importable — if not: print `Error: Hedera DID method requires: npm install @helix-id/did-hedera` and exit code 1
- Read `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, use `--network` flag
- Anchor DID via `anchorDidHedera()`
- Save wallet, print DID and transaction ID

**`--method key`:**
- Generate keypair, derive `did:key`
- Save wallet
- Print DID — note this is for agents, not issuers

---

### `helix issuer init`

```bash
helix issuer init --wallet issuer.enc
```

- Load issuer wallet from `--wallet`
- Print:
  ```
  ✓ Issuer ready

  DID:                did:web:example.com
  Public key:         ed25519:abc123...
  Verification method: did:web:example.com#key-1
  ```
- Confirms the issuer wallet is valid and readable before proceeding with issuance

---

### `helix status-list create`

```bash
helix status-list create \
  --length 131072 \
  --output ./public/status/1.json \
  --base-url https://example.com/status/1 \
  --wallet issuer.enc
```

- Generate a BitstringStatusList VC with `--length` bits, all zero
- Set `id` to `--base-url`
- Sign with issuer key from `--wallet`
- Write signed VC JSON to `--output`
- Print:
  ```
  ✓ StatusList created
  
  Output:   ./public/status/1.json
  Serve at: https://example.com/status/1
  Capacity: 131072 credentials
  ```

---

### `helix vc issue`

```bash
helix vc issue \
  --agent-did did:key:z6Mk... \
  --scopes read:orders,write:bookings \
  --expires 90d \
  --status-list ./public/status/1.json \
  --base-url https://example.com/status/1 \
  --wallet issuer.enc \
  --output ./vc-agent-001.json
```

- Load issuer wallet
- Load StatusList from `--status-list`
- Find next available bit index
- Issue `HelixAgentCredential` VC:
  - `issuer`: issuer DID from wallet
  - `credentialSubject.id`: `--agent-did`
  - `credentialSubject.privilegeScopes`: parsed from `--scopes`
  - `credentialSubject.maxDelegationDepth`: 1 (default, add `--max-delegation-depth` flag)
  - `validFrom`: now
  - `validUntil`: now + parsed `--expires`
  - `credentialStatus.statusListIndex`: next available index
  - `credentialStatus.statusListCredential`: `--base-url`
- Update and re-sign StatusList
- Write updated StatusList back to `--status-list`
- Write signed VC to `--output` or stdout if no `--output`
- Print:
  ```
  ✓ VC issued

  Agent DID:    did:key:z6Mk...
  VC ID:        urn:uuid:abc-123
  Scopes:       read:orders, write:bookings
  Expires:      2025-09-15T10:00:00Z
  Status index: 42

  Send ./vc-agent-001.json to the agent out of band.
  Agent runs: wallet.addCredential(vc) to store it.
  ```

---

### `helix vc self-issue`

```bash
helix vc self-issue \
  --scopes read:orders \
  --expires 24h \
  --wallet agent.enc
```

- Load agent wallet from `--wallet`
- Call `wallet.selfIssueVC({ scopes, expiresIn })`
- Print warning prominently:
  ```
  ⚠ Self-signed VC — for local development only

  This VC is not trusted in production. Any verifier running
  verifyVP() in production mode will reject it.

  VC added to wallet: agent.enc
  Scopes: read:orders
  Expires: 24h
  ```

---

### `helix revoke`

```bash
helix revoke \
  --vc-id urn:uuid:abc-123 \
  --status-list ./public/status/1.json \
  --wallet issuer.enc
```

- Load issuer wallet
- Load StatusList from `--status-list`
- Find entry for `--vc-id` — throw clear error if not found
- Flip bit to 1
- Re-sign StatusList with issuer key
- Write updated StatusList to `--status-list`
- Print:
  ```
  ✓ VC revoked

  VC ID:        urn:uuid:abc-123
  Status index: 42
  Bit flipped:  0 → 1

  Push ./public/status/1.json to your HTTPS server.
  Verifiers will see the revocation on next StatusList fetch.
  ```

---

### `helix wallet inspect`

```bash
helix wallet inspect --wallet agent.enc
```

- Load wallet
- Print DID, public key, credential count, credential IDs, scopes, expiry
- Never print private key — if accidentally attempted, throw and exit

---

## Error handling

All commands:
- If `HELIX_WALLET_PASSPHRASE` not set: print `Error: HELIX_WALLET_PASSPHRASE environment variable is required` and exit code 1
- If wallet file not found: print clear path and suggestion
- Use chalk for colored output: green `✓` for success, red `✗` for errors, yellow `⚠` for warnings
- Exit code 0 on success, 1 on error — important for scripting

---

## Test coverage required

| Test | What to verify |
|---|---|
| `helix did create --method web` | Creates wallet, prints did:web DID and did.json |
| `helix did create --method hedera` missing package | Exits 1 with clear install instruction |
| `helix did create --method key` | Creates wallet with did:key |
| `helix issuer init` | Loads wallet, prints DID and key info |
| `helix status-list create` | Creates valid signed StatusList VC file |
| `helix vc issue` | Issues VC, updates StatusList, writes output file |
| `helix vc self-issue` | Issues self-signed VC, adds to wallet, prints warning |
| `helix revoke` | Flips correct bit, re-signs, writes updated file |
| `helix revoke` unknown vc-id | Exits 1 with clear error |
| `helix wallet inspect` | Prints wallet info, no private key |
| Missing `HELIX_WALLET_PASSPHRASE` | All commands exit 1 with clear message |
