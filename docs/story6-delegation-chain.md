# STORY 6 — Delegation Chain

## Overview

Agent A can delegate a subset of its authority to Agent B via Helix ID. Helix ID remains the sole VC signer throughout — Agent A cannot sign credentials itself. Agent A calls `POST /v1/vcs/delegate` with a signed VP proving its own authority, specifies Agent B's DID and a subset of scopes. Helix ID verifies A's authority, enforces scope subset rules, issues a child VC for Agent B carrying the full delegation chain, and returns it.

`POST /v1/vcs/delegate` is an admin-protected Helix ID operation and requires `x-admin-api-key`.

When Agent B presents a VP, the verify path walks the embedded chain, verifying each VC's signature against `HELIX_SIGNING_KEY` and each link's scope subset constraint. DID resolution is used per link to verify the holder identity — not the signer (all VCs are Helix-signed). This keeps chain verification fast: one signing key, N DID resolutions where N is chain depth.

This story touches the VC service (new delegate endpoint and chain verification), the VP verify path (extended to walk chains), helix-core (VC schema additions, new error codes), and the SDK (new `delegate()` method).

Current implementation note: delegation uses the existing VP verification path as the authority proof, then extracts the parent VC id from the delegator VP. The convention `targetService: 'helix-delegation'` is used by the SDK, so that service must exist in `service_registry` before delegation examples run. Revocation checks in the API verifier are currently DB-backed through `getVCStatus`, not direct StatusList bit fetching.

---

## 6.1 — helix-core: VC Schema Changes

### `helix-core/src/schemas/vc.ts`

Add optional delegation fields to `AgentVC` credentialSubject:

```typescript
interface AgentVCCredentialSubject {
  id: string;                    // agentDid
  type: 'HelixAgent';
  privilegeScopes: string[];
  agentName: string;

  // Present only on delegated VCs
  delegatedFrom?: string;        // DID of the delegating agent
  delegationDepth?: number;      // 0 = root VC, 1 = first delegation, etc.
  maxDelegationDepth?: number;   // Maximum chain depth allowed — set at root issuance
  parentVcId?: string;           // vcId of the parent VC
}
```

**Root VCs** (issued at onboarding): `delegationDepth: 0`, `maxDelegationDepth` set by agent owner at onboarding time (default 0 — no delegation allowed unless explicitly requested), `delegatedFrom` and `parentVcId` absent.

**Delegated VCs**: all four fields present. `delegationDepth = parent.delegationDepth + 1`. `maxDelegationDepth` inherited from root VC — never increases along the chain.

Update Zod schema to reflect optional fields. Export updated types.

### `helix-core/src/schemas/vc.ts` — Chain Validation Logic

Add pure functions (no I/O, fully unit testable):

```typescript
function validateScopeSubset(parentScopes: string[], childScopes: string[]): void
```
Throws `DelegationScopeEscalationError` if any scope in `childScopes` is not present in `parentScopes`.

```typescript
function validateChainIntegrity(chain: AgentVC[]): void
```
Validates the full chain array (root first, leaf last):
- Chain must have at least 2 entries (root + one delegated)
- Each link's `delegatedFrom` must equal previous link's `credentialSubject.id`
- Each link's `delegationDepth` must equal index in array
- Each link's scopes must be a subset of previous link's scopes — calls `validateScopeSubset`
- Leaf's `delegationDepth` must be ≤ root's `maxDelegationDepth`
- Throws `DelegationChainInvalidError` with specific reason if any check fails

```typescript
function extractChainFromVC(leafVC: AgentVC): string[]
```
Returns the `parentVcId` ancestry chain from leaf back to root by following `parentVcId` fields. Returns array of vcIds in root-first order. Used by the verify path to fetch and reconstruct the chain from the database.

### Error Codes — `helix-core/src/errors/codes.ts`

