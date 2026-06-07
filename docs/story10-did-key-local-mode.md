# STORY 10 — `did:key` Local Mode

## Overview

Add a zero-infrastructure DID mode for local development and testing. A `did:key` DID is derived entirely from the public key — no Hedera account, no HCS topic, no Redis, no network calls. Developers clone the repo, set `DID_METHOD=key`, and have a working full Helix ID flow in under a minute.

`did:key` is strictly a development-only mode. It does not support DID updates, service endpoint changes, or HCS-backed revocation. It does not belong in production cross-org trust scenarios. The SDK and API enforce this separation clearly.

This story introduces a resolver dispatch layer in `IDIDService` and `HelixClient` that routes based on DID prefix — `did:key:` vs `did:hedera:` — so the rest of the system never needs to care which mode is active.

---

## 10.1 — Environment Variables

Add to `.env.example` and config:

```
DID_METHOD=hedera     # "hedera" (default, production) or "key" (local dev only)
```

Config addition:
- `didMethod: 'hedera' | 'key'` — default `'hedera'`

When `DID_METHOD=key`: Hedera env vars (`HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_TOPIC_ID`) are not required. Server startup skips Hedera client initialisation. A warning is logged: `"DID_METHOD=key: running in local development mode. Not suitable for production."`

---

## 10.2 — helix-core: `did:key` Primitives

### `helix-core/src/crypto/did-key.ts`

