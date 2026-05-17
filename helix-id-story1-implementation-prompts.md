# Helix ID — Story 1 Implementation Prompts
## Master Prompt Document for AI-Assisted Code Generation

---

## HOW TO USE THIS DOCUMENT

This document contains **6 self-contained phase prompts**. Each phase can be given to an LLM independently. Before running any phase prompt, always prepend:

1. The full contents of `STORY_1.md` (reference implementation spec)
2. The full contents of `constitution.md` (architectural rules)
3. The phase prompt from this document

Each phase prompt is complete — it includes all context, all file paths, all constraints, all existing code state, and exact instructions. The LLM should generate **only the files listed in that phase's output section** and nothing else.

---

## GLOBAL RULES (apply to every phase)

These rules must be respected in every generated file, in every phase:

### Language & Runtime
- TypeScript strict mode, ESM modules (`"type": "module"` in package.json)
- Node.js >= 20 LTS
- All imports use `.js` extension (ESM requirement), e.g. `import { x } from './keys.js'`

### Code Style
- Apache 2.0 license header on every file
- No `console.log` in any source or test file (ESLint rule)
- No `process.env` access outside `helix-core/src/config/index.ts`
- No `any` types — use `unknown` and narrow
- All async functions return typed Promises

### Architecture Rules (from constitution)
- `helix-core` has zero imports from other monorepo packages
- `helix-api` and `helix-sdk-js` import from `@helix-id/core` only (not sub-paths)
- Boundary import rule: B4 imports interfaces only, never concrete classes. All DI wiring happens in `server.ts`
- `IDIDService` interface must be defined alongside `DIDService` — B4 depends on the interface
- Repository files = Prisma queries only, zero business logic (DB-4)
- Service files = business logic only, no Prisma imports (go through repository)

### Security Rules (non-negotiable)
- SA-1/SA-2: Private key never transmitted to API, never logged
- SA-8: No private key, no raw VC, no raw VP in any log or error response
- SA-9: Hedera mainnet blocked unless `NODE_ENV=production`
- SA-10: No `test.skip`, `xit`, or `it.todo` in `tests/security/` ever

### TDD Rules
- Tests are written **before or alongside** implementation, never after
- Minimum 90% unit test coverage on `helix-core` (constitution says 95%, manager says 90% — use 95% as target)
- Minimum 80% on `helix-api`
- No mocking of crypto primitives — real Ed25519 ops in all tests

### Error Handling
- All error codes defined in `helix-core/src/errors/index.ts` — no ad hoc strings elsewhere
- All errors return `{ error: { code, message, requestId } }` shape
- EH-3: Never leak DB errors, stack traces, or key material in responses
- EH-5: Every error logged before returning to caller
- EH-6: SDK throws typed HelixError subclasses, never raw strings

### Audit Logging
- AL-1: Every security event produces an audit log entry
- AL-2: No private keys, no raw VC/VP payloads, no DB strings in audit entries
- AL-3: Audit log is append-only
- AL-4: Structured JSON, single line per entry, ISO 8601 timestamps
- AL-5: Missing audit entries = bug, same priority as failing security test

---

## EXISTING FILE STATE (what is already in the repo)

All files below are **stubs** unless noted otherwise. Do not assume they contain real logic.

```
helix-core/src/crypto/index.ts          → stub: export {}
helix-core/src/errors/index.ts          → stub: export {}
helix-core/src/audit/index.ts           → stub: export {}
helix-core/src/config/index.ts          → stub: export const config = {}
helix-core/src/index.ts                 → REAL: re-exports all modules (keep as-is)
helix-core/src/schemas/index.ts         → stub: export {} (Story 2, do not touch)
helix-core/src/status-list/index.ts     → stub: export {} (Story 2, do not touch)

helix-api/prisma/schema.prisma          → stub: generator + datasource only, no models
helix-api/src/server.ts                 → stub: basic Fastify health endpoint only
helix-api/src/repositories/index.ts    → stub: export {}
helix-api/src/services/did/index.ts    → stub: export {}
helix-api/src/hedera/IHederaClient.ts  → PARTIAL (wrong interface — see Phase 2)
helix-api/src/hedera/mock/MockHederaClient.ts → PARTIAL (matches old interface)
helix-api/src/middleware/errorHandler.ts → stub: placeholder function
helix-api/src/audit/index.ts            → stub: export {}
helix-api/src/routes/did/index.ts       → stub: empty Fastify plugin

helix-sdk-js/src/client/HelixClient.ts  → stub: empty constructor
helix-sdk-js/src/http/HttpAdapter.ts    → stub: empty constructor
```

### Package Dependencies Already Installed

**helix-core/package.json** — `dependencies: { zod: ^3.23.0 }`
- `@noble/curves` NOT installed — must be added
- `@noble/hashes` NOT installed — must be added

**helix-api/package.json** — `dependencies: { fastify, @prisma/client, @helix-id/core, zod, @fastify/sensible }`
- `@hashgraph/sdk` NOT installed — must be added
- `supertest` already in devDependencies ✅
- `vitest` already in devDependencies ✅

### helix-core/src/index.ts (DO NOT MODIFY — shown for reference)
```typescript
export * from './config/index.js';
export * from './crypto/index.js';
export * from './schemas/index.js';
export * from './errors/index.js';
export * from './audit/index.js';
export * from './status-list/index.js';
```

---

## PHASE 1 — helix-core: Errors, Audit Interface, Config, and Crypto (TDD)

### What This Phase Builds
The shared primitives in `helix-core` that every other package depends on. This phase is pure TypeScript logic — no I/O, no network, no database. All crypto is real (no mocks). Tests are written first (TDD).

### Files to Generate (in this order)

1. `helix-core/src/errors/codes.ts` — error code enum
2. `helix-core/src/errors/HelixError.ts` — base class + all B1 convenience constructors
3. `helix-core/src/errors/index.ts` — re-export
4. `helix-core/src/audit/events.ts` — all B1 audit event types and interfaces
5. `helix-core/src/audit/IAuditLogger.ts` — logger interface
6. `helix-core/src/audit/index.ts` — re-export
7. `helix-core/src/config/index.ts` — Zod-validated config singleton
8. **`helix-core/tests/unit/crypto/keys.test.ts`** — WRITE TESTS FIRST
9. `helix-core/src/crypto/keys.ts` — implementation (must make tests pass)
10. **`helix-core/tests/unit/crypto/did.test.ts`** — WRITE TESTS FIRST
11. `helix-core/src/crypto/did.ts` — implementation (must make tests pass)
12. `helix-core/src/crypto/index.ts` — re-export keys.ts and did.ts

### Detailed Specifications

