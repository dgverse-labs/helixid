# STORY 2 — Boundary 2: VC Issuance & Management

## Overview

B2 owns the full lifecycle of Verifiable Credentials. It issues agent VCs and user VCs, maintains the W3C StatusList2021 bitstring for revocation, handles expiry, and provides renewal. External verifiers use the status list URL embedded in each VC to check revocation without calling Helix ID per-verification.

---

## What to Mock So This Story Can Start

B2 depends on B1's `resolveDID`. Mock it as a function implementing `IDIDService` that accepts any DID string and returns a hardcoded valid DID document containing a known test public key. The mock does not hit a database or Hedera. A factory returning a fixed structure is sufficient.

The real `DIDService` gets injected in production via `server.ts`. The mock gets injected in B2 tests.

---

## 2.1 — Database Schema

Add to `helix-api/prisma/schema.prisma`:

```prisma
model Vc {
  id               String    @id @default(cuid())
  vcId             String    @unique  // format: vc:helix:<cuid>
  subjectDid       String
  subjectType      String              // "agent" or "user"
  vcJson           String              // full signed VC JSON
  privilegeScopes  String              // JSON array string, e.g. '["read:orders"]'
  statusListIndex  Int
  expiresAt        DateTime
  revokedAt        DateTime?
  renewedByVcId    String?             // vcId of the replacement VC after renewal
  createdAt        DateTime  @default(now())

  @@index([subjectDid])
  @@index([vcId])
  @@map("vcs")
}

model StatusListEntry {
  id           String   @id @default(cuid())
  listId       String   @unique  // e.g. "helix-status-list-1"
  encodedList  String            // base64url-encoded gzip-compressed bitstring
  nextIndex    Int      @default(0)
  updatedAt    DateTime @updatedAt

  @@map("status_list_entries")
}
```

Run migration: `npx prisma migrate dev --name add_vc_and_status_list_tables`

---

## 2.2 — helix-core Additions

### Allowed Privilege Scopes — `helix-core/src/schemas/privilegeScopes.ts`

```typescript
export const ALLOWED_PRIVILEGE_SCOPES = [
  'read:orders',
  'write:orders',
  'read:profile',
  'write:profile',
  'read:payments',
  'write:payments',
  'read:inventory',
  'write:inventory',
] as const;

export type PrivilegeScope = typeof ALLOWED_PRIVILEGE_SCOPES[number];

// Pattern for custom scope validation: lowercase letters, colon, lowercase letters/underscores
export const SCOPE_PATTERN = /^[a-z]+:[a-z_]+$/;
```

### VC Schema — `helix-core/src/schemas/vc.ts`

**Agent VC structure:**

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://helix-id.io/contexts/v1"
  ],
  "id": "vc:helix:<cuid>",
  "type": ["VerifiableCredential", "HelixAgentCredential"],
  "issuer": "did:hedera:testnet:<helix-id-operator-did>",
  "issuanceDate": "<ISO 8601>",
  "expirationDate": "<ISO 8601>",
  "credentialStatus": {
    "id": "<API_BASE_URL>/v1/status-list/<listId>#<index>",
    "type": "StatusList2021Entry",
    "statusPurpose": "revocation",
    "statusListIndex": "<index as string>",
    "statusListCredential": "<API_BASE_URL>/v1/status-list/<listId>"
  },
  "credentialSubject": {
    "id": "<agentDID>",
    "type": "HelixAgent",
    "privilegeScopes": ["read:orders", "write:orders"],
    "agentName": "My Agent"
  }
}
```

**User VC structure:** Same envelope. `type` is `["VerifiableCredential", "HelixUserCredential"]`. `credentialSubject.type` is `"HelixUser"`. No `privilegeScopes` field. Has `"userId": string` instead.

**Signed VC** wraps either with a `proof` field:

```json
{
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "<ISO 8601>",
    "verificationMethod": "<helix-id-did>#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "<base58btc-encoded signature>"
  }
}
```

Export Zod schemas for `AgentVC`, `UserVC`, `SignedVC`. Export TypeScript types inferred from Zod schemas.

### Status List Logic — `helix-core/src/status-list/index.ts`

Uses Node.js `zlib` for gzip. No additional dependencies.

Functions:

- `createStatusList(size?: number): string` — creates zeroed bitstring of `size` bits (default 131072), gzip-compresses, base64url-encodes. Returns encoded string.

- `setBit(encodedList: string, index: number, value: 0 | 1): string` — decodes, decompresses, flips bit at index, recompresses, re-encodes. Returns new encoded string. Does not mutate input.

- `getBit(encodedList: string, index: number): 0 | 1` — decodes, decompresses, reads bit at index. Returns 0 or 1.

- `buildStatusListCredential(listId: string, encodedList: string, issuerDid: string, apiBaseUrl: string): object` — builds W3C StatusList2021 credential JSON. Structure:

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://w3id.org/vc/status-list/2021/v1"
  ],
  "id": "<apiBaseUrl>/v1/status-list/<listId>",
  "type": ["VerifiableCredential", "StatusList2021Credential"],
  "issuer": "<issuerDid>",
  "issuanceDate": "<ISO 8601 now>",
  "credentialSubject": {
    "id": "<apiBaseUrl>/v1/status-list/<listId>#list",
    "type": "StatusList2021",
    "statusPurpose": "revocation",
    "encodedList": "<encodedList>"
  }
}
```

