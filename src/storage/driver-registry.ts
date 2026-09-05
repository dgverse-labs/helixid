// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Shared infrastructure for the pluggable storage-driver pattern used by
// every repository in src/repositories/. See docs/decision-storage-driver-
// pattern.md for the full design writeup and migration plan.
//
// THE PROBLEM THIS SOLVES: repositories used to branch on `if (this.prisma)
// ... else if (this.sqlite) ... else (in-memory)` inside every single
// method. Adding a new backend (MySQL, MongoDB, a hosted-only backend,
// whatever comes next) meant touching every method of every repository.
//
// THE PATTERN: each repository defines its own narrow `XStorageDriver`
// interface describing exactly the operations it needs (see
// repositories/drivers/did.drivers.ts for the reference implementation).
// Three (or more) classes implement that interface — one per backend — and
// a small factory function selects one by `StorageDriverKind`, registered
// here. The repository class itself becomes a thin delegator with zero
// branching: `return this.driver.createDid(data)`.
//
// ADDING A NEW BACKEND: implement the relevant `XStorageDriver` interface(s)
// for the new backend, add its kind to `StorageDriverKind` below and to the
// `HELIX_STORAGE_ADAPTER` enum in core/config/index.ts, then wire it into
// each repository's factory function (see did.drivers.ts's
// `createDidStorageDriver` for the pattern). No existing repository logic
// needs to change.

/**
 * The set of storage backends known to this codebase. Extend this — and the
 * HELIX_STORAGE_ADAPTER enum in core/config/index.ts — when adding a new
 * backend; every per-repository driver factory switches on this same type,
 * so TypeScript will flag every factory that hasn't been updated yet.
 */
export type StorageDriverKind = 'postgres' | 'sqlite' | 'memory';

/**
 * Shared dependency bag passed to every repository's driver factory. Not
 * every backend needs every field (e.g. the in-memory driver needs none of
 * them) — factories destructure only what they need.
 */
export interface StorageDriverDeps {
  prisma?: unknown;
  sqlite?: unknown;
}

/**
 * Thrown by a driver factory when asked for a `StorageDriverKind` that has
 * no implementation for that particular repository yet. Distinct from a
 * generic error so callers/tests can assert on it specifically —
 * "the kind exists but this repository hasn't been migrated to support it"
 * is a different failure mode than "the kind doesn't exist at all", which
 * TypeScript already catches at compile time via the StorageDriverKind
 * union.
 */
export class UnsupportedStorageDriverError extends Error {
  constructor(repositoryName: string, kind: StorageDriverKind) {
    super(`${repositoryName} has no storage driver implementation for kind '${kind}'`);
    this.name = 'UnsupportedStorageDriverError';
  }
}
