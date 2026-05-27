// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { ICache } from './ICache.js';

export class TwoLayerCache<T> implements ICache<T> {
  constructor(
    private readonly l1: ICache<T>,
    private readonly l2: ICache<T> | null,
    private readonly l1TtlSeconds: number,
    private readonly l2TtlSeconds: number,
  ) {}

  async get(key: string): Promise<T | null> {
    const l1Result = await this.l1.get(key);
    if (l1Result !== null) return l1Result;

    if (!this.l2) return null;
    const l2Result = await this.l2.get(key);
    if (l2Result === null) return null;

    await this.l1.set(key, l2Result, this.l1TtlSeconds);
    return l2Result;
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    const l1Ttl = Math.min(ttlSeconds, this.l1TtlSeconds);
    await this.l1.set(key, value, l1Ttl);

    if (!this.l2) return;
    const l2Ttl = Math.min(ttlSeconds, this.l2TtlSeconds);
    await this.l2.set(key, value, l2Ttl);
  }

  async delete(key: string): Promise<void> {
    await this.l1.delete(key);
    if (this.l2) await this.l2.delete(key);
  }
}
