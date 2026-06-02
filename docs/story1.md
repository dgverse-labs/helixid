# STORY 1 — Boundary 1: DID & Hedera Integration

## Overview

Implement everything related to DID lifecycle and Hedera anchoring. In the current implementation, live Hedera DID creation is performed through the Hiero DID SDK prepare/submit flow: the API prepares the DID creation payload, the SDK signs it locally with the agent key, and the API submits it to Hedera. Local DB state is then used for fast resolution by the rest of Helix ID.

Current implementation boundary: live did:hedera creation is supported for onboarding through `prepareDIDCreation` and `submitDIDCreation`. Direct document anchoring via `anchorDocument`, live Mirror Node fetch resolution, DID service endpoint updates, and Hedera-backed deactivation/update flows are not production-complete yet and should not be presented as adapter-ready live Hedera flows.

DID format: `did:hedera:<network>:<identifier>_<topicId>` for live Hiero-created DIDs, for example `did:hedera:testnet:<identifier>_0.0.<topic>`. Older local/mock tests may use shorter `did:hedera:testnet:<identifier>` values.

---

## What to Mock So Other Boundaries Can Start in Parallel

B2 (VC issuance): inject a `MockDIDService` that returns a hardcoded valid DID document containing a known test public key for any DID string. No DB, no Hedera.

B3 (VP verification): mock `resolveDID` to return a fixed DID document containing a known test public key. The mock must be injectable so security tests can simulate DID-not-found scenarios.

B4 (Agent onboarding): mock `createDID` returning `{ did: 'did:hedera:testnet:testid', hederaTransactionId: 'mock-tx-1' }`. Mock `resolveDID` returning a fixed DID document.

All mocks are constructor-injected interfaces. The real implementations are wired in `server.ts`.

---

## 1.1 — Dependencies to Install

In `helix-api`:

```bash
pnpm install @hiero-did-sdk/registrar @hashgraph/sdk @noble/curves @noble/hashes
```

In `helix-core`:

```bash
pnpm install @noble/curves @noble/hashes
```

Add entries to `decisions.md` for all four packages per DP-2.

---

## 1.2 — Database Schema

Add to `helix-api/prisma/schema.prisma`:

```prisma
model Did {
  id                   String      @id
  // "agent" or "user"
  subjectType          String
  publicKeyMultibase   String
  // Hedera HCS topic ID used for anchoring
  hederaTopicId        String
  // Hedera sequence number of the anchoring message
  hederaSequenceNumber Int
  // The transaction consensus timestamp from Hedera (ISO 8601)
  hederaTransactionId  String
  publicKey            String
  // The full DID document JSON — stored for fast resolution.
  didDocument          Json
  // Soft-delete marker — DID is never hard-deleted.
  deactivatedAt        DateTime?
  createdAt            DateTime    @default(now())
  updatedAt            DateTime    @updatedAt

  @@map("dids")
}

model AuditLog {
  id          String   @id @default(cuid())
  timestamp   String
  eventType   String
  requestId   String
  payloadJson String
  createdAt   DateTime @default(now())

  @@index([eventType])
  @@index([requestId])
  @@map("audit_log")
}
```

Run migration: `cd helix-api && npx prisma migrate dev --name init_did_tables`

---

## 1.3 — helix-core: Crypto Primitives

### `helix-core/src/crypto/keys.ts`

Exports:

- `generateKeyPair(): KeyPair` — generates Ed25519 keypair. Private key is 32 bytes of cryptographically secure random. Returns `{ privateKey: string, publicKey: string }` both hex-encoded. NEVER log or transmit the private key.
- `derivePublicKey(privateKeyHex: string): string` — derives public key from private key hex
- `signBytes(message: Uint8Array, privateKeyHex: string): string` — signs arbitrary bytes, returns hex-encoded 64-byte signature
- `verifySignature(message: Uint8Array, signatureHex: string, publicKeyHex: string): boolean` — verifies Ed25519 signature; catches malformed input and returns false rather than throwing
- `publicKeyToMultibase(publicKeyHex: string): string` — encodes public key as multibase base58btc with `z` prefix and Ed25519 multicodec prefix `0xed01`
- `multibaseToPublicKeyHex(multibase: string): string` — decodes multibase back to hex, strips multicodec prefix; throws if prefix is not `z`