#### 1. `helix-core/src/errors/codes.ts`
Define `ErrorCode` as a TypeScript `const` object (not enum). All values are string literals.

B1 error codes to include:
- `INVALID_PUBLIC_KEY` — public key not valid 32-byte Ed25519
- `INVALID_DID_FORMAT` — string doesn't match `did:helix:<32 hex chars>`
- `DID_NOT_FOUND` — DID not in database or Hedera
- `DID_ALREADY_EXISTS` — public key already has a DID
- `DID_DEACTIVATED` — DID has been deactivated
- `INVALID_SERVICE_ENDPOINT_URL` — not a valid HTTPS URL
- `SERVICE_ENDPOINT_NOT_FOUND` — endpoint ID not in DID document
- `SERVICE_ENDPOINT_ALREADY_EXISTS` — endpoint ID already in DID document
- `HEDERA_ANCHOR_FAILED` — HCS transaction failed or timed out
- `HEDERA_RESOLUTION_FAILED` — topic not found or no messages

General codes:
- `INTERNAL_ERROR` — generic internal error
- `VALIDATION_ERROR` — request body/query params failed schema validation

Export both the object and the derived type: `export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]`

#### 2. `helix-core/src/errors/HelixError.ts`
- Base class `HelixError extends Error` with fields: `code: ErrorCode`, `httpStatus: number`, `details?: Record<string, unknown>`
- Constructor: `(code, message, httpStatus, details?)`
- Convenience subclasses (one per B1 error code):
  - `InvalidPublicKeyError` → 400
  - `InvalidDIDFormatError(did: string)` → 400
  - `DIDNotFoundError(did: string)` → 404
  - `DIDAlreadyExistsError` → 409
  - `DIDDeactivatedError(did: string)` → 410
  - `InvalidServiceEndpointUrlError(url: string)` → 400
  - `ServiceEndpointNotFoundError(endpointId: string)` → 404
  - `ServiceEndpointAlreadyExistsError(endpointId: string)` → 409
  - `HederaAnchorFailedError` → 502
  - `HederaResolutionFailedError` → 502
  - `InternalError` → 500
  - `ValidationError(message: string)` → 400

#### 3. `helix-core/src/audit/events.ts`
Define TypeScript interfaces for all B1 audit events. Every event extends `BaseAuditEvent`:
```typescript
interface BaseAuditEvent {
  timestamp: string;   // ISO 8601
  event: AuditEventType;
  requestId: string;
}
```

B1 event types: `DID_CREATED`, `DID_CREATION_FAILED`, `DID_RESOLVED`, `DID_UPDATED`, `DID_UPDATE_FAILED`, `DID_DEACTIVATED`

Specific event interfaces:
- `DidCreatedEvent`: did, subjectType ('agent'|'user'), hederaTransactionId, publicKeyMultibase
- `DidCreationFailedEvent`: reason, publicKeyMultibase? (optional)
- `DidResolvedEvent`: did, source ('cache'|'hedera')
- `DidUpdatedEvent`: did, updateType ('add_service_endpoint'|'remove_service_endpoint'|'deactivate'), hederaTransactionId
- `DidUpdateFailedEvent`: did, updateType (string), reason
- `DidDeactivatedEvent`: did, reason

Export `B1AuditEvent` as a union of all six. Export `AuditEvent = B1AuditEvent` (will be extended in later stories).

#### 4. `helix-core/src/audit/IAuditLogger.ts`
```typescript
export interface IAuditLogger {
  log(event: AuditEvent): Promise<void>;
}
```

#### 5. `helix-core/src/config/index.ts`
Use Zod to validate all environment variables. Export a singleton `config` object.

Variables to validate:
```
NODE_ENV: enum(['development', 'test', 'production']), default 'development'
PORT: coerce number, 1–65535, default 3000
API_BASE_URL: string url
DATABASE_URL: string min 1
HEDERA_NETWORK: enum(['testnet', 'previewnet', 'mainnet']), default 'testnet'
HEDERA_OPERATOR_ID: string min 1
HEDERA_OPERATOR_KEY: string min 1
HEDERA_TOPIC_ID: string min 1
HELIX_SIGNING_KEY: string min 64
ENROLLMENT_TOKEN_TTL_SECONDS: coerce number, 60–3600, default 900
CHALLENGE_TTL_SECONDS: coerce number, 30–600, default 300
VP_TTL_SECONDS: coerce number, 60–3600, default 300
AUDIT_LOG_DESTINATION: enum(['stdout', 'file', 'both']), default 'stdout'
AUDIT_LOG_PATH: string optional
HEDERA_E2E_TESTNET: string transform to boolean, default false
```

Security guard (SA-9): If `HEDERA_NETWORK === 'mainnet'` and `NODE_ENV !== 'production'`, throw an error at startup.

The config module is the **only** place `process.env` is read. If validation fails, throw a descriptive error listing all invalid fields and exit before the server starts.

#### 6. `helix-core/tests/unit/crypto/keys.test.ts` — WRITE FIRST (TDD)

Test suites to cover (achieving 95%+ branch coverage):

**`generateKeyPair()`**
- Returns 64-char lowercase hex private key and 64-char lowercase hex public key
- Two calls produce different keypairs (uniqueness)
- Private key and public key are different strings

**`derivePublicKey(privateKeyHex)`**
- Derives the same public key that generateKeyPair returns
- Throws on invalid hex input

**`signBytes(message, privateKeyHex)` / `verifySignature(message, signatureHex, publicKeyHex)`**
- Signature verifies with matching public key
- Signature fails with wrong public key (different keypair)
- Signature fails if message bytes are altered
- Returns false (not throws) for malformed signature hex
- Returns false for malformed public key hex

**`publicKeyToMultibase(publicKeyHex)` / `multibaseToPublicKeyHex(multibase)`**
- Roundtrip: encode → decode returns original hex
- Encoded string starts with 'z' (base58btc prefix)
- Throws on non-'z' multibase prefix
- Multiple different keys produce different multibase strings

#### 7. `helix-core/src/crypto/keys.ts` — implementation

Implement using `@noble/curves/ed25519` and `@noble/curves/abstract/utils`.

Functions to export:
```typescript
export interface KeyPair {
  privateKey: string;  // hex-encoded Ed25519 32 bytes
  publicKey: string;   // hex-encoded Ed25519 32 bytes
}
export function generateKeyPair(): KeyPair
export function derivePublicKey(privateKeyHex: string): string
export function signBytes(message: Uint8Array, privateKeyHex: string): string  // hex sig
export function verifySignature(message: Uint8Array, signatureHex: string, publicKeyHex: string): boolean
export function publicKeyToMultibase(publicKeyHex: string): string  // 'z' + base58btc
export function multibaseToPublicKeyHex(multibase: string): string
```