```typescript
DELEGATION_NOT_PERMITTED: 'DELEGATION_NOT_PERMITTED',
DELEGATION_DEPTH_EXCEEDED: 'DELEGATION_DEPTH_EXCEEDED',
DELEGATION_SCOPE_ESCALATION: 'DELEGATION_SCOPE_ESCALATION',
DELEGATION_CHAIN_INVALID: 'DELEGATION_CHAIN_INVALID',
DELEGATION_PARENT_VC_NOT_FOUND: 'DELEGATION_PARENT_VC_NOT_FOUND',
DELEGATION_PARENT_VC_REVOKED: 'DELEGATION_PARENT_VC_REVOKED',
```

Convenience classes:

| Class | Code | HTTP |
|---|---|---|
| `DelegationNotPermittedError` | `DELEGATION_NOT_PERMITTED` | 403 |
| `DelegationDepthExceededError` | `DELEGATION_DEPTH_EXCEEDED` | 400 |
| `DelegationScopeEscalationError(scope)` | `DELEGATION_SCOPE_ESCALATION` | 400 |
| `DelegationChainInvalidError(reason)` | `DELEGATION_CHAIN_INVALID` | 400 |
| `DelegationParentVCNotFoundError` | `DELEGATION_PARENT_VC_NOT_FOUND` | 404 |
| `DelegationParentVCRevokedError` | `DELEGATION_PARENT_VC_REVOKED` | 400 |

### Audit Events — `helix-core/src/audit/events.ts`

```
VC_DELEGATED          — fields: parentVcId, childVcId, delegatingAgentDid, delegateeAgentDid, delegationDepth, scopes
DELEGATION_FAILED     — fields: reason, delegatingAgentDid, delegateeAgentDid
CHAIN_VERIFIED        — fields: leafVcId, chainDepth, agentDid, result: 'success'
CHAIN_REJECTED        — fields: leafVcId (if parseable), internalReason, timestamp
```

---

## 6.2 — Database Schema Changes

### `helix-api/prisma/schema.prisma` — changes to `Vc` model

```prisma
model Vc {
  // ... existing fields unchanged ...

  // Delegation fields — null on root VCs
  delegatedFrom     String?    // DID of delegating agent
  delegationDepth   Int?       // 0 = root
  maxDelegationDepth Int?      // inherited from root, null on root means no delegation
  parentVcId        String?    // vcId of parent VC (references Vc.vcId, not Vc.id)

  @@index([parentVcId])        // add this index for chain traversal
}
```

Run migration: `npx prisma migrate dev --name add_delegation_fields_to_vc`

**Note:** `parentVcId` is not a Prisma relation FK — it references `Vc.vcId` (the application-level ID, not the DB primary key). Chain traversal uses `findByVcId` in a loop, not a Prisma `include`. This avoids deep nested query complexity.

### `EnrollmentToken` model — add `maxDelegationDepth`

```prisma
model EnrollmentToken {
  // ... existing fields ...
  maxDelegationDepth Int @default(0)  // agent owner sets this at token generation time
}
```

Run as part of same migration.

Update `POST /v1/enrollment-tokens` request schema to accept optional `maxDelegationDepth: number` (min 0, max 5, default 0). Pass through to VC issuance in the `completeOnboarding` flow.

---

## 6.3 — API Endpoint — `POST /v1/vcs/delegate`

Add to OpenAPI spec before implementation.

**Called by:** Agent A's application, using Agent A's signed VP as proof of authority.

**Request:**

```json
{
  "delegatorVP": { /* Agent A's signed VP — proves A has authority */ },
  "delegateeAgentDid": "did:hedera:testnet:...",
  "requestedScopes": ["read:orders"],
  "expiresInSeconds": 3600
}
```

Validation:
- `delegatorVP` — required, object
- `delegateeAgentDid` — required, must match DID pattern
- `requestedScopes` — required, array, each must match `SCOPE_PATTERN`, min 1
- `expiresInSeconds` — optional, min 60, max 86400, default 3600

**Response 201:**

```json
{
  "vcId": "vc:helix:...",
  "delegateeAgentDid": "did:hedera:testnet:...",
  "delegatedFrom": "did:hedera:testnet:...",
  "delegationDepth": 1,
  "scopes": ["read:orders"],
  "expiresAt": "...",
  "vc": { /* full signed delegated VC */ }
}
```

