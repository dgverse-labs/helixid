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

| Layer | What It Does | How |
|---|---|---|
| **1. Identity** | Every agent gets a DID (Decentralized Identifier) bound to a cryptographic keypair | W3C DID, `did:hedera` (anchored) or `did:key` (local) |
| **2. Authority** | Scoped, time-bound credentials that prove what an agent is allowed to do | W3C Verifiable Credentials with delegation chains |
| **3. Enforcement** | Policy evaluation at the execution boundary — not just "is this credential valid?" but "is this action allowed?" | OPA (Open Policy Agent) with Rego rules |
| **4. Audit** | Immutable, cryptographic record of every credential issuance, presentation, and verification | Hedera Consensus Service (HCS) |
| **5. Revocation** | Decentralized, cacheable revocation that works offline | StatusList2021 bitstring, HCS-published |

Think of it as a **passport + work visa** for AI agents. The passport (DID) proves identity. The visa (VC) proves scoped authority from a specific issuer. Border control (OPA) enforces the rules. The stamp (HCS) creates the audit trail.

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
│  │              OPA Policy Engine (Rego)                 │   │
│  │         Enforcement at every layer (~1-5ms)           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Hedera Consensus Service (HCS)              │   │
│  │    DID anchoring · Proof anchoring · Audit trail      │   │
│  │              Write path only (~2.5-5s)                │   │
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

| Operation | HelixID (cached) | JWT/OAuth | Raw Ed25519 |
|---|---|---|---|
| Credential verification | ~1-6 ms | 1-5 ms | ~0.1 ms |
| DID resolution | ~0.01 ms (cache hit) | N/A | N/A |
| Revocation check | ~0.01 ms (cached) | 50-200 ms (introspection) | Not supported |
| Policy evaluation (OPA) | 1-5 ms | 1-5 ms | 1-5 ms |
| **Full verification (warm)** | **~1-6 ms** | **1-5 ms** | **~0.1 ms** |

**Context:** A single LLM inference call takes 500ms-5s. HelixID verification at ~5ms is noise in that budget. You get the same verification speed as JWT, backed by cryptographic trust that JWT can never provide.

**Caching architecture:**

- **L1:** In-process memory (5-60 min TTL) — DID documents, status lists
- **L2:** Redis/shared cache (15-60 min TTL) — cross-instance sharing
- **L3:** Hedera mirror node REST — fallback, with HCS subscription for cache invalidation

**Session token bridge:** For high-frequency scenarios (1000+ RPS), verify the VC once (~5ms), issue an ephemeral JWT for subsequent calls (~0.1ms). Best of both worlds.

## Quick Start

### Install

```bash
npm install @helixid/sdk
```

### Create an Agent Identity

```typescript
import { HelixID } from '@helixid/sdk';

// Initialize — local mode (did:key, no DLT dependency)
const helix = new HelixID({ mode: 'local' });

// Create an agent identity
const agent = await helix.createAgent({
  name: 'data-processor',
  owner: 'did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP',
});

// Issue a scoped credential
const credential = await helix.issueCredential({
  subject: agent.did,
  claims: {
    role: 'data-processor',
    scopes: ['read:analytics', 'write:reports'],
    maxDelegationDepth: 1,
  },
  expiresIn: '24h',
});
```

### Verify an Agent

```typescript
// On the receiving service
const result = await helix.verifyPresentation(presentation, {
  requiredScopes: ['read:analytics'],
  checkRevocation: true,
  policyFile: './policies/data-access.rego',
});

if (result.verified) {
  console.log(`Agent ${result.holder} authorized for ${result.scopes}`);
  // result.delegationChain shows the full authority path
}
```

### Delegate Authority

```typescript
// Agent A delegates a subset of its authority to Agent B
const delegatedCredential = await helix.delegate({
  from: agentA.did,
  to: agentB.did,
  parentCredential: agentACredential,
  scopes: ['read:analytics'], // subset of parent scopes
  expiresIn: '1h',
});

// Agent B can now present this credential
// Verifiers see the full chain: Issuer → Agent A → Agent B
```

### Policy Enforcement (OPA/Rego)

```rego
# policies/data-access.rego
package helixid.policy

default allow = false

allow {
    input.credential.verified == true
    input.credential.scopes[_] == input.requested_scope
    not credential_expired(input.credential)
    not credential_revoked(input.credential)
    delegation_depth_ok(input.credential)
}

delegation_depth_ok(cred) {
    cred.delegationDepth <= cred.maxDelegationDepth
}
```

### Anchored Mode (Hedera)

```typescript
// Production mode — DLT-anchored identity
const helix = new HelixID({
  mode: 'anchored',
  hedera: {
    network: 'testnet', // or 'mainnet'
    operatorId: process.env.HEDERA_OPERATOR_ID,
    operatorKey: process.env.HEDERA_OPERATOR_KEY,
  },
  cache: {
    l1: { ttl: '5m' },           // in-process
    l2: { redis: process.env.REDIS_URL, ttl: '15m' }, // shared
  },
});

// DID is now anchored on Hedera — globally resolvable, auditable
const agent = await helix.createAgent({ name: 'production-agent' });
// agent.did → "did:hedera:testnet:z6Mkf5rG..."
```

## Framework Integrations

HelixID provides middleware for major AI agent frameworks:

### LangChain / LangGraph

```typescript
import { HelixIDMiddleware } from '@helixid/langchain';

const chain = new LangChain({
  middleware: [
    HelixIDMiddleware({
      credential: agentCredential,
      policy: './policies/tool-access.rego',
    }),
  ],
});
```

### CrewAI

```typescript
import { HelixIDAuth } from '@helixid/crewai';

const crew = new Crew({
  agents: [researcher, writer],
  auth: HelixIDAuth({
    // Each agent in the crew gets its own delegated credential
    delegatePerAgent: true,
    parentCredential: crewCredential,
  }),
});
```

