# Helix ID — Project Constitution

This document is the single source of truth for all architectural, structural, security, and engineering decisions in the Helix ID project. Every user story, pull request, and design decision contracts against this file. If something is not covered here, raise it for constitution amendment — do not make ad hoc decisions.

---

## Table of Contents

1. Project Overview
2. Monorepo Structure
3. Folder Structure Per Package
4. Technology Stack
5. Security Axioms
6. API Contract Rules
7. helix-core Communication Model
8. Error Handling Philosophy
9. Environment Variables
10. Database
11. Hedera Interaction Rules
12. Audit Log Contract
13. Dependency Policy
14. Testing Constraints and Coverage
15. Definition of Done

---

## 1. Project Overview

Helix ID is an agent identity and trust infrastructure platform. It issues cryptographically verifiable identities (DIDs) and credentials (VCs) to agents and users, anchors them on the Hedera network.

The issuer service is self-hostable; Helix ID does not need to operate it on behalf of platform operators. Agents may self-sign delegation VCs using delegation — the SDK enforces scope subset and depth constraints locally without an issuer call.

Open core model. The core platform is Apache 2.0 licensed and self-hostable. SaaS and Enterprise tiers extend it with managed infrastructure, advanced policy engines, and compliance tooling.

The core system is organized around product domains: DID and Hedera integration, VC issuance and lifecycle management, VP creation and verification, JWT session bridging, agent/user onboarding, service registry, audit, and SDK ergonomics. Domain ownership is expressed through package structure and service interfaces, not through numbered labels.

The JWT Session Bridge may mint short-lived stateless JWT sessions only after full VP verification succeeds and the VP's `vpId` has been consumed.

---

## 2. Monorepo Structure

```
helix-id/
├── helix-core/          # Shared primitives — VC schema, crypto, OpenAPI spec, config, error types
├── helix-api/           # Fastify HTTP API — self-hostable, stateful operations
helix-cli/           # Operator CLI — DID creation, VC issuance, revocation, StatusList management
├── helix-sdk-js/        # TypeScript/JS SDK — HelixClient, local signing, wallet management
├── helix-sdk-py/        # (Future) Python SDK — mirrors JS SDK, OpenAPI spec as shared truth
├── packages/            # Framework adapters only — MCP, LangChain, future CrewAI, etc.
├── helix-contracts/     # (Future) Custom HCS message schemas — scaffolded, empty until that work begins
├── e2e/                 # End-to-end tests — full flow tests against live Docker Compose stack
├── scripts/             # Developer setup utilities — no application runtime logic
├── docker-compose.yml   # Local development stack — API + PostgreSQL + mock HCS
├── docker-compose.test.yml  # CI test stack
├── .env.example         # Environment variable template — all variables documented here
├── turbo.json           # Turborepo task graph definition — no application logic
├── decisions.md         # Append-only log of architectural decisions and dependency additions
├── CONSTITUTION.md      # This file
└── package.json         # Workspace root — scripts only, no application code
```

Rules:

