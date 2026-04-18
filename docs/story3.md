# STORY 3 — Boundary 3: VP Creation & Verification

## Overview

B3 handles the presentation layer. Helix ID generates an unsigned VP template with a unique `vpId` and short expiry. The agent signs it locally using the SDK. External services verify the signed VP either by calling Helix ID's verify endpoint or by self-verifying directly against Hedera and the public status list.

---

## What to Mock So This Story Can Start

B3 needs DID resolution (B1) and VC status checking (B2). Mock both as injectable interfaces:

**Mock DIDService:** implements `IDIDService`. `resolveDID(did)` returns a hardcoded DID document containing a known test keypair. Can be configured per-test to throw `DIDNotFoundError` to simulate missing DID scenarios.

**Mock VCService:** implements `IVCService`. `getVCStatus(vcId)` returns `'active'` by default. Tests override this via a setter to return `'revoked'` or `'expired'` to exercise B3 security paths.

Both mocks are injected via constructor into `VPService`. The real implementations are wired in `server.ts`.

---

## 3.1 — Database Schema

Add to `helix-api/prisma/schema.prisma`:

```prisma
model VpId {
  id            String    @id @default(cuid())
  vpId          String    @unique  // format: vp:helix:<cuid>
  agentDid      String
  userDid       String
  targetService String
  expiresAt     DateTime
  consumedAt    DateTime?
  createdAt     DateTime  @default(now())

  @@index([vpId])
  @@map("vp_ids")
}
```

Run migration: `npx prisma migrate dev --name add_vp_ids_table`

---

## 3.2 — helix-core Additions

### VP Schema — `helix-core/src/schemas/vp.ts`

**Unsigned VP template structure:**

```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiablePresentation"],
  "id": "vp:helix:<cuid>",
  "holder": "<agentDid>",
  "verifiableCredential": [ ],
  "nonce": "<random 32-byte hex string>",
  "expirationDate": "<ISO 8601, VP_TTL_SECONDS from now>",
  "delegatedBy": "<userDid>"
}
```

`verifiableCredential` array contains the agent's full signed VC JSON object.

**Signed VP** — same structure with added `proof` field:

```json
{
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "<ISO 8601>",
    "verificationMethod": "<agentDid>#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "<base58btc-encoded signature>"
  }
}
```

The agent signs using its own private key from the wallet — not the Helix ID signing key.

Export Zod schemas for `UnsignedVP` and `SignedVP`. Export inferred TypeScript types.

### Error Codes to Add — `helix-core/src/errors/codes.ts`

```typescript
// B3 — VP Creation & Verification
VP_NOT_FOUND: 'VP_NOT_FOUND',
VP_EXPIRED: 'VP_EXPIRED',
VP_ALREADY_CONSUMED: 'VP_ALREADY_CONSUMED',
VP_VERIFICATION_FAILED: 'VP_VERIFICATION_FAILED',
VP_INVALID_STRUCTURE: 'VP_INVALID_STRUCTURE',
VP_AGENT_DID_NOT_FOUND: 'VP_AGENT_DID_NOT_FOUND',
VP_NO_ACTIVE_VC: 'VP_NO_ACTIVE_VC',
```

**Critical — EH-4:** `VP_VERIFICATION_FAILED` is the only code returned externally for ALL of these internal failure reasons: invalid signature, DID not found, VC revoked, VC expired, VP expired, vpId already consumed, VP structure invalid. The internal audit log records the specific reason. The HTTP response never reveals which check failed.

Convenience error classes:

| Class | Code | HTTP |
|---|---|---|
| `VPNotFoundError` | `VP_NOT_FOUND` | 404 — internal only, never returned from verify endpoint |
| `VPExpiredError` | `VP_EXPIRED` | 400 — internal only |
| `VPAlreadyConsumedError` | `VP_ALREADY_CONSUMED` | 400 — internal only |
| `VPVerificationFailedError` | `VP_VERIFICATION_FAILED` | 400 — the only one returned externally |
| `VPInvalidStructureError` | `VP_INVALID_STRUCTURE` | 400 — internal only |
| `VPAgentDIDNotFoundError` | `VP_AGENT_DID_NOT_FOUND` | 404 |
| `VPNoActiveVCError` | `VP_NO_ACTIVE_VC` | 400 |

### Audit Events to Add — `helix-core/src/audit/events.ts`

```
VP_TEMPLATE_ISSUED  — fields: vpId, agentDid, userDid, targetService, expiresAt
VP_VERIFIED         — fields: vpId, agentDid, result: 'success', verifiedAt
VP_REJECTED         — fields: vpId (if parseable from request), internalReason (logged only — never in HTTP response), timestamp
```