Multicodec prefix for Ed25519: `[0xed, 0x01]` prepended before base58btc encoding.
Base58btc alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`
Implement base58btc encode/decode as private helpers in the same file.
`verifySignature` must catch all exceptions from Noble and return `false` — never throw.

#### 8. `helix-core/tests/unit/crypto/did.test.ts` — WRITE FIRST (TDD)

Test suites to cover:

**`deriveDidFromPublicKey(publicKeyHex)`**
- Returns string matching `/^did:helix:[0-9a-f]{32}$/`
- Same key always produces same DID (deterministic)
- Different keys produce different DIDs

**`buildDIDDocument(did, publicKeyHex, serviceEndpoints?)`**
- `@context` contains `'https://www.w3.org/ns/did/v1'`
- `id` and `controller` equal the DID argument
- `verificationMethod[0].type` equals `'Ed25519VerificationKey2020'`
- `authentication` and `assertionMethod` both contain `'${did}#key-1'`
- `service` is undefined when no endpoints provided
- `service` has correct length when endpoints provided

**`extractPublicKeyFromDIDDocument(document)`**
- Extracts the same public key used to build the document (roundtrip)
- Throws if no Ed25519 verification method present

**`buildServiceEndpoints(domains)`**
- Returns array with correct `id` format (`#domain-1`, `#domain-2`, ...)
- Each entry has `type: 'LinkedDomains'`
- Empty array returns empty array

**`addServiceEndpoint(document, endpoint)`**
- Adds endpoint to document
- Does not mutate original document (immutability)
- Throws 'already exists' if endpoint ID already present

**`removeServiceEndpoint(document, endpointId)`**
- Removes correct endpoint
- Does not mutate original document
- `service` becomes undefined when last endpoint removed
- Throws 'not found' if endpoint ID not present

#### 9. `helix-core/src/crypto/did.ts` — implementation

Functions to export:
```typescript
export interface DIDDocument { ... }
export interface VerificationMethod { ... }
export interface ServiceEndpoint { ... }
export type DIDSubjectType = 'agent' | 'user';

export function deriveDidFromPublicKey(publicKeyHex: string): string
export function buildDIDDocument(did: string, publicKeyHex: string, serviceEndpoints?: ServiceEndpoint[]): DIDDocument
export function extractPublicKeyFromDIDDocument(document: DIDDocument): string
export function buildServiceEndpoints(domains: string[]): ServiceEndpoint[]
export function addServiceEndpoint(document: DIDDocument, endpoint: ServiceEndpoint): DIDDocument
export function removeServiceEndpoint(document: DIDDocument, endpointId: string): DIDDocument
```

DID format: `did:helix:<first 16 bytes of sha256(pubkey) as hex>` = 32 hex chars
Use `sha256` from `@noble/hashes/sha256`.
Use `hexToBytes` from `@noble/curves/abstract/utils` — NOT `Buffer.from` (portability).
`addServiceEndpoint` and `removeServiceEndpoint` must be **pure functions** — return new objects, never mutate.

#### 10. `helix-core/src/crypto/index.ts`
```typescript
export * from './keys.js';
export * from './did.js';
```

### Phase 1 Package.json Changes

**`helix-core/package.json`** — add to `dependencies`:
```json
"@noble/curves": "^1.4.0",
"@noble/hashes": "^1.4.0"
```

### Phase 1 Acceptance Checklist
- [ ] All tests in `keys.test.ts` pass
- [ ] All tests in `did.test.ts` pass
- [ ] Coverage ≥ 95% on `helix-core/src/crypto/`
- [ ] `helix-core` builds with `tsc --noEmit` without errors
- [ ] No `Buffer.from` in `did.ts` (use `hexToBytes`)
- [ ] No `process.env` reads anywhere in helix-core except `config/index.ts`
- [ ] `verifySignature` never throws — always returns boolean
- [ ] `addServiceEndpoint` and `removeServiceEndpoint` are pure (no mutation)

---

## PHASE 2 — helix-api: Infrastructure Layer

### What This Phase Builds
The infrastructure supporting B1: Prisma schema, Hedera client interface and mock, error handler middleware, and audit logger implementation. No business logic yet.

### Files to Generate (in this order)

1. `helix-api/prisma/schema.prisma` — full schema with Did, DidUpdate, AuditLog models
2. `helix-api/src/hedera/IHederaClient.ts` — corrected interface (replaces partial stub)
3. `helix-api/src/hedera/mock/MockHederaClient.ts` — updated mock (replaces partial stub)
4. `helix-api/src/hedera/HederaHCSClient.ts` — production Hedera client (new file)
5. `helix-api/src/middleware/errorHandler.ts` — full implementation (replaces stub)
6. `helix-api/src/audit/index.ts` — ApiAuditLogger implementation (replaces stub)

### Detailed Specifications

#### 1. `helix-api/prisma/schema.prisma`

Keep existing generator and datasource blocks. Add three models:

**`Did` model** (`@@map("dids")`):
```
id                   String    @id @default(cuid())
did                  String    @unique
subjectType          String    // "agent" | "user"
publicKeyMultibase   String
hederaTopicId        String
hederaSequenceNumber Int
hederaTransactionId  String
didDocumentJson      String    // full DID document JSON for fast resolution
deactivated          Boolean   @default(false)
deactivatedAt        DateTime?
createdAt            DateTime  @default(now())
updatedAt            DateTime  @updatedAt
didUpdates           DidUpdate[]
```

**`DidUpdate` model** (`@@map("did_updates")`):
```
id                   String   @id @default(cuid())
didId                String
did                  Did      @relation(fields: [didId], references: [id])
updateType           String   // "add_service_endpoint" | "remove_service_endpoint" | "deactivate"
updatePayloadJson    String
hederaTransactionId  String
createdAt            DateTime @default(now())
```

**`AuditLog` model** (`@@map("audit_log")`):
```
id          String   @id @default(cuid())
timestamp   String
eventType   String
requestId   String
payloadJson String
createdAt   DateTime @default(now())
@@index([eventType])
@@index([requestId])
```

#### 2. `helix-api/src/hedera/IHederaClient.ts`

The current stub has the wrong interface (`resolveDocument` instead of `fetchMessage`, `topicSequenceNumber` is optional). Replace entirely.

Correct interface (per constitution HR-2 and Story 1 spec):

```typescript
export interface HederaTransactionResult {
  transactionId: string;
  sequenceNumber: number;   // required, not optional
  topicId: string;
}

export interface HederaMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  contents: string;  // raw JSON string of anchored document
}

export interface IHederaClient {
  anchorDocument(payload: string): Promise<HederaTransactionResult>;
  fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage>;
}
```