### Error Codes to Add — `helix-core/src/errors/codes.ts`

```typescript
// B2 — VC Issuance & Management
VC_NOT_FOUND: 'VC_NOT_FOUND',
VC_ALREADY_REVOKED: 'VC_ALREADY_REVOKED',
VC_EXPIRED: 'VC_EXPIRED',
VC_SUBJECT_DID_NOT_FOUND: 'VC_SUBJECT_DID_NOT_FOUND',
VC_INVALID_PRIVILEGE_SCOPE: 'VC_INVALID_PRIVILEGE_SCOPE',
STATUS_LIST_INDEX_EXHAUSTED: 'STATUS_LIST_INDEX_EXHAUSTED',
```

Add corresponding convenience error classes to `HelixError.ts`:

| Class | Code | HTTP |
|---|---|---|
| `VCNotFoundError(vcId)` | `VC_NOT_FOUND` | 404 |
| `VCAlreadyRevokedError` | `VC_ALREADY_REVOKED` | 409 |
| `VCExpiredError` | `VC_EXPIRED` | 400 |
| `VCSubjectDIDNotFoundError` | `VC_SUBJECT_DID_NOT_FOUND` | 404 |
| `VCInvalidPrivilegeScopeError(scope)` | `VC_INVALID_PRIVILEGE_SCOPE` | 400 |
| `StatusListIndexExhaustedError` | `STATUS_LIST_INDEX_EXHAUSTED` | 503 |

### Audit Events to Add — `helix-core/src/audit/events.ts`

```
VC_ISSUED           — fields: vcId, subjectDid, subjectType, privilegeScopes, expiresAt, statusListIndex
VC_ISSUANCE_FAILED  — fields: reason, subjectDid?
VC_REVOKED          — fields: vcId, timestamp
VC_REVOCATION_FAILED — fields: vcId, reason
VC_RENEWED          — fields: oldVcId, newVcId, timestamp
VC_RENEWAL_FAILED   — fields: vcId, reason
VC_STATUS_CHECKED   — fields: vcId, status, timestamp
STATUS_LIST_UPDATED — fields: listId, index, newBitValue, timestamp
```

`VC_ISSUED` must NOT include the VC JSON or the signed proof value.

---

## 2.3 — API Endpoints

### OpenAPI Spec — add to `helix-core/src/openapi/openapi.yaml` before implementation

**Endpoints:**

- `POST /v1/vcs` — issue VC
- `GET /v1/vcs/{vcId}` — get VC details
- `POST /v1/vcs/{vcId}/revoke` — revoke VC
- `POST /v1/vcs/{vcId}/renew` — renew VC
- `GET /v1/status-list/{listId}` — serve status list credential (public, no auth)

### `POST /v1/vcs` — Issue a VC

**Request:**

```json
{
  "subjectDid": "did:hedera:testnet:...",
  "subjectType": "agent",
  "privilegeScopes": ["read:orders", "write:orders"],
  "agentName": "My Shopping Agent",
  "expiresInSeconds": 7776000
}
```

For user VCs: omit `privilegeScopes` and `agentName`, include `"userId": "user_abc123"`.

Validation: `expiresInSeconds` min 3600, max 31536000. `privilegeScopes` required for agent, forbidden for user. `agentName` required for agent. `userId` required for user.

**Response 201:**

