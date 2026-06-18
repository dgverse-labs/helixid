# Prompt 01 — `helix-core` Modifications

## Dependency prerequisite
None. This is the foundation package. All other packages depend on it. Complete this first.

## Context
`helix-core` lives at `helix-core/` in the monorepo. It currently contains core crypto, schemas, errors, and StatusList helpers. We are adding: a unified DID resolver, VP construction logic, delegation VC construction, scope enforcement, and self-signed VC support. Hedera-specific resolution is NOT added here — that belongs in `@helix-id/did-hedera` (Prompt 02). The resolver in this package handles `did:key` and `did:web` only, with a conditional hook for `did:hedera` if the optional package is installed.

---

## Changes required

### 1. DID Resolver — `helix-core/src/did-resolver.ts`

Create a unified resolver with in-memory caching.

```typescript
export async function resolveDID(did: string): Promise<DIDDocument>
```

Rules:
- `did:key` — resolve locally using `@digitalbazaar/did-method-key` or equivalent. Zero network. Must work fully offline.
- `did:web` — derive URL from DID: `did:web:example.com` → `https://example.com/.well-known/did.json`, `did:web:example.com:agents:booking` → `https://example.com/agents/booking/did.json`. Fetch and validate. Cache with 5 minute TTL.
- `did:hedera` — attempt dynamic require of `@helix-id/did-hedera`. If not installed throw `DID_METHOD_NOT_AVAILABLE` with message: `did:hedera resolution requires: npm install @helix-id/did-hedera`. If installed, delegate to its resolver. Cache with 15 minute TTL.
- Any other method — throw `UNSUPPORTED_DID_METHOD: {did}`.

Cache implementation: simple `Map<string, { doc: DIDDocument, expiresAt: number }>`. Export `clearDIDCache()` for tests.

---

### 2. VP Builder Core — `helix-core/src/vp-builder.ts`

Move VP construction logic from `helix-api` into core. No API call involved.

```typescript
export interface VPBuilderOptions {
  vc: SignedVC
  holderDid: string
  targetService: string
  userDid: string
}

export class VPBuilder {
  constructor(options: VPBuilderOptions)
  async sign(privateKeyHex: string, verificationMethodId: string): Promise<SignedVP>
}
```

Rules:
- Generates a fresh `vpId` (UUID v4) internally on every `.sign()` call
- Sets `holder` to `holderDid`
- Sets `proof.verificationMethod` to `verificationMethodId`
- Sets `proof.created` to current ISO timestamp
- Embeds the VC inside `verifiableCredential[]`
- Signs the VP with Ed25519 using `privateKeyHex`
- Does not call any API or network — pure local crypto

---

### 3. VP Verifier Core — `helix-core/src/vp-verifier.ts`

```typescript
export interface VerifyVPOptions {
  expectedTargetService?: string
  allowSelfSigned?: boolean          // default false
}

export interface VerifyVPResult {
  valid: boolean
  agentDid: string
  privilegeScopes: string[]
  vpId: string
  delegationChain: DelegationLink[]
  warning?: string
  error?: string
}

export async function verifyVP(vp: SignedVP, options?: VerifyVPOptions): Promise<VerifyVPResult>
```

Verification steps in order:
1. Verify VP signature — resolve holder DID via `resolveDID()`, verify Ed25519 signature
2. Verify VC signature — resolve issuer DID via `resolveDID()`, verify Ed25519 signature
3. Check `validFrom` and `validUntil` — throw `VC_EXPIRED` or `VC_NOT_YET_VALID`
4. Check `credentialStatus` — fetch StatusList URL from VC, decode bitstring, check bit at `statusListIndex`. Throw `VC_REVOKED` if bit is 1.
5. Check `targetService` binding — if `expectedTargetService` provided, verify it matches VC
6. Self-signed check — if `issuer === credentialSubject.id` and `allowSelfSigned` is false, throw `SELF_SIGNED_VC_NOT_ALLOWED`. If true, add `warning: 'self-signed credential, not trusted in production'` to result.
7. Verify delegation chain if present — see delegation section below
8. Return `VerifyVPResult`

Note: vpId replay protection is NOT done here. Caller owns the store. `vpId` is returned in result for caller to check.

---

### 4. Delegation Core — `helix-core/src/delegation.ts`

```typescript
export interface DelegateOptions {
  to: string                  // delegatee did:key
  scopes: string[]            // requested scopes — must be subset of fromVC scopes
  expiresIn: number           // seconds
  fromVC: SignedVC            // parent VC
}

export async function buildDelegationVC(
  options: DelegateOptions,
  wallet: { did: string, privateKeyHex: string }
): Promise<SignedVC>
```