**Error cases:** 400 `DELEGATION_SCOPE_ESCALATION`, 400 `DELEGATION_DEPTH_EXCEEDED`, 403 `DELEGATION_NOT_PERMITTED`, 400 `DELEGATION_PARENT_VC_REVOKED`, 400 `VP_VERIFICATION_FAILED` (delegator VP invalid)

---

## 6.4 — Service Layer Changes

### `helix-api/src/services/vc/vc.service.ts` — add `delegateVC`

```typescript
async delegateVC(params: DelegateVCParams, requestId: string): Promise<DelegateVCResult>
```

Steps:

1. **Verify delegator VP** — call `vpService.verifyVP(params.delegatorVP, requestId)` using the existing B3 verify path. If it fails, throw `VPVerificationFailedError`. This is the authority proof — Agent A proves it holds the private key and has an active VC.

2. **Fetch delegator's parent VC** — extract the embedded VC id from `params.delegatorVP.verifiableCredential[0].id`, then call `vcRepository.findByVcId(parentVcId)`. If null, throw `DelegationParentVCNotFoundError`. Parse VC JSON.

3. **Check delegation is permitted** — if delegator VC has no `maxDelegationDepth` field or `maxDelegationDepth === 0`, throw `DelegationNotPermittedError`. If `delegationDepth >= maxDelegationDepth`, throw `DelegationDepthExceededError`.

4. **Validate scope subset** — call `validateScopeSubset(delegatorVC.credentialSubject.privilegeScopes, params.requestedScopes)`. Throws `DelegationScopeEscalationError` on violation.

5. **Resolve delegatee DID** — call `didService.resolveDID(params.delegateeAgentDid)`. Throw `VCSubjectDIDNotFoundError` if not found.

6. **Issue child VC** — call `issueVC` with:
   - `subjectDid: params.delegateeAgentDid`
   - `privilegeScopes: params.requestedScopes`
   - `agentName` — resolve from delegatee DID document metadata or use delegateeAgentDid as fallback
   - `expiresInSeconds: params.expiresInSeconds`
   - Extra fields: `delegatedFrom: delegatorDid`, `delegationDepth: delegatorVC.delegationDepth + 1`, `maxDelegationDepth: rootMaxDelegationDepth`, `parentVcId: delegatorVcId`
   - `rootMaxDelegationDepth` — if delegator is root (depth 0) use its `maxDelegationDepth`; if delegator is itself delegated, traverse up to root to retrieve `maxDelegationDepth` (one extra `findByVcId` call) - decide between this and the below point
   - `maxDelegationDepth` is inherited from the parent VC's `credentialSubject.maxDelegationDepth`

7. **Emit `VC_DELEGATED` audit event** — include both vcIds, both DIDs, depth.

8. Return result.

### `helix-api/src/services/vp/vp.service.ts` — extend `verifyVP` for chain

After step 9 (extract embedded VC from `signedVP.verifiableCredential[0]`), add chain detection and verification:

**Step 9a — detect chain:**
Check if embedded leaf VC has `credentialSubject.delegationDepth > 0`. If yes, proceed with chain verification. If 0 or absent, proceed with existing single-VC path.

**Steps 9b–9e (chain path only):**

9b. **Reconstruct chain from DB** — follow `credentialSubject.parentVcId` from the leaf VC through stored parent records until the root is reached. If any parent returns null, log `CHAIN_REJECTED` with `internalReason: 'parent_vc_not_found'`, return `VPVerificationFailedError`.

9c. **Verify each VC in chain** — for each VC (including leaf):
- Check `validUntil` is in future — if not, log `vc_expired`, return `VPVerificationFailedError`
- Check revocation status via `vcService.getVCStatus(vc.id)` — if revoked, log `vc_revoked`, return `VPVerificationFailedError`
- Verify VC signature against `HELIX_SIGNING_KEY` public key using `verifySignature` (all VCs signed by Helix ID) — if invalid, log `chain_signature_invalid`, return `VPVerificationFailedError`