---

## 3.3 — SDK: buildAndSignVP

Location: `helix-sdk-js/src/vp/VPBuilder.ts`

**Function signature:**

```typescript
function buildAndSignVP(unsignedVP: UnsignedVP, privateKeyHex: string): SignedVP
```

**Steps:**

1. Validate `unsignedVP` against Zod `UnsignedVP` schema — throw `VPInvalidStructureError` if fails
2. Check `unsignedVP.expirationDate` is in the future — throw `VPExpiredError` if already past. Prevents agent from signing a stale template.
3. Deep-clone the unsigned VP object
4. Serialize to canonical JSON (keys sorted recursively, no `proof` field present)
5. `sha256(Buffer.from(serialized, 'utf-8'))` — produces 32-byte hash
6. `signBytes(hashBytes, privateKeyHex)` — produces 64-byte hex signature using helix-core
7. Convert hex signature to bytes, base58btc-encode using helix-core encoder
8. Attach proof block: `{ type: 'Ed25519Signature2020', created: ISO8601 now, verificationMethod: '${unsignedVP.holder}#key-1', proofPurpose: 'assertionMethod', proofValue: base58btcSignature }`
9. Return `SignedVP`

**Private key safety:** The private key is passed as a parameter. The function does not store, log, or transmit it. It exists in memory only for the duration of the call. Callers must not log the result of `buildAndSignVP` in raw form before it has been transmitted.

---

## 3.4 — API Endpoints

### OpenAPI Spec — add to `helix-core/src/openapi/openapi.yaml` before implementation

**Endpoints:**

- `POST /v1/vp/template` — request unsigned VP template
- `POST /v1/vp/verify` — verify a signed VP

### `POST /v1/vp/template` — Request Unsigned VP Template

Called by the agent SDK immediately before performing an action on an external service.

**Request:**

```json
{
  "agentDid": "did:hedera:testnet:...",
  "userDid": "did:hedera:testnet:...",
  "targetService": "amazon"
}
```

**Response 201:**

```json
{
  "unsignedVP": { },
  "vpId": "vp:helix:abc123",
  "expiresAt": "2025-06-01T12:05:00Z"
}
```

**Service behaviour:**

1. Validate `agentDid` exists via `IDIDService.resolveDID` — throw `VPAgentDIDNotFoundError` if not found or deactivated
2. Fetch agent's active VC via `IVCService.findActiveBySubjectDid(agentDid)` — throw `VPNoActiveVCError` if none
3. Validate `targetService` exists in `service_registry` — throw `ServiceNotFoundError` if not
4. Generate `vpId = 'vp:helix:' + cuid()`
5. Generate `nonce = crypto.randomBytes(32).toString('hex')`
6. Set `expiresAt = now + VP_TTL_SECONDS`
7. Persist `vp_ids` record
8. Build unsigned VP: embed agent's full signed VC in `verifiableCredential` array
9. Emit `VP_TEMPLATE_ISSUED` audit event
10. Return unsigned VP + vpId + expiresAt

**Error cases:** 400 `VALIDATION_ERROR`, 404 `VP_AGENT_DID_NOT_FOUND`, 400 `VP_NO_ACTIVE_VC`, 404 `SERVICE_NOT_FOUND`

### `POST /v1/vp/verify` — Verify a Signed VP

Called by external services (Amazon, etc.) or by the agent itself for testing.

**Request:**

```json
{
  "signedVP": { }
}
```

**Response 200 (success):**

```json
{
  "valid": true,
  "agentDid": "did:hedera:testnet:...",
  "userDid": "did:hedera:testnet:...",
  "targetService": "amazon",
  "verifiedAt": "2025-06-01T12:04:55Z"
}
```

**Response 400 (any failure) — always the same external response, EH-4:**

```json
{
  "error": {
    "code": "VP_VERIFICATION_FAILED",
    "message": "The Verifiable Presentation could not be verified.",
    "requestId": "req_..."
  }
}
```

The internal audit log entry for a rejected VP includes the specific `internalReason` field. This field never reaches the HTTP response.

**Verification steps — fail fast, log specific reason internally:**

