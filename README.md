<p align="center">
  <h1 align="center">HelixID</h1>
  <p align="center"><strong>Cryptographic identity and authorization for AI agents.</strong></p>
  <p align="center">Replace API keys with verifiable, scoped, and auditable agent identity.</p>
</p>

<p align="center">
  <a href="https://github.com/nicedigverse/helixid/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://www.w3.org/TR/vc-data-model-2.0/"><img src="https://img.shields.io/badge/W3C-VC%202.0-green.svg" alt="W3C VC 2.0"></a>
  <a href="https://www.w3.org/TR/did-core/"><img src="https://img.shields.io/badge/W3C-DID%201.0-green.svg" alt="W3C DID 1.0"></a>
  <a href="https://hedera.com"><img src="https://img.shields.io/badge/DLT-Hedera-blueviolet.svg" alt="Hedera"></a>
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
| **1. Identity**    | Every agent gets a DID (Decentralized Identifier) bound to a cryptographic keypair                               | W3C DID, `did:hedera` (anchored) or `did:key` (local) |
| **2. Authority**   | Scoped, time-bound credentials that prove what an agent is allowed to do                                         | W3C Verifiable Credentials with delegation chains     |
| **3. Enforcement** | Policy evaluation at the execution boundary — not just "is this credential valid?" but "is this action allowed?" | Planned: OPA (Open Policy Agent) with Rego rules      |
| **4. Audit**       | Operational record of credential issuance, presentation, verification, revocation, and session events            | PostgreSQL `audit_log` table and structured stdout    |
| **5. Revocation**  | Decentralized, cacheable revocation that works offline                                                           | StatusList2021 bitstring, HCS-published               |

Think of it as a **passport + work visa** for AI agents. The passport (DID) proves identity. The visa (VC) proves scoped authority from a specific issuer. Border control (planned OPA/Rego) enforces the rules. HCS anchors DIDs, and the API audit log records lifecycle events.

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
│  │             │   │ • Hot path   │   │ • HCS anchoring │  │
│  │  ~0.1ms     │   │  ~0.1ms/req  │   │ • Cross-org     │  │
│  │             │   │              │   │   trust          │  │
│  └─────────────┘   └──────────────┘   └─────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Hedera Consensus Service (HCS)              │   │
│  │       DID anchoring · Live DID resolution source      │   │
│  │              Write path only (~2.5-5s)                │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        API Audit Log (PostgreSQL/stdout)              │   │
│  │       Issuance · VP verify · revocation · sessions    │   │
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
| Policy evaluation (planned OPA) | 1-5 ms               | 1-5 ms                    | 1-5 ms        |
| **Full verification (warm)**    | **~1-6 ms**          | **1-5 ms**                | **~0.1 ms**   |

**Context:** A single LLM inference call takes 500ms-5s. HelixID verification at ~5ms is noise in that budget. You get the same verification speed as JWT, backed by cryptographic trust that JWT can never provide.

**Caching architecture:**

- **L1:** In-process memory (5-60 min TTL) — DID documents, status lists
- **L2:** Redis/shared cache (15-60 min TTL) — cross-instance sharing
- **L3:** Hedera mirror node REST — fallback, with HCS subscription for cache invalidation

**Session token bridge:** For high-frequency scenarios (1000+ RPS), verify the VC once (~5ms), issue an ephemeral JWT for subsequent calls (~0.1ms). Best of both worlds.

## Quick Start

### Install

```bash
pnpm install
pnpm build
```

This is a pnpm workspace. The current SDK package is `@helix-id/sdk-js`, backed by the `@helix-id/api` service.

### Configure the API

Create or update `.env` with the Hedera and database values used by the API and live examples:

```bash
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=...
HEDERA_OPERATOR_KEY=...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/helixid
HELIX_ADMIN_API_KEY=...
```

Then prepare the database and issuer DID:

```bash
docker compose up -d postgres
pnpm --filter @helix-id/api db:deploy
pnpm setup:hedera -- --create-issuer-did
set -a; source .env; set +a
pnpm --filter @helix-id/api dev
```

The setup path is also documented in [`examples/README.md`](examples/README.md). The live tests under `helix-api/tests/live/` exercise the same API-backed Hedera flow.

### Enroll an Agent

The current onboarding flow creates a one-use enrollment token, generates the agent keypair locally in the SDK, anchors the DID through the API, issues a VC, and saves an encrypted wallet.

