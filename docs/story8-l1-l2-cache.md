# STORY 8 — L1/L2 Cache

## Overview

Security rule: cache is never the authority for deactivation, and revocation cache entries must be invalidated on writes. Helix ID's own verification path must not accept a stale cached DID after deactivation or a stale public status-list value after VC revocation.

---

## 8.1 — Environment Variables

Add to `.env.example` and config:

```
CACHE_ENABLED=true               # Optional. If false, all app cache reads/writes are bypassed
DID_CACHE_L1_TTL_SECONDS=300    # In-process DID cache TTL — default 5 minutes
STATUS_LIST_CACHE_L1_TTL_SECONDS=60   # Status lists change on revocation — shorter TTL
STATUS_LIST_CACHE_L2_TTL_SECONDS=300
```

Config module additions:
- `CACHE_ENABLED: boolean` — default true
- `CACHE_L2_ENABLED: boolean` — default true
- `DID_CACHE_L1_TTL_SECONDS: number` — default 300
- `DID_CACHE_L2_TTL_SECONDS: number` — default 900
- `STATUS_LIST_CACHE_L1_TTL_SECONDS: number` — default 60
- `STATUS_LIST_CACHE_L2_TTL_SECONDS: number` — default 300

L2 TTLs are intentionally higher than L1 TTLs. L1 is per-process and can become stale across instances, so it stays short. L2 is shared and can be invalidated centrally, so it can safely be longer while still staying below the caller's maximum freshness budget.

---

## 8.2 — Dependencies

In `helix-api`:

```bash
```

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

```typescript

  async get(key: string): Promise<T | null> {
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async set(key: string, value: T, ttlSeconds: number): Promise<void> {
  }

  async delete(key: string): Promise<void> {
  }
}
```

### `helix-api/src/cache/TwoLayerCache.ts`

```typescript
class TwoLayerCache<T> implements ICache<T> {
  constructor(
    private l1: ICache<T>,
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
- Status lists: `sl:v1:<listId>` e.g. `sl:v1:helix-status-list-1`

The `v1:` version prefix allows cache invalidation of all entries if the schema changes — bump to `v2:` in the key prefix.

---

## 8.4 — DID Service Changes

### `helix-api/src/services/did/did.service.ts`

Add constructor parameter: `cache: ICache<DIDDocument>`. Runtime wiring should pass a `TwoLayerCache` when caching is enabled and `NoopCache` when disabled.

**`resolveDID(did, options)` — add cache read/write:**

```
1. If `options.live !== true`:
   a. Check cache: `const cached = await cache.get(did)`
   b. If cached, check durable DB deactivation state before returning it. If DB says deactivated, delete cache entry and throw `DID_DEACTIVATED`.
   c. If still active, return cached document with `source: 'cache'`.
2. Existing path: DB lookup → if found and not deactivated, cache it and return with `source: 'db'`.
5. Return result.

```

**`deactivateDID(did, reason, requestId)` — add cache invalidation:**

After DB update, call `cache.delete(did)`. The resolve path also checks DB deactivation state before returning cached documents, so a stale L1 entry cannot validate a deactivated DID even in multi-instance deployments.

**`addServiceEndpoint` and `removeServiceEndpoint` — add cache invalidation:**

### `helix-api/src/server.ts` — wire cache

```typescript

const didCache = config.CACHE_ENABLED
  ? new TwoLayerCache(
      new InProcessCache<DIDDocument>(),
      config.DID_CACHE_L1_TTL_SECONDS,
      config.DID_CACHE_L2_TTL_SECONDS,
    )
  : new NoopCache<DIDDocument>();

const statusListCache = config.CACHE_ENABLED
  ? new TwoLayerCache(
      new InProcessCache<string>(),
      config.STATUS_LIST_CACHE_L1_TTL_SECONDS,
      config.STATUS_LIST_CACHE_L2_TTL_SECONDS,
    )
  : new NoopCache<string>();