Rules:
- Enforce `options.scopes` is a strict subset of `options.fromVC.credentialSubject.privilegeScopes`. Throw `SCOPE_ESCALATION_DENIED` if not.
- Read `options.fromVC.credentialSubject.maxDelegationDepth`. Read current `delegationDepth` from parent VC (default 0). If `delegationDepth + 1 > maxDelegationDepth`, throw `MAX_DELEGATION_DEPTH_EXCEEDED`.
- Set `issuer` to `wallet.did` (agent self-signs — Option A)
- Set `credentialSubject.id` to `options.to`
- Set `credentialSubject.delegatedFrom` to `wallet.did`
- Set `credentialSubject.delegationDepth` to parent `delegationDepth + 1`
- Set `credentialSubject.privilegeScopes` to `options.scopes`
- Set `credentialSubject.maxDelegationDepth` to parent `maxDelegationDepth`
- Sign with `wallet.privateKeyHex`

Delegation chain verification in `verifyVP`:
- If VC has `delegatedFrom`, recursively verify the delegation chain
- Each hop must have scopes that are a subset of the previous hop
- `delegationDepth` must increment by 1 at each hop
- Root VC issuer must be a trusted issuer DID (not `did:key` — self-signed VCs cannot be delegation roots in production)

---

### 5. Self-Signed VC — `helix-core/src/self-signed.ts`

```typescript
export interface SelfIssueOptions {
  scopes: string[]
  expiresIn?: string           // e.g. '24h', '90d' — default '24h'
  maxDelegationDepth?: number  // default 0
}

export async function selfIssueVC(
  options: SelfIssueOptions,
  wallet: { did: string, privateKeyHex: string }
): Promise<SignedVC>
```

Rules:
- Sets `issuer` to `wallet.did`
- Sets `credentialSubject.id` to `wallet.did`
- Adds `evidence: [{ type: 'SelfSignedDevCredential', warning: 'Not for production use' }]`
- No `credentialStatus` field — self-signed VCs are not revocable
- Signs with `wallet.privateKeyHex`

---

### 6. Error codes — `helix-core/src/errors.ts`

Add these new error codes to existing error definitions:
```
DID_METHOD_NOT_AVAILABLE
UNSUPPORTED_DID_METHOD
SELF_SIGNED_VC_NOT_ALLOWED
SCOPE_ESCALATION_DENIED
MAX_DELEGATION_DEPTH_EXCEEDED
VC_EXPIRED
VC_NOT_YET_VALID
VC_REVOKED
VP_SIGNATURE_INVALID
VC_SIGNATURE_INVALID
```

---

### 7. Exports — `helix-core/src/index.ts`

Add to existing exports:
```typescript
export { resolveDID, clearDIDCache } from './did-resolver'
export { VPBuilder } from './vp-builder'
export { verifyVP } from './vp-verifier'
export { buildDelegationVC } from './delegation'
export { selfIssueVC } from './self-signed'
export type { VerifyVPOptions, VerifyVPResult, DelegationLink, VPBuilderOptions }
```

---

## Test coverage required

| Test | What to verify |
|---|---|
| `resolveDID('did:key:...')` | Resolves offline, no network call |
| `resolveDID('did:web:...')` | Fetches correct URL, caches result |
| `resolveDID('did:web:...')` | Cache hit on second call within TTL |
| `resolveDID('did:hedera:...')` | Throws `DID_METHOD_NOT_AVAILABLE` when package absent |
| `resolveDID('did:unknown:...')` | Throws `UNSUPPORTED_DID_METHOD` |
| `VPBuilder.sign()` | Produces valid VP, vpId is UUID v4, signature verifiable |
| `verifyVP()` | Valid VP returns `valid: true` |
| `verifyVP()` | Expired VC throws `VC_EXPIRED` |
| `verifyVP()` | Revoked VC (bit set) throws `VC_REVOKED` |
| `verifyVP()` | Self-signed VC throws `SELF_SIGNED_VC_NOT_ALLOWED` by default |
| `verifyVP({ allowSelfSigned: true })` | Accepts self-signed with warning |
| `buildDelegationVC()` | Scope escalation throws `SCOPE_ESCALATION_DENIED` |
| `buildDelegationVC()` | Depth exceeded throws `MAX_DELEGATION_DEPTH_EXCEEDED` |
| `buildDelegationVC()` | Valid delegation produces correct VC structure |
| `selfIssueVC()` | issuer === credentialSubject.id |
| `selfIssueVC()` | evidence contains `SelfSignedDevCredential` |