All functions use `@noble/curves/ed25519` for signing and `@noble/hashes/sha256` for hashing. No other crypto libraries.

### `helix-core/src/crypto/did.ts`

Exports:

**Types:**

```typescript
interface DIDDocument {
  '@context': string[];
  id: string;
  controller: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[];
}

interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}
```

**Functions:**

- `buildDIDDocument(did: string, publicKeyHex: string, serviceEndpoints?: ServiceEndpoint[]): DIDDocument` — builds W3C-compliant DID document. Context includes `https://www.w3.org/ns/did/v1` and `https://w3id.org/security/suites/ed25519-2020/v1`. Verification method type is `Ed25519VerificationKey2020`. Both `authentication` and `assertionMethod` reference `${did}#key-1`. Service is omitted from document when array is empty.

- `extractPublicKeyFromDIDDocument(document: DIDDocument): string` — extracts hex public key from first `Ed25519VerificationKey2020` verification method; throws if none present

- `buildServiceEndpoints(domains: string[]): ServiceEndpoint[]` — converts domain URL strings to `LinkedDomains` service endpoint objects with IDs `#domain-1`, `#domain-2`, etc.

- `addServiceEndpoint(document: DIDDocument, endpoint: ServiceEndpoint): DIDDocument` — returns new document with endpoint added; throws `'already exists'` if ID is duplicate; does NOT mutate original

- `removeServiceEndpoint(document: DIDDocument, endpointId: string): DIDDocument` — returns new document with endpoint removed; throws `'not found'` if ID does not exist; sets service to undefined if last endpoint removed; does NOT mutate original

---

## 1.4 — helix-core: Error Types

### `helix-core/src/errors/codes.ts`

```typescript
export const ErrorCode = {
  // B1 — DID & Hedera
  INVALID_PUBLIC_KEY: 'INVALID_PUBLIC_KEY',
  INVALID_DID_FORMAT: 'INVALID_DID_FORMAT',
  DID_NOT_FOUND: 'DID_NOT_FOUND',
  DID_ALREADY_EXISTS: 'DID_ALREADY_EXISTS',
  DID_DEACTIVATED: 'DID_DEACTIVATED',
  INVALID_SERVICE_ENDPOINT_URL: 'INVALID_SERVICE_ENDPOINT_URL',
  SERVICE_ENDPOINT_NOT_FOUND: 'SERVICE_ENDPOINT_NOT_FOUND',
  SERVICE_ENDPOINT_ALREADY_EXISTS: 'SERVICE_ENDPOINT_ALREADY_EXISTS',
  HEDERA_ANCHOR_FAILED: 'HEDERA_ANCHOR_FAILED',
  HEDERA_RESOLUTION_FAILED: 'HEDERA_RESOLUTION_FAILED',

  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
```

### `helix-core/src/errors/HelixError.ts`

Base class `HelixError extends Error` with fields: `code: ErrorCode`, `httpStatus: number`, `details?: Record<string, unknown>`.

Convenience subclasses (each calls super with correct code, message, httpStatus):

| Class | Code | HTTP |
|---|---|---|
| `InvalidPublicKeyError` | `INVALID_PUBLIC_KEY` | 400 |
| `InvalidDIDFormatError(did)` | `INVALID_DID_FORMAT` | 400 |
| `DIDNotFoundError(did)` | `DID_NOT_FOUND` | 404 |
| `DIDAlreadyExistsError` | `DID_ALREADY_EXISTS` | 409 |
| `DIDDeactivatedError(did)` | `DID_DEACTIVATED` | 410 |
| `InvalidServiceEndpointUrlError(url)` | `INVALID_SERVICE_ENDPOINT_URL` | 400 |
| `ServiceEndpointNotFoundError(id)` | `SERVICE_ENDPOINT_NOT_FOUND` | 404 |
| `ServiceEndpointAlreadyExistsError(id)` | `SERVICE_ENDPOINT_ALREADY_EXISTS` | 409 |
| `HederaAnchorFailedError` | `HEDERA_ANCHOR_FAILED` | 502 |
| `HederaResolutionFailedError` | `HEDERA_RESOLUTION_FAILED` | 502 |
| `InternalError` | `INTERNAL_ERROR` | 500 |