```json
{
  "vcId": "vc:helix:abc123",
  "vc": { /* full signed VC JSON */ },
  "statusListIndex": 42,
  "expiresAt": "2025-09-01T00:00:00Z"
}
```

**Error cases:** 400 `VALIDATION_ERROR`, 400 `VC_INVALID_PRIVILEGE_SCOPE`, 404 `VC_SUBJECT_DID_NOT_FOUND`, 503 `STATUS_LIST_INDEX_EXHAUSTED`

Signing: Helix ID signs the VC using HELIX_SIGNING_KEY (Ed25519). The signature is computed over the canonical JSON of the credential (without the proof field), following the Linked Data Proof spec. In practice: JSON.stringify the credential without proof, compute SHA-256, sign with Ed25519, base58btc-encode the signature bytes.

### `GET /v1/vcs/{vcId}` — Get VC Details

**Response 200:**

```json
{
  "vcId": "vc:helix:abc123",
  "vc": { /* signed VC */ },
  "status": "active",
  "expiresAt": "...",
  "revokedAt": null,
  "renewedByVcId": null
}
```

`status` is computed: `"revoked"` if `revokedAt` is set, `"expired"` if `expiresAt` is past, otherwise `"active"`.

**Error cases:** 404 `VC_NOT_FOUND`

### `POST /v1/vcs/{vcId}/revoke` — Revoke a VC

No request body.

**Response 200:**

```json
{
  "vcId": "vc:helix:abc123",
  "revoked": true,
  "revokedAt": "2025-06-01T00:00:00Z"
}
```

**Error cases:** 404 `VC_NOT_FOUND`, 409 `VC_ALREADY_REVOKED`

### `POST /v1/vcs/{vcId}/renew` — Renew a VC

**Request (all fields optional — defaults to same as original VC):**

```json
{
  "privilegeScopes": ["read:orders"],
  "expiresInSeconds": 7776000
}
```

**Response 201:**

```json
{
  "vcId": "vc:helix:newid",
  "vc": { },
  "previousVcId": "vc:helix:oldid",
  "expiresAt": "..."
}
```

Old VC is NOT revoked on renewal — it expires naturally or is revoked separately. Old VC gets `renewedByVcId` set to new vcId.

**Error cases:** 404 `VC_NOT_FOUND`, 409 `VC_ALREADY_REVOKED` (cannot renew a revoked VC)

### `GET /v1/status-list/{listId}` — Serve Status List Credential

Public endpoint. No authentication. Set `Cache-Control: public, max-age=300` response header.

**Response 200:** The W3C StatusList2021 credential JSON directly (not wrapped in envelope). Content-Type: `application/json`.

**Error cases:** 404 if listId not found.

---

## 2.4 — Repository Layer

### `helix-api/src/repositories/vc.repository.ts`

Constructor takes `PrismaClient`. Methods — Prisma queries only:

- `create(data): Promise<Vc>`
- `findByVcId(vcId: string): Promise<Vc | null>`
- `findActiveBySubjectDid(subjectDid: string): Promise<Vc | null>` — not revoked, not expired
- `markRevoked(vcId: string): Promise<Vc>` — sets `revokedAt: now()`
- `markRenewed(oldVcId: string, newVcId: string): Promise<Vc>` — sets `renewedByVcId`
- `getStatusListEntry(listId: string): Promise<StatusListEntry | null>`
- `upsertStatusListEntry(listId: string, encodedList: string, nextIndex: number): Promise<StatusListEntry>`
- `claimStatusListIndex(listId: string): Promise<number>` — atomic increment using Prisma `$transaction` with `SELECT FOR UPDATE` semantics to prevent two concurrent issuances getting the same index

---

## 2.5 — Service Layer

### `helix-api/src/services/vc/IVCService.ts`

```typescript
interface IVCService {
  issueVC(params: IssueVCParams, requestId: string): Promise<IssueVCResult>;
  getVC(vcId: string, requestId: string): Promise<VCDetails>;
  revokeVC(vcId: string, requestId: string): Promise<RevokeVCResult>;
  renewVC(vcId: string, overrides: RenewVCOverrides, requestId: string): Promise<RenewVCResult>;
  getVCStatus(vcId: string): Promise<'active' | 'revoked' | 'expired'>;
  getStatusListCredential(listId: string): Promise<object>;
}
```

### `helix-api/src/services/vc/vc.service.ts`

