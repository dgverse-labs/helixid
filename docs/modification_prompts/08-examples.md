# Prompt 08 — Examples Updates and New Examples

## Dependency prerequisite
**Prompts 03 (sdk-js), 05 (langchain), 06 (mcp), and 07 (cli) must be complete.** Examples consume the updated SDK surface — they must not use the old `HelixClient`-based API for agent or verifier operations.

## Context
`examples/` contains the e2e-travel-concierge and framework-middleware examples. All agent-side and verifier-side code must be refactored to use standalone SDK functions. `HelixClient` stays only in operator enrollment scripts. Three new examples are added: replay protection, self-signed dev round-trip, and did:web issuer setup.

After Prompt 06, `@helix-id/mcp` verifies VPs from `toolCall.input._helixVP` (raw `SignedVP` object) and throws typed `HelixError` codes — not Authorization headers, not MCP `{ ok, error: { code: -32003 } }` objects, and not `HelixSession` JWT. The framework-middleware MCP example must reflect that contract.

---

## Changes to existing examples

### `examples/e2e-travel-concierge/agent/create-vp-fixture.ts`

**Before:**
```typescript
const client = new HelixClient(process.env.HELIX_API_URL)
const template = await client.createVPTemplate({ ... })
const signedVP = await new VPBuilder(template.unsignedVP).sign(...)
```

**After:**
```typescript
import { AgentWallet, VPBuilder } from '@helix-id/sdk-js'

const wallet = await AgentWallet.load('./agent/wallet.enc', process.env.WALLET_PASSPHRASE!)
const vc = wallet.credentials[0]
if (!vc) throw new Error('No credential in wallet. Run enroll-agent.ts first.')

const vp = await new VPBuilder({
  vc,
  holderDid: wallet.getDID(),
  targetService: 'travel-concierge',
  userDid: 'did:key:user-demo',
}).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`)

console.log(JSON.stringify(vp, null, 2))
```

No `HelixClient`. No API URL. No `HELIX_API_URL` env var needed.

---

### `examples/e2e-travel-concierge/platform/booking-platform.ts`

**Before:**
```typescript
const client = new HelixClient(process.env.HELIX_API_URL)
const result = await client.verifyVP(incomingVP)
const scopes = result.credentialSubject.privilegeScopes  // reading from raw VP — bug
```

**After:**
```typescript
import { verifyVP, requireScope } from '@helix-id/sdk-js'

const result = await verifyVP(incomingVP, {
  expectedTargetService: 'travel-concierge'
})

if (!result.valid) {
  return res.status(401).json({ error: result.error })
}

requireScope(result, 'write:bookings')

// scopes come from verified result, not raw VP
console.log('Agent:', result.agentDid)
console.log('Scopes:', result.privilegeScopes)
```

Fix the scope-reading bug: scopes must come from `result.privilegeScopes` (post-verification), not from raw VP fields.

---

### `examples/e2e-travel-concierge/operator/enroll-agent.ts`

Keep `HelixClient` here — this is the correct place for it. No changes needed to the enrollment logic. Add a comment at the top:

```typescript
/**
 * Operator enrollment script — run once per agent.
 * After enrollment, agents use the SDK directly without HelixClient.
 * See: examples/e2e-travel-concierge/agent/create-vp-fixture.ts
 */
```

---

### `examples/framework-middleware/langchain.ts`

**Before:**
```typescript
const middleware = HelixIDMiddleware({
  helixClient: new HelixClient(process.env.HELIX_API_URL!),
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  vcId: process.env.AGENT_VC_ID!,
  vcType: 'HelixAgentCredential',
  targetService: 'orders',
})
```

**After:**
```typescript
import { HelixIDMiddleware, filterToolsByScope } from '@helix-id/langchain'

const middleware = HelixIDMiddleware({
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  targetService: 'orders',
  userDid: 'did:key:user'
})

// planning-time: filter tools to only those the agent has scope for
const allowedTools = await filterToolsByScope(
  allTools,
  './agent-wallet.enc',
  process.env.WALLET_PASSPHRASE!
)
```

---

### `examples/framework-middleware/mcp.ts`

**Before (old adapter — Authorization header, HelixClient, MCP error objects):**
```typescript
const requireHelix = helixidMCPMiddleware({
  helixClient: new HelixClient(process.env.HELIX_API_URL!),
  verifyVP: verifyWithScopes,
  requiredScopes: ['read:orders'],
})

