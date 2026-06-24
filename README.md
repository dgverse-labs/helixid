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

## Performance

> "DLT is slow" is the first objection. Here's the data.

The DLT latency penalty exists only on the **write path** (DID anchoring, credential issuance). The **verification hot path** — what matters for real-time agent interactions — never touches the ledger.

| Operation                       | HelixID (cached)     | JWT/OAuth                 | Raw Ed25519   |
| ------------------------------- | -------------------- | ------------------------- | ------------- |
| Credential verification         | ~1-6 ms              | 1-5 ms                    | ~0.1 ms       |
| DID resolution                  | ~0.01 ms (cache hit) | N/A                       | N/A           |
| Revocation check                | ~0.01 ms (cached)    | 50-200 ms (introspection) | Not supported |
| **Full verification (warm)**    | **~1-6 ms**          | **1-5 ms**                | **~0.1 ms**   |

**Context:** A single LLM inference call takes 500ms-5s. HelixID verification at ~5ms is noise in that budget. You get the same verification speed as JWT, backed by cryptographic trust that JWT can never provide.

**Caching architecture:**

- **L1:** In-process memory cache (default for current runs) — DID documents and status lists
- **External sources:** DID/status lookups may still read external sources as needed

**Session token bridge:** For high-frequency scenarios (1000+ RPS), verify the VC once (~5ms), issue an ephemeral JWT for subsequent calls (~0.1ms). Best of both worlds.

## Quick Start

### Install

```bash
pnpm install
pnpm build
```

This is a pnpm workspace. The current SDK package is `@helixid/sdk-js`, backed by the `@helixid/api` service.

### Configure the API

Create or update `.env`. The default runtime is **no external infra** beyond the API process itself: `sqlite` storage + in-memory cache + `did:web`.

```bash
NODE_ENV=development
API_BASE_URL=http://localhost:3000

HELIX_STORAGE_ADAPTER=sqlite
HELIX_SQLITE_PATH=./data/helixid.sqlite
HELIX_CACHE_ADAPTER=memory

DID_METHOD=web
DID_DOMAIN=localhost:3000

HELIX_ADMIN_API_KEY=dev-admin-key-0001
HELIX_SIGNING_KEY=<32-byte-ed25519-private-key-hex>
```

Start the API:

```bash
set -a; source .env; set +a
pnpm --filter @helixid/api dev
```

Troubleshooting (SQLite users): if startup fails with
`SyntaxError: The requested module '@prisma/client' does not provide an export named 'PrismaClient'`,
it is usually an install/generation/runtime issue (not a SQLite requirement issue).

Use Node 20 LTS and regenerate Prisma client:

```bash
pnpm install
pnpm --filter @helixid/api db:generate
pnpm --filter @helixid/api dev
```

If needed, force a clean reinstall:

```bash
rm -rf node_modules helix-api/node_modules
pnpm install --force
pnpm --filter @helixid/api db:generate
pnpm --filter @helixid/api dev
```

SQLite mode does not require running database migrations.

### Enroll an Agent

The onboarding flow is a single SDK round trip using a one-time **bootstrap token** (single-use, short TTL) delivered out-of-band (env var, secret manager, CI variable).

```typescript
import { AgentWallet, HelixClient } from '@helixid/sdk-js'

const wallet = await AgentWallet.create('./wallet.enc', process.env.WALLET_PASSPHRASE!)
const client = new HelixClient(process.env.HELIX_API_URL!)

const vc = await client.enroll(process.env.HELIX_BOOTSTRAP_TOKEN!, wallet)

console.log(wallet.did, vc.id)
```

A bootstrap token is **not** an identity credential. It is a one-time permission slip that says: “whoever presents this may enroll one new agent with these scopes/delegation limits/domains.”

Creating that token is a privileged **operator policy action** (not an agent action), because it decides authority:

1. Operator decides policy (`requestedScopes`, `maxDelegationDepth`, `requestedDomains`)
2. Operator mints token via `POST /v1/enrollment-tokens` (authenticated operator call)
3. Operator delivers token out-of-band (env var, Kubernetes Secret, CI variable, etc.)
4. Agent SDK presents token via `client.enroll(...)` and receives VC

This boundary is intentional: if agents could mint their own bootstrap tokens, identity and authorization would collapse into self-granted authority.

For a runnable version, see `examples/e2e-travel-concierge/operator/enroll-agent.ts`.

### Present and Verify a VP (SDK-local)

```typescript
import { AgentWallet, VPBuilder, verifyVP } from '@helixid/sdk-js';

const wallet = await AgentWallet.load('agent/wallet.enc', 'change-this-passphrase');
const credential = wallet.credentials[0];
if (!credential) throw new Error('Wallet has no credential');

const signedVP = await new VPBuilder({
  vc: credential,
  holderDid: wallet.getDID(),
  userDid: 'did:web:user.example.com',
  targetService: 'analytics-service',
}).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`);

