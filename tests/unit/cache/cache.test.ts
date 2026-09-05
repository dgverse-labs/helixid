// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../../../src/core/index.js';
import { InProcessCache } from '../../../src/cache/InProcessCache.js';
import { NoopCache } from '../../../src/cache/NoopCache.js';
import { RedisCache, type RedisLike } from '../../../src/cache/RedisCache.js';
import { TwoLayerCache } from '../../../src/cache/TwoLayerCache.js';
import { createDidCache, createStatusListCache } from '../../../src/cache/cacheFactory.js';
import type { ICache } from '../../../src/cache/ICache.js';

class RecordingCache<T> implements ICache<T> {
  readonly get = vi.fn<(key: string) => Promise<T | null>>();
  readonly set = vi.fn<(key: string, value: T, ttlSeconds: number) => Promise<void>>();
  readonly delete = vi.fn<(key: string) => Promise<void>>();
}

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    CACHE_ENABLED: true,
    CACHE_L2_ENABLED: true,
    REDIS_URL: undefined,
    DID_CACHE_L1_TTL_SECONDS: 300,
    DID_CACHE_L2_TTL_SECONDS: 900,
    STATUS_LIST_CACHE_L1_TTL_SECONDS: 60,
    STATUS_LIST_CACHE_L2_TTL_SECONDS: 300,
    ...overrides,
  } as Config;
}

describe('cache primitives', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('InProcessCache handles miss, hit, expiry, delete, and key listing', async () => {
    const cache = new InProcessCache<string>();

    await expect(cache.get('k')).resolves.toBeNull();
    await cache.set('k', 'v', 10);
    await expect(cache.get('k')).resolves.toBe('v');
    expect(cache.keys()).toEqual(['k']);

    vi.advanceTimersByTime(10_001);
    await expect(cache.get('k')).resolves.toBeNull();

    await cache.set('k', 'v', 10);
    await cache.delete('k');
    await expect(cache.get('k')).resolves.toBeNull();

    await cache.set('zero', 'v', 0);
    await expect(cache.get('zero')).resolves.toBeNull();

    await cache.set('clear-me', 'v', 10);
    cache.clear();
    expect(cache.keys()).toEqual([]);
  });

  it('NoopCache never stores values', async () => {
    const cache = new NoopCache<string>();

    await cache.set('k', 'v', 10);
    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.delete('k')).resolves.toBeUndefined();
  });

  it('TwoLayerCache returns L1 hits without calling L2', async () => {
    const l1 = new RecordingCache<string>();
    const l2 = new RecordingCache<string>();
    l1.get.mockResolvedValue('from-l1');

    const cache = new TwoLayerCache(l1, l2, 5, 30);
    await expect(cache.get('k')).resolves.toBe('from-l1');

    expect(l2.get).not.toHaveBeenCalled();
  });

  it('TwoLayerCache repopulates L1 on L2 hit', async () => {
    const l1 = new RecordingCache<string>();
    const l2 = new RecordingCache<string>();
    l1.get.mockResolvedValue(null);
    l2.get.mockResolvedValue('from-l2');

    const cache = new TwoLayerCache(l1, l2, 5, 30);
    await expect(cache.get('k')).resolves.toBe('from-l2');

    expect(l1.set).toHaveBeenCalledWith('k', 'from-l2', 5);
  });

  it('TwoLayerCache handles misses, L1-only mode, TTL caps, and deletes', async () => {
    const l1 = new RecordingCache<string>();
    const l2 = new RecordingCache<string>();
    l1.get.mockResolvedValue(null);
    l2.get.mockResolvedValue(null);

    const cache = new TwoLayerCache(l1, l2, 5, 30);
    await expect(cache.get('k')).resolves.toBeNull();

    await cache.set('k', 'v', 3);
    expect(l1.set).toHaveBeenLastCalledWith('k', 'v', 3);
    expect(l2.set).toHaveBeenLastCalledWith('k', 'v', 3);

    await cache.set('k', 'v', 60);
    expect(l1.set).toHaveBeenLastCalledWith('k', 'v', 5);
    expect(l2.set).toHaveBeenLastCalledWith('k', 'v', 30);

    await cache.delete('k');
    expect(l1.delete).toHaveBeenCalledWith('k');
    expect(l2.delete).toHaveBeenCalledWith('k');

    const l1Only = new TwoLayerCache(l1, null, 5, 30);
    await l1Only.set('solo', 'v', 60);
    expect(l1.set).toHaveBeenLastCalledWith('solo', 'v', 5);
  });

  it('RedisCache delegates JSON operations with EX TTL', async () => {
    const redis: RedisLike = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };
    const cache = new RedisCache<{ ok: boolean }>(redis, 'p:');

    await expect(cache.get('k')).resolves.toEqual({ ok: true });
    await cache.set('k', { ok: true }, 10);
    await cache.delete('k');

    expect(redis.get).toHaveBeenCalledWith('p:k');
    expect(redis.set).toHaveBeenCalledWith('p:k', JSON.stringify({ ok: true }), 'EX', 10);
    expect(redis.del).toHaveBeenCalledWith('p:k');
  });

  it('RedisCache handles misses and non-positive TTL deletes', async () => {
    const redis: RedisLike = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };
    const cache = new RedisCache<string>(redis, 'p:');

    await expect(cache.get('missing')).resolves.toBeNull();
    await cache.set('expired', 'v', 0);

    expect(redis.get).toHaveBeenCalledWith('p:missing');
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('p:expired');
  });

  it('cache factory respects CACHE_ENABLED, CACHE_L2_ENABLED, and REDIS_URL state', async () => {
    const redis: RedisLike = {
      get: vi.fn().mockResolvedValue(JSON.stringify('from-l2')),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    const disabled = createDidCache<string>(testConfig({ CACHE_ENABLED: false, REDIS_URL: 'redis://localhost:6379' }), redis);
    await disabled.set('k', 'v', 10);
    await expect(disabled.get('k')).resolves.toBeNull();

    const l1OnlyByFlag = createDidCache<string>(testConfig({ CACHE_L2_ENABLED: false, REDIS_URL: 'redis://localhost:6379' }), redis);
    await l1OnlyByFlag.get('k');
    expect(redis.get).not.toHaveBeenCalled();

    const l1Config = testConfig();
    expect(l1Config.CACHE_ENABLED).toBe(true);
    const l1OnlyNoUrl = createDidCache<string>(l1Config, null);
    await l1OnlyNoUrl.set('k', 'v', 10);
    await expect(l1OnlyNoUrl.get('k')).resolves.toBe('v');

    const l2Enabled = createDidCache<string>(testConfig({ REDIS_URL: 'redis://localhost:6379' }), redis);
    await expect(l2Enabled.get('k')).resolves.toBe('from-l2');
    expect(redis.get).toHaveBeenCalledWith('did:v1:k');

    const statusListCache = createStatusListCache<string>(testConfig({ REDIS_URL: 'redis://localhost:6379' }), redis);
    await statusListCache.set('list-1', 'encoded', 10);
    expect(redis.set).toHaveBeenCalledWith('sl:v1:list-1', JSON.stringify('encoded'), 'EX', 10);
  });
});