9d. **Validate chain integrity** — call `validateChainIntegrity(chain)`. If throws, log specific reason from exception, return `VPVerificationFailedError`.

9e. **Resolve holder DID per link** — for each link, call `didService.resolveDID(link.credentialSubject.id)` to confirm the holder DID is still active (not deactivated). If any resolution fails or returns deactivated, log `holder_did_invalid`, return `VPVerificationFailedError`.

9f. **Resume existing path** at step 10 (check expiry — already done per link above, skip for leaf and go to step 12 atomic consumption).

Emit `CHAIN_VERIFIED` audit event on success.

**Important:** All chain rejection reasons are internal audit log only. The HTTP response for any chain failure is always `VP_VERIFICATION_FAILED` per EH-4.

---

## 6.5 — Route Layer

### `helix-api/src/routes/vc/index.ts` — add route

```
POST /v1/vcs/delegate
```

Requires `x-admin-api-key`.

The route plugin receives both `vcService` and `vpService` — the delegate endpoint needs to verify the delegator VP, which is handled by `vpService`.

JSON Schema for request body per AC-4. `delegatorVP` typed as `object` (same pattern as VP verify route — Zod handles deep validation in service).

Route handler extracts `requestId`, delegates to `vcService.delegateVC(params, requestId)`. On `VPVerificationFailedError` always return 400 with opaque `VP_VERIFICATION_FAILED` code (EH-4 applies here too).

---

## 6.6 — SDK Changes

### `helix-sdk-js/src/client/HelixClient.ts` — add `delegate()`

```typescript
async delegate(options: {
  delegateeAgentDid: string;
  requestedScopes: string[];
  expiresInSeconds?: number;
  walletPassphrase: string;
  walletFilePath: string;
}): Promise<DelegateVCResult>
```

Steps:
1. Load wallet: `AgentWallet.load(options.walletPassphrase, options.walletFilePath)` — retrieves `did`, `vcJson`, `privateKeyHex`
2. Request VP template: call `POST /v1/vp/template` with agent's own DID, `userDid: delegateeAgentDid`, `targetService: 'helix-delegation'`, and `vcType: 'HelixAgentCredential'`
3. Sign VP locally: `new VPBuilder(unsignedVP).sign(privateKeyHex, \`\${wallet.did}#key-1\`)`
4. Call `POST /v1/vcs/delegate` with signed VP + other params
5. Return result — caller stores the returned child VC however they need to (typically transmit to Agent B out of band)

Add error mappings in `HttpAdapter.ts` for all delegation error codes.

---

## 6.7 — Tests

### Unit Tests — `helix-core/tests/unit/schemas/delegation.test.ts`

- `validateScopeSubset(['read:orders', 'write:orders'], ['read:orders'])` — passes (no throw)
- `validateScopeSubset(['read:orders'], ['read:orders', 'write:orders'])` — throws `DelegationScopeEscalationError` with escalated scope in message
- `validateScopeSubset(['read:orders'], ['read:orders'])` — passes (identical scopes allowed)
- `validateChainIntegrity` — valid 2-deep chain passes
- `validateChainIntegrity` — chain where link 1's `delegatedFrom` does not match link 0's `id` throws
- `validateChainIntegrity` — chain where link 1's scopes are not a subset of link 0's throws
- `validateChainIntegrity` — chain where `delegationDepth` values are not sequential throws
- `validateChainIntegrity` — chain where leaf `delegationDepth` exceeds root `maxDelegationDepth` throws
- `extractChainFromVC` — leaf with no `parentVcId` returns single-element array
- `extractChainFromVC` — leaf with 2-deep ancestry returns 3-element array root-first

### Integration Tests — `helix-api/tests/integration/delegation.integration.test.ts`

Setup: real PostgreSQL, real DID service, real VC service, real VP service. `afterEach` truncates tables.

Tests:

- Full delegation: issue root VC for agentA, call `POST /v1/vcs/delegate` with valid delegator VP → 201, child VC has correct `delegationDepth: 1`, `delegatedFrom: agentA.did`, scopes are subset
- Delegated VC verify: build VP with delegated VC embedded, call `POST /v1/vp/verify` → 200 `valid: true`
- Scope escalation: `requestedScopes` contains scope not in parent → 400 `DELEGATION_SCOPE_ESCALATION`
- Depth exceeded: root VC has `maxDelegationDepth: 1`, attempt second delegation → 400 `DELEGATION_DEPTH_EXCEEDED`
- Delegation not permitted: root VC has `maxDelegationDepth: 0` (default) → 403 `DELEGATION_NOT_PERMITTED`
- Revoked parent VC in chain: revoke agentA's VC, Agent B presents VP with that chain → 400 `VP_VERIFICATION_FAILED`; audit log contains `internalReason: 'vc_revoked'`
- Invalid delegator VP: malformed VP in delegate request → 400 `VP_VERIFICATION_FAILED`

### Security Tests — `helix-api/tests/security/delegation.security.test.ts`

- **Scope escalation blocked:** Attempt `requestedScopes: ['write:orders']` when delegator VC only has `['read:orders']` → 400. DB: no child VC created.
- **Chain tamper:** Retrieve delegated VP, modify `delegationDepth` in embedded VC JSON, re-submit → 400 `VP_VERIFICATION_FAILED`; audit log `internalReason: 'chain_signature_invalid'`. The signature covers the full VC including depth field — tampering breaks it.
- **Depth enforcement:** Create chain: root (maxDepth=1) → A (depth=1). Attempt to delegate from A (depth=1, maxDepth=1) → 400 `DELEGATION_DEPTH_EXCEEDED`. No VC created.
- **Revoked intermediary:** root → A (depth 1) → B (depth 2). Revoke A's VC. B presents VP with full chain → 400 `VP_VERIFICATION_FAILED`; audit `internalReason: 'vc_revoked'` for A's vcId.
- **External response is opaque:** All chain failures above return identical `VP_VERIFICATION_FAILED` code. `internalReason` never in HTTP response body.
- **maxDelegationDepth cannot increase:** Root VC has `maxDelegationDepth: 1`. Attempt to issue delegation with any override to increase it → child VC's `maxDelegationDepth` in DB is still 1.

### SDK Unit Tests — `helix-sdk-js/tests/unit/client/delegation.test.ts`

- `delegate()` loads wallet, calls VP template, signs VP locally, calls delegate endpoint
- Private key is not present in the delegate API request body
- After `delegate()`, wallet file is unchanged (delegation does not modify Agent A's wallet)

---

## Story 6 Acceptance Criteria

- [ ] `POST /v1/vcs/delegate` verifies delegator authority via VP, enforces scope subset, issues child VC signed by Helix ID
- [ ] Delegated VC carries `delegatedFrom`, `delegationDepth`, `maxDelegationDepth`, `parentVcId` in `credentialSubject`
- [ ] `maxDelegationDepth` at root issuance requires explicit opt-in — default is 0 (no delegation)
- [ ] `POST /v1/vp/verify` walks full chain — verifies every VC's signature, expiry, and revocation status
- [ ] Revoked intermediary VC blocks entire chain — verified by security test
- [ ] Scope escalation blocked at every level — chain integrity validation in helix-core is pure and fully unit tested
- [ ] All chain failures return opaque `VP_VERIFICATION_FAILED` — internal reason in audit log only
- [ ] `CHAIN_VERIFIED` and `CHAIN_REJECTED` audit events emitted correctly
- [ ] `VC_DELEGATED` audit event emitted on successful delegation
- [ ] SDK `delegate()` signs locally — private key never in API request
- [ ] OpenAPI spec updated for `POST /v1/vcs/delegate` and updated `POST /v1/enrollment-tokens` (`maxDelegationDepth` field)
- [ ] All delegation security tests pass and none are skipped
- [ ] Prisma migration is non-destructive — existing root VCs get nullable delegation fields, no data loss
