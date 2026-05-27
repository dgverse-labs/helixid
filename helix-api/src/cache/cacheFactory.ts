// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { Config } from '@helix-id/core';
import type { ICache } from './ICache.js';
import { InProcessCache } from './InProcessCache.js';
import { NoopCache } from './NoopCache.js';
import { RedisCache, type RedisLike } from './RedisCache.js';
import { TwoLayerCache } from './TwoLayerCache.js';

interface CacheFactoryParams<T> {
  enabled: boolean;
  l2Enabled: boolean;
  redis: RedisLike | null;
  prefix: string;
  l1TtlSeconds: number;
  l2TtlSeconds: number;
}

export function createTwoLayerCache<T>(params: CacheFactoryParams<T>): ICache<T> {
  if (!params.enabled) return new NoopCache<T>();

  const l1 = new InProcessCache<T>();
  const l2 = params.l2Enabled && params.redis
    ? new RedisCache<T>(params.redis, params.prefix)
    : null;
  return new TwoLayerCache<T>(l1, l2, params.l1TtlSeconds, params.l2TtlSeconds);
}

export function createDidCache<T>(config: Config, redis: RedisLike | null): ICache<T> {
  return createTwoLayerCache<T>({
    enabled: config.CACHE_ENABLED,
    l2Enabled: config.CACHE_L2_ENABLED,
    redis,
    prefix: 'did:v1:',
    l1TtlSeconds: config.DID_CACHE_L1_TTL_SECONDS,
    l2TtlSeconds: config.DID_CACHE_L2_TTL_SECONDS,
  });
}

export function createStatusListCache<T>(config: Config, redis: RedisLike | null): ICache<T> {
  return createTwoLayerCache<T>({
    enabled: config.CACHE_ENABLED,
    l2Enabled: config.CACHE_L2_ENABLED,
    redis,
    prefix: 'sl:v1:',
    l1TtlSeconds: config.STATUS_LIST_CACHE_L1_TTL_SECONDS,
    l2TtlSeconds: config.STATUS_LIST_CACHE_L2_TTL_SECONDS,
  });
}
