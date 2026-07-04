<p align="center">
  <h1 align="center">HelixID</h1>
  <p align="center"><strong>Cryptographic identity and authorization for AI agents.</strong></p>
  <p align="center">Replace API keys with verifiable, scoped, and auditable agent identity.</p>
</p>

<p align="center">
  <a href="https://github.com/nicedigverse/helixid/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://www.w3.org/TR/vc-data-model-2.0/"><img src="https://img.shields.io/badge/W3C-VC%202.0-green.svg" alt="W3C VC 2.0"></a>
  <a href="https://www.w3.org/TR/did-core/"><img src="https://img.shields.io/badge/W3C-DID%201.0-green.svg" alt="W3C DID 1.0"></a>
</p>

---

## The Problem

AI agents are authenticating with static API keys and bearer tokens — credentials designed for humans clicking through OAuth consent screens, not autonomous software making thousands of cross-boundary decisions per hour.

This breaks in predictable ways:

- **No delegation chain.** When Agent A spawns Agent B to call Service C, there's no standard way to prove B is authorized to act on A's behalf.
- **No scoped authority.** API keys are all-or-nothing. An agent that needs read access to one table gets the same key as one that needs admin access to everything.
- **No cross-org trust.** When your agent calls a third-party service, both sides rely on shared secrets and manual API key exchange. There's no way to verify authority without bilateral integration.
- **No revocation that works.** Revoking a compromised agent means rotating keys across every service it touched.
- **No audit trail.** "Who authorized this agent to do that?" is answered by grepping logs, not cryptographic proof.

HelixID fixes this by giving every AI agent a cryptographic identity — a portable, verifiable, revocable credential that works across organizational boundaries without requiring the parties to know each other in advance.

## What HelixID Does

HelixID is a **5-layer trust stack** for AI agents, not just an identity library:

| Layer              | What It Does                                                                                                     | How                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **1. Identity**    | Every agent gets a DID (Decentralized Identifier) bound to a cryptographic keypair                               | W3C DID (`did:web` default, `did:key` local) |
| **2. Authority**   | Scoped, time-bound credentials that prove what an agent is allowed to do                                         | W3C Verifiable Credentials with delegation chains     |
| **3. Enforcement** | Runtime verification and authorization checks at execution boundaries                                              | SDK/core verification + verifier-owned policy checks  |
| **4. Audit**       | Operational record of issuance, verification/session bridge, revocation, and lifecycle events                    | Adapter-based `audit_log` store + structured stdout/file |
| **5. Revocation**  | Decentralized, cacheable revocation that works offline                                                           | Bitstring Status List |

## Roles

HelixID is built around three distinct actors. Each has a different relationship with the SDK and the issuer service.

| Role | Who | What they do |
|---|---|---|
| **Platform Operator** | The team building the AI product | Creates issuer DID, mints bootstrap tokens, issues VCs to agents, manages revocation |
| **AI Agent** | The autonomous software process | Holds a wallet, signs VPs, presents credentials, delegates authority to sub-agents |
| **Service Provider** | The API or service the agent calls | Verifies incoming VPs, checks scopes, optionally issues a session JWT or caches the result |

### Platform Operator

The operator runs the issuer service (self-hosted `helix-api` or CLI for low volume). They never touch agent private keys — they only control the issuance policy.

```typescript
// Operator: mint a bootstrap token for a new agent (authenticated operator call)
// POST /v1/enrollment-tokens
// { agentName, requestedScopes, maxDelegationDepth, requestedDomains }
// → { bootstrapToken }

// Operator: revoke an agent's credential
// CLI
helix revoke --vc-id <vcId> --status-list ./public/status/1.json --wallet issuer.enc
```

The operator's private key (issuer signing key) never leaves the issuer service. It is the trust anchor for every VC issued in their trust domain.

### AI Agent

The agent holds a wallet containing its DID, keypair, and credentials. All signing operations are local — no private key ever leaves the agent process.

```typescript
import { AgentWallet, VPBuilder, delegate } from '@helixid/sdk-js'

// load wallet on every startup
const wallet = await AgentWallet.loadOrCreate('./wallet.enc', process.env.WALLET_PASSPHRASE!)

// build and sign a VP — fully local, no network
const vp = await new VPBuilder({
  vc: wallet.credentials[0],
  holderDid: wallet.getDID(),
  userDid: 'did:web:user.example.com',
  targetService: 'orders-service',
}).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`)

// delegate to a sub-agent — fully local, self-signed (Option A)
const childVC = await delegate(
  { to: 'did:key:z6Mk...sub-agent', scopes: ['read:orders'], expiresIn: 3600 },
  wallet,
)
```

### Service Provider

The verifier never needs the issuer's API at runtime. `verifyVP()` is fully local — one HTTPS fetch for the StatusList (cached after first hit), everything else resolved offline.

```typescript
import { verifyVP, SessionManager } from '@helixid/sdk-js'

const result = await verifyVP(incomingVP, {
  expectedTargetService: 'orders-service',
})

