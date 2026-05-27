// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { ICache } from './ICache.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class InProcessCache<T> implements ICache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  async get(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      this.store.delete(key);
      return;
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}
