// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { ICache } from './ICache.js';

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisCache<T> implements ICache<T> {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix: string,
  ) {}

  async get(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.prefix + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      await this.delete(key);
      return;
    }
    await this.redis.set(this.prefix + key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}
