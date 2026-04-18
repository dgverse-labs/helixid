# STORY 4 — Boundary 4: Agent & User Flows

## Overview

B4 is the orchestration boundary. It does not own any primitives — it calls B1, B2, and B3 to implement the human-facing flows: agent onboarding, user DID verification, and the service registry. B4 is the only boundary that the SDK's human-facing methods call directly.

---

## What to Mock So This Story Can Start

B4 depends on B1, B2, and B3. All are mocked via injectable interfaces:

- **Mock IDIDService:** `createDID` returns `{ did: 'did:hedera:testnet:testid', hederaTransactionId: 'mock-tx-1' }`. `resolveDID` returns a fixed DID document with a known test keypair. Configurable to throw `DIDNotFoundError` for negative tests.
- **Mock IVCService:** `issueVC` returns a hardcoded signed VC. `getVCStatus` returns `'active'`.
- **Mock IVPService:** `generateVPTemplate` returns a hardcoded unsigned VP.

All mocks are constructor-injected. The real implementations are wired in `server.ts`.

---

## 4.1 — Database Schema

Add to `helix-api/prisma/schema.prisma`:

```prisma
model EnrollmentToken {
  id               String    @id @default(cuid())
  // SHA-256 hash of the raw token — raw value never stored
  tokenHash        String    @unique
  agentName        String
  requestedScopes  String    // JSON array string
  requestedDomains String    // JSON array string
  expiresAt        DateTime
  usedAt           DateTime?
  createdAt        DateTime  @default(now())

  challenges       Challenge[]

  @@map("enrollment_tokens")
}

model Challenge {
  id                  String           @id @default(cuid())
  challengeId         String           @unique  // format: chal:<cuid>
  nonce               String           // 32-byte random hex
  did                 String
  purpose             String           // "agent_onboarding" | "user_verification"
  // Only present for agent_onboarding challenges
  pendingPublicKeyHex String?
  pendingDomains      String?          // JSON array string
  expiresAt           DateTime
  verifiedAt          DateTime?
  createdAt           DateTime         @default(now())

  enrollmentToken     EnrollmentToken? @relation(fields: [enrollmentTokenId], references: [id])
  enrollmentTokenId   String?

  @@map("challenges")
}

model ServiceRegistry {
  id                 String   @id @default(cuid())
  serviceName        String   @unique  // e.g. "amazon"
  displayName        String
  verifiedDomain     String
  publicKeyMultibase String
  apiEndpoint        String
  metadata           String   // JSON string
  active             Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@map("service_registry")
}
```

Run migration: `npx prisma migrate dev --name add_agent_user_flow_tables`

---

## 4.2 — helix-core Additions

### Error Codes to Add — `helix-core/src/errors/codes.ts`

```typescript
// B4 — Agent & User Flows
ENROLLMENT_TOKEN_NOT_FOUND: 'ENROLLMENT_TOKEN_NOT_FOUND',
ENROLLMENT_TOKEN_EXPIRED: 'ENROLLMENT_TOKEN_EXPIRED',
ENROLLMENT_TOKEN_ALREADY_USED: 'ENROLLMENT_TOKEN_ALREADY_USED',
CHALLENGE_NOT_FOUND: 'CHALLENGE_NOT_FOUND',
CHALLENGE_EXPIRED: 'CHALLENGE_EXPIRED',
CHALLENGE_ALREADY_VERIFIED: 'CHALLENGE_ALREADY_VERIFIED',
CHALLENGE_SIGNATURE_INVALID: 'CHALLENGE_SIGNATURE_INVALID',
AGENT_ALREADY_ONBOARDED: 'AGENT_ALREADY_ONBOARDED',
SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
SERVICE_ALREADY_EXISTS: 'SERVICE_ALREADY_EXISTS',
```

Convenience error classes:

| Class | Code | HTTP |
|---|---|---|
| `EnrollmentTokenNotFoundError` | `ENROLLMENT_TOKEN_NOT_FOUND` | 404 |
| `EnrollmentTokenExpiredError` | `ENROLLMENT_TOKEN_EXPIRED` | 400 |
| `EnrollmentTokenAlreadyUsedError` | `ENROLLMENT_TOKEN_ALREADY_USED` | 400 |
| `ChallengeNotFoundError` | `CHALLENGE_NOT_FOUND` | 404 |
| `ChallengeExpiredError` | `CHALLENGE_EXPIRED` | 410 |
| `ChallengeAlreadyVerifiedError` | `CHALLENGE_ALREADY_VERIFIED` | 409 |
| `ChallengeSignatureInvalidError` | `CHALLENGE_SIGNATURE_INVALID` | 400 |
| `AgentAlreadyOnboardedError` | `AGENT_ALREADY_ONBOARDED` | 409 |
| `ServiceNotFoundError` | `SERVICE_NOT_FOUND` | 404 |
| `ServiceAlreadyExistsError` | `SERVICE_ALREADY_EXISTS` | 409 |

### Audit Events to Add — `helix-core/src/audit/events.ts`

```
ENROLLMENT_TOKEN_GENERATED  — fields: tokenIdHash, agentName, requestedScopes, expiresAt
ENROLLMENT_TOKEN_CONSUMED   — fields: tokenIdHash, agentDid, timestamp
ENROLLMENT_TOKEN_REJECTED   — fields: tokenIdHash, reason, timestamp
CHALLENGE_ISSUED            — fields: challengeId, did, purpose, expiresAt
CHALLENGE_VERIFIED          — fields: challengeId, did, purpose, success: true
CHALLENGE_REJECTED          — fields: challengeId, reason, timestamp
AGENT_ONBOARDED             — fields: agentDid, agentName, hederaTransactionId
USER_DID_VERIFIED           — fields: userDid, timestamp
```

**Token audit log security (AL-2):** The raw enrollment token is shown once in the API response. After generation, only `tokenIdHash` (SHA-256 of raw token, hex-encoded) is stored and logged. Audit entries must never contain the raw token value.

---

## 4.3 — API Endpoints

### OpenAPI Spec — add to `helix-core/src/openapi/openapi.yaml` before implementation

**Endpoints:**

- `POST /v1/enrollment-tokens` — generate enrollment token
- `POST /v1/onboard` — agent onboarding step 1 (token + public key → challenge)
- `POST /v1/onboard/verify` — agent onboarding step 2 (challenge response → DID + VC)
- `POST /v1/challenges` — issue challenge for user verification
- `POST /v1/challenges/{challengeId}/verify` — verify a challenge
- `GET /v1/services` — list service registry
- `GET /v1/services/{serviceName}` — get service details
- `POST /v1/services` — register a service (admin)

---

### `POST /v1/enrollment-tokens` — Generate Enrollment Token

Called by agent owner via dashboard or API.

**Request:**

```json
{
  "agentName": "My Shopping Agent",
  "requestedScopes": ["read:orders", "write:orders"],
  "requestedDomains": ["https://myagent.example.com"]
}
```

Validation: `agentName` string min 1 max 200. `requestedScopes` array, each must match `SCOPE_PATTERN`. `requestedDomains` array of HTTPS URLs, max 10, optional.

**Response 201:**

```json
{
  "token": "enroll:abc123xyz...",
  "expiresAt": "2025-06-01T12:15:00Z"
}
```

**Service behaviour:**

1. Generate `rawToken = 'enroll:' + cuid()`
2. `tokenHash = sha256(Buffer.from(rawToken)).toString('hex')`
3. Store `tokenHash`, `agentName`, `requestedScopes`, `requestedDomains`, `expiresAt` (now + `ENROLLMENT_TOKEN_TTL_SECONDS`)
4. Emit `ENROLLMENT_TOKEN_GENERATED` with `tokenIdHash` only — never raw token
5. Return `rawToken` in response — this is the only time it is visible

**Error cases:** 400 `VALIDATION_ERROR`

---

### `POST /v1/onboard` — Agent Onboarding Step 1

Agent calls this with the enrollment token received from the agent owner.

**Request:**

```json
{
  "enrollmentToken": "enroll:abc123xyz...",
  "publicKeyHex": "<64 hex chars>",
  "domains": ["https://myagent.example.com"]
}
```