1. Parse and validate VP structure against Zod `SignedVP` schema → fail: log `VP_INVALID_STRUCTURE`, return `VP_VERIFICATION_FAILED`
2. Extract `vpId` from `signedVP.id`
3. Look up `vpId` in `vp_ids` table → not found: log `VP_NOT_FOUND`, return `VP_VERIFICATION_FAILED`
4. Check `consumedAt` is null → not null: log `VP_ALREADY_CONSUMED`, return `VP_VERIFICATION_FAILED`
5. Check `expiresAt` is in future → past: log `VP_EXPIRED`, return `VP_VERIFICATION_FAILED`
6. Resolve agent DID from `signedVP.holder` via `IDIDService.resolveDID` → failure: log `VP_AGENT_DID_NOT_FOUND`, return `VP_VERIFICATION_FAILED`
7. Extract public key from resolved DID document via `extractPublicKeyFromDIDDocument`
8. Verify VP signature: reconstruct canonical JSON without proof, sha256, verify with `verifySignature(hash, proof.proofValue, publicKeyHex)` → false: log `signature_invalid`, return `VP_VERIFICATION_FAILED`
9. Extract embedded VC from `signedVP.verifiableCredential[0]`
10. Check VC `expirationDate` is in future → expired: log `vc_expired`, return `VP_VERIFICATION_FAILED`
11. Check VC credential status: fetch status list from `credentialStatus.statusListCredential`, call `getBit(encodedList, statusListIndex)` → bit is 1: log `vc_revoked`, return `VP_VERIFICATION_FAILED`
12. **Atomic consumption** — `UPDATE vp_ids SET consumed_at = NOW() WHERE vp_id = ? AND consumed_at IS NULL`. If 0 rows updated, a concurrent request consumed it first → log `VP_ALREADY_CONSUMED`, return `VP_VERIFICATION_FAILED`
13. Emit `VP_VERIFIED` audit event
14. Return 200 success

**Step 12 is the replay protection guarantee (SA-4).** Must use a raw atomic update, not a read-then-write. In Prisma this is: `prisma.vpId.updateMany({ where: { vpId, consumedAt: null }, data: { consumedAt: new Date() } })` — check `count` of updated rows, reject if 0.

---

## 3.5 — Repository Layer

### `helix-api/src/repositories/vp.repository.ts`

Constructor takes `PrismaClient`. Methods:

- `create(data): Promise<VpId>` — inserts new vpId record
- `findByVpId(vpId: string): Promise<VpId | null>`
- `consumeAtomically(vpId: string): Promise<boolean>` — executes `updateMany` with `consumedAt: null` condition, returns `true` if exactly 1 row updated, `false` if 0 (already consumed or not found)

---

## 3.6 — Service Layer

### `helix-api/src/services/vp/IVPService.ts`

```typescript
interface IVPService {
  generateVPTemplate(params: VPTemplateParams, requestId: string): Promise<VPTemplateResult>;
  verifyVP(signedVP: SignedVP, requestId: string): Promise<VPVerificationResult>;
}
```

### `helix-api/src/services/vp/vp.service.ts`

Constructor: `(vpRepository: VPRepository, didService: IDIDService, vcService: IVCService, serviceRegistry: ServiceRegistryRepository, auditLogger: IAuditLogger)`

**`generateVPTemplate`:** Steps as described in section 3.4 above.

**`verifyVP`:** Steps as described in section 3.4 above. All internal failure reasons are caught in a single try/catch block that logs the specific reason to audit and always returns `VPVerificationFailedError` to the route handler — never the specific internal error.

---

## 3.7 — Route Layer

### `helix-api/src/routes/vp/index.ts`

Fastify plugin. Accepts `{ vpService: IVPService }`.

JSON Schema for both routes per AC-4. The `signedVP` in the verify endpoint body schema is typed as `object` — Zod validation happens inside the service, not at the route layer, because the VP structure is complex enough that Fastify JSON Schema would need to duplicate the Zod logic.

The verify route handler catches `VPVerificationFailedError` and ensures it always returns 400 with the opaque error body. It must not catch and forward any other error type — all internal errors must become `VP_VERIFICATION_FAILED` at this endpoint.

---

## 3.8 — Self-Verification Documentation

Create `helix-api/docs/self-verification.md`.

Document must cover:

1. **DID Resolution:** How to resolve `did:hedera:testnet:<id>` directly from Hedera Mirror Node REST API (`https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages/{sequenceNumber}`) without calling Helix ID.

2. **Public Key Extraction:** How to find the `Ed25519VerificationKey2020` verification method in the DID document and decode `publicKeyMultibase` to raw bytes.

3. **Signature Verification:** How to verify the VP proof — reconstruct canonical JSON without proof field, SHA-256 hash, Ed25519 verify against extracted public key.

4. **Status List Check:** How to fetch the status list credential from the URL in `vc.credentialStatus.statusListCredential`, decode the `encodedList` field (base64url decode, gzip decompress, read bit at `statusListIndex`).

5. **VP Expiry:** Check `signedVP.expirationDate` is in future before accepting.

6. **VC Expiry:** Check embedded `vc.expirationDate` is in future.

