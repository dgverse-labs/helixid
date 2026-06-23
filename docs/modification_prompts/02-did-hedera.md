
## Dependency prerequisite

## Context

---

## Changes required

```json
{
  "version": "0.1.0",
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

```typescript
```

Rules:
- Parse the latest HCS message to get the DID document
- Validate it is a valid W3C DID document
- Return `DIDDocument`

Support both `testnet` and `mainnet` mirror node URLs.

---

```typescript
  didDocument: DIDDocument
  network: 'testnet' | 'mainnet'
}

  did: string
  topicId: string
  transactionId: string
}
```

Rules:
- Use `@hashgraph/sdk` to create an HCS topic
- Publish the DID document as the first message
- Log HBAR cost warning before submitting transaction

---

```typescript
export async function publishStatusListToHCS(
  statusListVC: SignedVC,
): Promise<{ transactionId: string }>
```

Rules:
- Publishes the signed StatusList VC to HCS as a message
- Used for on-chain audit trail of revocation events
- Optional — not required for revocation to work. StatusList HTTPS file is authoritative. HCS is the audit layer.

---

```typescript
export { publishStatusListToHCS } from './status-list-publisher'
```

---

### 6. Registration with helix-core resolver

The `helix-core` did-resolver does a conditional dynamic require:
```typescript
// this is already handled in helix-core/src/did-resolver.ts (Prompt 01)
```

No change needed here — just ensure the export name matches what `helix-core` expects.

---

- Remove all `@hashgraph/sdk` imports from `helix-core/`
- Remove all `@hashgraph/sdk` imports from `helix-api/` that relate to DID anchoring
- Remove `@hashgraph/sdk` from `helix-core/package.json` dependencies

---

## Test coverage required

| Test | What to verify |
|---|---|

