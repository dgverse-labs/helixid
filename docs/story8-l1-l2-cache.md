# STORY 8 — L1/L2 Cache

## Overview

Add a two-layer read cache to selected DID resolution and status list fetch paths. L1 is an in-process Map with TTL — enabled by default. L2 is Redis — optional, shared across horizontal instances, and activated only when `CACHE_L2_ENABLED=true` and `REDIS_URL` is set. PostgreSQL remains Helix ID's durable API-side DID/VC state index, and Hedera remains the external DID anchoring/resolution source. This story adds cache layers in front of repeated read paths; it does not replace DB persistence or verification semantics.

No new API endpoints. No schema changes. This is a performance and reliability story that makes the delegation chain verify path (Story 6) cheaper at scale and reduces repeated PostgreSQL/Hedera read frequency in production.

Security rule: cache is never the authority for revocation or deactivation. Helix ID's own verification path must not accept a stale cached DID after deactivation or a stale cached status list after VC revocation.

---

## 8.1 — Environment Variables

Add to `.env.example` and config:

```
CACHE_ENABLED=true               # Optional. If false, all app cache reads/writes are bypassed
CACHE_L2_ENABLED=true            # Optional. If false, force L1-only even when REDIS_URL is set
REDIS_URL=                      # Optional. If absent, L2 cache is disabled — L1 only
DID_CACHE_L1_TTL_SECONDS=300    # In-process DID cache TTL — default 5 minutes
DID_CACHE_L2_TTL_SECONDS=900    # Redis DID cache TTL — default 15 minutes
STATUS_LIST_CACHE_L1_TTL_SECONDS=60   # Status lists change on revocation — shorter TTL
STATUS_LIST_CACHE_L2_TTL_SECONDS=300
```

Config module additions:
- `CACHE_ENABLED: boolean` — default true
- `CACHE_L2_ENABLED: boolean` — default true
- `REDIS_URL: string | undefined`
- `DID_CACHE_L1_TTL_SECONDS: number` — default 300
- `DID_CACHE_L2_TTL_SECONDS: number` — default 900
- `STATUS_LIST_CACHE_L1_TTL_SECONDS: number` — default 60
- `STATUS_LIST_CACHE_L2_TTL_SECONDS: number` — default 300

L2 TTLs are intentionally higher than L1 TTLs. L1 is per-process and can become stale across instances, so it stays short. L2 is shared and can be invalidated centrally, so it can safely be longer while still staying below the caller's maximum freshness budget.

---

## 8.2 — Dependencies

In `helix-api`:

```bash
pnpm install ioredis
```

Add `ioredis` to `decisions.md`. Alternative considered: `redis` (official client) — `ioredis` chosen for better TypeScript support and cluster-ready interface.

No new helix-core dependencies.

---

## 8.3 — Cache Interface — `helix-api/src/cache/ICache.ts`

```typescript
interface ICache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Two implementations:

### `helix-api/src/cache/InProcessCache.ts`

```typescript
class InProcessCache<T> implements ICache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

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
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
```

### `helix-api/src/cache/RedisCache.ts`

```typescript
class RedisCache<T> implements ICache<T> {
  constructor(private redis: Redis, private prefix: string) {}

  async get(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.prefix + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}
```

### `helix-api/src/cache/TwoLayerCache.ts`

```typescript
class TwoLayerCache<T> implements ICache<T> {
  constructor(
    private l1: ICache<T>,
    private l2: ICache<T> | null,     // null when Redis not configured
    private l1TtlSeconds: number,
    private l2TtlSeconds: number,
  ) {}

  async get(key: string): Promise<T | null> {
    // L1 hit
    const l1Result = await this.l1.get(key);
    if (l1Result !== null) return l1Result;

    // L2 hit — populate L1
    if (this.l2) {
      const l2Result = await this.l2.get(key);
      if (l2Result !== null) {
        await this.l1.set(key, l2Result, this.l1TtlSeconds);
        return l2Result;
      }
    }

    return null;  // caller falls through to Hedera
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
    const l1Ttl = Math.min(ttlSeconds, this.l1TtlSeconds);
    const l2Ttl = Math.min(ttlSeconds, this.l2TtlSeconds);
    await this.l1.set(key, value, l1Ttl);
    if (this.l2) await this.l2.set(key, value, l2Ttl);
  }