---

## 1.5 — helix-core: Audit Log Interface

### `helix-core/src/audit/events.ts`

B1 audit event types:

```
DID_CREATED        — fields: did, subjectType, hederaTransactionId, publicKeyMultibase
DID_CREATION_FAILED — fields: reason, publicKeyMultibase?
DID_RESOLVED       — fields: did, source: 'cache' | 'hedera'
DID_UPDATED        — fields: did, updateType, hederaTransactionId
DID_UPDATE_FAILED  — fields: did, updateType, reason
DID_DEACTIVATED    — fields: did, reason
```

Every event has base fields: `timestamp: string` (ISO 8601), `event: AuditEventType`, `requestId: string`.

### `helix-core/src/audit/IAuditLogger.ts`

```typescript
interface IAuditLogger {
  log(event: AuditEvent): Promise<void>;
}
```

---

## 1.6 — helix-core: Config Module

### `helix-core/src/config/index.ts`

Zod schema validating these env variables at startup:

- `NODE_ENV`: enum `development | test | production`, default `development`
- `PORT`: coerce to number, min 1, max 65535, default 3000
- `API_BASE_URL`: string URL
- `DATABASE_URL`: string min 1
- `HEDERA_NETWORK`: enum `testnet | previewnet | mainnet`, default `testnet`
- `HEDERA_OPERATOR_ID`: string min 1
- `HEDERA_OPERATOR_KEY`: string min 1
- `HEDERA_TOPIC_ID`: string min 1 for legacy/manual HCS topic configuration. The live Hiero DID registrar path can return its own topic suffix in the DID; adapters should not assume this env value is the DID topic for every DID.
- `HELIX_SIGNING_KEY`: string min 64
- `ENROLLMENT_TOKEN_TTL_SECONDS`: coerce number, min 60, max 3600, default 900
- `CHALLENGE_TTL_SECONDS`: coerce number, min 30, max 600, default 300
- `VP_TTL_SECONDS`: coerce number, min 60, max 3600, default 300
- `AUDIT_LOG_DESTINATION`: enum `stdout | file | both`, default `stdout`
- `AUDIT_LOG_PATH`: string optional
- `HEDERA_E2E_TESTNET`: transform string to boolean, default false

**SA-9 enforcement:** After parsing, if `HEDERA_NETWORK === 'mainnet'` and `NODE_ENV !== 'production'`, throw with message `"HEDERA_NETWORK=mainnet is only permitted when NODE_ENV=production."`. Process exits.

Exported as singleton `config` — loaded once at module import time. All other packages import this object. ESLint rule blocks direct `process.env` access everywhere else.

---

## 1.7 — helix-api: IHederaClient Interface

### `helix-api/src/hedera/IHederaClient.ts`

```typescript
interface HederaTransactionResult {
  transactionId: string;
  sequenceNumber: number;
  topicId: string;
}

interface HederaMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  contents: string; // raw JSON string of the DID document
}

interface IHederaClient {
  prepareDIDCreation(publicKeyMultibase: string): Promise<{ stateJson: string; signingPayloadHex: string }>;
  submitDIDCreation(stateJson: string, signatureHex: string): Promise<{
    did: string;
    didDocument: unknown;
    transactionId: string;
    sequenceNumber: number;
    topicId: string;
  }>;
  anchorDocument(payload: string): Promise<HederaTransactionResult>;
  fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage>;
}
```

### `helix-api/src/hedera/HederaHIEROClient.ts`