#### 3. `helix-api/src/hedera/mock/MockHederaClient.ts`

Full in-memory implementation. Update to match the new `IHederaClient` interface.

Requirements:
- `anchoredPayloads: string[]` — public array for test assertions
- `anchorDocument` stores payload, increments sequence counter, returns deterministic mock transaction ID: `mock-tx-${seq}-${Date.now()}`
- `fetchMessage` returns stored message or throws if sequence not found
- `reset()` method clears all state (called in `afterEach` in tests)
- Never makes network calls

#### 4. `helix-api/src/hedera/HederaHCSClient.ts`

Production implementation wrapping `@hashgraph/sdk`.

- Constructor reads from `config` (imported from `@helix-id/core`) — never reads `process.env` directly
- Uses `Client.forTestnet()` or `Client.forPreviewnet()` based on `config.HEDERA_NETWORK`
- SA-9 guard: if `config.HEDERA_NETWORK === 'mainnet'` and this is reached somehow, throw
- `anchorDocument`: submits via `TopicMessageSubmitTransaction`, gets receipt, returns `HederaTransactionResult`
- `fetchMessage`: uses Hedera Mirror Node REST API (more reliable than SDK for historical reads)
  - Testnet URL: `https://testnet.mirrornode.hedera.com`
  - Previewnet URL: `https://previewnet.mirrornode.hedera.com`
  - Endpoint: `GET /api/v1/topics/{topicId}/messages/{sequenceNumber}`
  - Mirror Node returns base64-encoded message — decode to UTF-8 string
- Catch all SDK/network errors and rethrow as `HederaAnchorFailedError` or `HederaResolutionFailedError` (imported from `@helix-id/core`)

#### 5. `helix-api/src/middleware/errorHandler.ts`

Full Fastify error handler. Replace placeholder.

Three tiers:
1. `HelixError` instances — use `error.httpStatus`, return structured body with `error.code`
2. Fastify validation errors (`'validation' in error && error.validation`) — return 400 with `VALIDATION_ERROR` code
3. Unknown errors — log full detail internally, return 500 with `INTERNAL_ERROR` code (EH-3: no internal detail in response)

Response shape always:
```json
{ "error": { "code": "...", "message": "...", "requestId": "..." } }
```

`requestId` comes from `request.id` (Fastify assigns this per-request).

Signature: `export function errorHandler(error, request, reply): void`

#### 6. `helix-api/src/audit/index.ts`

`ApiAuditLogger` class implementing `IAuditLogger` from `@helix-id/core`.

- Constructor takes `PrismaClient`
- `log(event)` method:
  1. Serialise event to single-line JSON string
  2. Always write to `prisma.auditLog.create()`
  3. If `config.AUDIT_LOG_DESTINATION === 'stdout'` or `'both'`: write to `process.stdout`
  4. If `config.AUDIT_LOG_DESTINATION === 'file'` or `'both'` and `config.AUDIT_LOG_PATH` set: append to file using `node:fs/promises`
- AL-2 enforcement: never include private keys or raw credential payloads — the event types themselves enforce this since they only have typed fields

### Phase 2 Package.json Changes

**`helix-api/package.json`** — add to `dependencies`:
```json
"@hashgraph/sdk": "^2.50.0"
```

### Phase 2 Acceptance Checklist
- [ ] `prisma validate` passes on the new schema
- [ ] `IHederaClient` has `fetchMessage` (not `resolveDocument`), `sequenceNumber` is required
- [ ] `MockHederaClient` implements new interface, has `reset()` and `anchoredPayloads`
- [ ] `HederaHCSClient` reads from `config`, not `process.env`
- [ ] `errorHandler` returns `{ error: { code, message, requestId } }` for all three error tiers
- [ ] `ApiAuditLogger` writes to DB always, stdout/file based on config
- [ ] No `process.env` reads outside `@helix-id/core`

---

## PHASE 3 — helix-api: B1 Business Logic

### What This Phase Builds
The core DID service, repository, routes, and wired-up server. This is where all the B1 business logic lives.

### Files to Generate (in this order)

1. `helix-api/src/repositories/did.repository.ts` — new file
2. `helix-api/src/repositories/index.ts` — update to export DidRepository
3. `helix-api/src/services/did/did.service.ts` — new file (IDIDService interface + DIDService class)
4. `helix-api/src/services/did/index.ts` — update to export both
5. `helix-api/src/routes/did/index.ts` — full implementation (replaces stub)
6. `helix-api/src/server.ts` — full DI wiring (replaces stub)

### Detailed Specifications

#### 1. `helix-api/src/repositories/did.repository.ts`

Prisma queries only — zero business logic (DB-4).

```typescript
export class DidRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    did: string;
    subjectType: 'agent' | 'user';
    publicKeyMultibase: string;
    hederaTopicId: string;
    hederaSequenceNumber: number;
    hederaTransactionId: string;
    didDocumentJson: string;
  }): Promise<Did>

  async findByDid(did: string): Promise<Did | null>

  async findByPublicKeyMultibase(multibase: string): Promise<Did | null>

  async updateDIDDocument(
    did: string,
    didDocumentJson: string,
    hederaTransactionId: string,
  ): Promise<Did>
  // Updates: didDocumentJson, updatedAt. hederaTransactionId param is stored in DidUpdate, not Did.

  async deactivate(did: string): Promise<Did>
  // Sets deactivated=true, deactivatedAt=new Date()

  async createDidUpdate(data: {
    didId: string;
    updateType: string;
    updatePayloadJson: string;
    hederaTransactionId: string;
  }): Promise<DidUpdate>

  async getDidUpdates(did: string): Promise<DidUpdate[]>
}
```

#### 2. `helix-api/src/services/did/did.service.ts`

Define `IDIDService` interface first (for B4 inter-boundary contract), then `DIDService` class implementing it.

**`IDIDService` interface** (B1 → B2, B4 contract from constitution §7):
```typescript
export interface IDIDService {
  createDID(publicKeyHex: string, subjectType: 'agent' | 'user', domains: string[], requestId: string): Promise<CreateDIDResult>;
  resolveDID(did: string, requestId: string): Promise<ResolveDIDResult>;
  resolveDIDFromHedera(did: string, requestId: string): Promise<ResolveDIDResult>;
  addServiceEndpoint(did: string, endpoint: ServiceEndpoint, requestId: string): Promise<DIDDocument>;
  removeServiceEndpoint(did: string, endpointId: string, requestId: string): Promise<DIDDocument>;
  deactivateDID(did: string, reason: string, requestId: string): Promise<void>;
}
```

**`DIDService` class** — constructor takes `(didRepository: DidRepository, hederaClient: IHederaClient, auditLogger: IAuditLogger)`.