**Response 200:**

```json
{
  "challengeId": "chal:abc123",
  "nonce": "<32-byte hex>",
  "expiresAt": "2025-06-01T12:05:00Z"
}
```

**Service behaviour:**

1. Hash submitted token: `sha256(Buffer.from(enrollmentToken)).toString('hex')`
2. Look up by `tokenHash` — throw `EnrollmentTokenNotFoundError` if not found
3. If `usedAt` is not null → throw `EnrollmentTokenAlreadyUsedError` (SA-3: token burned on first use)
4. If `expiresAt` < now → throw `EnrollmentTokenExpiredError`; emit `ENROLLMENT_TOKEN_REJECTED` with reason `'expired'`
5. Validate `publicKeyHex` format (64 hex chars, valid Ed25519 key)
6. Validate each domain in `domains` is HTTPS URL
7. **Burn token immediately:** `UPDATE enrollment_tokens SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL` — check 1 row updated. If 0 rows updated, concurrent request consumed it first → throw `EnrollmentTokenAlreadyUsedError`
8. Generate challenge: `challengeId = 'chal:' + cuid()`, `nonce = crypto.randomBytes(32).toString('hex')`
9. Store challenge with `pendingPublicKeyHex`, `pendingDomains`, `enrollmentTokenId`, `purpose: 'agent_onboarding'`, `expiresAt = now + CHALLENGE_TTL_SECONDS`
10. Emit `ENROLLMENT_TOKEN_CONSUMED` with `tokenIdHash`
11. Emit `CHALLENGE_ISSUED`
12. Return `challengeId` + `nonce` + `expiresAt`

**Error cases:** 400 `VALIDATION_ERROR`, 404 `ENROLLMENT_TOKEN_NOT_FOUND`, 400 `ENROLLMENT_TOKEN_EXPIRED`, 400 `ENROLLMENT_TOKEN_ALREADY_USED`, 400 `INVALID_PUBLIC_KEY`, 400 `INVALID_SERVICE_ENDPOINT_URL`

---

### `POST /v1/onboard/verify` — Agent Onboarding Step 2

Agent signs the nonce from step 1 and submits the signature.

**Request:**

```json
{
  "challengeId": "chal:abc123",
  "signature": "<hex-encoded Ed25519 signature of the nonce bytes>"
}
```

**Response 201:**

```json
{
  "agentDid": "did:hedera:testnet:...",
  "vc": { },
  "hederaTransactionId": "...",
  "vcId": "vc:helix:..."
}
```

**Service behaviour:**

1. Look up challenge by `challengeId` — throw `ChallengeNotFoundError` if not found
2. Check `expiresAt` — throw `ChallengeExpiredError` if past
3. Check `verifiedAt` is null — throw `ChallengeAlreadyVerifiedError` if set
4. Check `purpose` is `'agent_onboarding'` — throw `ChallengeNotFoundError` if mismatch (prevents user challenges being used for onboarding)
5. Retrieve `pendingPublicKeyHex` and `nonce` from challenge record
6. Verify: `verifySignature(hexToBytes(nonce), signature, pendingPublicKeyHex)` → if false throw `ChallengeSignatureInvalidError`
7. Retrieve enrollment token via `challenge.enrollmentTokenId` to get `requestedScopes`, `agentName`, `requestedDomains`
8. Parse `pendingDomains` from challenge (domains submitted at step 1, used here for DID creation)
9. Call `IDIDService.createDID(pendingPublicKeyHex, 'agent', parsedDomains, requestId)` — if throws `DIDAlreadyExistsError` → throw `AgentAlreadyOnboardedError`
10. Call `IVCService.issueVC({ subjectDid: agentDid, subjectType: 'agent', privilegeScopes: requestedScopes, agentName, expiresInSeconds: ENROLLMENT_TOKEN_TTL_SECONDS * 100 }, requestId)` — use a sensible default VC expiry
11. Mark challenge `verifiedAt = now()`
12. Emit `AGENT_ONBOARDED` with `agentDid`, `agentName`, `hederaTransactionId`
13. Return `agentDid` + signed VC + `hederaTransactionId` + `vcId`