const outboundCall = await attachHelixVP(
  { name: 'orders.lookup', arguments: { orderId: 'ORD-1001' } },
  {
    walletPassphrase: process.env.WALLET_PASSPHRASE!,
    walletFilePath: './agent-wallet.enc',
    vcId: process.env.AGENT_VC_ID!,
    vcType: 'HelixAgentCredential',
    targetService: 'orders',
  },
)

// VP was attached to headers.Authorization as `HelixVP <base64url>`
// Middleware took MCPRequestLike + optional next callback and returned { ok: false, error: { code: -32003 } }
```

**After (SDK-first — `_helixVP` on tool input, typed HelixErrors):**
```typescript
import { helixidMCPMiddleware, attachHelixVP } from '@helix-id/mcp'
import { walletPassphrase, walletPath, targetService, userDid, logStep } from './shared.js'

const toolCall = { name: 'orders.lookup', input: { orderId: 'ORD-1001' } }

// Outbound — attach locally signed VP to toolCall.input._helixVP (raw SignedVP object)
const outboundCall = await attachHelixVP(toolCall, {
  walletPassphrase,
  walletFilePath: walletPath,
  targetService,
  userDid, // optional — defaults to did:key:anonymous
})

logStep('MCP', `_helixVP attached to tool input (vpId: ${(outboundCall.input?._helixVP as { id?: string }).id})`)

// Inbound — verify VP and required scopes; throws on failure
const requireReadOrders = helixidMCPMiddleware({
  requiredScopes: ['read:orders'],
  allowSelfSigned: false, // optional, default false — never true in production
})

const accepted = await requireReadOrders(outboundCall)
logStep('MCP', `Allowed tool call: ${accepted.name}`)

// Scope denial — middleware throws INSUFFICIENT_SCOPE (not an MCP error object)
const requireWriteInventory = helixidMCPMiddleware({ requiredScopes: ['write:inventory'] })
try {
  await requireWriteInventory(outboundCall)
} catch (error) {
  logStep('MCP', `Denied: ${(error as { code?: string }).code}`)
}
```

Key differences from the old example:
- No `HelixClient`, no `HELIX_API_URL`, no `verifyVP` override, no `MCPRequestLike`, no `next` callback
- No `Authorization: HelixVP …` header — VP lives on `toolCall.input._helixVP` as a parsed `SignedVP` object
- No `HelixSession` JWT path — session bridging is API-only; MCP adapter verifies VPs locally
- Removed `vcId`, `vcType` — credential is selected from wallet (first credential, or match on `targetService` when multiple)
- Errors throw typed `HelixError` subclasses: `VP_MISSING`, `VP_VERIFICATION_FAILED`, `INSUFFICIENT_SCOPE`, `NO_CREDENTIAL_IN_WALLET`
- Tool call shape is `{ name, input }` — not `{ name, arguments, headers }`

**Note:** `@helix-id/langchain` encodes `_helixVP` as a base64url string; `@helix-id/mcp` stores the raw `SignedVP` object. Do not mix the two encodings in the same integration.

---

### `examples/framework-middleware/shared.ts`

Remove MCP-only helpers that existed for the old Authorization-header flow. Keep wallet loading utilities. Changes:

- Remove `createHelixClient()` usage from `mcp.ts` and `langchain.ts` (keep only in `setup-live.ts` for operator enrollment)
- Remove `verifyWithScopes()` from MCP example — `helixidMCPMiddleware` calls `verifyVP()` internally
- Keep `decodeHelixVP` / `encodeHelixVP` for `langchain.ts` only (LangChain adapter base64url-encodes `_helixVP`)
- Simplify `loadWalletSummary()` to use `AgentWallet.load()` static method where possible

---

## New examples to create

### `examples/replay-protection/`

Create `examples/replay-protection/README.md` and `examples/replay-protection/middleware.ts`.

```typescript
// examples/replay-protection/middleware.ts
import express from 'express'
import { verifyVP } from '@helix-id/sdk-js'

const app = express()
app.use(express.json())