```typescript
import { AgentWallet, HelixClient } from '@helix-id/sdk-js';

const helixApiUrl = process.env.HELIX_API_URL ?? 'http://localhost:3000';
const walletPassphrase = process.env.WALLET_PASSPHRASE ?? 'change-this-passphrase';
const walletPath = 'agent/wallet.enc';
const client = new HelixClient(helixApiUrl);

const enrollment = await fetch(`${helixApiUrl}/v1/enrollment-tokens`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    agentName: 'data-processor',
    requestedScopes: ['read:analytics', 'write:reports'],
    requestedDomains: ['https://analytics.example.com'],
    maxDelegationDepth: 1,
  }),
}).then((response) => response.json() as Promise<{ token: string }>);

const challenge = await client.requestOnboardingChallenge(enrollment.token, [
  'https://analytics.example.com',
]);

const onboarding = await client.completeOnboarding(
  challenge.challengeId,
  challenge.nonce,
  walletPassphrase,
  walletPath,
);

const wallet = await new AgentWallet().load(walletPassphrase, walletPath);

console.log(onboarding.agentDid, onboarding.vcId, wallet.did);
```

For a runnable version, see `examples/e2e-travel-concierge/operator/enroll-agent.ts`.

### Present and Verify a VP

```typescript
import { AgentWallet, HelixClient, VPBuilder } from '@helix-id/sdk-js';
import type { SignedVP, UnsignedVP } from '@helix-id/core';

const client = new HelixClient(process.env.HELIX_API_URL ?? 'http://localhost:3000');
const wallet = await new AgentWallet().load('change-this-passphrase', 'agent/wallet.enc');
const credential = wallet.credentials[0];
if (!credential) throw new Error('Wallet has no credential');

const template = await client.createVPTemplate({
  agentDid: wallet.did,
  userDid: 'did:hedera:testnet:user-demo',
  targetService: 'analytics-service',
  vcType: 'HelixAgentCredential',
  vcId: credential.vcId,
});

const signedVP: SignedVP = await new VPBuilder(template.unsignedVP as UnsignedVP).sign(
  wallet.privateKeyHex,
  `${wallet.did}#key-1`,
);

const result = await client.verifyVP(signedVP, { session: true });
console.log(result.valid, result.agentDid, result.session?.token);
```

The verifier checks VP signature, embedded VC signature, expiry, BitstringStatusList revocation, target-service binding, and single-use `vpId` replay. See `examples/e2e-travel-concierge/agent/create-vp-fixture.ts`, `examples/verify-vp.ts`, and `helix-api/tests/live/vp.live.integration.test.ts`.

### Delegate Authority

```typescript
const delegatedCredential = await client.delegate({
  delegateeAgentDid: 'did:hedera:testnet:delegatee-agent',
  requestedScopes: ['read:analytics'],
  expiresInSeconds: 3600,
  walletPassphrase: 'change-this-passphrase',
  walletFilePath: 'agent/wallet.enc',
  vcId: credential.vcId,
});

console.log(delegatedCredential.vcId, delegatedCredential.scopes);
```

See `helix-api/tests/live/delegation.live.integration.test.ts` for the live delegation path.

### Policy Enforcement (Planned OPA/Rego)

OPA/Rego policy evaluation and the shared `policies/` library are planned. Today, verification enforces cryptographic validity, expiry, revocation, target-service binding, replay protection, and delegation constraints in the API.

### Anchored Mode (Hedera)

```bash
pnpm setup:hedera -- --create-issuer-did
pnpm --filter @helix-id/api dev
```

The API currently anchors `did:hedera:testnet:*` DIDs and publishes StatusList credentials. Local `did:key` mode remains part of the product direction, but the current runnable flow is the API-backed Hedera path.

## Framework Integrations

HelixID currently provides middleware for LangChain/LangGraph and MCP. CrewAI and n8n are planned integrations.

### LangChain / LangGraph

```typescript
import { HelixIDMiddleware } from '@helix-id/langchain';
import { HelixClient } from '@helix-id/sdk-js';

const helixClient = new HelixClient('http://localhost:3000');

const middleware = HelixIDMiddleware({
  helixClient,
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  vcId: process.env.AGENT_VC_ID!,
  vcType: 'HelixAgentCredential',
  userDid: 'did:hedera:testnet:user',
  targetService: 'orders',
});
```

### CrewAI and n8n

CrewAI and n8n integrations are planned. There are no `@helix-id/crewai` or `@helix-id/n8n` packages in the current workspace.

### MCP (Model Context Protocol)

```typescript
import { attachHelixVP, helixidMCPMiddleware } from '@helix-id/mcp';
import { HelixClient } from '@helix-id/sdk-js';

