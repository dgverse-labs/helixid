// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { ICache } from './ICache.js';

export class NoopCache<T> implements ICache<T> {
  async get(_key: string): Promise<T | null> {
    return null;
  }

  async set(_key: string, _value: T, _ttlSeconds: number): Promise<void> {
    // Intentionally empty.
  }

  async delete(_key: string): Promise<void> {
    // Intentionally empty.
  }
}