  async delete(key: string): Promise<void> {
    await this.l1.delete(key);
    if (this.l2) await this.l2.delete(key);
  }
}
```

`ttlSeconds` is the caller's maximum freshness budget. `TwoLayerCache` respects it and caps each layer by that layer's configured maximum TTL. If `CACHE_ENABLED=false`, the server should inject a `NoopCache` implementation whose `get` always returns null and whose `set/delete` are no-ops.

Cache key conventions:
- DID documents: `did:v1:<did>` e.g. `did:v1:did:hedera:testnet:z6Mk...`
- Status lists: `sl:v1:<listId>` e.g. `sl:v1:helix-status-list-1`

The `v1:` version prefix allows cache invalidation of all entries if the schema changes — bump to `v2:` in the key prefix.

---

## 8.4 — DID Service Changes

### `helix-api/src/services/did/did.service.ts`

Add constructor parameter: `cache: TwoLayerCache<DIDDocument>`

**`resolveDID(did, options)` — add cache read/write:**

```
1. If `options.live !== true`:
   a. Check cache: `const cached = await cache.get(did)`
   b. If cached, check durable DB deactivation state before returning it. If DB says deactivated, delete cache entry and throw `DID_DEACTIVATED`.
   c. If still active, return cached document with `source: 'cache'`.
2. Existing path: DB lookup → if found and not deactivated, cache it and return with `source: 'db'`.
3. If `live=true` or not in DB: Hedera mirror node fetch.
4. After successful Hedera fetch/DB hit: `await cache.set(did, didDocument, config.DID_CACHE_L1_TTL_SECONDS)`.
5. Return result.

Rationale: DID documents are already stored in PostgreSQL. L1/L2 cache reduces repeated DB reads, especially in VP/delegation verification, but DB remains the immediate authority for deactivation state.
```

**`deactivateDID(did, reason, requestId)` — add cache invalidation:**

After DB update, call `cache.delete(did)`. The resolve path also checks DB deactivation state before returning cached documents, so a stale L1 entry cannot validate a deactivated DID even in multi-instance deployments.

**`addServiceEndpoint` and `removeServiceEndpoint` — add cache invalidation:**

After DB update and Hedera anchoring, call `cache.delete(did)` so subsequent resolves fetch the updated document. Multi-instance deployments may still hold stale L1 documents until TTL, so use conservative DID L1 TTL unless Redis pub/sub invalidation is added in a later story.

### `helix-api/src/server.ts` — wire cache

```typescript
const redis = config.CACHE_L2_ENABLED && config.REDIS_URL ? new Redis(config.REDIS_URL) : null;

const didCache = config.CACHE_ENABLED
  ? new TwoLayerCache(
      new InProcessCache<DIDDocument>(),
      redis ? new RedisCache<DIDDocument>(redis, 'did:v1:') : null,
      config.DID_CACHE_L1_TTL_SECONDS,
      config.DID_CACHE_L2_TTL_SECONDS,
    )
  : new NoopCache<DIDDocument>();

const statusListCache = config.CACHE_ENABLED
  ? new TwoLayerCache(
      new InProcessCache<string>(),
      redis ? new RedisCache<string>(redis, 'sl:v1:') : null,
      config.STATUS_LIST_CACHE_L1_TTL_SECONDS,
      config.STATUS_LIST_CACHE_L2_TTL_SECONDS,
    )
  : new NoopCache<string>();

// Inject caches into services
const didService = new DIDService(didRepository, hederaClient, auditLogger, didCache);
const vcService = new VCService(vcRepository, didService, auditLogger, statusListCache);
```

---

## 8.5 — Status List Service Changes

### `helix-api/src/services/vc/vc.service.ts`

Add constructor parameter: `statusListCache: TwoLayerCache<string>`

**`getStatusListCredential(listId)` — add cache for the public status-list endpoint:**

```
1. Check cache: const cached = await statusListCache.get(listId)
2. If cached: return buildStatusListCredential(listId, cached, ...)
3. Fetch from DB via vcRepository.getStatusListEntry(listId)
4. If found: `await statusListCache.set(listId, entry.encodedList, config.STATUS_LIST_CACHE_L1_TTL_SECONDS)`
5. Return credential
```

**`revokeVC(vcId, requestId)` — add cache invalidation:**

After the atomic Prisma transaction (DB revocation + status list update), call `statusListCache.delete('helix-status-list-1')`. This forces the next local read to fetch the updated bitstring from DB.

**Why short TTL for status lists (60s L1, 300s L2):** A revocation must be detectable by verifiers within a reasonable window. The existing self-verification documentation already states verifiers may cache the status list — a 5-minute maximum staleness window is consistent with that. For Helix ID's own `verifyVP` path, revocation must still be checked against durable VC status, not accepted from a stale cached status list.

---

## 8.6 — VP Verify Path Cache Benefit

The delegation chain verify path (Story 6, step 9e) calls `didService.resolveDID` once per chain link. With L1 cache active, repeated DID lookups become in-process Map lookups after the first DB/Hedera read. For a 3-deep chain, warm state should usually be cache hits plus durable deactivation checks. This makes chain verification latency acceptable without requiring L2 Redis.

No code changes should be needed in Story 6's verify path beyond using the existing `IDIDService` interface. The service must preserve the rule that cached DID documents cannot bypass deactivation.

---

## 8.7 — Docker Compose Changes

No Redis container is required for the default Story 8 implementation or default test suite.

Keep `docker-compose.yml` and `docker-compose.test.yml` unchanged in this pass unless local development explicitly needs Redis. Real Redis infrastructure coverage is deferred to a later opt-in test command. When that follow-up is added, it should add a Redis service and set `REDIS_URL=redis://redis:6379` only for the API container in that Redis-enabled compose profile.

Story 8 tests should prove L2 behavior with an in-memory/fake L2 cache and mocked Redis client calls. A real Redis-backed integration test can be added later under a separate opt-in command when we want infrastructure coverage.

### `.env.example` — update comment

Add note: "`CACHE_ENABLED` defaults to true. `REDIS_URL` is optional. If `REDIS_URL` is not set, or `CACHE_L2_ENABLED=false`, only in-process L1 cache is used. Redis is recommended for multi-instance deployments."

---

## 8.8 — Tests

### Unit Tests — `helix-api/tests/unit/cache/`

- `InProcessCache.get` returns null for missing key
- `InProcessCache.get` returns null for expired key
- `InProcessCache.set` then `get` within TTL returns value
- `InProcessCache.delete` removes key
- `TwoLayerCache.get` — L1 hit: L2 never called
- `TwoLayerCache.get` — L1 miss, L2 hit: value returned and L1 populated
- `TwoLayerCache.get` — both miss: null returned
- `TwoLayerCache.set` — sets in both L1 and L2
- `TwoLayerCache.set` — when L2 is null (no Redis): only L1 set, no error
- `TwoLayerCache.set` — caller TTL lower than layer TTL: lower caller TTL is used
- `TwoLayerCache.set` — layer TTL lower than caller TTL: layer TTL cap is used
- `TwoLayerCache.delete` — deletes from both layers
- `NoopCache.get` always returns null
- `NoopCache.set/delete` do nothing and do not throw
- `RedisCache.get` returns null for missing key
- `RedisCache.set` with TTL → raw Redis call uses `EX` parameter
- cache factory with `CACHE_ENABLED=false` returns `NoopCache`
- cache factory with `CACHE_L2_ENABLED=false` and `REDIS_URL` set returns L1-only cache
- cache factory with `CACHE_L2_ENABLED=true` and no `REDIS_URL` returns L1-only cache
- cache factory with `CACHE_L2_ENABLED=true` and `REDIS_URL` set wires Redis-backed L2

All unit tests use in-memory mocks for Redis — no real Redis connection.

### Integration Tests — `helix-api/tests/integration/cache.integration.test.ts`

Setup: real PostgreSQL + app-level cache. Do not require real Redis in this story pass. For L2 behavior, inject a fake/shared in-memory L2 cache through the cache factory or service test harness. `afterEach` clears DB tables and in-memory cache instances.

Tests:

- `GET /v1/dids/:did` first call → DB/Hedera path, response `source: 'db'`. Second call → L1 cache hit (no DB call — verify via mock on repository layer).
- L2 behavior without real Redis: populate fake L2, clear L1, resolve DID → L2 hit repopulates L1.
- `CACHE_ENABLED=false`: repeated DID resolve does not return `source: 'cache'` and continues through normal DB/Hedera path.
- `CACHE_L2_ENABLED=false` with `REDIS_URL` set: cache factory does not create Redis L2 and L1-only mode works.
- `CACHE_L2_ENABLED=true` with `REDIS_URL` unset: L1-only mode works without connection attempts.
- DID deactivation invalidates cache and DB active-state check wins: resolve DID (populate cache), deactivate, resolve again → 410 `DID_DEACTIVATED` (not served from cache)
- Status list `GET /v1/status-list/:listId` first call → DB. Second call within TTL → L1 cache.
- Revoke VC → status list cache invalidated → next `GET /v1/status-list/:listId` returns updated bitstring with revoked bit set
- VP verification after revocation rejects using durable VC status, even if status-list cache was warm before revocation
- No Redis configured (`REDIS_URL` unset): L1-only mode works correctly end to end
- L2 TTL higher than L1: fake L2 retains value after L1 expiry and repopulates L1; caller TTL cap is still respected

### Security Tests — `helix-api/tests/security/cache.security.test.ts`

- **Deactivated DID not accepted from cache:** Deactivate DID while it is in L1 cache. Immediately call `resolveDID` → must return `DID_DEACTIVATED`, not the cached document. This confirms DB active-state check/invalidation wins over TTL.
- **Revoked VC not accepted from stale cache:** Revoke VC. Call `POST /v1/vp/verify` with a VP built from that VC → must reject. This confirms Helix ID's own verify path does not trust stale status-list cache.
- **Public status list invalidated on revoke:** Revoke VC. Call `GET /v1/status-list/:listId` → bit at revoked index must be 1. Confirms public status-list cache invalidation works before TTL expiry.
- **Cache keys do not leak private data:** Assert no key in the in-memory/fake L2 cache contains `privateKey`, `encryptedPrivateKey`, or any 64-char hex string matching a known private key from test fixtures. When real Redis tests are added later, apply the same assertion to Redis keys.

---

## Story 8 Acceptance Criteria

- [ ] L1 in-process cache active by default — zero configuration required
- [ ] `CACHE_ENABLED=false` cleanly bypasses cache without changing API behavior
- [ ] L2 Redis cache activates only when `CACHE_L2_ENABLED=true` and `REDIS_URL` is set — gracefully absent when not
- [ ] Real Redis is not required by the default test suite; L2 behavior is covered with fake L2/mocked Redis client tests
- [ ] DID resolution cache hit skips DB and Hedera calls — verified by integration test via repository mock
- [ ] Status list cache hit skips DB call — verified by integration test
- [ ] L2 TTLs are higher than L1 TTLs and `TwoLayerCache` respects caller TTL caps
- [ ] Cached DID documents cannot bypass deactivation — security test confirms DB state/invalidation wins over TTL
- [ ] VC revocation cannot be bypassed by stale status-list cache in `verifyVP`
- [ ] Public status-list cache invalidated immediately on VC revocation — security test confirms updated bit served within same request cycle
- [ ] `docker-compose.yml` and `docker-compose.test.yml` do not require Redis for the default suite
- [ ] `TwoLayerCache` is independently unit tested — all cache path combinations covered
- [ ] `ioredis` added to `decisions.md`
- [ ] No private keys or VC payloads stored in cache — verified by security test
- [ ] Cache config via env vars with documented defaults in `.env.example`
