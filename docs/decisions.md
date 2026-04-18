# Helix ID — Architectural Decisions Log

This file is append-only. Every new dependency, every significant architectural decision,
and every deviation from the constitution is recorded here.

---

## 2025-04-18 — Project initialization

**Decision:** Monorepo structure with pnpm workspaces + Turborepo.

**Reason:** Shared helix-core primitives needed by both API and SDK. Turborepo ensures correct build order and enables remote cache for CI speed.

**Remote cache note:** Self-host turborepo-remote-cache package (MIT licensed) on any Node server or Railway/Fly.io instance. Set TURBO_API, TURBO_TOKEN, TURBO_TEAM env vars in CI. Do this before the team grows beyond 2 people — cache hit rate on a warmed CI is 70–90% on unchanged packages.

**Alternatives considered:** Separate repos with local npm link — rejected due to synchronisation overhead.
**Approved by:** [founder]

---

## 2025-04-18 — Turborepo for task orchestration

**Decision:** Turborepo added at project init for task graph caching and parallel execution.

**Reason:** helix-core is a shared dependency — Turborepo ensures build order is correct (helix-core builds before helix-api and helix-sdk-js). Remote cache via self-hosted turborepo-remote-cache prevents redundant CI builds.

**Alternatives considered:** Plain pnpm workspaces scripts — rejected because build order and cache invalidation must be managed manually as package count grows.
**Approved by:** [founder]

---

## 2025-04-18 — Fastify chosen as HTTP framework

**Decision:** helix-api uses Fastify.

**Reason:** Schema-first, native TypeScript, JSON Schema on every route aligns with AC-4.

**Alternatives considered:** Express — rejected due to lack of built-in schema validation; Hono — rejected, less mature ecosystem for this use case.

**Approved by:** [founder]

---

## 2025-04-18 — @noble/curves and @noble/hashes for cryptography

**Decision:** Only @noble/curves and @noble/hashes are permitted for cryptographic operations in JS/TS packages.

**Reason:** Audited, maintained, no native dependencies, tree-shakeable.

**Alternatives considered:** node:crypto built-ins — insufficient for Ed25519 VP signing in browser-compatible SDK; tweetnacl — unmaintained.

**Approved by:** [founder]

---

## 2025-04-18 — Hiero DID SDK for Hedera DID anchoring

**Decision:** Use `@hiero-did-sdk/client`, `@hiero-did-sdk/registrar`, and `@hiero-did-sdk/resolver` instead of rolling a custom HCS message format for DID anchoring.

**Reason:** These packages implement the official `did:hedera` DID method spec. DID format becomes `did:hedera:testnet:<identifier>` instead of a custom `did:helix:<hash>`. This means external resolvers can verify DIDs without depending on Helix ID at all, which strengthens the trust model and aligns with W3C DID spec interoperability goals.

**Impact on constitution:** DID format updated from `did:helix:<32 hex chars>` to `did:hedera:testnet:<identifier>` throughout. The `IHederaClient` interface is retained — it wraps these SDK calls rather than raw HCS calls. The `helix-contracts` package remains scaffolded for future custom HCS message schema work unrelated to DIDs.

**Alternatives considered:** Raw `@hashgraph/sdk` HCS topic message submission with custom message format — rejected because it reinvents the did:hedera method spec and breaks interoperability with standard Hedera DID resolvers.

**Approved by:** [founder]

---

## 2025-04-18 — @hashgraph/sdk for Hedera network interaction

**Decision:** `@hashgraph/sdk` is used as the underlying Hedera network client, wrapped by the Hiero DID SDK.

**Reason:** Official Hedera SDK. Required for operator account setup and HBAR payment for HCS transactions. The Hiero DID SDK depends on it.

**Alternatives considered:** None — it is the only SDK for Hedera.

**Approved by:** [founder]

---

## 2025-04-18 — W3C StatusList2021 for VC revocation

**Decision:** VC revocation uses W3C StatusList2021 — a gzip-compressed base64url-encoded bitstring.

**Reason:** Privacy-preserving (verifiers cannot tell which VC they are checking from the index alone), cacheable (verifiers can cache the list and check offline), and standard (W3C specification).

**Alternatives considered:** Simple revocation registry (list of revoked vcIds) — rejected because it leaks which VCs have been revoked and requires a per-VC network call to check.

**Approved by:** [founder]

---

## 2025-04-18 — Prisma as ORM

**Decision:** Prisma is the ORM for helix-api.

**Reason:** Type-safe queries, migration management, schema as code. Aligns with DB-2 in constitution.

**Alternatives considered:** Drizzle — considered but Prisma's migration tooling is more mature; raw pg — rejected, no type safety.

**Approved by:** [founder]

---

## 2025-04-18 — PostgreSQL as the only supported database

**Decision:** PostgreSQL only. SQLite not supported.

**Reason:** Concurrent write safety required for vpId consumption (SA-4) and enrollment token burning (SA-3). These are security operations requiring ACID guarantees and row-level locking. SQLite cannot safely handle concurrent writes in a multi-request server.

**Alternatives considered:** SQLite for simplicity — rejected on security grounds as above.

**Approved by:** [founder]

---

## 2025-04-18 — Agent wallet uses AES-256-GCM with PBKDF2

**Decision:** AgentWallet encrypts the private key at rest using AES-256-GCM. Encryption key derived via PBKDF2 (100,000 iterations, SHA-256, 32-byte output, 16-byte random salt). Uses Node.js built-in `crypto` module.

**Reason:** No additional dependency. PBKDF2 with 100k iterations is sufficient for protecting a local wallet file against offline brute force. AES-256-GCM provides authenticated encryption — tampering with the file is detectable.

**Alternatives considered:** argon2 — stronger KDF but requires a native addon, breaking browser-compatibility goal of the SDK. libsodium — additional dependency, same algorithm class.

**Approved by:** [founder]

## 6. Migration from npm to pnpm
**Date:** 2026-04-18
**Status:** Approved

**Context:** The initial specification (`docs/story0.md` & `constitution.md`) mandated using `npm workspaces` for monorepo management.
**Decision:** We transitioned from `npm` to `pnpm` (v9+) for robust package management.
**Rationale:** `pnpm` strictly bans phantom dependencies through its symlinked virtual store (`.pnpm`). In a monolithic repository architecture designed around Zero-Trust and explicit boundaries, letting a workspace implicitly import a dependency it didn't explicitly request is an architectural violation. `pnpm` strictly forbids this. It also integrates perfectly with Turborepo and provides parallel processing speedups.
**Consequences:** 
- Workspace linking uses native `pnpm-workspace.yaml`.
- All `npm install` actions are replaced by `pnpm install`.
- Internal dependency linking uses `"workspace:*"` explicitly.
- `package-lock.json` replaced by `pnpm-lock.yaml`.

---

_Add new entries above this line. Date format: YYYY-MM-DD. Never delete or modify existing entries._
