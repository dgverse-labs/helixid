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

**Approved by:** [founder]

---

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

## 2026-05-28 — Optional Peer Dependencies for Framework Adapters

**Decision:** Story 7 framework adapter packages declare framework SDKs as optional peers: `@modelcontextprotocol/sdk` for `@helixid/mcp` and `@langchain/core` for `@helixid/langchain`.

**Reason:** The adapters are intentionally thin and structural. They should not force every Helix ID install to pull MCP or LangChain dependencies, but applications using those frameworks still get explicit peer dependency metadata.

**Alternatives considered:** Hard dependencies — rejected because it bloats installs and couples unrelated adapter packages. No dependency metadata — rejected because package consumers need clear compatibility signals.

**Approved by:** [founder]

---

**Approved by:** [founder]

---

## 2026-09-03 — CLI stays JS-only; MCP middleware stays per-language

**Decision:** The `helix` CLI has one canonical implementation in
`helix-sdk-js` — `helix_cli` is removed from `helix-sdk-py`. The MCP
middleware is unaffected and continues to exist in both languages, in the
same bucket as `helix_langchain`/`helix_crewai`, and is renamed
`@helixid/mcp` → `@helixid/mcp-middleware` / `helix_mcp` →
`helix_mcp_middleware` to remove the ambiguity with a possible future
standalone MCP server. See `decision-cli-mcp-scope.md` for full reasoning.

**Reason:** The CLI is a standalone consumer tool (nobody imports it as a
library), so a JS-vs-Python split is a false split. The MCP middleware
package is a peer-dependency library other MCP servers/clients import to
verify/attach Helix VPs — a real per-runtime implementation, not a
duplicate, same as the LangChain/CrewAI adapters. A future standalone
Helix-MCP-server (Helix's own ops exposed as MCP tools, the MCP analogue of
the CLI) would fall under the CLI rule if it's ever built, but doesn't
exist yet — the `mcp-middleware` rename makes clear it isn't that.

**Alternatives considered:** Keep `helix_cli` in Python for parity with
`helix_langchain`/`helix_crewai` — rejected, since the CLI isn't a
framework adapter and has no capability gap to close by existing twice.
Also remove the MCP middleware from Python — rejected, it's structurally a
library like the other framework adapters, not a standalone tool. Leave it
named `mcp` — rejected, that was the source of the original confusion
between "middleware library" and "standalone server."

**Approved by:** [founder]

---

## 2026-09-03 — Built `@helixid/mcp-server`, the standalone Helix MCP server

**Decision:** Built the standalone Helix MCP server named in the CLI/MCP
scope decision above — `@helixid/mcp-server`, a new `helix-sdk-js` package
exposing the CLI's platform-operator workflows (`did_create`, `issuer_init`,
`status_list_create`, `vc_issue`, `vc_self_issue`, `revoke`,
`wallet_inspect`) as MCP tools over stdio. One canonical implementation,
JS only, same rule as the CLI. See `decision-cli-mcp-scope.md`'s "Applied"
section for the full breakdown, including a required prerequisite refactor
of `@helixid/cli`'s internals from `process.exit` to throwing (so a bad MCP
tool call can't kill the whole server process) and the removal of stale
compiled files that had been committed directly under `cli/src/`.

**Reason:** The user confirmed both the MCP-middleware library and the
standalone MCP server are wanted, and that the server belongs on
`helix-sdk-js` — the same placement already decided for the CLI, and for
the same reason (a standalone tool, not a library, so no per-language
split).

**Approved by:** [founder]

---

_Add new entries above this line. Date format: YYYY-MM-DD. Never delete or modify existing entries._