**Error cases:** 404 `CHALLENGE_NOT_FOUND`, 410 `CHALLENGE_EXPIRED`, 409 `CHALLENGE_ALREADY_VERIFIED`, 400 `CHALLENGE_SIGNATURE_INVALID`, 409 `AGENT_ALREADY_ONBOARDED`

---

### `POST /v1/challenges` — Issue a Challenge

Used to verify a user's ownership of a DID. Called by the agent on behalf of the user.

**Request:**

```json
{
  "did": "did:hedera:testnet:...",
  "purpose": "user_verification"
}
```

**Response 201:**

```json
{
  "challengeId": "chal:xyz",
  "nonce": "<32-byte hex>",
  "expiresAt": "..."
}
```

**Service behaviour:**

1. Validate DID format
2. Call `IDIDService.resolveDID(did)` — throw `DIDNotFoundError` if not found or deactivated
3. Generate `challengeId = 'chal:' + cuid()`, `nonce = crypto.randomBytes(32).toString('hex')`
4. Store challenge with `purpose: 'user_verification'`, `did`, `nonce`, `expiresAt = now + CHALLENGE_TTL_SECONDS`. No `pendingPublicKeyHex` — the public key is resolved from the DID document at verification time.
5. Emit `CHALLENGE_ISSUED`
6. Return `challengeId` + `nonce` + `expiresAt`

**Error cases:** 400 `VALIDATION_ERROR`, 400 `INVALID_DID_FORMAT`, 404 `DID_NOT_FOUND`, 410 `DID_DEACTIVATED`

---

### `POST /v1/challenges/{challengeId}/verify` — Verify a Challenge

**Request:**

```json
{
  "signature": "<hex-encoded Ed25519 signature of the nonce bytes>"
}
```

**Response 200:**

```json
{
  "did": "did:hedera:testnet:...",
  "verified": true,
  "vc": { }
}
```

`vc` field is present only when `purpose === 'user_verification'`. For `agent_onboarding` challenges this endpoint should not be called directly — use `POST /v1/onboard/verify` instead.

**Service behaviour:**

1. Look up challenge by `challengeId` — throw `ChallengeNotFoundError` if not found
2. Check `expiresAt` — throw `ChallengeExpiredError` if past
3. Check `verifiedAt` is null — throw `ChallengeAlreadyVerifiedError` if set
4. Check `purpose === 'user_verification'`
5. Resolve DID from `IDIDService.resolveDID(challenge.did)` — extract public key via `extractPublicKeyFromDIDDocument`
6. Verify: `verifySignature(hexToBytes(challenge.nonce), signature, publicKeyHex)` → false: throw `ChallengeSignatureInvalidError`
7. Mark challenge `verifiedAt = now()`
8. Emit `CHALLENGE_VERIFIED`
9. Fetch or issue user VC:
   - Try `IVCService.findActiveBySubjectDid(challenge.did)`
   - If none exists: call `IVCService.issueVC({ subjectDid: did, subjectType: 'user', userId: did, expiresInSeconds: 7776000 })`
10. Emit `USER_DID_VERIFIED`
11. Return `{ did, verified: true, vc }`

**Error cases:** 404 `CHALLENGE_NOT_FOUND`, 410 `CHALLENGE_EXPIRED`, 409 `CHALLENGE_ALREADY_VERIFIED`, 400 `CHALLENGE_SIGNATURE_INVALID`

---

### `GET /v1/services` — List Service Registry

No auth in open core. Returns all active services.

**Response 200:**

```json
{
  "services": [
    {
      "serviceName": "amazon",
      "displayName": "Amazon",
      "verifiedDomain": "https://amazon.com",
      "apiEndpoint": "https://api.amazon.com/helix/verify",
      "metadata": {}
    }
  ]
}
```

---

### `GET /v1/services/{serviceName}` — Get Service Details

**Response 200:** Single service entry.

**Error cases:** 404 `SERVICE_NOT_FOUND`

---

### `POST /v1/services` — Register a Service (Admin)

