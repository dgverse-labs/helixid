// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { ICache } from './ICache.js';

export class NoopCache<T> implements ICache<T> {
  async get(key: string): Promise<T | null> {
    void key;
    return null;
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    void key;
    void value;
    void ttlSeconds;
  }

  async delete(key: string): Promise<void> {
    void key;
  }
}