async function helixAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const vpHeader = req.headers['x-helix-vp']
  if (!vpHeader) return res.status(401).json({ error: 'VP_MISSING' })

  const vp = JSON.parse(vpHeader as string)

  const result = await verifyVP(vp, {
    expectedTargetService: 'orders-service'
  })

  if (!result.valid) {
    return res.status(401).json({ error: result.error })
  }

  // replay protection — vpId is single-use
  const vpIdKey = `vpid:${result.vpId}`
  if (alreadySeen) {
    return res.status(401).json({ error: 'VP_REPLAY_DETECTED' })
  }

  // store with TTL matching VP expiry
  const vpExpiryMs = new Date(vp.verifiableCredential[0].validUntil).getTime() - Date.now()
  const vpExpirySeconds = Math.floor(vpExpiryMs / 1000)

  // attach verified identity to request
  req.helixAgent = {
    did: result.agentDid,
    scopes: result.privilegeScopes
  }

  next()
}

app.get('/orders', helixAuthMiddleware, (req, res) => {
  res.json({ orders: [], agentDid: req.helixAgent.did })
})
```

---

### `examples/self-signed-dev/`

Create `examples/self-signed-dev/README.md` and `examples/self-signed-dev/round-trip.ts`.

Full local dev round trip with zero infrastructure:

```typescript
// examples/self-signed-dev/round-trip.ts
import { AgentWallet, VPBuilder, verifyVP } from '@helix-id/sdk-js'

// ── Agent side ──────────────────────────────────────────────
const wallet = await AgentWallet.create('./dev-wallet.enc', 'dev-passphrase')
console.log('Agent DID:', wallet.getDID())

const vc = await wallet.selfIssueVC({
  scopes: ['read:orders'],
  expiresIn: '24h',
})
console.log('Self-signed VC issued (dev only)')

const vp = await new VPBuilder({
  vc,
  holderDid: wallet.getDID(),
  targetService: 'orders-service',
  userDid: 'did:key:user',
}).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`)
console.log('VP signed')

// ── Service Provider side ────────────────────────────────────
const result = await verifyVP(vp, {
  expectedTargetService: 'orders-service',
  allowSelfSigned: true              // dev mode only
})

console.log('Valid:', result.valid)
console.log('Agent:', result.agentDid)
console.log('Scopes:', result.privilegeScopes)
console.log('Warning:', result.warning)

// cleanup
await fs.unlink('./dev-wallet.enc')
```

README must clearly state: self-signed VCs are for local development only. Production verifiers reject them. Shows the exact two lines to change when moving to production: remove `allowSelfSigned: true` and add a real issuer-signed VC to the wallet.

---

### `examples/did-web-issuer/`

Create `examples/did-web-issuer/README.md` showing Platform Operator setup with CLI:

```bash
# Step 1 — create issuer identity
export HELIX_WALLET_PASSPHRASE=your-secure-passphrase
helix did create --method web --domain issuer.example.com --wallet ./issuer.enc

# Step 2 — serve did.json
# Copy the printed did.json content to:
# https://issuer.example.com/.well-known/did.json

# Step 3 — create StatusList
helix status-list create \
  --length 131072 \
  --output ./public/status/1.json \
  --base-url https://issuer.example.com/status/1 \
  --wallet ./issuer.enc

# Step 4 — issue VC to an agent
helix vc issue \
  --agent-did did:key:z6MkAgent123 \
  --scopes read:orders,write:bookings \
  --expires 90d \
  --status-list ./public/status/1.json \
  --base-url https://issuer.example.com/status/1 \
  --wallet ./issuer.enc \
  --output ./vc-agent.json

# Step 5 — send vc-agent.json to the agent out of band
# Agent runs:
#   const wallet = await AgentWallet.load('./agent.enc', passphrase)
#   await wallet.addCredential(vcJson)

# Step 6 — revoke when needed
helix revoke \
  --vc-id urn:uuid:abc-123 \
  --status-list ./public/status/1.json \
  --wallet ./issuer.enc
# then push updated ./public/status/1.json to your HTTPS server
```

---

## Test coverage required

All examples must have a runnable check:
- `examples/self-signed-dev/round-trip.ts` — runs with `npx tsx round-trip.ts`, exits 0, no external services
- `examples/framework-middleware/mcp.ts` — runs with `pnpm example:middleware:mcp`, demonstrates attach + verify round-trip without API

Grep checks (agent, verifier, and framework-middleware example files — exclude `operator/` and `setup-live.ts`):
- No `HelixClient` import
- No `HELIX_API_URL` or `localhost:3000`
- No `createVPTemplate`
- No `Authorization` / `HelixVP` header handling in `mcp.ts` (VP is on `input._helixVP`)
- No `MCPRequestLike`, `helixClient`, or `verifyWithScopes` in `mcp.ts`
