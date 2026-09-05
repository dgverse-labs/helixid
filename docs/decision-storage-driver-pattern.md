# Decision: Postgres as default storage adapter + pluggable storage-driver pattern

**Status:** Draft — one repository (`DidRepository`) converted as a reference implementation. Not yet rolled out to the other seven, not yet pushed.

## 1. What changed

- `HELIX_STORAGE_ADAPTER` now defaults to `postgres` instead of `sqlite` (`core/config/index.ts`).
- `DidRepository`'s internal per-method `if (this.prisma) {...} else if (this.sqlite) {...} else {...}` branching has been extracted into three driver classes (`PrismaDidStorageDriver`, `SqliteDidStorageDriver`, `InMemoryDidStorageDriver`) selected by a factory function, so the repository class itself has zero backend branching left.

## 2. Why change the default

`HELIX_STORAGE_ADAPTER` defaulting to `sqlite` meant any deployment or CI job that didn't explicitly set it fell back to SQLite silently — including, on inspection, the **"Live tests (Postgres)" CI job in `helix-server`'s own workflow**. That job sets `DATABASE_URL` for a Postgres connection string but never explicitly sets `HELIX_STORAGE_ADAPTER` (or `LIVE_STORAGE_ADAPTER`, which the live-test harness in `tests/utils/liveApi.ts` reads to decide whether to pass `HELIX_STORAGE_ADAPTER: 'sqlite'` through to the spawned server). With the old default, the spawned server in that job would have fallen back to `sqlite`, meaning **the "Postgres" live-test job was very likely testing SQLite the whole time**, not Postgres as its name and its own code comment ("Postgres is the default and only storage adapter these live tests have ever driven") claim.

This is traced through the code carefully but not run end-to-end (the sandbox this was written in cannot run `prisma generate`, so it cannot start the real server to confirm empirically) — flagging as a strong finding, not a confirmed one, and recommending someone check the actual CI job logs once this is pushed, or reproduce locally where Prisma has real network access.

Flipping the default to `postgres` fixes this as a side effect: with no explicit override, the spawned server now defaults to `postgres`, matching the job's intent.

### Behavior change this causes

`core/config/index.ts` already validates `DATABASE_URL` is required when `HELIX_STORAGE_ADAPTER === 'postgres'`. Since that's now the default, **any environment that previously relied on the implicit SQLite default with no `DATABASE_URL` set will now fail fast at startup** with the existing clear error message ("DATABASE_URL: required when HELIX_STORAGE_ADAPTER=postgres") instead of silently starting on SQLite. This seems like the correct behavior for a production-oriented default — failing loudly beats silently running on the wrong backend — but it is a real, deliberate behavior change worth confirming before merging.

Two `docker-compose.yml` files under `examples/` explicitly set `HELIX_STORAGE_ADAPTER: sqlite` already, so they're unaffected either way.

## 3. Why the driver-interface refactor

The ask was to make it possible to add *any* DB interface, not just switch which of the two existing ones is the default. Before this change, adding a third backend (MySQL, MongoDB, anything) meant touching every method of every one of the 8 repository classes (~2,900 lines total) to add another `else if` branch. That doesn't scale and is exactly the kind of change that's easy to get subtly wrong in one repository while doing it correctly in another.

### The pattern

- `storage/driver-registry.ts` — shared infrastructure: the `StorageDriverKind` union type, a generic `StorageDriverDeps` bag, and an `UnsupportedStorageDriverError`.
- Per repository, a new `repositories/drivers/<name>.drivers.ts` file defines:
  - A narrow interface (`DidStorageDriver`) listing exactly the operations that repository needs.
  - One class per backend implementing it (`PrismaDidStorageDriver`, `SqliteDidStorageDriver`, `InMemoryDidStorageDriver`) — each is a direct, mechanical extraction of what used to be one branch of the old if/else chain. Behavior is unchanged; only where the branching code lives has moved.
  - A factory function (`createDidStorageDriver`) that switches on `StorageDriverKind` and returns the right instance. TypeScript's exhaustiveness checking (the `const _exhaustive: never = kind` trick in the `default` case) means adding a new `StorageDriverKind` member without updating every repository's factory produces a compile error, not a silent gap.