const result = await verifyVP(signedVP, {
  expectedTargetService: 'analytics-service',
});

console.log(result.valid, result.agentDid, result.privilegeScopes);
```

`verifyVP()` runs locally (no API call): VP signature, VC signature, validity window, revocation (when credentialStatus exists), target-service checks, and delegation-chain integrity. `vpId` is returned for caller-managed replay protection. If you need a session JWT bridge, call `POST /v1/vp/verify` with `session: true`.

### Delegate Authority (SDK-local, self-signed)

```typescript
import { AgentWallet, delegate } from '@helixid/sdk-js';

const wallet = await AgentWallet.load('agent/wallet.enc', 'change-this-passphrase');

const delegatedCredential = await delegate(
  {
    to: 'did:key:z6Mk...delegatee',
    scopes: ['read:analytics'],
    expiresIn: 3600,
    // optional: fromVC: specific parent VC from wallet
  },
  wallet,
);

console.log(
  delegatedCredential.id,
  delegatedCredential.credentialSubject.privilegeScopes,
  delegatedCredential.credentialSubject.delegationDepth,
);
```

Delegation is **Option A**: Agent A signs the child VC locally, and verifiers enforce chain integrity, scope subset, and max depth from the VC chain itself. There is no API delegation endpoint.

## Framework Integrations

### LangChain / LangGraph

```typescript
import { HelixIDMiddleware } from '@helixid/langchain';

const middleware = HelixIDMiddleware({
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  userDid: 'did:web:user.example.com',
  targetService: 'orders',
});
```

### MCP (Model Context Protocol)

```typescript
import { attachHelixVP, helixidMCPMiddleware } from '@helixid/mcp';

const requireHelix = helixidMCPMiddleware({
  requiredScopes: ['read:orders'],
});

const outboundCall = await attachHelixVP(
  { name: 'orders.lookup', input: { orderId: 'ORD-1001' } },
  {
    walletPassphrase: process.env.WALLET_PASSPHRASE!,
    walletFilePath: './agent-wallet.enc',
    userDid: 'did:web:user.example.com',
    targetService: 'orders',
  },
);
```

## Why Not Just Use...

### "OAuth/JWT already does this"

OAuth authenticates users to services. It was not designed for autonomous agents that spawn sub-agents, cross organizational boundaries, and need offline-verifiable delegation chains. JWT claims are opaque and custom per system — there's no standard way for Service C to verify that Agent B was delegated authority from Agent A by Organization X without calling Organization X's token server. HelixID credentials are self-verifiable with no issuer availability required.

### "API keys + RBAC is fine"

For single-tenant, human-supervised agents calling known APIs — sure. When agents autonomously discover and invoke services across organizations, API keys require bilateral key exchange and RBAC requires a shared permission model. Neither exists in cross-org agent-to-agent scenarios. HelixID provides portable authority that works without prior integration.

### "Ed25519 signing is simpler"

Ed25519 proves "this key signed this payload." HelixID proves "Organization X attests that Agent Y has Authority Z, verified by anyone, revocable at any time, with a full delegation chain." Simple signing gives you cryptographic proof of origin. VCs give you cryptographic proof of delegated authority. These are fundamentally different properties.

### "Verified ≠ Trusted"

Correct. Verification is necessary but not sufficient. HelixID combines identity, credentialed authority, verification at runtime, audit evidence, and revocation controls so trust decisions can be made from cryptographic proof instead of shared secrets.

## Standards & Ecosystem Alignment

HelixID builds on established and converging standards:

- **W3C Verifiable Credentials 2.0** (Recommendation, May 2025) — credential format
- **W3C Decentralized Identifiers 1.0** (Recommendation) — identity layer
- **W3C StatusList2021** — decentralized revocation
- **W3C AI Agent Protocol Community Group** (est. June 2025) — cross-origin agent communication
- **DIF Trusted AI Agents Working Group** — industry alignment
- **NIST NCCoE** — AI Agent Identity and Authorization (concept paper, Feb 2026)

## Self-Hosted

HelixID is fully self-hostable. The current open-source stack covers:

- DID methods: `did:web` (default) and `did:key` (local)
- API-backed enrollment with local SDK key ownership
- SDK-local VP build/verify and SDK-local delegation
- VC issuance and revocation with Bitstring Status List hosting
- Optional JWT session bridge via API (`/v1/vp/verify` with `session: true`)

### Session tokens & secrets (JWT)

HelixID supports two session-token patterns. Pick the one that matches your deployment and threat model:

- API-issued EdDSA tokens (recommended for cross-service verification)
  - The API issues Ed25519-signed JWTs (EdDSA). Verifiers check these by fetching the session public key from `/v1/sessions/public-key` and calling the EdDSA verifier (e.g. `verifyJWT(token, publicKeyHex)`). No symmetric `JWT_SECRET` is required for EdDSA verification. This is the preferred approach when tokens are shared across services or organizations.

- SDK `SessionManager` (HMAC HS256 — local verifier)
  - The SDK provides a local `SessionManager` that signs and verifies JWTs with HMAC (HS256) using a symmetric secret. The constructor requires a secret of at least 16 characters; if omitted or too short the constructor throws an error: `SessionManager secret must be at least 16 characters`.
  - Example (verifier-managed sessions):

```ts
const session = new SessionManager({ secret: process.env.JWT_SECRET!, ttl: 600 });
```

  - Use this mode only when you control all verifiers and can securely store/rotate the secret. Do not reuse the same symmetric secret across untrusted services.

Recommendations:

- Prefer API-issued EdDSA tokens for production and cross-service deployments.
- For local development, set a demo `JWT_SECRET` in `.env` (many examples fall back to a demo secret). For production, generate a strong secret and store it securely:

```bash
# generate 32 bytes hex
openssl rand -hex 32
# or in node
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- If you adopt the SDK `SessionManager` pattern, ensure every verifier instance receives the secret securely (secret manager, not checked into repo) and has a rotation plan.