// replay protection — verifier owns this store
const seen = await redis.get(`vpid:${result.vpId}`)
if (seen) throw new Error('REPLAY_DETECTED')
await redis.set(`vpid:${result.vpId}`, '1', 'EX', result.expiresInSeconds)

// scope check
if (!result.privilegeScopes.includes('read:orders')) throw new Error('INSUFFICIENT_SCOPE')

// session handling — verifier's choice, both optional

// Option A: issue a short-lived JWT, agent reuses it for subsequent calls
const session = new SessionManager({ secret: process.env.JWT_SECRET!, ttl: 600 })
const token = await session.issue({ agentDid: result.agentDid, scopes: result.privilegeScopes })

// Option B: cache the VP result by vpId, skip re-verification on repeat calls
await cache.set(`vp:${result.vpId}`, result, { ttl: result.expiresInSeconds })
```

Neither session option is required. The verifier can re-verify the VP on every call if preferred. The SDK supports all three paths.

## Architecture

HelixID uses a **hybrid 3-layer architecture** that delivers the trust properties of verifiable credentials with the performance of JWTs:

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR AI AGENT                           │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  Layer 3    │   │   Layer 2    │   │    Layer 1      │  │
│  │  Ed25519    │   │  Ephemeral   │   │   VC-Based      │  │
│  │  Direct     │   │    JWT       │   │   Identity      │  │
│  │  Signing    │   │  Sessions    │   │                 │  │
│  │             │   │              │   │                 │  │
│  │ • did:key   │   │ • Verify VC  │   │ • DID creation  │  │
│  │ • Local dev │   │   once       │   │ • Delegated VCs │  │
│  │ • MCP tool  │   │ • Issue JWT  │   │ • StatusList    │  │
│  │   auth      │   │   (5-15 min) │   │   revocation    │  │
│  │             │   │ • Hot path   │   │ • Cross-org     │  │
│  │  ~0.1ms     │   │  ~0.1ms/req  │   │   trust          │  │
│  └─────────────┘   └──────────────┘   └─────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │    API audit log (adapter store + stdout/file)       │   │
│  │   Issuance · revocation · session-bridge verification │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Why three layers?** Different trust contexts need different tradeoffs:

- **Layer 1 (VCs):** Use when agents cross organizational boundaries, when delegation chains matter, when you need revocation and audit. This is the foundation.
- **Layer 2 (JWT sessions):** Verify the VC once, issue a short-lived JWT for subsequent calls. Best for high-frequency internal calls where you've already established trust.
- **Layer 3 (Ed25519 direct):** For local development, MCP tool authentication, and internal agent-to-tool calls where both parties share a trust context.

## Quick Start

### Full Demo (self-hosted, Travel Concierge)

See HelixID enforce scoped access, delegation, and revocation against a real
AI travel-booking agent — with a live audit trail of every trust decision.

Prefer a guided walkthrough? **[Try it on our website →](https://dgverse.in/helixid/try-it-out)**
Same demo, no local setup.

To run it yourself:

**Step 1 — Get an LLM API key**

The concierge agent needs access to an LLM. Grab a free key from one of:

- [Anthropic Console](https://console.anthropic.com/settings/keys)
- [OpenAI Platform](https://platform.openai.com/api-keys)

**Step 2 — Get the demo**

Download the demo package:

[helixid-travel-concierge-demo.zip](#) — pre-filled `.env` with working demo defaults (LLM key still manual).

Unzip it, then set your key:

```bash
# --- LLM Provider ---
# Which LLM to use: "anthropic" (default) or "openai".
LLM_PROVIDER=anthropic

# LLM API key obtained from your LLM provider.
LLM_API_KEY=your-llm-api-key
```

**Step 3 — Run it**

```bash
docker-compose up
```

This starts the issuer API (sqlite + in-memory cache + `did:web`), the
**HelixID Console**, the travel-concierge web app, and two pre-provisioned
agent wallets. A one-shot setup service pre-registers the booking backend as
a known service, seeds scopes, pre-onboards the demo agents, and seeds a
status list — fully wired, nothing else to configure.

Open **http://localhost:5173** for the demo. The terminal will also print a
URL for the **Console** — the operator view where you'll revoke credentials
and watch enrollment happen live in Step 4.

**Step 4 — Try the security patterns**

| Scenario | What it shows |
|---|---|
| **Search vs. Book** | The Search Agent can look up flights but its VP is rejected when it tries to book — scope enforcement, not a role flag in a database. |
| **Delegate to a Sub-Agent** | The Concierge Agent delegates a reduced, time-boxed credential to a search sub-agent. The sub-agent can search, but can't book — even though it inherited from an agent that could. |
| **Revoke Mid-Flight** | An operator revokes the Concierge Agent's credential while it's active. Its very next request is rejected — no key rotation, anywhere. |
| **Onboard a New Agent, Live** | From the Console, mint a bootstrap token and watch a brand-new agent enroll and receive its VC in real time — the only scenario that isn't pre-seeded. |

Every action above appears in real time in the **Console's audit panel**, so
you can watch exactly which credential authorized which action, and when.

---