const helixClient = new HelixClient('http://localhost:3000');

const requireHelix = helixidMCPMiddleware({
  helixClient,
  requiredScopes: ['read:orders'],
});

const outboundCall = await attachHelixVP(
  { name: 'orders.lookup', arguments: { orderId: 'ORD-1001' } },
  {
    helixClient,
    walletPassphrase: process.env.WALLET_PASSPHRASE!,
    walletFilePath: './agent-wallet.enc',
    vcId: process.env.AGENT_VC_ID!,
    vcType: 'HelixAgentCredential',
    userDid: 'did:hedera:testnet:user',
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

Correct. Verification is necessary but not sufficient. That's why HelixID is a 5-layer stack, not just a credential library. Layer 1 (identity) tells you who. Layer 2 (credentials) tells you what they're allowed to do. Layer 3, planned OPA/Rego enforcement, applies policy at runtime. Layer 4 (audit) creates the evidence trail. Layer 5 (revocation) lets you pull the plug. Trust is the emergent property of the full stack, not any single layer.

## Standards & Ecosystem Alignment

HelixID builds on established and converging standards:

- **W3C Verifiable Credentials 2.0** (Recommendation, May 2025) — credential format
- **W3C Decentralized Identifiers 1.0** (Recommendation) — identity layer
- **W3C StatusList2021** — decentralized revocation
- **Hedera Consensus Service** — DID anchoring and live DID resolution source
- **Open Policy Agent (OPA)** — planned policy enforcement
- **W3C AI Agent Protocol Community Group** (est. June 2025) — cross-origin agent communication
- **DIF Trusted AI Agents Working Group** — industry alignment
- **NIST NCCoE** — AI Agent Identity and Authorization (concept paper, Feb 2026)

## Self-Hosted vs Cloud

HelixID is fully self-hostable. The open-source SDK covers:

- `did:hedera` anchored identity on Hedera testnet
- API-backed agent onboarding with local SDK key ownership
- VC issuance, presentation, and verification
- Bitstring StatusList revocation
- JWT session bridge after VP verification
- LangChain/LangGraph and MCP middleware

Planned open-source coverage includes `did:key` local identity, OPA policy evaluation with base Rego rules, CrewAI middleware, and n8n integration.

**HelixID Cloud** (coming soon) adds:

- Managed DID infrastructure and key custody
- Trust registry as a service
- Advanced policy engine (ABAC, ZKP selective disclosure)
- Dashboard for credential lifecycle management
- Enterprise SSO and compliance reporting

## Roadmap

### Phase 1 — Foundation (Current)

- [x] Architecture decisions (VC vs signing, DLT latency analysis)
- [x] `@helix-id/core` — Core cryptography, schemas, StatusList helpers
- [x] `@helix-id/api` — API service for DID anchoring, VC lifecycle, VP verification, revocation, and sessions
- [x] `@helix-id/sdk-js` — JavaScript SDK with `HelixClient`, `AgentWallet`, and `VPBuilder`
- [x] `did:hedera` anchored mode (testnet)
- [x] Bitstring StatusList revocation
- [ ] `did:key` local mode
- [ ] Base Rego policy library and OPA enforcement

### Phase 2 — Framework Integrations

- [x] `@helix-id/langchain` — LangChain/LangGraph middleware
- [x] `@helix-id/mcp` — MCP middleware
- [ ] `@helix-id/crewai` — planned CrewAI integration
- [ ] `@helix-id/n8n` — planned n8n node
- [x] Session token bridge (VC → ephemeral JWT)
- [ ] Trust registry v1

### Phase 3 — Enterprise & Advanced

- [ ] ZKP selective disclosure (ZK-SD-VCs)
- [ ] ABAC policy engine
- [ ] Credential monetization primitives
- [ ] Kubernetes admission controller
- [ ] HelixID Cloud managed service

## Project Structure

```
helixid/
├── helix-core/           # Core crypto, schemas, errors, OpenAPI, StatusList helpers
├── helix-api/            # Fastify API, Hedera integration, Prisma persistence
├── helix-sdk-js/         # SDK: HelixClient, AgentWallet, VPBuilder
├── packages/
│   ├── mcp/              # MCP middleware
│   └── langchain/        # LangChain/LangGraph integration
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
└── docker-compose.yml    # Local Postgres for API development
```

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where help is needed:

- **DID method implementations** — additional DID method resolvers
- **Framework integrations** — middleware for additional AI agent frameworks
- **Planned Rego policy library** — common authorization patterns for agent use cases
- **Planned benchmarks** — real-world performance testing across caching configurations
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