- Note: missing `JWT_SECRET` has no effect on verifying API-issued EdDSA session tokens (those rely on the API public key), but it WILL prevent constructing a `SessionManager` for HS256 tokens in the SDK.

- LangChain/LangGraph and MCP middleware

## Parked Items

### Bitstring Status List Hosting

Revisit soon: status list URL conventions and hosting model.

The current W3C spec is [Bitstring Status List v1.0](https://www.w3.org/TR/vc-bitstring-status-list/), published as a W3C Recommendation on 15 May 2025. It does not mandate a fixed URL path for status lists. The `statusListCredential` URL embedded in a VC must point to a valid signed `BitstringStatusListCredential` that verifiers can fetch and verify.

There is no `/.well-known/` equivalent for status lists. That differs from `did:web`, where deterministic resolution requires a fixed path. Status list resolution is pointer-based: the verifier is told the exact URL inside the VC, so the issuer controls where the list lives.

De facto implementations often use a path like:

```text
https://issuer.example.com/credentials/status/{listId}
```

Practical constraints to revisit:

- The URL should remain stable for the VC lifetime.
- The URL should be HTTPS and publicly reachable by verifiers.
- The response should be a signed `BitstringStatusListCredential`.
- The read path can be static: CDN, S3, object storage, or the HelixID API can serve the signed JSON.

## Project Structure

```
helixid/
├── helix-core/           # Core crypto, schemas, resolver, VP/delegation/self-signed primitives
├── helix-api/            # Fastify API: enrollment, VC lifecycle, status list, did:web, session bridge
├── helix-sdk-js/         # SDK: AgentWallet, VPBuilder, verifyVP, delegate, HelixClient (enrollment/API ops)
├── packages/
│   ├── mcp/              # MCP middleware
│   ├── langchain/        # LangChain/LangGraph integration
│   └── cli/              # CLI workflows
├── examples/
│   ├── e2e-travel-concierge/   # Live onboarding, wallet, VP fixture flow
│   ├── framework-middleware/   # Live LangChain and MCP middleware examples
│   ├── verify-vp.ts
│   ├── scope-check.ts
│   ├── self-verify.ts
│   └── revocation-check.ts
├── e2e/                  # End-to-end test package
├── docs/                 # Agent playbook, decisions, story docs, testing guides
├── scripts/              # Setup and helper scripts
└── docker-compose.yml    # Local API stack (sqlite+memory+did:web default)
```

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where help is needed:

- **DID method implementations** — additional DID method resolvers
- **Framework integrations** — middleware for additional AI agent frameworks
- **Documentation** — tutorials, guides, and examples

## Community

- [GitHub Discussions](https://github.com/nicedigverse/helixid/discussions) — questions, ideas, and show-and-tell
- [GitHub Issues](https://github.com/nicedigverse/helixid/issues) — bug reports and feature requests

## License

[Apache License 2.0](LICENSE) — chosen for enterprise compatibility, explicit patent protection, and no copyleft friction for proprietary AI agent integrations.

## Built By

HelixID is built by [DgVerse](https://www.dgverse.in) — building the trust layer for digital credentials and AI agents.

---

<p align="center">
  <em>Static auth primitives will fail at scale for autonomous AI systems.<br/>Cryptographic agent identity is the infrastructure-level solution.</em>
</p>