**`createDID` flow:**
1. `validatePublicKey(publicKeyHex)` — must be 64 hex chars `/^[0-9a-f]{64}$/i`
2. `validateServiceEndpointUrls(domains)` — each must be valid HTTPS URL
3. `publicKeyToMultibase(publicKeyHex)` from `@helix-id/core`
4. Check `didRepository.findByPublicKeyMultibase(multibase)` — if found, emit `DID_CREATION_FAILED` audit, throw `DIDAlreadyExistsError`
5. `deriveDidFromPublicKey(publicKeyHex)` from `@helix-id/core`
6. `buildServiceEndpoints(domains)` → `buildDIDDocument(did, publicKeyHex, endpoints)`
7. `hederaClient.anchorDocument(JSON.stringify(didDocument))` — on failure emit `DID_CREATION_FAILED`, throw `HederaAnchorFailedError`
8. `didRepository.create(...)` 
9. Emit `DID_CREATED` audit event
10. Return `{ did, didDocument, hederaTransactionId }`

**`resolveDID` flow (cache):**
1. `validateDIDFormat(did)`
2. `didRepository.findByDid(did)` — if null throw `DIDNotFoundError`
3. If `record.deactivated` throw `DIDDeactivatedError`
4. Parse `record.didDocumentJson`
5. Emit `DID_RESOLVED` audit with `source: 'cache'`
6. Return result

**`resolveDIDFromHedera` flow (live):**
1. `validateDIDFormat(did)`
2. `didRepository.findByDid(did)` — need topicId and sequenceNumber
3. `hederaClient.fetchMessage(record.hederaTopicId, record.hederaSequenceNumber)`
4. Parse message contents
5. Emit `DID_RESOLVED` audit with `source: 'hedera'`
6. Return result

**`addServiceEndpoint` flow:**
1. `validateDIDFormat(did)`, `validateServiceEndpointUrl(endpoint.serviceEndpoint)`
2. `getActiveRecord(did)` — throws `DIDNotFoundError` or `DIDDeactivatedError`
3. `addServiceEndpoint(current, endpoint)` from `@helix-id/core` — catch 'already exists', throw `ServiceEndpointAlreadyExistsError`
4. Anchor updated document on Hedera
5. `didRepository.updateDIDDocument(...)`, `didRepository.createDidUpdate(...)`
6. Emit `DID_UPDATED` audit
7. Return updated document

**`removeServiceEndpoint` flow:**
1. `validateDIDFormat(did)`
2. `getActiveRecord(did)`
3. `removeServiceEndpoint(current, endpointId)` from `@helix-id/core` — catch 'not found', throw `ServiceEndpointNotFoundError`
4. Anchor updated document
5. Update DB, create update record
6. Emit `DID_UPDATED` audit
7. Return updated document

**`deactivateDID` flow:**
1. `validateDIDFormat(did)`
2. `getActiveRecord(did)`
3. Anchor deactivated document on Hedera — `.catch(() => {})` (Hedera failure does NOT block local deactivation — DB record is authoritative)
4. `didRepository.deactivate(did)`
5. Emit `DID_DEACTIVATED` audit

**Private helpers:**
- `getActiveRecord(did)` — finds record, throws if null or deactivated
- `anchorUpdate(document)` — wraps hederaClient.anchorDocument, rethrows as HederaAnchorFailedError
- `validatePublicKey(hex)` — regex + length check
- `validateDIDFormat(did)` — regex `/^did:helix:[0-9a-f]{32}$/`
- `validateServiceEndpointUrl(url)` — URL parse + protocol check
- Import `InvalidDIDFormatError` explicitly — this was a bug in the Story 1 spec (it was missing from imports)

#### 3. `helix-api/src/routes/did/index.ts`

Fastify plugin. Replace empty stub.

JSON Schema inline on every route (AC-4). All schemas derived from the OpenAPI spec.

Routes to register:
- `POST /v1/dids` → `didService.createDID()` → 201
- `GET /v1/dids/:did` → `didService.resolveDID()` or `resolveDIDFromHedera()` based on `?live=true` → 200
- `POST /v1/dids/:did/services` → `didService.addServiceEndpoint()` → 200
- `DELETE /v1/dids/:did/services/:endpointId` → `didService.removeServiceEndpoint()` → 200
- `POST /v1/dids/:did/deactivate` → `didService.deactivateDID()` → 200

Plugin receives `{ didService: IDIDService }` as options (uses interface, not concrete class — boundary import rule).

Request `id` is passed to all service calls as `requestId`.

Schemas:
```
POST /v1/dids body:
  - publicKeyHex: string, pattern '^[0-9a-fA-F]{64}$', required
  - subjectType: enum ['agent', 'user'], required
  - domains: array of strings matching '^https://', maxItems 10, optional
  additionalProperties: false

GET /v1/dids/:did params:
  - did: string, pattern '^did:helix:[0-9a-f]{32}$'
  querystring:
  - live: boolean, default false

POST /v1/dids/:did/services body:
  - id: string, pattern '^#[a-zA-Z0-9\\-]+$', required
  - type: enum ['LinkedDomains'], required
  - serviceEndpoint: string, pattern '^https://', required
  additionalProperties: false

DELETE /v1/dids/:did/services/:endpointId params:
  - did: string, pattern '^did:helix:[0-9a-f]{32}$'
  - endpointId: string, pattern '^#[a-zA-Z0-9\\-]+$'

POST /v1/dids/:did/deactivate body:
  - reason: string, minLength 1, maxLength 500, required
  additionalProperties: false
```

#### 4. `helix-api/src/server.ts`

Full Fastify server. Replace basic stub.

```typescript
const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.body.privateKey'],
  },
  genReqId: () => `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
});
```

Wiring:
1. `app.setErrorHandler(errorHandler)`
2. `const prisma = new PrismaClient()`
3. `const hederaClient = new HederaHCSClient()`
4. `const auditLogger = new ApiAuditLogger(prisma)`
5. `const didRepository = new DidRepository(prisma)`
6. `const didService = new DIDService(didRepository, hederaClient, auditLogger)`
7. `await app.register(didRoutes, { didService })`
8. `app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }))`

Graceful shutdown:
```typescript
const shutdown = async () => { await app.close(); await prisma.$disconnect(); };
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
```

Server start: `app.listen({ port: config.PORT, host: '0.0.0.0' })`

### Phase 3 Acceptance Checklist
- [ ] `IDIDService` interface is exported from `services/did/did.service.ts`
- [ ] `DIDService` constructor takes interfaces, not concrete classes (except DidRepository which is internal to API)
- [ ] Routes use `IDIDService` type for options, not `DIDService`
- [ ] `server.ts` is the only file that instantiates concrete classes
- [ ] `InvalidDIDFormatError` is imported in `did.service.ts`
- [ ] `deactivateDID` Hedera anchor failure is swallowed (DB is authoritative)
- [ ] All 5 routes registered with correct HTTP methods and paths
- [ ] `genReqId` uses `crypto.randomUUID()`
- [ ] Logger redacts `req.body.privateKey` (SA-8)

---

## PHASE 4 — helix-sdk-js: DID Methods

### What This Phase Builds
The SDK's DID-related methods. Key generation happens in the SDK (client-side). Only public key is sent to API. Error mapping from API codes to typed SDK errors.

### Files to Generate (in this order)

1. `helix-sdk-js/src/http/HttpAdapter.ts` — full implementation (replaces stub)
2. `helix-sdk-js/src/client/HelixClient.ts` — DID methods (replaces stub)

### Detailed Specifications

#### 1. `helix-sdk-js/src/http/HttpAdapter.ts`

Internal HTTP adapter. All network calls from SDK go through here.

```typescript
export class HttpAdapter {
  constructor(private readonly baseUrl: string) {}