Constructor: `(vcRepository: VCRepository, didService: IDIDService, auditLogger: IAuditLogger)`

**`issueVC(params, requestId)`:**

1. Call `didService.resolveDID(params.subjectDid)` — if throws `DIDNotFoundError` or `DIDDeactivatedError`, throw `VCSubjectDIDNotFoundError`. Emit `VC_ISSUANCE_FAILED` audit event first.
2. Validate privilege scopes: each must match `SCOPE_PATTERN` and be in `ALLOWED_PRIVILEGE_SCOPES`. Throw `VCInvalidPrivilegeScopeError(scope)` for first invalid scope.
3. Claim next `statusListIndex` via `vcRepository.claimStatusListIndex('helix-status-list-1')`. If index ≥ 131072, throw `StatusListIndexExhaustedError`.
4. Build unsigned VC JSON — set `vcId = 'vc:helix:' + cuid()`, set `credentialStatus` with index, set `expirationDate`.
5. Sign: `JSON.stringify` the VC without `proof` field → SHA-256 hash → sign hash with `HELIX_SIGNING_KEY` using Ed25519 → base58btc-encode signature bytes → attach as `proof.proofValue`.
6. Persist to `vcs` table.
7. Emit `VC_ISSUED` audit event — include `statusListIndex` and `vcId`, NOT the VC JSON.
8. Return result.

**`revokeVC(vcId, requestId)`:**

1. Fetch VC record — throw `VCNotFoundError` if null.
2. Throw `VCAlreadyRevokedError` if `revokedAt` is set.
3. Fetch status list entry.
4. Call `setBit(encodedList, statusListIndex, 1)` from helix-core.
5. In a single Prisma transaction: update status list entry AND mark VC as revoked. Atomicity prevents partial state.
6. Emit `VC_REVOKED` and `STATUS_LIST_UPDATED` audit events.
7. Return result.

**`renewVC(vcId, overrides, requestId)`:**

1. Fetch original VC — throw `VCNotFoundError` if null.
2. Throw `VCAlreadyRevokedError` if revoked.
3. Parse original VC JSON to extract subject, original scopes, agentName.
4. Call `issueVC` with same subject + (overrides.privilegeScopes ?? original scopes) + (overrides.expiresInSeconds ?? original TTL).
5. Call `vcRepository.markRenewed(vcId, newVcId)` on old record.
6. Emit `VC_RENEWED` event with both old and new vcId.
7. Return result.

**`getVCStatus(vcId)`:**

1. Fetch VC record — throw `VCNotFoundError` if null.
2. If `revokedAt` set → return `'revoked'`
3. If `expiresAt` < now → return `'expired'`
4. Return `'active'`

**Signing detail:** The proof value is computed as:
1. Deep-clone the VC JSON object, delete the `proof` key
2. `JSON.stringify` with keys in deterministic order (use a recursive sort)
3. Compute `sha256(Buffer.from(serialized, 'utf-8'))`
4. Sign hash bytes with Ed25519 using `signBytes` from helix-core
5. Convert signature bytes to base58btc string (use same base58btc encoder from helix-core `keys.ts`)
6. Set `proof.proofValue = base58btcSignature`

---

## 2.6 — Route Layer

### `helix-api/src/routes/vc/index.ts`

Fastify plugin. Accepts `{ vcService: IVCService }`.

JSON Schema for every route per AC-4. Routes:

- `POST /v1/vcs` → 201 or error
- `GET /v1/vcs/:vcId` → 200 or 404
- `POST /v1/vcs/:vcId/revoke` → 200 or error
- `POST /v1/vcs/:vcId/renew` → 201 or error
- `GET /v1/status-list/:listId` → 200 with `Cache-Control: public, max-age=300` header

`vcId` path param pattern: `^vc:helix:[a-zA-Z0-9]+$`

---

## 2.7 — SDK Methods

Add to `HelixClient`:

- `getVC(vcId: string): Promise<VCDetails>` — calls `GET /v1/vcs/:vcId`
- `revokeVC(vcId: string): Promise<{ revoked: true, revokedAt: string }>` — calls `POST /v1/vcs/:vcId/revoke`
- `renewVC(vcId: string, options?: { privilegeScopes?: string[], expiresInSeconds?: number }): Promise<RenewVCResult>` — calls `POST /v1/vcs/:vcId/renew`
- `getStatusList(listId: string): Promise<object>` — calls `GET /v1/status-list/:listId`
- `checkVCStatus(vc: SignedVC): Promise<'active' | 'revoked' | 'expired'>` — client-side only, no API call. Extracts `statusListIndex` and `statusListCredential` URL from VC, fetches status list via `getStatusList`, calls `getBit` from helix-core. Also checks `expirationDate` locally.