- The repository class itself (`DidRepository`) becomes a thin delegator: every method is `return this.driver.methodName(...)`, no branching.

### What adding a new backend looks like under this pattern

1. Add the new kind to `StorageDriverKind` in `storage/driver-registry.ts`.
2. Add it to the `HELIX_STORAGE_ADAPTER` zod enum in `core/config/index.ts`.
3. For each repository that needs to support the new backend, implement its `XStorageDriver` interface and add a `case` to its factory function. TypeScript will list every factory that still needs updating (compile error from the exhaustiveness check) — nothing to track by hand.
4. No existing repository class changes at all.

This is a smaller commitment than a fully generic, data-driven plugin system (e.g. dynamically loading arbitrary third-party adapter packages at runtime) — that would be a much bigger architecture change with its own tradeoffs (versioning, discovery, sandboxing) that didn't seem justified without a concrete driver waiting to be added. This pattern optimizes for "adding a backend is mechanical and type-checked," not "adding a backend requires zero code changes anywhere."

### Why the public constructor signature didn't change

The existing `(prisma?: PrismaClient, sqlite?: SqliteStore)` constructor signature is relied on directly across the test suite — at least 6 test files across unit/integration/security construct repositories this way (e.g. `new DidRepository(prisma)`, `new DidRepository()` for the in-memory fallback). Changing the constructor to take `(kind, deps)` explicitly would be the more "obviously correct" design in isolation, but it would break every one of those call sites for no behavioral gain — backend selection is still inferred exactly the same way it always was (prisma present → postgres, sqlite present → sqlite, neither → in-memory), just via a `resolveDriverKind()` private method instead of repeated inline `if` checks. **This is a deliberate, additive-not-breaking scope choice** — flagging it explicitly since it's the kind of shared-convention call that seemed better to make visible than to change unilaterally.

## 4. Rollout status: complete

All 8 repositories under `src/repositories/` now follow this pattern — `DidRepository`, `VcRepository`, `AuditLogRepository`, `AgentRepository`, `PreparedPayloadRepository`, `AccountRepository`, `IssuerKeyRepository`, `RefreshTokenRepository`, and `VPRepository`. Each has a companion `repositories/drivers/<name>.drivers.ts` with a `<Name>StorageDriver` interface, three implementing classes (`Prisma*`, `Sqlite*`, `InMemory*`), and a `create<Name>StorageDriver()` factory. Every repository's public constructor signature is unchanged. `ServiceRegistryRepository` needed no changes — it already only depends on `AgentRepository`, not on `prisma`/`sqlite` directly.

Net effect: ~2,300 lines of per-method backend branching removed from the 8 repository files (each now a thin delegator), replaced by ~2,700 lines across 8 new `drivers/*.ts` files where that same logic lives, now organized by backend instead of interleaved per-method. The repository files themselves shrank from ~2,900 total lines to under 800.

One naming inconsistency was found and deliberately left alone rather than silently "fixed": `VPRepository`'s constructor names its Prisma parameter `db`, not `prisma` like every other repository. That predates this refactor and isn't something this change should rename as a side effect.

## 5. Verification status

- **Not run against a real build/typecheck/test cycle.** The sandbox this was developed in cannot run `prisma generate` (needs network access to `binaries.prisma.sh`, outside its egress allowlist) — a pre-existing, already-documented limitation, not new here. Every driver file was written by careful manual extraction from the original, already-working implementation (near-verbatim per-method copy, just relocated), and reviewed by hand for TypeScript correctness against this project's `tsconfig.json` settings (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`) — but this has **not been confirmed by an actual compiler run**.
- Needs `pnpm --filter @helixid/api run build` and the full existing test suite (unit, integration, security, live) run for real before merging. Every repository's own test file (`did.repository.test.ts`, `vc.repository.test.ts` / `.integration.test.ts` / `.security.test.ts`, etc.) is the natural place to catch any transcription slip in the mechanical extraction, since they already construct each repository against a mocked or real Prisma client and exercise every method.
- Checked (but not run) that every repository's test-suite call sites still match: grepped for `new <X>Repository(` across `tests/` for each of the 8 repositories and confirmed no call site relies on anything beyond the unchanged `(prisma?, sqlite?)` / `(db?, sqlite?)` positional signature.