Production implementation wrapping `@hiero-did-sdk/registrar`. Constructor reads from `config`. Operator account set via `@hashgraph/sdk` `Client`.

`prepareDIDCreation(publicKeyMultibase)`: asks the Hiero registrar for a DID creation request and returns serialized state plus the payload the agent key must sign.

`submitDIDCreation(stateJson, signatureHex)`: submits the signed creation request to Hedera and waits for DID visibility. Returns the did:hedera DID and DID document.

`anchorDocument(payload)` and `fetchMessage(topicId, sequenceNumber)`: currently interface placeholders for future DID update/live-resolution support. The current live client intentionally does not implement arbitrary document anchoring or Mirror Node DID document fetching.

### `helix-api/src/hedera/mock/MockHederaClient.ts`

In-memory implementation. Stores anchored messages in a `Map<number, StoredMessage>`. Auto-increments sequence counter. Exposes `anchoredPayloads: string[]` for test assertions. Has `reset()` method — call in `afterEach`.

Never makes network calls.

---

## 1.8 — helix-api: Repository Layer

### `helix-api/src/repositories/did.repository.ts`

Constructor takes `PrismaClient`. Methods — Prisma queries only, no business logic:

- `create(data): Promise<Did>` — inserts new DID record
- `findDidById(did: string): Promise<Did | null>`
- `findDidByPublicKey(publicKeyHex: string): Promise<Did | null>`
- `updateDidDocument(did: string, didDocument: object, updateMetadata): Promise<Did>`
- `deactivateDid(did: string, deactivatedAt: Date): Promise<Did>` — sets `deactivatedAt`

---

## 1.9 — helix-api: Service Layer

### `helix-api/src/services/did/IDIDService.ts`

Interface exposing the methods B2, B3, B4 depend on:

```typescript
interface IDIDService {
  prepareDIDCreation(publicKeyHex: string): Promise<{ stateJson: string; signingPayloadHex: string }>;
  createDID(publicKeyHex: string, subjectType: 'agent' | 'user', domains: string[], requestId: string, creationProof?: DIDCreationProof): Promise<CreateDIDResult>;
  resolveDID(did: string, options?: { live?: boolean } | string, requestId?: string): Promise<ResolveDIDResult>;
  addServiceEndpoint(did: string, endpoint: ServiceEndpoint, requestId: string): Promise<DIDDocument>;
  removeServiceEndpoint(did: string, endpointId: string, requestId: string): Promise<DIDDocument>;
  deactivateDID(did: string, requestId: string): Promise<void>;
}
```

### `helix-api/src/services/did/did.service.ts`

Constructor: `(didRepository: DidRepository, hederaClient: IHederaClient, auditLogger: IAuditLogger)`

**`createDID(publicKeyHex, subjectType, domains, requestId)`:**

1. Validate public key: must match `/^[0-9a-f]{64}$/i`. Throw `InvalidPublicKeyError` if not.
2. Validate each domain: must parse as valid URL with `https:` protocol. Throw `InvalidServiceEndpointUrlError` if not.
3. Derive `publicKeyMultibase` via `publicKeyToMultibase`.
4. Check `didRepository.findDidByPublicKey` — if exists throw `DIDAlreadyExistsError`. Emit `DID_CREATION_FAILED` audit event first.
5. For live did:hedera creation, accept a `creationProof` produced by SDK-side signing of the payload from `prepareDIDCreation`.
6. Call `hederaClient.submitDIDCreation(creationProof.stateJson, creationProof.signatureHex)` — on failure emit `DID_CREATION_FAILED` then throw `HederaAnchorFailedError`.
7. Store the DID and DID document returned by Hiero; append requested linked-domain service endpoints in the local persisted document.
8. Persist to DB via `didRepository.create`.
9. Emit `DID_CREATED` audit event with `publicKeyMultibase` — never with private key.
10. Return `{ did, didDocument, hederaTransactionId }`.

**`resolveDID(did, requestId)`:**