Add error mappings in `HttpAdapter.ts` for `VC_NOT_FOUND`, `VC_ALREADY_REVOKED`, `VC_EXPIRED`, `VC_SUBJECT_DID_NOT_FOUND`, `VC_INVALID_PRIVILEGE_SCOPE`, `STATUS_LIST_INDEX_EXHAUSTED`.

---

## 2.8 — Tests

### Unit Tests — `helix-core/tests/unit/status-list/`

- `createStatusList` produces a non-empty base64url string
- `getBit` on freshly created list returns 0 for any index
- `setBit(list, 5, 1)` then `getBit(list, 5)` returns 1
- `setBit` does not affect adjacent bits — set bit 5, check bits 4 and 6 are still 0
- Multiple bits roundtrip: set bits 0, 100, 1000, 65535 → read them all back correctly
- `buildStatusListCredential` returns object with correct `@context` and `type` fields

### Integration Tests — `helix-api/tests/integration/vc.integration.test.ts`

Setup: real PostgreSQL, MockHederaClient (for DIDService), MockDIDService (returns hardcoded DID document). `afterEach` truncates vc, status_list_entries, audit_log tables.

Tests:

- Issue agent VC → 201, vcId format correct, VC JSON contains correct subjectDid and scopes
- Issue user VC → 201, VC JSON has no `privilegeScopes`, has `userId`
- Issue VC for unknown DID → 404 `VC_SUBJECT_DID_NOT_FOUND`
- Issue VC with invalid scope string → 400 `VC_INVALID_PRIVILEGE_SCOPE`
- Issue VC with scope not in allowed list → 400 `VC_INVALID_PRIVILEGE_SCOPE`
- Get VC → 200, `status: 'active'`
- Revoke VC → 200, DB record has `revokedAt` set
- Revoke already-revoked VC → 409 `VC_ALREADY_REVOKED`
- Get revoked VC → 200, `status: 'revoked'`
- Renew VC → 201, old VC has `renewedByVcId` set to new vcId, new VC has a different `statusListIndex`
- Renew revoked VC → 409 `VC_ALREADY_REVOKED`
- Get status list → 200, valid JSON with correct `type`
- Concurrent issuance: two simultaneous `issueVC` calls via `Promise.all` → both succeed, different `statusListIndex` values

### Security Tests — `helix-api/tests/security/vc.security.test.ts`

- Issued VC proof value verifies against `HELIX_SIGNING_KEY` public key using `verifySignature` from helix-core
- Tampered VC (change one character in `credentialSubject.id`) — re-verify proof → signature invalid
- Revoke VC then call `checkVCStatus` in SDK → returns `'revoked'`; `getBit` at that index in status list returns 1
- Create VC with `expiresInSeconds: 2`, wait 3 seconds, call `checkVCStatus` → returns `'expired'`
- `VC_ISSUED` audit entry does not contain the VC JSON string or proof value
- `STATUS_LIST_UPDATED` audit entry is written on every revocation

---

## Story 2 Acceptance Criteria

- [ ] `POST /v1/vcs` issues agent and user VCs with correct structure and valid Ed25519 proof
- [ ] `GET /v1/vcs/:vcId` returns VC with computed status
- [ ] `POST /v1/vcs/:vcId/revoke` flips bit in status list; atomic with DB update
- [ ] `POST /v1/vcs/:vcId/renew` issues new VC; old VC marked with `renewedByVcId`
- [ ] `GET /v1/status-list/:listId` serves W3C StatusList2021 credential with correct cache headers
- [ ] Concurrent issuance test passes — unique `statusListIndex` per VC
- [ ] All B2 audit events from AL-1 are emitted and verified by tests
- [ ] VC proof value verified by security test against `HELIX_SIGNING_KEY`
- [ ] SDK `checkVCStatus` verifies revocation client-side without extra API call
- [ ] All error codes defined in helix-core before implementation
- [ ] OpenAPI spec complete for all B2 endpoints before implementation
- [ ] Unit test coverage ≥ 95% for status-list module in helix-core
- [ ] All security tests pass and none are skipped
