# Prompt 05 — `@helix-id/langchain` Modifications

## Dependency prerequisite
**Prompt 03 (sdk-js) must be complete.** This package now imports standalone `VPBuilder` and `verifyVP()` from `@helix-id/sdk-js` instead of `HelixClient`.

## Context
`packages/langchain/` contains LangChain/LangGraph middleware. Currently it takes a `helixClient: HelixClient` parameter which requires an API URL. After this prompt, the middleware takes only `walletPath` and `walletPassphrase` — no API URL, no `HelixClient`, no network call at middleware runtime.

---

## Changes required

### 1. New middleware signature

**Before:**
```typescript
const middleware = HelixIDMiddleware({
  helixClient,                    // ← remove
  walletPassphrase: '...',
  walletFilePath: './agent.enc',
  vcId: '...',
  vcType: 'HelixAgentCredential',
  userDid: 'did:...',
  targetService: 'orders',
})
```

**After:**
```typescript
const middleware = HelixIDMiddleware({
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  targetService: 'orders',
  userDid: 'did:key:user',        // optional, defaults to 'did:key:anonymous'
})
```

Remove `helixClient`, `vcId`, `vcType` parameters. The middleware reads the VC directly from the wallet. Uses `wallet.credentials[0]` by default. If multiple credentials in wallet, uses the one matching `targetService` if `targetService` binding is present in VC, otherwise uses first.

---

### 2. Internal implementation

```typescript
// packages/langchain/src/middleware.ts
import { AgentWallet, VPBuilder } from '@helix-id/sdk-js'

export function HelixIDMiddleware(options: HelixIDMiddlewareOptions) {
  let wallet: AgentWallet | null = null

  async function getWallet(): Promise<AgentWallet> {
    if (!wallet) {
      wallet = await AgentWallet.load(options.walletFilePath, options.walletPassphrase)
    }
    return wallet
  }

  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const w = await getWallet()
    const vc = w.credentials[0]
    if (!vc) throw new Error('No credential in wallet. Run enrollment first.')

    const vp = await new VPBuilder({
      vc,
      holderDid: w.did,
      targetService: options.targetService,
      userDid: options.userDid ?? 'did:key:anonymous'
    }).sign(w.privateKeyHex, `${w.did}#key-1`)

    return { ...input, _helixVP: vp }
  }
}
```

Wallet is loaded once and cached in closure — not reloaded on every tool call.

---

### 3. Planning-time scope filter

Add utility for filtering tools based on `credentialSubject.privilegeScopes` — read directly from wallet, no API call:

```typescript
export async function filterToolsByScope(
  tools: StructuredTool[],
  walletFilePath: string,
  walletPassphrase: string
): Promise<StructuredTool[]>
```

Rules:
- Load wallet, read `wallet.credentials[0].credentialSubject.privilegeScopes`
- Filter tools to only those whose name or metadata scope tag matches an allowed scope
- Convention: tool declares required scope via `tool.metadata?.requiredScope`
- If tool has no `requiredScope` metadata, include it by default

---

### 4. Update package exports

```typescript
// packages/langchain/src/index.ts
export { HelixIDMiddleware } from './middleware'
export { filterToolsByScope } from './scope-filter'
export type { HelixIDMiddlewareOptions } from './types'
```

---

### 5. Remove dependencies

Remove from `packages/langchain/package.json`:
- Any direct `axios` or `node-fetch` for API calls
- Keep only: `@helix-id/sdk-js`, `@langchain/core`

---

## Test coverage required

| Test | What to verify |
|---|---|
| Middleware injects `_helixVP` into tool input | VP present in output object |
| Middleware loads wallet once, not per call | Wallet load called once across multiple invocations |
| Middleware throws if wallet has no credentials | Clear error message |
| `filterToolsByScope()` | Tools without requiredScope included by default |
| `filterToolsByScope()` | Tools with requiredScope excluded if scope not in VC |
| `filterToolsByScope()` | Tools with matching scope included |
| No `HelixClient` import | Grep for HelixClient — must not appear in package |
| No API URL in any test or source | Grep for `localhost:3000` — must not appear |