  async get<T>(path: string): Promise<T>
  async post<T>(path: string, body?: unknown): Promise<T>
  async delete<T>(path: string): Promise<T>
  private async request<T>(method: string, path: string, body?: unknown): Promise<T>
  private mapErrorResponse(data: unknown): HelixError
}
```

`request` method:
- Uses native `fetch`
- Sets `Content-Type: application/json`
- On non-ok response: call `mapErrorResponse(await response.json())`

`mapErrorResponse` — maps API error codes to typed SDK errors (EH-6):
```
DID_NOT_FOUND          → DIDNotFoundError
DID_ALREADY_EXISTS     → DIDAlreadyExistsError
DID_DEACTIVATED        → DIDDeactivatedError
INVALID_PUBLIC_KEY     → InvalidPublicKeyError
HEDERA_ANCHOR_FAILED   → HederaAnchorFailedError
VALIDATION_ERROR       → ValidationError(message)
(default)              → InternalError
```

All error classes imported from `@helix-id/core`.

#### 2. `helix-sdk-js/src/client/HelixClient.ts`

Public SDK surface. DID methods implemented.

```typescript
export interface CreateDIDOptions {
  subjectType: 'agent' | 'user';
  domains?: string[];
}

export interface CreateDIDResult {
  did: string;
  keyPair: KeyPair;
  didDocument: DIDDocument;
  hederaTransactionId: string;
}

export interface ResolveDIDOptions {
  live?: boolean;
}

export class HelixClient {
  constructor(
    private readonly http: HttpAdapter,
    private readonly baseUrl: string,
  ) {}

  async createDID(options: CreateDIDOptions): Promise<CreateDIDResult>
  async resolveDID(did: string, options?: ResolveDIDOptions): Promise<{ did: string; didDocument: DIDDocument; source: 'cache' | 'hedera' }>
  async addServiceEndpoint(did: string, endpoint: { id: string; type: 'LinkedDomains'; serviceEndpoint: string }): Promise<{ did: string; didDocument: DIDDocument }>
  async removeServiceEndpoint(did: string, endpointId: string): Promise<{ did: string; didDocument: DIDDocument }>
  async deactivateDID(did: string, reason: string): Promise<{ did: string; deactivated: true }>
}
```

**`createDID` critical requirement (SA-1, SA-2):**
```typescript
const keyPair = generateKeyPair(); // local, never transmitted
const response = await this.http.post('/v1/dids', {
  publicKeyHex: keyPair.publicKey,  // only public key sent
  subjectType: options.subjectType,
  domains: options.domains ?? [],
});
return { ...response, keyPair };   // keyPair returned to caller to store
```

`resolveDID`: appends `?live=true` if `options.live === true`

`removeServiceEndpoint`: URL-encodes the `endpointId` with `encodeURIComponent` (handles `#` prefix)

Import `generateKeyPair`, `KeyPair`, `DIDDocument` from `@helix-id/core`.

### Phase 4 Acceptance Checklist
- [ ] `createDID` generates keypair locally — private key never passed to `http.post()`
- [ ] `mapErrorResponse` handles all B1 error codes
- [ ] `removeServiceEndpoint` URL-encodes endpointId
- [ ] `HelixClient` constructor takes `HttpAdapter` (dependency injection)
- [ ] No `process.env` reads in SDK files

---

## PHASE 5 — Tests: Integration and Security

### What This Phase Builds
All integration tests and security tests for helix-api B1. These tests use real PostgreSQL (via Docker Compose) and `MockHederaClient`. No real Hedera calls.

### Files to Generate

1. `helix-api/tests/integration/did.integration.test.ts`
2. `helix-api/tests/security/did.security.test.ts`

### Test Setup Pattern (both files)

```typescript
let app: ReturnType<typeof Fastify>;
let prisma: PrismaClient;
let mockHedera: MockHederaClient;

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });
  mockHedera = new MockHederaClient();
  const auditLogger = new ApiAuditLogger(prisma);
  const didRepository = new DidRepository(prisma);
  const didService = new DIDService(didRepository, mockHedera, auditLogger);
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(didRoutes, { didService });
  await app.ready();
});

afterEach(async () => {
  // Clean state between tests — prevents pollution
  await prisma.auditLog.deleteMany();
  await prisma.didUpdate.deleteMany();
  await prisma.did.deleteMany();
  mockHedera.reset();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
```

### Integration Tests — `did.integration.test.ts`

#### `POST /v1/dids`
- ✅ Creates DID and returns 201 with `did`, `didDocument`, `hederaTransactionId`
- ✅ DID matches pattern `/^did:helix:[0-9a-f]{32}$/`
- ✅ `didDocument.id` equals the returned `did`
- ✅ Creates DID with service endpoints — `didDocument.service` has correct length
- ✅ Returns 409 with `DID_ALREADY_EXISTS` when same public key submitted twice
- ✅ Returns 400 with `VALIDATION_ERROR` for public key shorter than 64 chars
- ✅ Returns 400 for non-hex characters in public key
- ✅ Returns 400 with `INVALID_SERVICE_ENDPOINT_URL` for http:// service endpoint
- ✅ `mockHedera.anchoredPayloads` has length 1 after creation (document was anchored)
- ✅ Anchored payload parses as valid JSON with `@context` field
- ✅ `DID_CREATED` audit log entry written to DB after creation
- ✅ Audit log entry does NOT contain the string `privateKey` (SA-8)

#### `GET /v1/dids/:did`
- ✅ Resolves existing DID, returns 200 with `source: 'cache'`
- ✅ Returns 404 with `DID_NOT_FOUND` for unknown DID
- ✅ Returns 400 for malformed DID format
- ✅ Returns 410 with `DID_DEACTIVATED` after deactivation