1. Validate DID format against did:hedera pattern. Throw `InvalidDIDFormatError` if not.
2. `didRepository.findDidById` — throw `DIDNotFoundError` if null.
3. Throw `DIDDeactivatedError` if `record.deactivatedAt` is set.
4. Return the persisted `didDocument`. Emit `DID_RESOLVED` with `source: 'cache'`. Return result.

**Live resolution status:**

Current implementation exposes `resolveDID(did, { live: true })`, but live Mirror Node fetching is not implemented yet. Until `fetchMessage` is wired to a real resolver path, adapters should treat DID resolution as DB-backed.

**`addServiceEndpoint(did, endpoint, requestId)`:**

1. Validate DID format and service endpoint URL.
2. Fetch active record (not found → `DIDNotFoundError`, deactivated → `DIDDeactivatedError`).
3. Parse current DID document. Call `addServiceEndpoint` from helix-core. Catch `'already exists'` error → throw `ServiceEndpointAlreadyExistsError`.
4. Re-anchor updated document on Hedera. Current live client does not support this yet; treat service endpoint updates as not adapter-ready in live Hedera mode.
5. Update DB: `didRepository.updateDidDocument`.
6. Emit `DID_UPDATED` audit event.
7. Return updated DID document.

**`removeServiceEndpoint(did, endpointId, requestId)`:**

Same pattern. Catch `'not found'` → throw `ServiceEndpointNotFoundError`. Re-anchor when live update support exists. Update DB. Emit audit event.

**`deactivateDID(did, reason, requestId)`:**

1. Fetch active record.
2. Anchor deactivation marker on Hedera when live update support exists. Current behavior is local deactivation with best-effort anchoring that may fail without blocking local state.
3. `didRepository.deactivate(did)`.
4. Emit `DID_DEACTIVATED` audit event.

---

## 1.10 — helix-api: Route Layer

### OpenAPI Spec First (AC-1)

Add all B1 endpoints to `helix-core/src/openapi/openapi.yaml` before implementation:

**Endpoints:**

- `POST /v1/dids` — create DID
- `GET /v1/dids/{did}` — resolve DID (query param `?live=boolean`)
- `POST /v1/dids/{did}/services` — add service endpoint
- `DELETE /v1/dids/{did}/services/{endpointId}` — remove service endpoint
- `POST /v1/dids/{did}/deactivate` — deactivate DID

**Request schemas:**

`POST /v1/dids` body:
```
publicKeyHex: string, pattern ^[0-9a-fA-F]{64}$, required
subjectType: enum [agent, user], required
domains: array of https:// URLs, max 10, optional
```

`POST /v1/dids/{did}/services` body:
```
id: string, pattern ^#[a-zA-Z0-9\-]+$, required
type: enum [LinkedDomains], required
serviceEndpoint: string, pattern ^https://, required
```

`POST /v1/dids/{did}/deactivate` body:
```
reason: string, minLength 1, maxLength 500, required
```

**DID path parameter pattern:** `^did:hedera:testnet:[a-zA-Z0-9._-]+$`

**Response schemas:** All defined in OpenAPI components. `ErrorResponse` schema has `error.code`, `error.message`, `error.requestId` — all required.

**HTTP status codes per endpoint:**

| Endpoint | Success | Error codes |
|---|---|---|
| POST /v1/dids | 201 | 400, 409, 502 |
| GET /v1/dids/{did} | 200 | 400, 404, 410 |
| POST /v1/dids/{did}/services | 200 | 400, 404, 409, 410 |
| DELETE /v1/dids/{did}/services/{endpointId} | 200 | 404, 410 |
| POST /v1/dids/{did}/deactivate | 200 | 404, 410 |

### `helix-api/src/routes/did/index.ts`

Fastify plugin. Accepts `{ didService: IDIDService }` as options.

Each route defines full JSON Schema for `body`, `params`, `querystring`, `response` per AC-4. Schemas are derived directly from the OpenAPI spec — no divergence.

Route handlers extract `request.id` and pass as `requestId` to service methods. No business logic in route handlers — delegate everything to service.

---

