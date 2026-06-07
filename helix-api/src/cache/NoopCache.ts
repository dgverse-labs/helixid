// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { ICache } from './ICache.js';

export class NoopCache<T> implements ICache<T> {
  async get(): Promise<T | null> {
    return null;
  }

  async set(): Promise<void> {
    // Intentionally empty.
  }

  async delete(): Promise<void> {
    // Intentionally empty.
  }
}
