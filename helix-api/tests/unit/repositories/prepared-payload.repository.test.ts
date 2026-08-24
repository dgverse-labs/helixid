// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { PreparedPayloadRepository } from '../../../src/repositories/prepared-payload.repository.js';
import { SqliteStore } from '../../../src/storage/sqlite.js';

function baseInput() {
  return {
    purpose: 'delegation' as const,
    unsignedPayload: JSON.stringify({ hello: 'world' }),
    canonicalHash: 'deadbeef'.repeat(8),
    expectedSignerDid: 'did:key:z6MkSignerExample',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  };
}

describe('PreparedPayloadRepository (in-memory)', () => {
  it('creates a row with a generated token and null consumedAt', async () => {
    const repo = new PreparedPayloadRepository();
    const record = await repo.create(baseInput());
    expect(record.token).toMatch(/^ppt_/);
    expect(record.consumedAt).toBeNull();
    expect(record.purpose).toBe('delegation');
  });

  it('finds a row by token', async () => {
    const repo = new PreparedPayloadRepository();
    const created = await repo.create(baseInput());
    const found = await repo.findByToken(created.token);
    expect(found?.canonicalHash).toBe(created.canonicalHash);
  });

  it('returns null for an unknown token', async () => {
    const repo = new PreparedPayloadRepository();
    expect(await repo.findByToken('nope')).toBeNull();
  });

  it('marks a row consumed exactly once', async () => {
    const repo = new PreparedPayloadRepository();
    const created = await repo.create(baseInput());
    expect(await repo.markConsumedAtomically(created.token)).toBe(true);
    const found = await repo.findByToken(created.token);
    expect(found?.consumedAt).not.toBeNull();
  });

  it('rejects a second consume attempt on the same token', async () => {
    const repo = new PreparedPayloadRepository();
    const created = await repo.create(baseInput());
    expect(await repo.markConsumedAtomically(created.token)).toBe(true);
    expect(await repo.markConsumedAtomically(created.token)).toBe(false);
  });

  it('rejects consuming an unknown token', async () => {
    const repo = new PreparedPayloadRepository();
    expect(await repo.markConsumedAtomically('nope')).toBe(false);
  });
});

describe('PreparedPayloadRepository (sqlite)', () => {
  const dbPath = `/tmp/helix-test-prepared-payloads-${Math.random().toString(16).slice(2)}.sqlite`;

  afterEach(() => {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  });

  it('persists and retrieves a row across the sqlite backend', async () => {
    const sqlite = new SqliteStore(dbPath);
    const repo = new PreparedPayloadRepository(undefined, sqlite);
    const created = await repo.create(baseInput());
    const found = await repo.findByToken(created.token);
    expect(found?.token).toBe(created.token);
    expect(found?.expectedSignerDid).toBe('did:key:z6MkSignerExample');
    expect(found?.consumedAt).toBeNull();
  });

  it('atomically consumes exactly once against sqlite', async () => {
    const sqlite = new SqliteStore(dbPath);
    const repo = new PreparedPayloadRepository(undefined, sqlite);
    const created = await repo.create(baseInput());
    expect(await repo.markConsumedAtomically(created.token)).toBe(true);
    expect(await repo.markConsumedAtomically(created.token)).toBe(false);
  });
});