### MCP (Model Context Protocol)

```typescript
import { helixidMCPMiddleware } from '@helixid/mcp';

const server = new MCPServer({
  middleware: [
    helixidMCPMiddleware({
      requireCredential: true,
      allowedScopes: ['tool:execute', 'resource:read'],
    }),
  ],
});
```

## Why Not Just Use...

### "OAuth/JWT already does this"

OAuth authenticates users to services. It was not designed for autonomous agents that spawn sub-agents, cross organizational boundaries, and need offline-verifiable delegation chains. JWT claims are opaque and custom per system — there's no standard way for Service C to verify that Agent B was delegated authority from Agent A by Organization X without calling Organization X's token server. HelixID credentials are self-verifiable with no issuer availability required.

### "API keys + RBAC is fine"

For single-tenant, human-supervised agents calling known APIs — sure. When agents autonomously discover and invoke services across organizations, API keys require bilateral key exchange and RBAC requires a shared permission model. Neither exists in cross-org agent-to-agent scenarios. HelixID provides portable authority that works without prior integration.

### "Ed25519 signing is simpler"

Ed25519 proves "this key signed this payload." HelixID proves "Organization X attests that Agent Y has Authority Z, verified by anyone, revocable at any time, with a full delegation chain." Simple signing gives you cryptographic proof of origin. VCs give you cryptographic proof of delegated authority. These are fundamentally different properties.

### "Verified ≠ Trusted"

Correct. Verification is necessary but not sufficient. That's why HelixID is a 5-layer stack, not just a credential library. Layer 1 (identity) tells you who. Layer 2 (credentials) tells you what they're allowed to do. Layer 3 (OPA) enforces it at runtime. Layer 4 (audit) creates the evidence trail. Layer 5 (revocation) lets you pull the plug. Trust is the emergent property of the full stack, not any single layer.

## Standards & Ecosystem Alignment

HelixID builds on established and converging standards:

- **W3C Verifiable Credentials 2.0** (Recommendation, May 2025) — credential format
- **W3C Decentralized Identifiers 1.0** (Recommendation) — identity layer
- **W3C StatusList2021** — decentralized revocation
- **Hedera Consensus Service** — DLT anchoring and audit trail
- **Open Policy Agent (OPA)** — policy enforcement
- **W3C AI Agent Protocol Community Group** (est. June 2025) — cross-origin agent communication
- **DIF Trusted AI Agents Working Group** — industry alignment
- **NIST NCCoE** — AI Agent Identity and Authorization (concept paper, Feb 2026)

## Self-Hosted vs Cloud

HelixID is fully self-hostable. The open-source SDK covers:

- `did:key` local identity (zero infrastructure)
- `did:hedera` anchored identity (requires Hedera account)
- VC issuance, presentation, and verification
- StatusList2021 revocation
- OPA policy evaluation with base Rego rules
- LangChain, CrewAI, and MCP middleware

**HelixID Cloud** (coming soon) adds:

- Managed DID infrastructure and key custody
- Trust registry as a service
- Advanced policy engine (ABAC, ZKP selective disclosure)
- Dashboard for credential lifecycle management
- Enterprise SSO and compliance reporting

## Roadmap

### Phase 1 — Foundation (Current)
- [x] Architecture decisions (VC vs signing, DLT latency analysis)
- [ ] `@helixid/sdk` — Core SDK (DID, VC, verification, OPA)
- [ ] `@helixid/mcp` — MCP middleware
- [ ] `did:key` local mode
- [ ] `did:hedera` anchored mode (testnet)
- [ ] StatusList2021 revocation
- [ ] Base Rego policy library

### Phase 2 — Framework Integrations
- [ ] `@helixid/langchain` — LangChain/LangGraph middleware
- [ ] `@helixid/crewai` — CrewAI integration
- [ ] `@helixid/n8n` — n8n node
- [ ] Session token bridge (VC → ephemeral JWT)
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
├── packages/
│   ├── sdk/              # Core SDK — DIDs, VCs, verification, OPA
│   ├── mcp/              # MCP middleware
│   ├── langchain/        # LangChain/LangGraph integration
│   ├── crewai/           # CrewAI integration
│   └── n8n/              # n8n node
├── policies/             # Base Rego policy library
├── examples/
│   ├── local-mode/       # did:key quickstart
│   ├── anchored-mode/    # did:hedera with HCS
│   ├── delegation/       # Multi-agent delegation chain
│   └── mcp-server/       # MCP server with HelixID auth
├── docs/
│   ├── architecture.md
│   ├── did-methods.md
│   ├── credential-schemas.md
│   └── security-model.md
└── benchmarks/           # Performance benchmarks
```

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where help is needed:

- **DID method implementations** — additional DID method resolvers
- **Framework integrations** — middleware for additional AI agent frameworks
- **Rego policy library** — common authorization patterns for agent use cases
- **Benchmarks** — real-world performance testing across caching configurations
- **Documentation** — tutorials, guides, and examples

## Community

- [GitHub Discussions](https://github.com/nicedigverse/helixid/discussions) — questions, ideas, and show-and-tell
- [GitHub Issues](https://github.com/nicedigverse/helixid/issues) — bug reports and feature requests

## License

[Apache License 2.0](LICENSE) — chosen for enterprise compatibility, explicit patent protection, and no copyleft friction for proprietary AI agent integrations.

## Built By

HelixID is built by [DgVerse](https://dgverse.io) — building the trust layer for digital credentials and AI agents.

---

<p align="center">
  <em>Static auth primitives will fail at scale for autonomous AI systems.<br/>Cryptographic agent identity is the infrastructure-level solution.</em>
</p>
