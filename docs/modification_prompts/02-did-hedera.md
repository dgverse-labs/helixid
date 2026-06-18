# Prompt 02 — `@helix-id/did-hedera` New Package

## Dependency prerequisite
**Prompt 01 (helix-core) must be complete.** This package implements the `did:hedera` resolver hook that `helix-core/src/did-resolver.ts` conditionally loads.

## Context
All Hedera-specific code is being extracted from `helix-core` and `helix-api` into this standalone optional package. Developers who never use Hedera never install it. The `@hashgraph/sdk` dependency stays isolated here and never appears in `helix-core` or `helix-sdk-js`. Create this package at `packages/did-hedera/`.

---

## Changes required

### 1. Package setup — `packages/did-hedera/package.json`

```json
{
  "name": "@helix-id/did-hedera",
  "version": "0.1.0",
  "description": "Optional Hedera DID method support for HelixID",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@hashgraph/sdk": "^2.x",
    "@helix-id/core": "workspace:*"
  }
}
```

Add to pnpm workspace `pnpm-workspace.yaml` if not already included via glob.

---

### 2. DID Resolver — `packages/did-hedera/src/resolver.ts`

```typescript
export async function resolveDidHedera(did: string): Promise<DIDDocument>
```

Rules:
- Parse `did:hedera:{network}:{topicId}` or `did:hedera:{network}:{accountId}`
- Fetch from Hedera mirror node REST: `https://{network}.mirrornode.hedera.com/api/v1/topics/{topicId}/messages`
- Parse the latest HCS message to get the DID document
- Validate it is a valid W3C DID document
- Return `DIDDocument`
- Throw `HEDERA_RESOLUTION_FAILED` with mirror node error details if fetch fails

Support both `testnet` and `mainnet` mirror node URLs.

---

### 3. DID Anchoring — `packages/did-hedera/src/anchor.ts`

```typescript
export interface HederaAnchorOptions {
  didDocument: DIDDocument
  operatorId: string           // from env HEDERA_OPERATOR_ID
  operatorKey: string          // from env HEDERA_OPERATOR_KEY
  network: 'testnet' | 'mainnet'
}

export async function anchorDidHedera(options: HederaAnchorOptions): Promise<{
  did: string
  topicId: string
  transactionId: string
}
```

Rules:
- Use `@hashgraph/sdk` to create an HCS topic
- Publish the DID document as the first message
- Return the resulting DID in `did:hedera:{network}:{topicId}` format
- Log HBAR cost warning before submitting transaction
- Throw `HEDERA_ANCHOR_FAILED` with transaction details if submission fails

---

### 4. StatusList Publisher — `packages/did-hedera/src/status-list-publisher.ts`

```typescript
export async function publishStatusListToHCS(
  statusListVC: SignedVC,
  options: HederaAnchorOptions
): Promise<{ transactionId: string }>
```

Rules:
- Publishes the signed StatusList VC to HCS as a message
- Used for on-chain audit trail of revocation events
- Optional — not required for revocation to work. StatusList HTTPS file is authoritative. HCS is the audit layer.

---

### 5. Exports — `packages/did-hedera/src/index.ts`

```typescript
export { resolveDidHedera } from './resolver'
export { anchorDidHedera } from './anchor'
export { publishStatusListToHCS } from './status-list-publisher'
```

---

### 6. Registration with helix-core resolver

The `helix-core` did-resolver does a conditional dynamic require:
```typescript
// this is already handled in helix-core/src/did-resolver.ts (Prompt 01)
// packages/did-hedera just needs to export resolveDidHedera correctly
```

No change needed here — just ensure the export name matches what `helix-core` expects.

---

### 7. Remove Hedera from helix-core and helix-api

- Remove all `@hashgraph/sdk` imports from `helix-core/`
- Remove all `@hashgraph/sdk` imports from `helix-api/` that relate to DID anchoring
- Remove `@hashgraph/sdk` from `helix-core/package.json` dependencies
- In `helix-api`, replace direct Hedera calls with imports from `@helix-id/did-hedera` — but only instantiate if `DID_METHOD=hedera` env var is set

---

## Test coverage required

| Test | What to verify |
|---|---|
| `resolveDidHedera()` | Fetches from correct mirror node URL for testnet |
| `resolveDidHedera()` | Fetches from correct mirror node URL for mainnet |
| `resolveDidHedera()` | Throws `HEDERA_RESOLUTION_FAILED` on network error |
| `anchorDidHedera()` | Submits HCS transaction (mock @hashgraph/sdk) |
| `anchorDidHedera()` | Returns correct did:hedera DID format |
| `anchorDidHedera()` | Throws `HEDERA_ANCHOR_FAILED` on submission failure |
| helix-core resolver | `resolveDID('did:hedera:...')` delegates to this package when installed |
| helix-core resolver | `resolveDID('did:hedera:...')` throws `DID_METHOD_NOT_AVAILABLE` when not installed |

Mock `@hashgraph/sdk` in tests — do not make real Hedera calls in unit tests. Live tests go in `helix-api/tests/live/` with a `--hedera` flag guard.
