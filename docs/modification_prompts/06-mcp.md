# Prompt 06 — `@helix-id/mcp` Modifications

## Dependency prerequisite
**Prompt 03 (sdk-js) must be complete.** Same pattern as Prompt 05 (langchain) — remove `HelixClient`, use standalone SDK functions.

## Context
`packages/mcp/` contains MCP middleware. Two functions: `helixidMCPMiddleware` (inbound — verifies VP on incoming tool calls) and `attachHelixVP` (outbound — attaches VP to outgoing tool calls). Both currently take `helixClient`. Both must be refactored to use standalone SDK functions only.

---

## Changes required

### 1. `helixidMCPMiddleware` — inbound verifier

**Before:**
```typescript
const requireHelix = helixidMCPMiddleware({
  helixClient,
  requiredScopes: ['read:orders'],
})
```

**After:**
```typescript
const requireHelix = helixidMCPMiddleware({
  requiredScopes: ['read:orders'],
  allowSelfSigned: false,          // optional, default false
})
```

Internal implementation:
```typescript
import { verifyVP, requireScope } from '@helix-id/sdk-js'

export function helixidMCPMiddleware(options: MCPMiddlewareOptions) {
  return async (toolCall: MCPToolCall): Promise<MCPToolCall> => {
    const vp = toolCall.input?._helixVP
    if (!vp) throw new HelixError('VP_MISSING', 'No _helixVP in tool call input')

    const result = await verifyVP(vp, {
      allowSelfSigned: options.allowSelfSigned ?? false
    })

    if (!result.valid) throw new HelixError('VP_VERIFICATION_FAILED', result.error)

    for (const scope of options.requiredScopes ?? []) {
      requireScope(result, scope)
    }

    return toolCall
  }
}
```

---

### 2. `attachHelixVP` — outbound VP attachment

**Before:**
```typescript
const outboundCall = await attachHelixVP(toolCall, {
  helixClient,
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
const outboundCall = await attachHelixVP(toolCall, {
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  targetService: 'orders',
  userDid: 'did:key:user',         // optional
})
```

Internal implementation:
```typescript
import { AgentWallet, VPBuilder } from '@helix-id/sdk-js'

export async function attachHelixVP(
  toolCall: MCPToolCall,
  options: AttachHelixVPOptions
): Promise<MCPToolCall> {
  const wallet = await AgentWallet.load(options.walletFilePath, options.walletPassphrase)
  const vc = wallet.credentials[0]
  if (!vc) throw new Error('No credential in wallet')

  const vp = await new VPBuilder({
    vc,
    holderDid: wallet.did,
    targetService: options.targetService,
    userDid: options.userDid ?? 'did:key:anonymous'
  }).sign(wallet.privateKeyHex, `${wallet.did}#key-1`)

  return {
    ...toolCall,
    input: { ...toolCall.input, _helixVP: vp }
  }
}
```

---

### 3. Update package exports

```typescript
// packages/mcp/src/index.ts
export { helixidMCPMiddleware } from './middleware'
export { attachHelixVP } from './attach'
export type { MCPMiddlewareOptions, AttachHelixVPOptions } from './types'
```

---

### 4. Remove dependencies

Remove from `packages/mcp/package.json`:
- Any direct HTTP client for API calls
- Keep only: `@helix-id/sdk-js`, `@modelcontextprotocol/sdk`

---

## Test coverage required

| Test | What to verify |
|---|---|
| `helixidMCPMiddleware` | Throws `VP_MISSING` when no `_helixVP` in input |
| `helixidMCPMiddleware` | Passes through valid VP |
| `helixidMCPMiddleware` | Throws `VP_VERIFICATION_FAILED` on invalid VP |
| `helixidMCPMiddleware` | Throws `INSUFFICIENT_SCOPE` when scope missing |
| `attachHelixVP` | Injects `_helixVP` into tool call input |
| `attachHelixVP` | Throws when wallet has no credentials |
| No `HelixClient` import | Grep for HelixClient — must not appear |
| No API URL | Grep for `localhost:3000` — must not appear |