7. **The vpId Obligation:** This section must be explicitly titled "Your Obligation for Replay Prevention". Text must state: "If you self-verify rather than calling the Helix ID verify endpoint, you are responsible for implementing vpId consumption tracking. You must store every `signedVP.id` value you have successfully verified and reject any subsequent request presenting the same `id`. Helix ID's verify endpoint handles this automatically. If you self-verify and do not implement this tracking, you are vulnerable to replay attacks."

8. **Test Vectors:** Provide one complete example of a valid unsigned VP, its canonical JSON, SHA-256 hash, and expected signature given a test private key.

---

## 3.9 — Tests

### Unit Tests — `helix-sdk-js/tests/unit/vp/`

- `buildAndSignVP` with valid inputs produces SignedVP with non-empty `proof.proofValue`
- `buildAndSignVP` throws `VPInvalidStructureError` if required field missing from unsignedVP
- `buildAndSignVP` throws `VPExpiredError` if `expirationDate` is already past
- The signature in the returned SignedVP verifies via `verifySignature(canonicalHash, proof.proofValue, derivedPublicKey)` using the same private key
- Signing with different private key → signature does not verify against original public key

### Integration Tests — `helix-api/tests/integration/vp.integration.test.ts`

Setup: real PostgreSQL, MockDIDService, MockVCService.

Tests:

- `POST /v1/vp/template` → 201, returns unsignedVP with correct `holder`, `delegatedBy`, embedded VC
- `POST /v1/vp/template` with unknown agentDid → 404 `VP_AGENT_DID_NOT_FOUND`
- `POST /v1/vp/template` with unknown targetService → 404 `SERVICE_NOT_FOUND`
- `POST /v1/vp/template` with agent that has no active VC → 400 `VP_NO_ACTIVE_VC`
- Correctly signed VP verifies → 200 `valid: true`
- Verify VP → DB record has `consumedAt` set
- Get status list bit at `statusListIndex` before and after verify — stays 0 (vpId consumption is separate from VC revocation)

### Security Tests — `helix-api/tests/security/vp.security.test.ts`

**These tests may NEVER be skipped. See SA-10.**

- **Replay attack:** Submit same signed VP twice → second returns 400 `VP_VERIFICATION_FAILED`; `consumedAt` set after first call; DB has one consumed record
- **Concurrent replay:** `Promise.all` with same signed VP submitted twice simultaneously → exactly one 200 and one 400. Test may be flaky on very fast hardware — use a transaction delay mock if needed to ensure both requests hit step 12 simultaneously.
- **Tampered VP:** Change one character in `credentialSubject.privilegeScopes[0]` of embedded VC → 400 `VP_VERIFICATION_FAILED`; audit log contains `internalReason: 'signature_invalid'`
- **Wrong private key:** Sign VP with a keypair that is NOT the one registered to `agentDid` → 400 `VP_VERIFICATION_FAILED`
- **Expired VP:** Generate template, manually set `expiresAt` to 1 second in past in DB, submit → 400 `VP_VERIFICATION_FAILED`; audit log contains `internalReason: 'vp_expired'`
- **Revoked VC:** MockVCService configured to return `'revoked'` for the embedded VC's vcId → 400 `VP_VERIFICATION_FAILED`; audit log contains `internalReason: 'vc_revoked'`
- **Expired VC:** MockVCService returns `'expired'` → 400 `VP_VERIFICATION_FAILED`; audit log contains `internalReason: 'vc_expired'`
- **Unknown vpId:** Submit valid-looking signed VP with a `id` field not in `vp_ids` table → 400 `VP_VERIFICATION_FAILED`
- **External response is always opaque:** Verify all the above cases — every failure returns the identical `VP_VERIFICATION_FAILED` code and same message text. The HTTP response body must never contain `internalReason` or any hint of which step failed.

---

## Story 3 Acceptance Criteria

- [ ] `POST /v1/vp/template` generates unsigned VP with unique vpId, correct structure, agent VC embedded
- [ ] `POST /v1/vp/verify` verifies correctly signed VP and marks vpId consumed atomically
- [ ] All verification failures return identical 400 `VP_VERIFICATION_FAILED` response — EH-4 verified by security tests
- [ ] `buildAndSignVP` in SDK signs locally — no network call, private key never transmitted
- [ ] All B3 audit events emitted; rejected VPs include `internalReason` in audit log only
- [ ] `self-verification.md` document complete including the vpId obligation section
- [ ] Concurrent replay test passes — exactly one success, one failure
- [ ] All other security tests pass and none are skipped
- [ ] OpenAPI spec complete for both VP endpoints before implementation
- [ ] All error codes defined in helix-core before implementation