No auth in open core. Document this limitation in the route file comment and in `README.md`. This endpoint is intended for manual operation by the Helix ID operator.

**Request:**

```json
{
  "serviceName": "amazon",
  "displayName": "Amazon",
  "verifiedDomain": "https://amazon.com",
  "apiEndpoint": "https://api.amazon.com/helix/verify",
  "publicKeyMultibase": "z...",
  "metadata": {}
}
```

Validation: `serviceName` lowercase letters and hyphens only, pattern `^[a-z][a-z0-9-]+$`. `verifiedDomain` and `apiEndpoint` must be HTTPS URLs.

**Response 201:** The created service entry.

**Error cases:** 400 `VALIDATION_ERROR`, 409 `SERVICE_ALREADY_EXISTS`

---

## 4.4 — Repository Layer

### `helix-api/src/repositories/agent.repository.ts`

Constructor takes `PrismaClient`. Methods:

- `createEnrollmentToken(data): Promise<EnrollmentToken>`
- `findEnrollmentTokenByHash(tokenHash: string): Promise<EnrollmentToken | null>`
- `burnEnrollmentTokenAtomically(tokenHash: string): Promise<boolean>` — `updateMany` with `usedAt: null` condition, returns true if 1 row updated
- `createChallenge(data): Promise<Challenge>`
- `findChallengeById(challengeId: string): Promise<Challenge | null>`
- `markChallengeVerified(challengeId: string): Promise<Challenge>`
- `getServiceByName(serviceName: string): Promise<ServiceRegistry | null>`
- `listActiveServices(): Promise<ServiceRegistry[]>`
- `createService(data): Promise<ServiceRegistry>`
- `findServiceByName(serviceName: string): Promise<ServiceRegistry | null>` — includes inactive

---

## 4.5 — Service Layer

### `helix-api/src/services/agent/agent.service.ts`

Constructor: `(agentRepository: AgentRepository, didService: IDIDService, vcService: IVCService, auditLogger: IAuditLogger)`

All methods follow the step-by-step flows described in section 4.3. Key implementation notes:

**Token hashing:** Use `sha256` from `@noble/hashes/sha256` which is already a dependency. Hash the UTF-8 bytes of the raw token string.

**Atomic token burning in `processOnboardStep1`:** Must use `burnEnrollmentTokenAtomically` which uses `updateMany` — not a read-then-write. This prevents a race condition where two concurrent requests with the same token both pass the null check before either has written `usedAt`.

**Challenge-to-DID linking:** The `challenges` table has `enrollmentTokenId` FK. When creating a challenge in step 1, store this FK so step 2 can retrieve `requestedScopes` and `agentName` without re-hashing the token.

---

## 4.6 — SDK: AgentWallet

### `helix-sdk-js/src/wallet/AgentWallet.ts`

Encrypted local JSON file. Encryption uses Node.js `crypto` module (AES-256-GCM + PBKDF2). No additional dependencies.

**Wallet file structure (stored on disk, private key is encrypted):**