- No application logic lives at the workspace root
- Root scripts are permitted only for developer setup, validation, and repository maintenance. They must not contain API runtime logic.
- helix-core has no monorepo siblings as dependencies — it is a pure library
- packages/* is reserved for thin framework adapters. These packages may depend on helix-sdk-js, helix-core types, or the future helix-sdk-py, but they must not introduce new trust semantics, API endpoints, or core primitives.
- helix-contracts is scaffolded but empty until custom HCS message schema work begins (note: DID anchoring uses the Hiero DID SDK from Story 1 — helix-contracts is for future custom message types beyond DIDs, Hedera is optional too)
- helix-cli is a thin wrapper around SDK and helix-core operations. It contains no business logic beyond CLI argument parsing and output formatting.
- turbo.json lives at the workspace root and is the task graph definition — no application logic
- Each package has its own package.json, tsconfig.json, and README.md

---

## 3. Folder Structure Per Package

### helix-core

```
helix-core/
├── src/
│   ├── config/          # Env variable schema and validated config module
│   ├── crypto/          # DID generation, VP/JWT signing, signature verification, key utils
│   ├── schemas/         # VC, VP, JWT schema definitions and privilege scopes
│   ├── errors/          # Shared error types and error codes
│   ├── audit/           # Audit log interface (contract only — implementations elsewhere)
│   ├── status-list/     # W3C StatusList2021 bitstring logic
│   └── openapi/         # OpenAPI spec — single source of truth for all API contracts
├── tests/
│   └── unit/
├── package.json
├── tsconfig.json
└── README.md
```

### helix-api

```
helix-api/
├── src/
│   ├── routes/          # Fastify route handlers — grouped by product domain
│   │   ├── did/
│   │   ├── vc/
│   │   ├── vp/
│   │   ├── agent/
│   │   └── sessions/
│   ├── services/        # Business logic — called by routes, calls repositories
│   │   ├── did/
│   │   ├── vc/
│   │   ├── vp/
│   │   ├── agent/
│   │   └── sessions/
│   ├── repositories/    # Database access — Prisma queries, no business logic
│   ├── hedera/          # IHederaClient interface + Hiero DID SDK implementation
│   ├── middleware/       # Auth, error handling, request logging
│   ├── audit/           # Audit log implementation for API
│   └── server.ts        # Fastify instance setup and plugin registration
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── package.json
├── tsconfig.json
└── README.md
```

### helix-sdk-js

```
helix-sdk-js/
├── src/
│   ├── client/          # HelixClient — public surface, single entry point
│   ├── wallet/          # Agent wallet — encrypted local storage of key, DID, VC
│   ├── vp/              # VP builder and local signing (calls helix-core crypto)
│   ├── http/            # Internal HTTP adapter — all API calls go through here
│   ├── audit/           # Audit log implementation for SDK
│   └── index.ts         # Public exports — HelixClient and types only
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── package.json
├── tsconfig.json
└── README.md
```

### helix-sdk-py (Future)

```
helix-sdk-py/
├── helix_sdk/
│   ├── client.py        # HelixClient
│   ├── wallet.py        # Agent wallet
│   ├── vp.py            # VP builder and signing
│   ├── http.py          # Internal HTTP adapter
│   ├── schemas.py       # Python-native type definitions (OpenAPI spec as truth)
│   ├── audit.py         # Audit log implementation
│   └── errors.py        # Error types mirroring helix-core error codes
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── pyproject.toml
└── README.md
```

### helix-cli
```
helix-cli/
├── src/
│   ├── commands/
│   │   ├── did.ts        # did create --method web|hedera|key
│   │   ├── vc.ts         # vc issue, vc revoke
│   │   └── status-list.ts # status-list create
│   └── index.ts
├── package.json
├── tsconfig.json
└── README.md
```

### packages/* Framework Adapters

```
packages/
├── mcp/                 # MCP adapter — VP/session verification and VP attachment for tool calls
├── langchain/           # LangChain/LangGraph adapter — VP attachment for tool invocations
└── crewai/              # Future CrewAI adapter — parked until helix-sdk-py exists
```

Rules:

- Framework adapters are ergonomic wrappers around the SDK and existing API only.
- They must not contain credential issuance, VP verification semantics, DID anchoring logic, or policy decisions that belong in helix-api, helix-core, or the SDK.
- TypeScript adapters use `@helix-id/sdk-js` and `@helix-id/core` workspace packages.
- Python adapters must use `helix-sdk-py` once available. They must not hand-roll VP signing, canonicalization, or verification semantics inside framework adapters.

### e2e

```
e2e/
├── tests/
│   ├── agent-onboarding.test.ts
│   ├── user-did-flow.test.ts
│   ├── vp-lifecycle.test.ts
│   ├── vp-replay-attack.test.ts
│   └── vc-revocation-flow.test.ts
├── helpers/             # Stack setup, client factories, test data builders
├── package.json
└── tsconfig.json
```

---

## 4. Technology Stack

### Languages and Runtimes

| Component | Language | Version |
|---|---|---|
| helix-api | TypeScript | Node.js >= 20 LTS |
| helix-sdk-js | TypeScript | Node.js >= 18 LTS |
| helix-sdk-py (Future) | Python | >= 3.11 |
| helix-core | TypeScript | Node.js >= 20 LTS |

### API Layer

| Decision | Choice | Rationale |
|---|---|---|
| HTTP framework | Fastify | Schema-first, JSON Schema on every route, aligns with OpenAPI contract rule, native TS support |
| Schema validation | Fastify JSON Schema + Zod | Route validation via JSON Schema; business logic validation via Zod |
| ORM | Prisma | Type-safe queries, migration management, schema as code |
| Database | PostgreSQL | ACID guarantees required for vpId consumption and token burning (security operations) |
| Cache | L1 in-process + optional Redis L2 in helix-api | Performance layer over PostgreSQL/Hedera reads; optional Redis supports multi-instance deployments |

### Monorepo and Build

| Decision | Choice | Rationale |
|---|---|---|
| Monorepo workspace | pnpm workspaces + Turborepo | Shared helix-core primitives; Turborepo ensures correct build order and enables remote cache |
| Remote cache | turborepo-remote-cache (self-hosted) | MIT licensed; prevents redundant CI builds; set up before team grows beyond 2 people |

### DID methods

| DID method  | Use case                        | Hosting required        |
|-------------|---------------------------------|-------------------------|
| did:key     | Local dev, ephemeral agents     | None                    |
| did:web     | Default production              | HTTPS /.well-known/     |
| did:hedera  | Enterprise, immutable anchoring | Hedera operator account |

### Hedera

| Decision | Choice | Rationale |
|---|---|---|
| DID anchoring | @hiero-did-sdk/registrar | Implements did:hedera method spec; interoperable with standard Hedera DID resolvers |
| DID resolution | @hiero-did-sdk/resolver | Resolves did:hedera DIDs from Hedera Mirror Node; no Helix ID dependency for external verifiers |
| Network client | @hashgraph/sdk | Official Hedera SDK; required for operator account and HBAR payment |

DID format: `did:hedera:testnet:<identifier>` — standard did:hedera method, not a custom did:helix format.
did:hedera is optional. did:web is the default production DID method. did:key is for local development and ephemeral agents

### Cryptography

| Purpose | Library |
|---|---|
| Elliptic curve signing | @noble/curves |
| Hashing | @noble/hashes |

No other crypto libraries are permitted without a documented decision in decisions.md. No thin wrappers around wrappers. No unmaintained libraries.

### Testing

| Scope | Framework |
|---|---|
| JS/TS unit + integration | Vitest |
| JS/TS HTTP testing | Supertest |
| JS/TS coverage | @vitest/coverage-v8 |
| E2E | Vitest driving SDK against live stack |

### Tooling

| Purpose | Tool |
|---|---|
| Monorepo workspace | pnpm workspaces + Turborepo |
| Remote cache | turborepo-remote-cache (self-hosted) |
| Linting | ESLint (TS) |
| Formatting | Prettier (TS), Black (Python) |
| CI | GitHub Actions |
| Containerisation | Docker + Docker Compose |

---

## 5. Security Axioms

These rules are non-negotiable. No user story, no implementation shortcut, no external request overrides them. Any PR that violates an axiom is rejected without exception.

**SA-1 — Private key never leaves the agent.** The agent's private key is generated locally and stored in the agent wallet. It is never transmitted to Helix ID, never passed to the API, and never logged. buildAndSignVP executes entirely client-side.

**SA-2 — Helix ID never sees the agent's private key.** The onboarding flow binds a keypair via challenge-response. Helix ID receives the public key and a signature. Never the private key.

**SA-3 — Enrollment token is single-use.** Every enrollment token is burned on first use. A second attempt with the same token is rejected regardless of validity. Token expiry is 15–30 minutes.

**SA-4 — replay Attack is out of scope for helix id.** The SDK returns the vpId from every verified VP. The verifier is responsible for persisting consumed vpIds in their own store and rejecting duplicates. The self-hosted API implements this for operators who use it. Service providers using SDK-only verification must implement equivalent nonce checking — an example implementation using Redis is provided in examples/replay-protection/

**SA-5 — VP expiry is enforced.** Every VP has a short expiry timestamp. Expired VPs are rejected at verification regardless of signature validity.

**SA-6 — VC revocation is checked at verification.** Verifiers must check the W3C StatusList2021 status list at the index embedded in the VC. A revoked VC (bit flipped to 1) invalidates any VP built from it.

**SA-7 — Challenge-response is the universal verification mechanism.** No user or agent identity claim is accepted without a challenge-response proof of private key ownership. There is no password-based or OTP-based fallback in core.

**SA-8 — Nothing sensitive appears in logs.** Private keys, raw VCs in plaintext, and raw VP payloads before verification must never appear in any log output, error message, or audit entry. See Audit Log Contract.

**SA-9 — Testnet only for Hedera in all non-production environments.** No test, CI pipeline, or development environment writes to Hedera mainnet under any circumstances.

**SA-10 — No security test may be skipped.** Security tests in tests/security/ may not be marked skip, todo, or xit. CI enforces this via grep. A skipped security test is a build failure.

**SA-11 — JWT sessions are derived from verified VPs only.** A JWT session may be issued only after full VP verification succeeds and `vpId` has been consumed. JWTs are short-lived, stateless, signed by an API startup-ephemeral Ed25519 keypair, and never replace VC or VP issuance semantics. The JWT session private key never leaves API memory and raw JWT token strings must not be logged or audited.

**SA-12 — Delegation never increases authority.** A delegated VC may contain only scopes that are a subset of the delegator's active VC scopes. Any requested scope outside the parent scope set is rejected.

**SA-13 — Delegation depth is explicit and enforced.** Root agent VCs default to `maxDelegationDepth = 0`. Delegation is impossible unless the agent owner explicitly allows it. Each child VC increments `delegationDepth`; delegation fails when `delegationDepth >= maxDelegationDepth`.

**SA-14** — Root VCs are signed by the issuer only. Root VCs establishing an agent's initial authority are signed by the platform operator's issuer service. Agents may self-sign delegation VCs (Option A delegation) granting a subset of their own scopes to another agent. The SDK enforces that delegated scopes are a strict subset of the delegator's active VC scopes and that delegation depth limits are respected. Self-signed delegation VCs carry no issuer trust anchor and are validated by chain integrity alone.".

**SA-15 — A broken parent breaks the chain.** If any parent or intermediary VC in a delegation chain is expired, revoked, missing, tampered, invalidly signed, or linked incorrectly, the leaf VP must fail verification.

**SA-16 ** — Self-signed VCs are rejected in production verification by default. The SDK's verifyVP() rejects VCs where issuer === credentialSubject.id unless { allowSelfSigned: true } is explicitly passed. This flag is for local development only. Framework adapters must never pass allowSelfSigned: true in production configurations.
---

## 6. API Contract Rules

**AC-1 — OpenAPI spec is the source of truth.** The spec lives in helix-core/src/openapi/. Every endpoint must have a spec entry before implementation begins. The spec is the design artifact — not documentation generated after the fact.

**AC-2 — No endpoint exists without a spec entry.** A route handler with no corresponding OpenAPI definition is a build failure. Enforced by a validation script in CI that diffs registered routes against the spec.

**AC-3 — Breaking changes require a version bump.** Any change that modifies request or response shape in a non-additive way requires an API version increment. Additive changes (new optional fields) do not.

**AC-4 — Fastify JSON Schema on every route.** Every route defines schema.body, schema.querystring, schema.params, and schema.response where applicable. No unvalidated input reaches a service layer.

**AC-5 — The SDK is the intended client.** The API is designed for HelixClient as its primary consumer. Raw HTTP access is supported and documented but not the primary design target. This means the API can assume well-formed requests matching the SDK's behavior — it does not need to defend against arbitrary malformed input beyond standard validation.

**AC-6 — Session endpoints live under `/v1/sessions`.** The JWT public key endpoint is `GET /v1/sessions/public-key`. VP verification may accept an optional `session` field as an additive change, but session issuance must remain attached to successful VP verification.

---

## 7. helix-core Communication Model

helix-core is a pure library package. The dependency graph has exactly one direction.

```
helix-api     →  helix-core
helix-sdk-js  →  helix-core
helix-sdk-py  →  (mirrors helix-core types natively — no cross-language import)
helix-core    →  (no monorepo imports)
```

helix-core never imports from helix-api, helix-sdk-js, or helix-sdk-py. Ever.

What lives in helix-core and why it must be there:

| Module | Reason it must be in core |
|---|---|
| VC schema + Zod validators | Both API (issuance) and SDK (parsing) must validate against the same schema |
| Crypto primitives | SDK signs locally; API verifies. Both must use identical algorithms |
| OpenAPI spec | API implements it; SDK calls it. Single definition prevents drift |
| Config module + Zod env validation | API uses config at runtime; env shape must be validated before anything starts |
| Shared error types and codes | API returns errors; SDK parses them. Same codes on both sides |
| Audit log interface | API and SDK have separate implementations but must log the same event types |
| StatusList2021 bitstring logic | API writes the list; SDK and external verifiers read it |
| JWT schema + crypto utilities | API issues JWT sessions; SDK and external services verify them locally using the same Ed25519 and base64url logic |

helix-sdk-py does not import from helix-core. It maintains its own Python-native type definitions in helix_sdk/schemas.py. The OpenAPI spec in helix-core is the truth that both the JS and Python SDKs are validated against in CI — not a shared import.

---

## 8. Error Handling Philosophy

**EH-1 — Error code with structured error body.** Every error response from the API returns a structured JSON body. HTTP status codes convey category; the body conveys specifics.

```json
{
  "error": {
    "code": "ENROLLMENT_TOKEN_EXPIRED",
    "message": "The enrollment token has expired. Tokens are valid for 15 minutes.",
    "requestId": "req_01j..."
  }
}
```

**EH-2 — Error codes are defined in helix-core.** The full enumeration of error codes lives in helix-core/src/errors/. The SDK maps these codes to typed error classes. New codes require a helix-core change — they cannot be invented ad hoc in helix-api.

**EH-3 — Never leak internal state in error responses.** Database errors, Hedera transaction details, internal stack traces, and key material never appear in error responses returned to callers. Log the detail internally; return only the structured error body.

**EH-4 — Security errors are indistinguishable where appropriate.** Invalid signature and invalid DID return the same error code (VP_VERIFICATION_FAILED) to prevent oracle attacks. The internal log records the specific reason; the external response does not.

**EH-5 — All errors are logged before being returned.** The middleware logs every error with its requestId, error code, and internal detail before serialising the response. This ensures audit coverage without leaking to callers.

**EH-6 — SDK throws typed errors.** HelixClient never rejects with a raw HTTP error or a string. Every failure throws an instance of a typed error class (e.g. HelixEnrollmentTokenExpiredError) that exposes code, message, and optionally retryable.

---

## 9. Environment Variables

**EV-1 — Config module in helix-core is the single entry point.** No package reads process.env directly. Every package imports the validated config object from helix-core/src/config/. If a variable is missing or malformed, the process exits at startup with a clear error — not at runtime three calls deep.

**EV-2 — All variables are validated with Zod at startup.** The config module defines a Zod schema for the full environment. Validation runs before the server binds to a port or the SDK initialises a wallet.

**EV-3 — .env.example is the canonical list of all variables.** Every environment variable that exists in the system must have an entry in .env.example with a description and example value. No undocumented variables.

**EV-4 — .env files with real credentials are never committed.** .env, .env.local, .env.production are gitignored. CI uses GitHub Actions secrets. Local development uses .env.test (gitignored) populated from .env.example.

**EV-5** HELIX_SIGNING_KEY and HELIX_ISSUER_DID are required only when running the self-hosted issuer service. SDK-only deployments do not require these variables."

### Variable Categories

| Category | Variables |
|---|---|
| Hedera | HEDERA_NETWORK, HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_TOPIC_ID |
| Database | DATABASE_URL |
| Cache | CACHE_ENABLED, CACHE_L2_ENABLED, REDIS_URL, DID_CACHE_L1_TTL_SECONDS, DID_CACHE_L2_TTL_SECONDS, STATUS_LIST_CACHE_L1_TTL_SECONDS, STATUS_LIST_CACHE_L2_TTL_SECONDS |
| Helix ID signing | HELIX_SIGNING_KEY (private key for VC issuance), HELIX_ISSUER_DID |
| JWT session signing | API startup-ephemeral Ed25519 keypair, public key served at `/v1/sessions/public-key` |
| API | PORT, API_BASE_URL |
| Token expiry | ENROLLMENT_TOKEN_TTL_SECONDS, CHALLENGE_TTL_SECONDS, VP_TTL_SECONDS, JWT_SESSION_TTL_SECONDS |
| Audit | AUDIT_LOG_DESTINATION (stdout / file / both), AUDIT_LOG_PATH |
| Environment | NODE_ENV |
| E2E / Testing | HEDERA_E2E_TESTNET |

The developer setup script must not persist JWT session signing keys. Live Hedera DID creation for issuer setup is separate work and must not be faked locally.

Cache variables are optional. `CACHE_ENABLED` defaults to true. L1 in-process cache is enabled by default with conservative TTLs. Redis L2 is enabled only when `CACHE_L2_ENABLED=true` and `REDIS_URL` is set.

---

## 10. Database

**DB-1 — PostgreSQL is the only supported database.** SQLite is not supported. Concurrent write safety is required for vpId consumption and enrollment token burning. These are security operations that require ACID guarantees.

**DB-2 — Prisma is the ORM.** All database access goes through Prisma. Raw SQL queries are not permitted except in migration files. No other ORM or query builder is introduced.

**DB-3 — Schema migrations are code-reviewed like application code.** Migration files live in helix-api/prisma/migrations/. Destructive migrations (dropping columns, tables) require explicit approval note in the PR description.

**DB-4 — No business logic in repositories.** Repository files contain Prisma queries only. Business logic lives in service files. Services call repositories; routes call services.

**DB-5 — PostgreSQL remains the durable API-side DID and VC state index.** Caches may sit in front of read paths for performance, but they do not replace PostgreSQL persistence or Hedera DID anchoring.

### Core Tables

| Table | Purpose |
|---|---|
| dids | DID records, public keys, Hedera transaction IDs |
| did_updates | History of DID document updates |
| vcs | Issued VCs, status list index, expiry, revocation state |
| enrollment_tokens | One-time tokens, tokenHash (never raw value), usedAt timestamp, expiry |
| vp_ids | Issued vpIds, consumedAt timestamp |
| challenges | Active challenge nonces, expiry, DID association, purpose |
| status_list_entries | Bitstring entries per status list |
| service_registry | Verified service endpoints and metadata |
| audit_log | Append-only audit event log |

The JWT Session Bridge adds no database table. JWTs are stateless; replay protection remains anchored in `vp_ids`.

### Cache Rules

**CR-1 — Cache is a performance layer only.** L1/L2 cache entries must never become the source of authority for security state. DID documents and status lists may be cached, but verification semantics remain governed by DID active state, VC expiry, VC revocation, and chain validation.

**CR-2 — Stale cache must not validate revoked or deactivated authority.** Helix ID's own verification path must not accept a stale cached DID after deactivation or stale cached status list after VC revocation. Either invalidate immediately or check the durable DB state before accepting cached data in security-critical paths.

**CR-3 — L2 cache is optional.** Open core supports Redis as an optional shared cache when `CACHE_L2_ENABLED=true` and `REDIS_URL` is configured. The system must run correctly with L1-only cache.

**CR-4 — Cache keys must not contain secrets.** Cache keys and values must not include private keys, encrypted private keys, raw JWTs, raw enrollment tokens, or database connection strings. Raw VP payloads before verification must not be cached.

---

## 11. Hedera Interaction Rules

**HR-1 — Testnet by default.** All development, testing, and CI environments use Hedera testnet. HEDERA_NETWORK defaults to testnet. The config module rejects mainnet unless NODE_ENV=production is explicitly set.

**HR-2 — All Hedera calls go through IHederaClient.** A TypeScript interface IHederaClient defines the contract for all Hedera DID operations. The production implementation wraps the Hiero DID SDK. Tests use a test double that records calls without writing to the network.


```typescript
interface IHederaClient {
  anchorDocument(payload: string): Promise<HederaTransactionResult>
  resolveDocument(topicId: string, sequenceNumber: number): Promise<string>
}
```

**HR-3 — No test writes to Hedera testnet in CI.** Integration and unit tests use the IHederaClient test double. E2E tests may write to testnet but this is opt-in, controlled by HEDERA_E2E_TESTNET=true, and never runs in standard CI pipelines.

**HR-4 — Hedera operator credentials are never hardcoded.** Operator account ID and private key come from environment variables only. No test fixture, seed file, or code comment contains real Hedera credentials.

**HR-5 — HBAR costs are the API's responsibility.** The SDK never holds Hedera credentials or pays for transactions. The API operator account pays for all HCS writes. This is by design — the agent's private key and the Hedera operator key are entirely separate concerns.

HR-6 — Hedera is optional. The system must operate correctly with HELIX_DID_METHOD=web or HELIX_DID_METHOD=key without any Hedera credentials configured. Hedera-dependent code paths must be gated on HELIX_DID_METHOD=hedera and must not execute or fail loudly when Hedera is not configured."

---

## 12. Audit Log Contract

Every security-relevant event must produce an audit log entry. This is not optional — it is a correctness requirement on par with tests.

**AL-1 — These events must always be logged:**

| Event | Required Fields |
|---|---|
| Enrollment token generated | tokenIdHash, agentName, requestedScopes, expiresAt |
| Enrollment token consumed | tokenIdHash, agentDid, timestamp |
| Enrollment token rejected | tokenIdHash, reason, timestamp |
| DID created | did, subjectType, hederaTransactionId, publicKeyMultibase |
| DID updated | did, updateType, hederaTransactionId |
| DID deactivated | did, reason, timestamp |
| VC issued | vcId, subjectDid, subjectType, privilegeScopes, expiresAt, statusListIndex |
| VC revoked | vcId, revokedBy, timestamp |
| VC renewed | oldVcId, newVcId, timestamp |
| Challenge issued | challengeId, did, purpose, expiresAt |
| Challenge verified | challengeId, did, purpose, success |
| Challenge rejected | challengeId, reason, timestamp |
| VP template issued | vpId, agentDid, userDid, targetService, expiresAt |
| VP verified | vpId, agentDid, result, timestamp |
| VP rejected | vpId, reason (internal log only — never in HTTP response), timestamp |
| JWT session issued | jti, agentDid, userDid, targetService, vpId, expiresAt |
| JWT session rejected | jti or requestId, reason (internal log only), timestamp |
| Agent onboarded | agentDid, agentName, hederaTransactionId |
| User DID verified | userDid, timestamp |
| Status list updated | listId, index, newBitValue, timestamp |

**AL-2 — These fields must never appear in audit logs:**

- Private keys (agent or Helix ID)
- Raw VC payloads in plaintext
- Raw VP payloads before verification
- Raw JWT session tokens
- JWT session private key
- Database connection strings
- Enrollment token raw values after generation (log the tokenIdHash only)

**AL-3 — Audit log is append-only.** No audit log entry is ever deleted or updated. In core, audit log is written to PostgreSQL audit_log table and optionally to stdout as structured JSON.

**AL-4 — Audit log format is structured JSON.** Every entry is a single-line JSON object with timestamp (ISO 8601), event, requestId, and event-specific fields.

**AL-5 — Missing audit log entries are a bug.** If a security event listed in AL-1 occurs and no audit log entry is produced, that is treated as a bug with the same priority as a failing security test.

---

## 13. Dependency Policy

Dependencies are not prohibited, but every addition is a decision that must be documented.

**DP-1 — Before adding a dependency, check:**

1. Is it actively maintained? (last commit, issue response rate)
2. Does it have known CVEs? (check pnpm audit or pip-audit)
3. Can an existing dependency already in the project achieve this?
4. For crypto libraries specifically: is it a well-known audited library? (see approved list in stack section)

**DP-2 — Every new dependency is recorded in decisions.md.** Format: date, package name, version, reason added, alternatives considered, who approved.

**DP-3 — Crypto libraries have a stricter gate.** Only @noble/curves, @noble/hashes (JS) and cryptography PyCA (Python) are approved for cryptographic operations. Any addition to this list requires explicit amendment to this constitution, not just a decisions.md entry.

**DP-3a — JWT libraries are not approved for Story 5.** `jsonwebtoken`, `jose`, and equivalent JWT abstraction libraries are not permitted for the JWT Session Bridge unless this constitution is amended. JWT signing and verification must use approved crypto primitives and explicit base64url/JWS handling in helix-core.

**DP-4 — Dev dependencies are not exempt.** A malicious build tool is as dangerous as a malicious runtime dependency. The same checks apply.

**DP-5 — pnpm audit and pip-audit run in CI on every PR.** High or critical severity findings block merge. Exceptions require a documented reason and a filed issue for remediation.

---

## 14. Testing Constraints and Coverage

### Philosophy

Tests in Helix ID are security proofs as much as correctness proofs. A passing test suite means the trust model holds, not just that the code runs.

### Test Types

**Unit tests**

- Pure logic, no I/O, no network, no database, no Hedera
- helix-core is almost entirely unit tested
- Mocking crypto primitives is forbidden — if a unit test needs to mock signVP, the code is structured wrong
- Framework: Vitest (JS/TS), Pytest (Python)

**Integration tests**

- One product flow or service area end-to-end against real dependencies
- helix-api integration tests run against real PostgreSQL (Docker Compose) and IHederaClient test double
- SDK integration tests run against a locally running helix-api instance
- Framework: Vitest + Supertest (JS/TS), Pytest (Python)

**Security tests**

- Separate category in tests/security/ — not folded into integration
- Every named attack vector in the design has a corresponding test
- Framework: Vitest (JS/TS), Pytest (Python)
- May never be skipped. CI enforces via grep on tests/security/ for skip, xit, todo.

**End-to-end tests**

- Full flows against Docker Compose stack (API + PostgreSQL + mock HCS)
- Run on merge to main only — not on every PR
- Framework: Vitest driving the JS SDK against the live stack

### Required Security Tests

Every item on this list must have a corresponding test. This is a checklist, not a coverage percentage.

- [ ] Present same vpId twice — second must be rejected
- [ ] Present VP past expiry — must be rejected
- [ ] Use enrollment token twice — second must be rejected
- [ ] Use enrollment token past 15-minute TTL — must be rejected
- [ ] Tamper one field in VP after signing — verification must fail
- [ ] Verify VP with revoked VC — must be rejected
- [ ] Sign VP with wrong private key — must fail verification
- [ ] Issue challenge, let it expire, submit signature — must be rejected
- [ ] Attempt DID update with wrong keypair — must be rejected
- [ ] Concurrent VP verification with same vpId — exactly one must succeed
- [ ] Raw enrollment token must never appear in audit log — only tokenIdHash
- [ ] Challenge replay — same challengeId submitted twice after verification — must be rejected
- [ ] Request JWT session with invalid VP — no JWT must be issued
- [ ] Tamper JWT payload after signing — verification must fail
- [ ] Verify JWT with wrong public key — verification must fail
- [ ] Verify JWT past expiry — must be rejected
- [ ] Raw JWT session token and JWT session private key must never appear in audit log
- [ ] Self-signed VC presented to production verifier (allowSelfSigned not set) — must be rejected
- [ ] Delegated VC with scopes exceeding parent — SDK must reject before presentation
- [ ] Delegation depth exceeded — SDK must reject
- [ ] Replay protection — same vpId presented to SDK verifier twice — second must be rejected by caller store example

### Coverage Minimums

| Package | Unit coverage | Integration | Notes |
|---|---|---|---|
| helix-core | 95% | N/A | Pure logic — no excuse for gaps |
| helix-api | 80% | All happy paths + all security cases | Security tests tracked separately via checklist |
| helix-sdk-js | 85% | All SDK methods against live API | |
| helix-sdk-py | 85% | Same as JS SDK | |
| e2e | Not line-measured | All named flows must have a test | |

### Forbidden Practices

- Mocking crypto primitives in any test
- Shared mutable state between tests — integration tests truncate tables in beforeEach
- Writing to Hedera mainnet in any test or CI pipeline
- Committing .env files with real credentials
- console.log debugging left in test files (ESLint rule)
- test.skip, xit, or it.todo in tests/security/ (CI grep blocks merge)

---

## 15. Definition of Done

A user story is done when all of the following are true:

- [ ] OpenAPI spec updated in helix-core/src/openapi/ before or alongside implementation
- [ ] Implementation matches the spec exactly — no undocumented fields, no missing fields
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing where the story touches HTTP, persistence, or cross-service behavior
- [ ] Security tests written if the story touches any item in the security test checklist
- [ ] Audit log entries defined and verified to be emitted for all events in AL-1 that the story triggers
- [ ] Error cases documented — every non-2xx response the story can produce has an error code in helix-core
- [ ] No new dependency added without a decisions.md entry
- [ ] pnpm audit / pip-audit clean
- [ ] Coverage minimums met for affected packages
- [ ] PR description notes any database migrations and whether they are destructive
- [ ] README.md updated in the affected package if public-facing behaviour changed

---

_Constitution version 1.5 — optional L1/L2 cache rules added for helix-api read paths. Further amendments require a PR touching this file with explicit note in the PR description that the constitution is being amended._