// Inject caches into services
const vcService = new VCService(vcRepository, didService, auditLogger, statusListCache);
```

---

## 8.5 — Status List Service Changes

### `helix-api/src/services/vc/vc.service.ts`

Add constructor parameter: `statusListCache: ICache<string>`. Runtime wiring should pass a `TwoLayerCache` when caching is enabled and `NoopCache` when disabled.

**`getStatusList(listId)` — add cache for the public status-list endpoint:**

```
1. Check cache: const cached = await statusListCache.get(listId)
2. If cached: return buildStatusListCredential(listId, cached, ...)
3. Fetch from DB via vcRepository.getStatusListEntry(listId)
4. If found: `await statusListCache.set(listId, entry.encodedList, config.STATUS_LIST_CACHE_L1_TTL_SECONDS)`
5. Return credential
```

**`revokeVC(vcId, requestId)` — add cache invalidation:**

After the atomic Prisma transaction (DB revocation + status list update), call `statusListCache.delete('helix-status-list-1')`. This forces the next local read to fetch the updated bitstring from DB.

**Why short TTL for status lists (60s L1, 300s L2):** A revocation must be detectable by verifiers within a reasonable window. The existing self-verification documentation already states verifiers may cache the status list — a 5-minute maximum staleness window is consistent with that. For Helix ID's own `verifyVP` path, revocation is read from the embedded VC 2.0 `BitstringStatusListEntry` and the corresponding status-list credential. Revocation writes must delete the status-list cache entry before returning.

---

## 8.6 — VP Verify Path Cache Benefit

No code changes should be needed in Story 6's verify path beyond using the existing `IDIDService` interface. The service must preserve the rule that cached DID documents cannot bypass deactivation.

---

## 8.7 — Docker Compose Changes

### `.env.example` — update comment

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
- `TwoLayerCache.set` — caller TTL lower than layer TTL: lower caller TTL is used
- `TwoLayerCache.set` — layer TTL lower than caller TTL: layer TTL cap is used
- `TwoLayerCache.delete` — deletes from both layers
- `NoopCache.get` always returns null
- `NoopCache.set/delete` do nothing and do not throw
- cache factory with `CACHE_ENABLED=false` returns `NoopCache`

### Integration Tests — `helix-api/tests/integration/cache.integration.test.ts`

Tests:

- DID deactivation invalidates cache and DB active-state check wins: resolve DID (populate cache), deactivate, resolve again → 410 `DID_DEACTIVATED` (not served from cache)
- Status list `GET /v1/status-list/:listId` first call → DB. Second call within TTL → L1 cache.
- Revoke VC → status list cache invalidated → next `GET /v1/status-list/:listId` returns updated bitstring with revoked bit set
- VP verification after revocation rejects using the VC's embedded `BitstringStatusListEntry`; status-list cache invalidation ensures the updated bitstring is used after revocation
- L2 TTL higher than L1: fake L2 retains value after L1 expiry and repopulates L1; caller TTL cap is still respected

### Security Tests — `helix-api/tests/security/cache.security.test.ts`

- **Deactivated DID not accepted from cache:** Deactivate DID while it is in L1 cache. Immediately call `resolveDID` → must return `DID_DEACTIVATED`, not the cached document. This confirms DB active-state check/invalidation wins over TTL.
- **Revoked VC not accepted from stale cache:** Revoke VC. Call `POST /v1/vp/verify` with a VP built from that VC → must reject. This confirms Helix ID's own verify path uses the updated Bitstring Status List state after cache invalidation.
- **Public status list invalidated on revoke:** Revoke VC. Call `GET /v1/status-list/:listId` → bit at revoked index must be 1. Confirms public status-list cache invalidation works before TTL expiry.

---

## Story 8 Acceptance Criteria

- [ ] L1 in-process cache active by default — zero configuration required
- [ ] `CACHE_ENABLED=false` cleanly bypasses cache without changing API behavior
- [ ] Status list cache hit skips DB call — verified by integration test
- [ ] L2 TTLs are higher than L1 TTLs and `TwoLayerCache` respects caller TTL caps
- [ ] Cached DID documents cannot bypass deactivation — security test confirms DB state/invalidation wins over TTL
- [ ] VC revocation cannot be bypassed by stale status-list cache in `verifyVP`
- [ ] Public status-list cache invalidated immediately on VC revocation — security test confirms updated bit served within same request cycle
- [ ] `TwoLayerCache` is independently unit tested — all cache path combinations covered
- [ ] No private keys or VC payloads stored in cache — verified by security test
- [ ] Cache config via env vars with documented defaults in `.env.example`