```json
{
  "version": 1,
  "did": "did:hedera:testnet:...",
  "publicKeyHex": "...",
  "encryptedPrivateKey": "<hex>",
  "iv": "<12-byte hex>",
  "salt": "<16-byte hex>",
  "vcId": "vc:helix:...",
  "vcJson": "<signed VC JSON string>",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Private key encryption: PBKDF2 (100,000 iterations, SHA-256, 32-byte output key, 16-byte random salt). IV is 12 bytes random. AES-256-GCM. Both `iv` and `salt` are stored in the file in hex — they are not secrets.

**Methods:**

- `save(data: WalletData, passphrase: string, filePath: string): Promise<void>` — derives key from passphrase+salt, encrypts private key with AES-256-GCM, writes JSON file. `data.privateKeyHex` is the only encrypted field.
- `load(passphrase: string, filePath: string): Promise<WalletData>` — reads file, derives key, decrypts. Throws `Error('Invalid passphrase or corrupted wallet')` if GCM authentication tag fails.
- `getPrivateKey(passphrase: string, filePath: string): Promise<string>` — convenience: load + return `privateKeyHex`
- `updateVC(newVcId: string, newVcJson: string, filePath: string, passphrase: string): Promise<void>` — load, update VC fields, re-save

---

## 4.7 — SDK: High-Level Onboarding and User Flow Methods

Add to `HelixClient`:

**`requestOnboardingChallenge(enrollmentToken: string, domains?: string[]): Promise<{ challengeId, nonce, expiresAt }>`**

1. Generate keypair locally: `const keyPair = generateKeyPair()`
2. Store `keyPair` temporarily in-memory (do not persist yet — only persist after challenge verified)
3. Call `POST /v1/onboard` with `{ enrollmentToken, publicKeyHex: keyPair.publicKey, domains }`
4. Store `keyPair` on the client instance temporarily for use in `completeOnboarding`
5. Return `{ challengeId, nonce, expiresAt }`

**`completeOnboarding(challengeId: string, nonce: string, walletPassphrase: string, walletFilePath: string): Promise<OnboardingResult>`**

1. Retrieve `pendingKeyPair` stored in step above
2. Sign nonce: `signBytes(hexToBytes(nonce), pendingKeyPair.privateKey)` — produces hex signature
3. Call `POST /v1/onboard/verify` with `{ challengeId, signature }`
4. On success: call `AgentWallet.save({ did: result.agentDid, publicKeyHex: pendingKeyPair.publicKey, privateKeyHex: pendingKeyPair.privateKey, vcId: result.vcId, vcJson: JSON.stringify(result.vc), createdAt: now, updatedAt: now }, walletPassphrase, walletFilePath)`
5. Clear `pendingKeyPair` from memory
6. Return `OnboardingResult` with `agentDid`, `vcId`, `walletSaved: true`

**`requestUserChallenge(userDid: string): Promise<{ challengeId, nonce, expiresAt }>`** — calls `POST /v1/challenges`

**`verifyUserChallenge(challengeId: string, signature: string): Promise<{ did, verified, vc? }>`** — calls `POST /v1/challenges/:challengeId/verify`

**`listServices(): Promise<ServiceEntry[]>`** — calls `GET /v1/services`

**`getService(serviceName: string): Promise<ServiceEntry>`** — calls `GET /v1/services/:serviceName`

Add error mappings in `HttpAdapter.ts` for all B4 error codes.

---

## 4.8 — Tests

### Unit Tests — `helix-sdk-js/tests/unit/wallet/`

- `AgentWallet.save` writes a file with no plaintext private key visible in raw JSON
- `AgentWallet.load` with correct passphrase returns original `privateKeyHex`
- `AgentWallet.load` with wrong passphrase throws
- `AgentWallet.updateVC` updates VC fields without changing private key
- `AgentWallet.getPrivateKey` returns original private key after save+load roundtrip

### Unit Tests — `helix-sdk-js/tests/unit/client/onboarding.test.ts`

- `completeOnboarding` signs the nonce with the pending keypair and produced signature verifies against the same public key
- After `completeOnboarding`, `pendingKeyPair` is cleared from client instance memory

### Integration Tests — `helix-api/tests/integration/agent.integration.test.ts`

Setup: real PostgreSQL, MockDIDService, MockVCService. `afterEach` truncates all tables.

Tests:

- Full onboarding flow: `POST /v1/enrollment-tokens` → `POST /v1/onboard` → `POST /v1/onboard/verify` → agentDid in response, VC returned
- Onboarding with expired token → 400 `ENROLLMENT_TOKEN_EXPIRED`
- Onboarding with already-used token → 400 `ENROLLMENT_TOKEN_ALREADY_USED`
- User verification flow: `POST /v1/challenges` (purpose: user_verification) → sign nonce → `POST /v1/challenges/:id/verify` → 200 `verified: true`, VC in response
- User without existing VC gets one issued on verification
- `GET /v1/services` returns seeded service entries
- `POST /v1/services` creates new service entry
- `POST /v1/services` duplicate `serviceName` → 409 `SERVICE_ALREADY_EXISTS`
- `GET /v1/services/:serviceName` returns correct entry
- `GET /v1/services/:serviceName` unknown name → 404 `SERVICE_NOT_FOUND`

### Security Tests — `helix-api/tests/security/agent.security.test.ts`

**These tests may NEVER be skipped. See SA-10.**

- **Enrollment token single use (SA-3):** Generate token. Use it once → success. Use same token again → 400 `ENROLLMENT_TOKEN_ALREADY_USED`. DB record shows `usedAt` is set. Exactly one challenge created.
- **Enrollment token expiry (SA-3):** Generate token, manually set `expiresAt` to 1 second past in DB. Attempt use → 400 `ENROLLMENT_TOKEN_EXPIRED`. No challenge created.
- **Raw enrollment token never in audit log:** After token generation and consumption, fetch all `audit_log` rows. Assert no row contains the raw token string. Assert all token-related rows contain `tokenIdHash` only.
- **Wrong signature on onboarding challenge:** Submit a signature produced by a different keypair than the one submitted in step 1. → 400 `CHALLENGE_SIGNATURE_INVALID`. DB: `verifiedAt` on challenge is still null. No DID created (MockDIDService.createDID not called). No VC issued.
- **Challenge expiry:** Create challenge, manually set `expiresAt` to 1 second past in DB. Submit correct signature → 410 `CHALLENGE_EXPIRED`. No DID created.
- **Challenge replay:** Complete onboarding successfully. Submit same `challengeId` again → 409 `CHALLENGE_ALREADY_VERIFIED`. No second DID or VC created.
- **Concurrent token burning:** Generate one token. Submit `POST /v1/onboard` twice simultaneously with same token via `Promise.all`. Exactly one request must succeed (200), the other must fail (400 `ENROLLMENT_TOKEN_ALREADY_USED`). DB: exactly one challenge created.
- **Wallet file private key is not plaintext:** After `AgentWallet.save`, read the raw JSON file. Assert `encryptedPrivateKey` field is not the original `privateKeyHex` value. Assert raw file does not contain the private key string anywhere.

---

## Story 4 Acceptance Criteria

- [ ] `POST /v1/enrollment-tokens` generates token shown once, stores only hash
- [ ] `POST /v1/onboard` burns token atomically, returns challenge
- [ ] `POST /v1/onboard/verify` verifies challenge signature, creates DID via B1, issues VC via B2, returns full onboarding result
- [ ] `POST /v1/challenges` issues user verification challenge
- [ ] `POST /v1/challenges/:id/verify` verifies user challenge, fetches or issues user VC
- [ ] Service registry CRUD endpoints working
- [ ] SDK `completeOnboarding` signs locally, saves to encrypted wallet, clears private key from memory
- [ ] `AgentWallet` encrypts private key at rest — raw file contains no plaintext private key
- [ ] All B4 audit events emitted; raw token never appears in any audit entry
- [ ] All security tests pass — especially: token single-use, challenge expiry, concurrent token burn, wallet encryption
- [ ] OpenAPI spec complete for all B4 endpoints before implementation
- [ ] All error codes defined in helix-core before implementation
- [ ] Full E2E test in `e2e/tests/agent-onboarding.test.ts` passes against live Docker Compose stack
- [ ] Full E2E test in `e2e/tests/user-did-flow.test.ts` passes

---

## Cross-Story Wiring Notes

After Story 4, update `helix-api/src/server.ts` to wire all four boundaries together:

```
PrismaClient
  → DidRepository
  → VCRepository
  → VPRepository
  → AgentRepository
  → AuditLogger (ApiAuditLogger)
  → HederaHIEROClient
  → DIDService(didRepository, hederaClient, auditLogger)
  → VCService(vcRepository, didService, auditLogger)
  → VPService(vpRepository, didService, vcService, agentRepository, auditLogger)
  → AgentService(agentRepository, didService, vcService, auditLogger)
  → register didRoutes({ didService })
  → register vcRoutes({ vcService })
  → register vpRoutes({ vpService })
  → register agentRoutes({ agentService })
```

Boundary import rule (constitution §7): `AgentService` holds references to `IDIDService`, `IVCService` — interfaces only. It does NOT import `DIDService` or `VCService` implementation classes. All concrete wiring is in `server.ts`.