#### `POST /v1/dids/:did/services`
- ✅ Adds service endpoint, returns 200 with updated `didDocument.service`
- ✅ `mockHedera.anchoredPayloads` has length 2 after create + add (re-anchored)
- ✅ Returns 409 with `SERVICE_ENDPOINT_ALREADY_EXISTS` for duplicate endpoint ID

#### `DELETE /v1/dids/:did/services/:endpointId`
- ✅ Removes service endpoint, `didDocument.service` becomes undefined after removing last
- ✅ Returns 404 with `SERVICE_ENDPOINT_NOT_FOUND` for missing endpoint

#### `POST /v1/dids/:did/deactivate`
- ✅ Returns 200 with `{ did, deactivated: true }`
- ✅ Subsequent GET returns 410
- ✅ `DID_DEACTIVATED` audit entry written to DB

### Security Tests — `did.security.test.ts`

**CRITICAL: No `test.skip`, `xit`, or `it.todo` anywhere in this file. SA-10.**

#### `SECURITY: DID deduplication prevents key reuse`
- Submit same public key twice (second with different `subjectType`)
- Second returns 409 `DID_ALREADY_EXISTS`
- DB count of `did` records is exactly 1

#### `SECURITY: Deactivated DID is fully blocked`
- Create DID, deactivate it
- GET returns 410 (not resolvable)
- POST to `/services` returns 410 (cannot add service endpoint)
- POST to `/deactivate` again returns 410 (already deactivated)

#### `SECURITY: Audit log contains no private key material`
- Create a DID
- Query all audit log entries
- Assert no entry's `payloadJson` contains the string `privateKey` (case-insensitive)
- Assert no entry's `payloadJson` matches `/[0-9a-f]{64}/` pattern that would indicate a raw 64-hex private key
  - Note: the publicKeyMultibase IS base58 (starts with 'z'), not hex, so the hex pattern won't match it
  - The DID identifier is only 32 hex chars, also won't match

#### `SECURITY: DID_DEACTIVATED audit entry written on deactivation`
- Create DID, deactivate with reason `'key lost'`
- Query `auditLog` where `eventType = 'DID_DEACTIVATED'`
- Assert entry exists
- Assert `JSON.parse(payloadJson).reason === 'key lost'`

#### `SECURITY: Non-HTTPS service endpoints are rejected`
- `http://` domain returns 400 `INVALID_SERVICE_ENDPOINT_URL`, zero DID records created
- `ftp://` domain returns 400
- `https://` domain succeeds

#### `SECURITY: Service endpoint operations respect deactivation`
- Create DID, add service endpoint (succeeds)
- Deactivate DID
- Attempt to add another service endpoint → 410
- Attempt to remove existing service endpoint → 410

### Phase 5 Acceptance Checklist
- [ ] No `test.skip`, `xit`, `it.todo` in `did.security.test.ts`
- [ ] `afterEach` truncates `auditLog`, `didUpdate`, `did` tables
- [ ] `mockHedera.reset()` called in `afterEach`
- [ ] Security test for private key in logs uses both string and regex checks
- [ ] All happy paths AND all error paths covered in integration tests
- [ ] Integration tests import `generateKeyPair` from `@helix-id/core`

---

## PHASE 6 — OpenAPI Spec and Package Dependency Updates

### What This Phase Builds
The OpenAPI specification for all B1 endpoints (AC-1 — spec is the source of truth), and all package.json updates needed to install the new dependencies.

### Files to Generate

1. `helix-core/src/openapi/openapi.yaml` — B1 endpoints (update existing file)
2. `helix-core/package.json` — add `@noble/curves` and `@noble/hashes`
3. `helix-api/package.json` — add `@hashgraph/sdk`

### OpenAPI Spec Requirements

Full OpenAPI 3.1.0 spec. Must include:

**Endpoints:**
- `GET /health` — health check
- `POST /v1/dids` — create DID
- `GET /v1/dids/{did}` — resolve DID (with `?live` query param)
- `POST /v1/dids/{did}/services` — add service endpoint
- `DELETE /v1/dids/{did}/services/{endpointId}` — remove service endpoint
- `POST /v1/dids/{did}/deactivate` — deactivate DID

**Request/response schemas to define:**
- `CreateDIDRequest` — `publicKeyHex` (pattern `^[0-9a-fA-F]{64}$`), `subjectType` (enum), `domains` (optional array)
- `CreateDIDResponse` — `did`, `didDocument`, `hederaTransactionId`
- `ResolveDIDResponse` — `did`, `didDocument`, `source` (enum `cache|hedera`)
- `AddServiceEndpointRequest` — `id` (pattern `^#[a-zA-Z0-9\-]+$`), `type` (enum `LinkedDomains`), `serviceEndpoint`
- `UpdateDIDResponse` — `did`, `didDocument`, `hederaTransactionId`
- `DeactivateDIDRequest` — `reason` (string, 1–500 chars)
- `DeactivateDIDResponse` — `did`, `deactivated` (boolean, const true)
- `DIDDocument` — full W3C DID document shape
- `VerificationMethod` — `id`, `type`, `controller`, `publicKeyMultibase`
- `ServiceEndpoint` — `id`, `type`, `serviceEndpoint`
- `ErrorResponse` — `error: { code, message, requestId }`

**Reusable components:**
- `DIDParam` path parameter — pattern `^did:helix:[0-9a-f]{32}$`
- `ValidationError` response (400)
- `NotFoundError` response (404)
- `ConflictError` response (409)
- `GoneError` response (410)
- `HederaError` response (502)

**HTTP status codes:**
- `POST /v1/dids` → 201 (created), 400 (validation), 409 (conflict), 502 (Hedera)
- `GET /v1/dids/{did}` → 200, 400, 404, 410
- `POST /v1/dids/{did}/services` → 200, 400, 404, 409, 410
- `DELETE /v1/dids/{did}/services/{endpointId}` → 200, 404, 410
- `POST /v1/dids/{did}/deactivate` → 200, 404, 410

### Package.json Changes

**`helix-core/package.json`** — add to `dependencies`:
```json
"@noble/curves": "^1.4.0",
"@noble/hashes": "^1.4.0"
```

**`helix-api/package.json`** — add to `dependencies`:
```json
"@hashgraph/sdk": "^2.50.0"
```

### Phase 6 Acceptance Checklist
- [ ] Every B1 endpoint has an OpenAPI entry
- [ ] DID path parameter pattern matches implementation: `^did:helix:[0-9a-f]{32}$`
- [ ] `publicKeyHex` pattern is `^[0-9a-fA-F]{64}$` (case-insensitive hex)
- [ ] All response schemas are complete — no `type: object` without properties
- [ ] Error responses all use `$ref: '#/components/responses/...'`
- [ ] `helix-core/package.json` has `@noble/curves` and `@noble/hashes` in dependencies
- [ ] `helix-api/package.json` has `@hashgraph/sdk` in dependencies

