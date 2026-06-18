# Prompt 08 — Examples Updates and New Examples

## Dependency prerequisite
**Prompts 03 (sdk-js), 05 (langchain), 06 (mcp), and 07 (cli) must be complete.** Examples consume the updated SDK surface — they must not use the old `HelixClient`-based API for agent or verifier operations.

## Context
`examples/` contains the e2e-travel-concierge and framework-middleware examples. All agent-side and verifier-side code must be refactored to use standalone SDK functions. `HelixClient` stays only in operator enrollment scripts. Three new examples are added: replay protection, self-signed dev round-trip, and did:web issuer setup.

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
  holderDid: wallet.did,
  targetService: 'travel-concierge',
  userDid: 'did:key:user-demo'
}).sign(wallet.privateKeyHex, `${wallet.did}#key-1`)

console.log(JSON.stringify(vp, null, 2))
```

No `HelixClient`. No API URL. No `HELIX_API_URL` env var needed.

---

### `examples/e2e-travel-concierge/booking-platform/booking-platform.ts`

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
  userDid: 'did:hedera:testnet:user',
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

**Before:**
```typescript
const requireHelix = helixidMCPMiddleware({
  helixClient: new HelixClient(process.env.HELIX_API_URL!),
  requiredScopes: ['read:orders'],
})

const outboundCall = await attachHelixVP(toolCall, {
  helixClient: new HelixClient(process.env.HELIX_API_URL!),
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  vcId: process.env.AGENT_VC_ID!,
  vcType: 'HelixAgentCredential',
  userDid: 'did:hedera:testnet:user',
  targetService: 'orders',
})
```

**After:**
```typescript
import { helixidMCPMiddleware, attachHelixVP } from '@helix-id/mcp'

const requireHelix = helixidMCPMiddleware({
  requiredScopes: ['read:orders'],
})

const outboundCall = await attachHelixVP(toolCall, {
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  targetService: 'orders',
})
```

---

## New examples to create

### `examples/replay-protection/`

Create `examples/replay-protection/README.md` and `examples/replay-protection/middleware.ts`.

The example shows an Express service provider using `verifyVP()` + Redis for vpId replay protection.

```typescript
// examples/replay-protection/middleware.ts
import express from 'express'
import { createClient } from 'redis'
import { verifyVP } from '@helix-id/sdk-js'

const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' })
await redis.connect()

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
  const alreadySeen = await redis.get(vpIdKey)
  if (alreadySeen) {
    return res.status(401).json({ error: 'VP_REPLAY_DETECTED' })
  }

  // store with TTL matching VP expiry
  const vpExpiryMs = new Date(vp.verifiableCredential[0].validUntil).getTime() - Date.now()
  const vpExpirySeconds = Math.floor(vpExpiryMs / 1000)
  await redis.set(vpIdKey, '1', { EX: vpExpirySeconds })

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

README must explain: SDK does the crypto, caller owns the store. Redis is one implementation — any persistent store works (Postgres, DynamoDB, etc.).

---

### `examples/self-signed-dev/`

Create `examples/self-signed-dev/README.md` and `examples/self-signed-dev/round-trip.ts`.

Full local dev round trip with zero infrastructure:

```typescript
// examples/self-signed-dev/round-trip.ts
import { AgentWallet, VPBuilder, verifyVP } from '@helix-id/sdk-js'

// ── Agent side ──────────────────────────────────────────────
const wallet = await AgentWallet.create('./dev-wallet.enc', 'dev-passphrase')
console.log('Agent DID:', wallet.did)

const vc = await wallet.selfIssueVC({
  scopes: ['read:orders'],
  expiresIn: '24h'
})
console.log('Self-signed VC issued (dev only)')

const vp = await new VPBuilder({
  vc,
  holderDid: wallet.did,
  targetService: 'orders-service',
  userDid: 'did:key:user'
}).sign(wallet.privateKeyHex, `${wallet.did}#key-1`)
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
- `examples/replay-protection/middleware.ts` — integration test with mock Redis
- Grep check: no `HelixClient` in agent or verifier example files
- Grep check: no `HELIX_API_URL` in agent or verifier example files
- Grep check: no `createVPTemplate` anywhere in examples