## 1.11 — helix-api: Error Handler Middleware

### `helix-api/src/middleware/errorHandler.ts`

Fastify `setErrorHandler` callback.

- `HelixError` instance: log at warn level with `{ code, requestId }`, return `httpStatus` with structured error body
- Fastify validation error (`'validation' in error`): return 400 with `VALIDATION_ERROR` code
- Unknown error: log at error level (detail only in log — EH-3), return 500 with `INTERNAL_ERROR`

Response body always:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message.",
    "requestId": "req_..."
  }
}
```

---

## 1.12 — helix-api: Audit Log Implementation

### `helix-api/src/audit/index.ts`

`ApiAuditLogger implements IAuditLogger`. Constructor takes `PrismaClient`.

`log(event)`:
1. Serialize event to JSON string
2. Insert to `audit_log` table via Prisma
3. If `AUDIT_LOG_DESTINATION` is `stdout` or `both`: `process.stdout.write(entry + '\n')`
4. If `AUDIT_LOG_DESTINATION` is `file` or `both` and `AUDIT_LOG_PATH` is set: `fs.appendFile`

---

## 1.13 — helix-api: Wire in server.ts

`server.ts` wires all dependencies and registers routes:

```
PrismaClient
  → DidRepository
  → AuditLogger (ApiAuditLogger)
  → HederaHIEROClient
  → DIDService(didRepository, hederaClient, auditLogger)
  → register didRoutes({ didService })
```

Fastify logger config: redact `req.headers.authorization`. Use `crypto.randomUUID()` for `genReqId` — prefix `req_`.

Graceful shutdown on `SIGTERM` and `SIGINT`: close Fastify, disconnect Prisma.

---

## 1.14 — SDK: DID Methods

### `helix-sdk-js/src/http/HttpAdapter.ts`

Constructor takes `baseUrl: string`. Methods: `get<T>(path)`, `post<T>(path, body?)`, `delete<T>(path)`.

All errors from API are mapped to typed `HelixError` subclasses. Switch on `error.code` from response body. Unknown codes → `InternalError`.

### `helix-sdk-js/src/client/HelixClient.ts`

Constructor takes `(http: HttpAdapter, wallet: AgentWallet)`.

Methods:

- `createDID(options: { subjectType, domains? }): Promise<CreateDIDResult>` — direct DID creation helper for non-onboarding use. Current live onboarding uses `requestOnboardingChallenge`/`completeOnboarding` so the SDK can sign the Hiero DID creation payload locally. Private key is never transmitted.
- `resolveDID(did: string, options?: { live?: boolean }): Promise<ResolveDIDResult>`
- `addServiceEndpoint(did: string, endpoint): Promise<UpdateDIDResult>`
- `removeServiceEndpoint(did: string, endpointId: string): Promise<UpdateDIDResult>`
- `deactivateDID(did: string, reason: string): Promise<{ did, deactivated: true }>` — client method sends reason for API compatibility; current service deactivation stores local `deactivatedAt`.

---

## 1.15 — Tests

### Unit Tests — `helix-core/tests/unit/crypto/keys.test.ts`

- `generateKeyPair` produces 64-char hex private key and public key
- `generateKeyPair` produces unique keypairs on each call
- `derivePublicKey` returns same public key as `generateKeyPair`
- `signBytes` + `verifySignature` with matching key → true
- `verifySignature` with wrong public key → false
- `verifySignature` with altered message → false
- `verifySignature` with malformed signature hex → false (no throw)
- `publicKeyToMultibase` produces string starting with `z`
- Roundtrip: `publicKeyToMultibase` → `multibaseToPublicKeyHex` returns original hex
- `multibaseToPublicKeyHex` throws on non-`z` prefix

### Unit Tests — `helix-core/tests/unit/crypto/did.test.ts`

- `buildDIDDocument` contains correct `@context`
- `buildDIDDocument` id and controller match the DID string
- `buildDIDDocument` verification method type is `Ed25519VerificationKey2020`
- `buildDIDDocument` authentication and assertionMethod reference `${did}#key-1`
- `buildDIDDocument` includes service endpoints when provided
- `buildDIDDocument` service is undefined when no endpoints
- `extractPublicKeyFromDIDDocument` returns original public key hex
- `extractPublicKeyFromDIDDocument` throws if no Ed25519 method present
- `addServiceEndpoint` adds endpoint; does not mutate original; throws on duplicate ID
- `removeServiceEndpoint` removes endpoint; sets service undefined when last removed; throws when not found

