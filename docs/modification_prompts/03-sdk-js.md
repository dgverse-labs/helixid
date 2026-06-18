# Prompt 03 — `@helix-id/sdk-js` Modifications

## Dependency prerequisite
**Prompt 01 (helix-core) must be complete.** This package re-exports and wraps core functionality into the developer-facing SDK surface. All crypto logic lives in `helix-core` — do not reimplement it here.

## Context
`helix-sdk-js` lives at `helix-sdk-js/`. The goal is to make agent and verifier code completely free of `HelixClient` and API URLs. After this prompt, `HelixClient` is restricted to enrollment only. `verifyVP()`, `VPBuilder`, and `delegate()` are standalone exports that require no API URL and no `HelixClient` instance.

---

## Changes required

### 1. Standalone `verifyVP` export

Re-export from `helix-core` with any SDK-level convenience wrappers:

```typescript
// helix-sdk-js/src/verify.ts
export { verifyVP } from '@helix-id/core'
export type { VerifyVPOptions, VerifyVPResult } from '@helix-id/core'
```

No additional logic needed — `helix-core` owns the implementation.

---

### 2. Standalone `VPBuilder` export

Re-export from `helix-core`:

```typescript
// helix-sdk-js/src/vp-builder.ts
export { VPBuilder } from '@helix-id/core'
export type { VPBuilderOptions } from '@helix-id/core'
```

---

### 3. Standalone `delegate` export

Re-export from `helix-core` with wallet-aware wrapper:

```typescript
// helix-sdk-js/src/delegation.ts
import { buildDelegationVC } from '@helix-id/core'
import type { AgentWallet } from './wallet'

export interface DelegateOptions {
  to: string
  scopes: string[]
  expiresIn: number
  fromVC?: SignedVC     // defaults to wallet.credentials[0] if not provided
}

export async function delegate(
  options: DelegateOptions,
  wallet: AgentWallet
): Promise<SignedVC>
```

Defaults `fromVC` to `wallet.credentials[0]` if not provided. Throws `NO_CREDENTIAL_IN_WALLET` if wallet has no credentials.

---

### 4. Standalone `checkScope` export

```typescript
// helix-sdk-js/src/scope.ts
export function checkScope(result: VerifyVPResult, requiredScope: string): boolean {
  return result.privilegeScopes.includes(requiredScope)
}

export function requireScope(result: VerifyVPResult, requiredScope: string): void {
  if (!checkScope(result, requiredScope)) {
    throw new HelixError('INSUFFICIENT_SCOPE', `Required scope: ${requiredScope}`)
  }
}
```

---

### 5. `AgentWallet` additions

Add to existing `AgentWallet` class in `helix-sdk-js/src/wallet.ts`:

**Static `create()` method:**
```typescript
static async create(walletPath: string, passphrase: string): Promise<AgentWallet>
```
- Checks if `walletPath` already exists — if yes, throw `WALLET_ALREADY_EXISTS` with message: 'Wallet file already exists. Use AgentWallet.load() to load an existing wallet.'
- Generates fresh Ed25519 keypair
- Derives `did:key` from public key
- Creates wallet with empty `credentials[]`
- Encrypts and saves to `walletPath`
- Returns loaded wallet instance

**`addCredential()` method:**
```typescript
async addCredential(vc: SignedVC): Promise<void>
```
- Validates VC has `credentialSubject.id === this.did` — throws `CREDENTIAL_NOT_FOR_THIS_AGENT` if not
- Checks for duplicate `vcId` — throws `CREDENTIAL_ALREADY_IN_WALLET` if duplicate
- Appends to `this.credentials[]`
- Re-encrypts and saves wallet file

**`selfIssueVC()` method:**
```typescript
async selfIssueVC(options: SelfIssueOptions): Promise<SignedVC>
```
- Delegates to `helix-core` `selfIssueVC()` with wallet's did and privateKeyHex
- Automatically calls `this.addCredential()` with the result
- Returns the signed VC

---

### 6. `HelixClient` restrictions

Modify `helix-sdk-js/src/client.ts`:

**Remove these methods entirely:**
- `createVPTemplate()` — VPBuilder handles this locally now
- `verifyVP()` — standalone function now
- `delegate()` — standalone function now

**Keep these methods — enrollment only:**
- `requestOnboardingChallenge()`
- `completeOnboarding()`

**Add SDK-only constructor overload:**
```typescript
/**
 * For Platform Operator enrollment use only.
 * Agent and verifier code should not use HelixClient.
 * Use verifyVP(), VPBuilder, delegate() standalone functions instead.
 */
export class HelixClient {
  constructor(apiUrl?: string) {
    if (!apiUrl) {
      this.sdkOnlyMode = true
    }
  }
}
```

If `sdkOnlyMode` is true and an enrollment method is called, throw `SDK_ONLY_MODE_NO_API` with message: 'This operation requires a HelixID API URL. Pass the API URL to HelixClient constructor: new HelixClient("http://your-api")'

---

### 7. Update package exports — `helix-sdk-js/src/index.ts`

Restructure exports with clear grouping:

```typescript
// ─── Agent ───────────────────────────────────────────────
export { AgentWallet } from './wallet'
export { VPBuilder } from './vp-builder'
export { delegate } from './delegation'

// ─── Verifier ────────────────────────────────────────────
export { verifyVP } from './verify'
export { checkScope, requireScope } from './scope'

// ─── Enrollment only (Platform Operator setup) ───────────
export { HelixClient } from './client'

// ─── Types ───────────────────────────────────────────────
export type {
  VerifyVPOptions,
  VerifyVPResult,
  DelegationLink,
  VPBuilderOptions,
  SelfIssueOptions,
  SignedVP,
  SignedVC,
} from '@helix-id/core'
```

---

### 8. Remove `@hashgraph/sdk` dependency

Remove from `helix-sdk-js/package.json` if present. SDK must have zero Hedera dependency.

---

## Test coverage required

| Test | What to verify |
|---|---|
| `AgentWallet.create()` | Creates wallet, derives did:key, saves encrypted file |
| `AgentWallet.create()` | Throws `WALLET_ALREADY_EXISTS` if file exists |
| `AgentWallet.load()` | Loads existing wallet correctly |
| `wallet.addCredential()` | Adds VC, rejects wrong agent DID, rejects duplicate |
| `wallet.selfIssueVC()` | Issues self-signed VC, adds to wallet automatically |
| `VPBuilder` | Builds and signs VP without API call |
| `verifyVP()` | Verifies VP without API call |
| `delegate()` | Defaults to wallet.credentials[0] |
| `delegate()` | Throws `NO_CREDENTIAL_IN_WALLET` on empty wallet |
| `checkScope()` | Returns true/false correctly |
| `requireScope()` | Throws `INSUFFICIENT_SCOPE` when scope missing |
| `HelixClient` | Throws on removed methods (createVPTemplate etc.) |
| `HelixClient()` no args | SDK-only mode, throws on enrollment methods |
| Zero Hedera import | `@hashgraph/sdk` not in dependency tree |