---

## STORY 1 DEFINITION OF DONE CHECKLIST

Use this checklist to verify Story 1 is complete after all 6 phases:

### API Endpoints
- [ ] `POST /v1/dids` creates a DID, anchors on Hedera mock, returns DID + DID document + Hedera transaction ID
- [ ] `GET /v1/dids/:did` resolves from DB cache; `?live=true` resolves from Hedera
- [ ] `POST /v1/dids/:did/services` adds service endpoint and re-anchors
- [ ] `DELETE /v1/dids/:did/services/:endpointId` removes service endpoint and re-anchors
- [ ] `POST /v1/dids/:did/deactivate` deactivates DID — all subsequent ops return 410

### Architecture
- [ ] `IDIDService` interface exported from `services/did/did.service.ts`
- [ ] Routes use `IDIDService`, not `DIDService` concrete class
- [ ] `server.ts` is the only file with concrete class instantiation
- [ ] No `process.env` reads outside `helix-core/src/config/index.ts`
- [ ] `helix-core` has no imports from `helix-api` or `helix-sdk-js`

### Errors
- [ ] All error codes in `helix-core/src/errors/codes.ts`
- [ ] All error responses match `{ error: { code, message, requestId } }` shape
- [ ] `InvalidDIDFormatError` imported and used in `did.service.ts`

### Audit
- [ ] `DID_CREATED`, `DID_CREATION_FAILED`, `DID_RESOLVED`, `DID_UPDATED`, `DID_DEACTIVATED` all emitted
- [ ] Integration tests assert audit entries via DB queries
- [ ] No private key in any audit entry (verified by security tests)

### Tests
- [ ] `helix-core/tests/unit/crypto/keys.test.ts` — all passing, ≥ 95% coverage
- [ ] `helix-core/tests/unit/crypto/did.test.ts` — all passing, ≥ 95% coverage
- [ ] `helix-api/tests/integration/did.integration.test.ts` — all passing
- [ ] `helix-api/tests/security/did.security.test.ts` — all passing, none skipped
- [ ] `MockHederaClient` used in all tests — no real Hedera calls in CI

### Build
- [ ] `helix-core` builds: `tsc --noEmit` clean
- [ ] `helix-api` builds: `tsc --noEmit` clean
- [ ] `helix-sdk-js` builds: `tsc --noEmit` clean
- [ ] OpenAPI spec complete for all B1 endpoints

### Dependencies
- [ ] `@noble/curves` and `@noble/hashes` in `helix-core/package.json`
- [ ] `@hashgraph/sdk` in `helix-api/package.json`
- [ ] `docs/decisions.md` already has entries for all three (verified ✅)

---

## APPENDIX A — Known Bugs in Story 1 Spec (Fix in Implementation)

These are bugs in the original `STORY_1.md` spec that must be corrected in the generated code:

1. **Missing import in `did.service.ts`**: `InvalidDIDFormatError` used in `validateDIDFormat()` but not listed in imports. Must be added.

2. **`Buffer.from` in `did.ts`**: `deriveDidFromPublicKey` uses `Buffer.from(publicKeyHex, 'hex')` which breaks in non-Node environments. Use `hexToBytes` from `@noble/curves/abstract/utils` instead.

3. **`AuditLog` schema not in Phase 1**: The `AuditLog` Prisma model must be added in Phase 2 alongside `Did` and `DidUpdate` in a single schema file and single migration.

4. **`DidRepository.updateDIDDocument` unused parameter**: The method signature accepts `hederaTransactionId` but the Story 1 spec's Prisma call doesn't use it. Either remove the parameter or store it. Resolution: keep the parameter but do NOT store it on the `Did` record — it belongs in `DidUpdate`. The parameter exists because the service passes it through to `createDidUpdate` in the same operation.

5. **`DIDNotFoundError` constructor mismatch in SDK**: `HttpAdapter.mapErrorResponse` passes the error message string to `DIDNotFoundError` but the constructor expects a `did` string. Use the message as-is since the SDK doesn't have the original DID at that point.

---

## APPENDIX B — File Tree After Story 1 Complete

```
helix-core/
└── src/
    ├── crypto/
    │   ├── keys.ts          ← NEW
    │   ├── did.ts           ← NEW
    │   └── index.ts         ← UPDATED
    ├── errors/
    │   ├── codes.ts         ← NEW
    │   ├── HelixError.ts    ← NEW
    │   └── index.ts         ← UPDATED
    ├── audit/
    │   ├── events.ts        ← NEW
    │   ├── IAuditLogger.ts  ← NEW
    │   └── index.ts         ← UPDATED
    ├── config/
    │   └── index.ts         ← UPDATED
    ├── openapi/
    │   └── openapi.yaml     ← UPDATED
    ├── schemas/             ← UNTOUCHED (Story 2)
    ├── status-list/         ← UNTOUCHED (Story 2)
    └── index.ts             ← UNTOUCHED
└── tests/
    └── unit/
        └── crypto/
            ├── keys.test.ts ← NEW
            └── did.test.ts  ← NEW

helix-api/
├── prisma/
│   └── schema.prisma        ← UPDATED (3 models added)
└── src/
    ├── hedera/
    │   ├── IHederaClient.ts          ← UPDATED
    │   ├── HederaHCSClient.ts        ← NEW
    │   └── mock/MockHederaClient.ts  ← UPDATED
    ├── middleware/
    │   └── errorHandler.ts           ← UPDATED
    ├── audit/
    │   └── index.ts                  ← UPDATED
    ├── repositories/
    │   ├── did.repository.ts         ← NEW
    │   └── index.ts                  ← UPDATED
    ├── services/
    │   └── did/
    │       ├── did.service.ts        ← NEW (IDIDService + DIDService)
    │       └── index.ts              ← UPDATED
    ├── routes/
    │   └── did/
    │       └── index.ts              ← UPDATED
    └── server.ts                     ← UPDATED
└── tests/
    ├── integration/
    │   └── did.integration.test.ts   ← NEW
    └── security/
        └── did.security.test.ts      ← NEW

helix-sdk-js/
└── src/
    ├── client/
    │   └── HelixClient.ts    ← UPDATED
    └── http/
        └── HttpAdapter.ts    ← UPDATED
```

---

_End of Helix ID Story 1 Implementation Prompts_
_Reference: STORY_1.md + constitution.md must be prepended to each phase prompt_
_Total files: 27 across 6 phases_