### Integration Tests — `helix-api/tests/integration/did.integration.test.ts`

Setup: real PostgreSQL (from docker-compose.test.yml), MockHederaClient, ApiAuditLogger. `afterEach` truncates all tables. `afterAll` closes app and disconnects Prisma.

Tests:

- Live onboarding DID creation → DID matches did:hedera pattern and returns a Hiero transaction marker
- `POST /v1/dids` with domains → 201, didDocument.service has correct entry
- `POST /v1/dids` same public key twice → 409 `DID_ALREADY_EXISTS`
- `POST /v1/dids` invalid public key (too short) → 400 `VALIDATION_ERROR`
- `POST /v1/dids` non-HTTPS domain → 400 `INVALID_SERVICE_ENDPOINT_URL`
- `POST /v1/dids` → audit log has `DID_CREATED` entry; no private key in any log entry
- `GET /v1/dids/:did` → 200, returns DID document from persisted DB state
- `GET /v1/dids/:did` unknown DID → 404 `DID_NOT_FOUND`
- `GET /v1/dids/:did` malformed DID → 400
- `GET /v1/dids/:did` after deactivation → 410 `DID_DEACTIVATED`
- `POST /v1/dids/:did/services` → currently not adapter-ready in live Hedera mode until update anchoring is implemented
- `POST /v1/dids/:did/services` duplicate ID → 409 `SERVICE_ENDPOINT_ALREADY_EXISTS`
- `DELETE /v1/dids/:did/services/:endpointId` → 200, service removed
- `DELETE /v1/dids/:did/services/:endpointId` nonexistent → 404 `SERVICE_ENDPOINT_NOT_FOUND`

### Security Tests — `helix-api/tests/security/did.security.test.ts`

**These tests may NEVER be skipped. See SA-10.**

- Second DID creation for same public key → 409; exactly one DB record exists
- Deactivated DID is not resolvable → 410
- Cannot add service endpoint to deactivated DID → 410 `DID_DEACTIVATED`
- All audit log entries after DID creation contain no `privateKey` field and no 64-char hex string matching a private key
- `DID_DEACTIVATED` audit entry is written on deactivation with correct `reason` field
- HTTP (non-HTTPS) service endpoint → 400; zero DID records created in DB

---

## Story 1 Acceptance Criteria

- [ ] Live onboarding creates did:hedera DIDs through Hiero prepare/submit flow; SDK signs creation payload locally
- [ ] `GET /v1/dids/:did` resolves from persisted DB state; `?live=true` must not be documented as live until Mirror Node/Hiero resolver support is implemented
- [ ] Service endpoint updates and deactivation are locally represented; live Hedera update anchoring remains future work unless `anchorDocument` is replaced with a real Hiero update flow
- [ ] `POST /v1/dids/:did/deactivate` deactivates DID locally — all subsequent operations return 410
- [ ] All error codes defined in helix-core; all error responses match structured format
- [ ] All B1 audit events from AL-1 are emitted — verified by integration tests via DB assertions
- [ ] No private key in any log, error response, or audit entry — verified by security tests
- [ ] MockHederaClient used in all unit and integration tests — no real Hedera calls in CI
- [ ] OpenAPI spec complete for all B1 endpoints before implementation
- [ ] Unit test coverage ≥ 95% for helix-core crypto and did modules
- [ ] All security tests pass and none are skipped
- [ ] `decisions.md` updated with @hiero-did-sdk packages and @hashgraph/sdk entries
- [ ] `pnpm run build` compiles without errors