Implements the `did:key` method spec (https://w3c-ccg.github.io/did-method-key/).

```typescript
function generateDidKey(publicKeyHex: string): string
```

Steps:
1. Convert public key hex to bytes
2. Prepend Ed25519 multicodec prefix: `[0xed, 0x01]`
3. Base58btc-encode the prefixed bytes using existing `publicKeyToMultibase` logic
4. Strip the `z` multibase prefix — the base58btc string becomes the method-specific identifier
5. Return `did:key:z` + base58btcString

```typescript
function resolveDidKey(did: string): DIDDocument
```

Steps:
1. Validate `did` starts with `did:key:z` — throw `InvalidDIDFormatError` if not
2. Strip `did:key:` prefix, base58btc-decode (strip `z` multibase prefix first)
3. Validate first two bytes are `[0xed, 0x01]` — throw `InvalidDIDFormatError` if not (wrong key type)
4. Strip multicodec prefix — remaining bytes are the 32-byte Ed25519 public key
5. Hex-encode to `publicKeyHex`
6. Call `buildDIDDocument(did, publicKeyHex, [])` from existing `helix-core/src/crypto/did.ts`
7. Return `DIDDocument`

Note: `resolveDidKey` is a pure local function — no network, no DB. The DID document is deterministically derived from the DID string itself. This is by design in the `did:key` spec.

```typescript
function isDidKey(did: string): boolean
```
Returns `true` if `did` starts with `did:key:`. Used by the dispatcher.

```typescript
function isDidHedera(did: string): boolean
```
Returns `true` if `did` starts with `did:hedera:`. Used by the dispatcher.

---

## 10.3 — API: Resolver Dispatch

### `helix-api/src/services/did/did.service.ts` — add dispatcher

The existing `DIDService` handles `did:hedera:` only. Add a dispatcher that sits in front of it.

### `helix-api/src/services/did/DidResolver.ts`

```typescript
interface IDidResolver {
  resolve(did: string): Promise<DIDDocument>;
}

class HederaDidResolver implements IDidResolver {
  constructor(private didService: DIDService) {}

  async resolve(did: string): Promise<DIDDocument> {
    const result = await this.didService.resolveDID(did);
    return result.document;
  }
}

class LocalDidKeyResolver implements IDidResolver {
  async resolve(did: string): Promise<DIDDocument> {
    return resolveDidKey(did);   // pure local — helix-core function
  }
}

class DispatchingDidResolver implements IDidResolver {
  constructor(
    private hederaResolver: IDidResolver,
    private keyResolver: IDidResolver,
  ) {}

  async resolve(did: string): Promise<DIDDocument> {
    if (isDidKey(did)) return this.keyResolver.resolve(did);
    if (isDidHedera(did)) return this.hederaResolver.resolve(did);
    throw new InvalidDIDFormatError(did);
  }
}
```

**Wire in `server.ts`:**

```typescript
const hederaResolver = new HederaDidResolver(didService);
const keyResolver = new LocalDidKeyResolver();
const resolver = new DispatchingDidResolver(hederaResolver, keyResolver);

// vpService and vcService receive resolver instead of didService
// for DID resolution calls — they still call didService for other operations
```

All places in `vp.service.ts` and `vc.service.ts` that call `didService.resolveDID` switch to call `resolver.resolve(did)` instead. The `didService` itself is still injected for non-resolution operations (createDID, deactivateDID, etc.) — those are `did:hedera:`-only operations and do not need dispatch.

---

## 10.4 — API: `did:key` Create and Onboarding

### `helix-api/src/services/did/did.service.ts` — `createDID` with `did:key` mode

When `config.didMethod === 'key'`, `createDID` does not call Hedera. Instead:

1. Accept `publicKeyHex` as normal
2. Call `generateDidKey(publicKeyHex)` from helix-core — produces `did:key:z...`
3. Build DID document via `buildDIDDocument`
4. Persist to `dids` table with `hederaTopicId: 'local'`, `hederaSequenceNumber: 0`, `hederaTransactionId: 'local-' + cuid()`
5. Return `{ did, didDocument, hederaTransactionId: result.hederaTransactionId }`

The DB schema does not change — `hederaTopicId` and `hederaTransactionId` store sentinel values for local mode. This avoids nullable columns and keeps the repository layer unchanged.

**`deactivateDID`, `addServiceEndpoint`, `removeServiceEndpoint`:** These operations are blocked in `did:key` mode. They throw `DIDOperationNotSupportedError` with message: `"DID updates are not supported in did:key mode. Switch to DID_METHOD=hedera for production use."`.

Add error code:

```typescript
DID_OPERATION_NOT_SUPPORTED: 'DID_OPERATION_NOT_SUPPORTED',
```

| Class | Code | HTTP |
|---|---|---|
| `DIDOperationNotSupportedError(operation)` | `DID_OPERATION_NOT_SUPPORTED` | 400 |

---

## 10.5 — SDK Changes

### `helix-sdk-js/src/client/HelixClient.ts`

**`createDID` — no changes needed.** The SDK generates the keypair locally and posts the public key to the API. The API handles whether that becomes a `did:hedera:` or `did:key:` based on `DID_METHOD`. The SDK receives the resulting DID string — it stores whatever DID the API returns in the wallet.

**`resolveDID` — add local resolution:**

```typescript
async resolveDID(did: string, options?: { live?: boolean }): Promise<ResolveDIDResult>
```

If `did` starts with `did:key:` AND `options.live !== true`:
- Call `resolveDidKey(did)` from helix-core — pure local, no network
- Return `{ did, document, source: 'local' }`

Otherwise call the API as before.

This means SDK consumers can resolve `did:key:` DIDs without a running API — useful for local testing and SDK-only usage.

**Add to `HelixClient` factory or constructor:**

```typescript
interface HelixClientOptions {
  baseUrl: string;
  mode?: 'local' | 'anchored';   // 'local' = prefer local resolution where possible
}
```

When `mode: 'local'`, `resolveDID` tries local resolution first for `did:key:` DIDs before calling the API. When `mode: 'anchored'`, always call the API.

---

## 10.6 — `scripts/setup.ts` Changes

Add mode detection to the setup script:

```
? Which DID method? (hedera / key)

If "key":
  - Skip Hedera credential prompts
  - Write DID_METHOD=key to .env
  - Print warning: "did:key mode is for local development only. Not suitable for production."
  - Generate HELIX_SIGNING_KEY as normal; JWT session signing keys are generated ephemerally at API startup
  - Done — no Hedera account needed

If "hedera":
  - Existing flow unchanged
```

---

## 10.7 — Tests

### Unit Tests — `helix-core/tests/unit/crypto/did-key.test.ts`

- `generateDidKey` produces string starting with `did:key:z`
- `generateDidKey` roundtrip: generate DID from known public key → `resolveDidKey` returns DID document with same public key
- `generateDidKey` with two different public keys produces two different DIDs
- `resolveDidKey` with valid `did:key:z...` returns DIDDocument with correct `id`
- `resolveDidKey` with `did:hedera:` prefix throws `InvalidDIDFormatError`
- `resolveDidKey` with truncated key bytes throws `InvalidDIDFormatError`
- `resolveDidKey` with wrong multicodec prefix (not `[0xed, 0x01]`) throws `InvalidDIDFormatError`
- `isDidKey` returns true for `did:key:z...`, false for `did:hedera:...`
- `isDidHedera` returns true for `did:hedera:testnet:...`, false for `did:key:...`
- `resolveDidKey` is deterministic — same input always produces identical DIDDocument
- `resolveDidKey` produces no network calls (no mocks needed — confirmed by no I/O in implementation)

### Unit Tests — `helix-api/tests/unit/services/did-resolver.test.ts`

- `DispatchingDidResolver` routes `did:key:` to `LocalDidKeyResolver`
- `DispatchingDidResolver` routes `did:hedera:` to `HederaDidResolver`
- `DispatchingDidResolver` throws `InvalidDIDFormatError` for unknown DID prefix
- `LocalDidKeyResolver.resolve` calls `resolveDidKey` — returns document, no DB call
- `HederaDidResolver.resolve` calls `didService.resolveDID`

### Integration Tests — `helix-api/tests/integration/did-key.integration.test.ts`

Setup: real PostgreSQL, `DID_METHOD=key` config. No Hedera mock needed. `afterEach` truncates tables.

Tests:

- `POST /v1/dids` with `DID_METHOD=key` → 201, returned DID starts with `did:key:z`
- `GET /v1/dids/:did` resolves `did:key:` DID → 200, document returned
- `POST /v1/dids/:did/services` with `did:key:` DID → 400 `DID_OPERATION_NOT_SUPPORTED`
- `POST /v1/dids/:did/deactivate` with `did:key:` DID → 400 `DID_OPERATION_NOT_SUPPORTED`
- Full onboarding flow with `DID_METHOD=key`: enrollment token → onboard → verify challenge → agent DID is `did:key:z...`, VC issued correctly
- `POST /v1/vp/template` with `did:key:` agent DID → 201, unsigned VP returned
- `POST /v1/vp/verify` with VP signed by `did:key:` agent → 200 `valid: true` (resolver dispatches to local resolution for DID document)

### SDK Unit Tests — `helix-sdk-js/tests/unit/client/did-key.test.ts`

- `resolveDID` with `did:key:` and `mode: 'local'` returns document without calling HTTP adapter
- `resolveDID` with `did:key:` and `mode: 'anchored'` calls HTTP adapter
- `resolveDID` with `did:hedera:` always calls HTTP adapter regardless of mode

### Security Tests — `helix-api/tests/security/did-key.security.test.ts`

- **No Hedera calls in `did:key` mode:** Confirm `MockHederaClient` (or spy) is never called when `DID_METHOD=key`. DID creation, resolution, and VP verification complete without any Hedera interaction.
- **`did:key` DID cannot be updated:** Attempt `addServiceEndpoint` → 400. Confirm no DB write occurred.
- **`did:key` DID resolution is deterministic:** Generate same public key twice → same DID document both times. A replay attacker cannot produce a different document for the same `did:key:` DID.
- **VP verify with `did:key:` agent uses local resolution — no network:** Instrument `DispatchingDidResolver` to confirm `LocalDidKeyResolver` is called (not `HederaDidResolver`) when agent DID is `did:key:`. Confirm no outbound HTTP to Hedera mirror node.

---

## Story 10 Acceptance Criteria

- [ ] `DID_METHOD=key` in `.env` enables local mode — Hedera env vars not required
- [ ] `POST /v1/dids` with `DID_METHOD=key` creates `did:key:z...` DID from public key — no Hedera call
- [ ] `resolveDidKey` in helix-core is a pure local function — no I/O, no dependencies beyond `@noble/curves`
- [ ] `DispatchingDidResolver` routes correctly — `did:key:` local, `did:hedera:` Hedera
- [ ] Full onboarding and VP verify flow works end-to-end in `did:key` mode
- [ ] DID update operations blocked in `did:key` mode with clear error message
- [ ] SDK `resolveDID` resolves `did:key:` DIDs locally when `mode: 'local'` — no API call
- [ ] `scripts/setup.ts` supports `did:key` setup path — skips Hedera credential prompts
- [ ] Warning logged on startup when `DID_METHOD=key`
- [ ] Unit test coverage ≥ 95% for `did-key.ts` in helix-core
- [ ] All security tests confirm no Hedera calls in `did:key` mode
- [ ] `decisions.md` updated noting `did:key` is development-only — not added as a production trust anchor
