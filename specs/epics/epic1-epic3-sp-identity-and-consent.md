# HelixID — Epic 1 + Epic 3 Implementation Handover Guide

**Purpose of this doc:** you should be able to work through this
top-to-bottom and make every code change needed for Epic 1 (SP Identity
& Revocation Infra) and Epic 3 (Consent Package: Grant Issuance &
Revocation) without needing to sit in on the design discussion that
produced it. Every task below names the exact file(s), what changes, and
why. Where a new function is needed, a signature is given — treat it as
a strong suggestion, not a contract cast in stone, but don't deviate
without a reason.

**One thing is deliberately left open** — see Part E. Everything else
here is a locked decision. Implement it as stated.

**Companion docs, for background only (you shouldn't need to re-read
these to do the work, but they're the paper trail if something here is
unclear):**
- `helixid-consolidated-decision-log.md`
- `helixid-vp-generation-verification-dev-design.md` (owns the VP/grant
  *composition* — i.e. what happens after the agent has a grant VC in its
  wallet. Not your concern for this handover.)
- `epic1-epic3-code-analysis.md` (the original file-by-file code read
  that grounded these decisions)

**Scope boundary:** stop at "the agent holds a signed grant credential in
its wallet." Building `[agentVC, grantVC]` into a VP, and verifying it,
belongs to the separate VP doc — don't implement or modify that here.

---

## Part A — Epic 1: SP Identity & Revocation Infra

### A1. Export `VCBaseSchema`

**File:** `helix-core/src/schemas/vc.ts`

Currently:
```ts
const VCBaseSchema = z.object({ ... });   // no export
```

Change to:
```ts
export const VCBaseSchema = z.object({ ... });
```

**Why:** Epic 3's new grant schema (§B1) needs to `VCBaseSchema.extend({...})`
from a different file. One-line change, but it's a hard prerequisite for
Part B — do this first.

---

### A2. Fix status-list `@context` to use `VC_CONTEXTS`

**File:** `helix-core/src/status-list/index.ts`

In `buildStatusListCredential()`, currently hardcoded:
```ts
'@context': [
  'https://www.w3.org/ns/credentials/v2',
  'https://www.w3.org/ns/credentials/status/v1'
],
```

Replace with:
```ts
import { VC_CONTEXTS } from '../schemas/vc.js';
// ...
'@context': [...VC_CONTEXTS],
```

**Why:** consistency with every other credential builder in the repo.
`VC_CONTEXTS` is a readonly tuple — spread it since this field expects a
mutable `string[]`.

**Call out explicitly in your PR description:** this changes the actual
`@context` URL served by every status list, `helix-api`-hosted or
SP-hosted. Nothing is in production yet, so this is safe, but it's a
real shape change to a credential every verifier fetches — don't let it
read as a cosmetic diff in review.

---

### A3. Add runtime schema validation for fetched status lists

**No zod schema exists for `StatusListCredential` today** — only the TS
interface in `helix-core/src/status-list/index.ts`:
```ts
export interface StatusListCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    type: 'BitstringStatusList';
    statusPurpose: 'revocation';
    encodedList: string;
  };
}
```

**New file:** `helix-core/src/status-list/schema.ts`

```ts
import { z } from 'zod';

export const StatusListCredentialSchema = z.object({
  '@context': z.array(z.string()).min(1),
  id: z.string(),
  type: z.array(z.string()),
  issuer: z.string(),
  validFrom: z.string(),
  credentialSubject: z.object({
    id: z.string(),
    type: z.literal('BitstringStatusList'),
    statusPurpose: z.literal('revocation'),
    encodedList: z.string(),
  }),
});
```

**Call site:** wherever the revocation check fetches
`vc.credentialStatus.statusListCredential` and currently does
`await response.json() as StatusListCredential` — this is in
`helix-core/src/vp-verifier.ts`'s revocation-check logic. Before this
change it's a straight cast with no validation.

**Required behavior change at that call site:**
1. `StatusListCredentialSchema.safeParse(json)` the fetched response.
2. On success → proceed to `getBit()` as today.
3. On failure → **treat the credential as revoked/untrusted** (fail
   closed). Do not throw an unhandled cast error, do not silently
   proceed with a garbage `encodedList`. Reuse whatever error type the
   revocation-check path already throws for "revoked" (`VCRevokedError`
   or equivalent) so callers don't need a new catch branch.

This applies to both `helix-api`-hosted and SP-hosted lists — one shared
format, one validation path, no special-casing by host.

---

### A4. Remove the service registry — full checklist

**This touches four packages. Do it as one coordinated PR, not a
partial deletion — a half-removed registry (e.g. routes gone but SDK
methods still calling them) is worse than not starting.**

**Before deleting anything:** grep the whole repo for `listServices`,
`getService(`, `registerService`, `/v1/services` to catch any caller not
listed below. The list below is confirmed from the code-analysis pass,
but re-verify against current `main` before you delete — code may have
moved since that pass.

**`helix-api`:**
- `helix-api/src/routes/agent/index.ts` — delete the three route
  handlers: `GET /services`, `GET /services/:serviceName`,
  `POST /services`. This file has other, unrelated routes
  (`/enrollment-tokens`, `/enroll`, `/onboard`, `/onboard/verify`,
  `/challenges`, `/challenges/:challengeId/verify`) — **do not touch
  those**, this is a surgical removal of three route blocks, not a file
  deletion.
- `helix-api/src/services/agent/agent.service.ts` — remove
  `listServices()`, `getService()`, `createService()`. Remove the
  now-unused imports: `ServiceNotFoundError`, `ServiceAlreadyExistsError`,
  `ensureServiceName()`. Leave `VALIDATION_ERROR` alone — it's still used
  by other code paths in this file.
- `helix-api/src/services/agent/IAgentService.ts` — remove the three
  corresponding interface method signatures.
- `helix-api/src/openapi/openapi.yaml` (or wherever OpenAPI is defined)
  — remove the three paths.

**`helix-sdk-js`:**
- `helix-sdk-js/src/client/HelixClient.ts` — remove `listServices()`,
  `getService()`, `registerService()`. Regenerate any generated `.js`/
  `.d.ts` copies that mirror these exports (run whatever the repo's
  build/codegen step is — don't hand-edit generated files).

**`console`:**
- `console/src/pages/ServicesPage.tsx` — **delete the file entirely.**
  Nothing replaces it — this is a confirmed product decision, not a
  placeholder to fill in later.
- Remove its route/nav entry wherever the Console's routing/nav config
  lives (find the entry that links to this page — likely in a router
  config or a sidebar/nav component).
- `console/src/api/client.ts` — remove `listServices()` (~line 86) and
  `registerService()` (~line 90).

**Tests (all three packages):**
- `helix-api/tests/integration/agent.integration.test.ts` — remove the
  tests exercising the three HTTP routes.
- Agent service unit tests — remove tests calling `getService()`/
  `createService()` directly. (Leave repository-level `createService()`
  calls inside VP/security test *setup*, if any exist — those are a
  lower-level fixture helper, unrelated to the registry being removed.)
- SDK tests — remove tests calling `listServices()`, `getService()`,
  `registerService()`.
- Console tests — remove tests exercising the Services page/list/
  registration behavior.

**Docs:**
- `major-flows.md` — delete §7 ("Service Registry") entirely.
- `public-surfaces.md` — remove the three HTTP API rows and the three
  SDK method rows (`listServices`, `getService`, `registerService`).
- `README.md` — remove the "Register your service" section and its
  `curl -X POST $API_BASE_URL/v1/services ...` example. Note: other parts
  of the README reference `orders-service` as a `targetService` — that
  concept (a string identifying a target service in a VP) doesn't depend
  on the registry existing; don't remove those references, only the
  registration mechanism itself.

**Do not touch (out of scope for this epic, tracked separately under
Epic 5):** `helixid-setup` seeder currently calls `POST /v1/services` to
pre-register the demo booking backend. It needs to switch to
`POST /v1/dids` instead, but that's Epic 5 work. If your registry removal
breaks the seeder, that's expected — flag it, don't fix it here unless
asked.

---

### A5. `did:web` + status-list as a single onboarding command

**File:** `packages/cli/src/commands/did.ts`

In the `--method web` branch, after the existing steps (generate
keypair → `buildDIDDocument()` → `saveNewWallet()` → print DID document +
hosting instruction), **add a step that runs status-list creation by
default**, reusing the logic already in
`packages/cli/src/commands/status-list.ts` (`loadIssuerKeyMaterial()` →
`buildCliStatusListPayload()` → `signCredential()`/`createEd25519Proof()`
after A/B7's merge → write to `--output`).

**Add a flag to opt out:** `--no-status-list` (or `--skip-status-list` —
pick one, be consistent with the repo's existing flag-naming convention).
When passed, skip the new step and behave exactly as today.

**Update the printed operator instructions** to cover both artifacts:
today it prints one line ("host this DID document at
`.well-known/did.json`"). It now needs to also say the status-list JSON
needs hosting at whatever `--base-url`/path was used — this is now one
command producing two files that both need deploying.

**Update the README / onboarding docs** wherever this command is
documented (`public-surfaces.md`'s CLI table, `README.md`'s SP
identity/onboarding section if one exists) to reflect the new default
behavior and the opt-out flag.

---

## Part B — Epic 3: Grant Issuance, Revocation, Wallet Assignment

### B1. `DelegationGrantCredential` schema

**New file:** `helix-core/src/schemas/delegation-grant.ts`

```ts
import { z } from 'zod';
import { VCBaseSchema, VCCredentialStatusSchema, VC_CONTEXTS } from './vc.js';

export const DelegationGrantVCSchema = VCBaseSchema.extend({
  type: z.array(z.string()).superRefine((val, ctx) => {
    if (!val.includes('VerifiableCredential') || !val.includes('DelegationGrantCredential')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Delegation Grant VC types' });
    }
  }),
  credentialSubject: z.object({
    id: z.string(),                 // agent DID being authorized
    type: z.literal('DelegationGrant'),
    userDid: z.string(),            // DID or plain email string
    scopes: z.array(z.string()),
    durability: z.enum(['standing', 'session']),
    serviceDid: z.string().optional(),
  }),
});
```

Notes:
- `'@context'`: use `[...VC_CONTEXTS]`, same as A2 — don't hardcode.
- `validFrom`/`validUntil` are mandatory on `VCBaseSchema` — there is no
  "no expiry" value. For a `standing` grant, generate a concrete
  far-future `validUntil` (pick a sane default, e.g. 10 years out — this
  isn't specified further, use your judgment and note it in the PR).
- `credentialStatus`: reuse `VCCredentialStatusSchema` as-is, no changes
  needed there.
- This depends on A1 (`VCBaseSchema` export) — don't start this file
  until A1 is merged.

**Also update:** wherever `type HelixVC = AgentVC | UserVC` is defined
(in `helix-core/src/schemas/vc.ts`), widen it to
`AgentVC | UserVC | DelegationGrantVC` **only** where the codebase treats
"any VC" generically — e.g. `AgentWallet.credentials`'s default type
parameter in `helix-sdk-js/src/wallet/AgentWallet.ts`. **Do not** touch
`validateScopeSubset()`/`validateChainIntegrity()` — those are typed
against `AgentVC[]` specifically and should stay that way; they don't
apply to grants.

---

### B2. Grant issuance function

**New file:** `helix-core/src/grant.ts` (name illustrative — match
whatever convention `delegation.ts` uses as a sibling)

Model this on `delegate()` in `helix-core/src/delegation.ts` for
*pattern* only (local, wallet-signed, throws on invalid input) — **do
not call or extend `buildDelegationVC()`**, the grant's
`credentialSubject` shares no fields with an agent VC's subject.

```ts
export interface IssueGrantOptions {
  agentDid: string;
  userDid: string;
  scopes: string[];
  durability: 'standing' | 'session';
  serviceDid?: string;
  statusList: StatusListCredential;       // current list, unmodified
  statusListCredentialUrl: string;        // public URL of the list above
}

export async function issueGrant(
  options: IssueGrantOptions,
  issuerWallet: IssuerKeyMaterial,
): Promise<{ grantVC: SignedVC; updatedStatusList: StatusListCredential }> {
  // 1. pick a random index within options.statusList's bit length (see B3)
  // 2. build credentialStatus per VCCredentialStatusSchema, pointing at
  //    options.statusListCredentialUrl and the chosen index
  // 3. build the DelegationGrantVCSchema-shaped payload — no
  //    delegationChain field, ever
  // 4. sign via createEd25519Proof() (after B5's merge — this is the
  //    only signer in the codebase at that point)
  // 5. return the signed grant VC AND the updated status list (bit set
  //    for the new index is NOT required at issuance — issuance doesn't
  //    set bits, only revocation does, same as the existing agent-VC
  //    issuance pattern)
}
```

**Important: no `delegationChain` field.** The sibling function this is
modeled on (`buildDelegationVC()`) always populates
`delegationChain: [...parentChain, options.fromVC]`. The grant builder
must explicitly **not** do this — write a test asserting the field is
absent from the signed grant VC.

**Persistence responsibility:** this function does not persist anything
itself (no file I/O, no DB write) — it returns the signed VC and expects
the caller (the SP's own backend code) to store it. This matters because
of B4 below: without the SP persisting the returned `grantVC`, it has no
way to revoke by VC later.

---

### B3. Index allocation: random assignment (decided — see Part E for
what's still open)

At issuance time (inside `issueGrant()`, B2), assign a **random
`statusListIndex`** within the target status list's bit length. Do
**not** implement or extend `findNextAvailableIndex()`'s "first zero bit"
scan — that function has a confirmed bug (issuance never sets bits, so
multiple active credentials can collide on index 0) and is not the model
here.

```json
{
  "credentialStatus": {
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "94567",
    "statusListCredential": "https://issuer.example/status/3"
  }
}
```

No registry, no counter, no persisted "used indices" structure is needed
for this to work — collision is accepted as improbable given a
reasonably large list length (existing CLI guidance: 100k+ bits,
unused bits are free — pick a generous `--length` at status-list creation
time, this doesn't need to be enforced in code, just noted in onboarding
docs).

**Do not build anything more sophisticated than
`Math.floor(Math.random() * listLength)` for this.** See Part E —
whether a stronger guarantee is needed is an open question for later,
not something to preempt here.

---

### B4. Grant revocation function

**New file:** `helix-core/src/revoke-grant.ts` (or add alongside B2 in
`grant.ts` — your call, keep it close to the issuance function)

```ts
export type RevokeGrantTarget =
  | { vc: SignedVC }
  | { statusListIndex: string };

export async function revokeGrant(
  currentStatusList: StatusListCredential,
  issuerWallet: IssuerKeyMaterial,
  target: RevokeGrantTarget,
): Promise<StatusListCredential> {
  const index = 'vc' in target
    ? target.vc.credentialStatus?.statusListIndex
    : target.statusListIndex;

  if (!index) {
    throw new /* appropriate error from the consolidated taxonomy, B7 */ Error(
      'No statusListIndex available to revoke — VC has no credentialStatus, or no index was provided',
    );
  }

  // flip the bit at `index` in currentStatusList.credentialSubject.encodedList
  // re-sign via createEd25519Proof()
  // return the updated StatusListCredential — caller persists it
}
```

**Decided input shape (do not deviate):**
- **If given the grant VC:** read `credentialStatus.statusListIndex`
  directly off it. No side-registry lookup — nothing like the CLI's
  `helixIndexRegistry` pattern.
- **If given only an index:** use it as-is.
- **Whichever the SP provides is the SP's responsibility to get right.**
  HelixID does not maintain a `vcId → index` mapping anywhere in this
  path — an SP that revokes by index and gets the index wrong will
  revoke the wrong grant. This is an intentional simplification: since
  the SP already has to persist the signed grant VC it issued (to
  re-serve/reference/display it), the VC-object path should be the
  common case in practice; the index-only path exists for SPs that, for
  whatever reason, only have the bare index on hand.

**Object-in/object-out, not file-in/file-out.** Unlike the existing
`helix revoke` CLI (which reads a status-list file from disk, flips a
bit, writes back to the same path, and prints a manual "now redeploy"
instruction), this function takes the current `StatusListCredential`
object and returns the updated one. The caller decides how to persist it
(DB row, object storage, file — whatever the SP already uses). Do not
couple this function to file I/O the way the CLI command is.

---

### B5. Merge `signCredential()` into `createEd25519Proof()`

**File:** `packages/cli/src/lib/issuer-ops.ts`

`signCredential()` today independently reimplements the same essential
operation as `helix-core`'s `createEd25519Proof()` — it does
`signBytes(hashCanonicalPayload(credential), privateKeyHex)` and
constructs an `Ed25519Signature2020` proof using `${issuerDid}#key-1`
itself, rather than calling the shared function.

**Task:** replace `signCredential()`'s internals with a call to
`createEd25519Proof()` from `helix-core`. The function's external
signature/call sites can stay the same — this is an internal
implementation swap, not an API change for existing callers
(`buildCliStatusListPayload()`, `issueAgentCredential()`, and now the new
grant-issuance path in B2 all end up calling the same signer).

**Required: regression tests.** Add a test file (e.g.
`packages/cli/tests/issuer-ops.signCredential.test.ts`) that:
1. Signs a fixed test payload with a fixed test key using the **old**
   `signCredential()` implementation (keep a copy of the old code path
   temporarily, or capture its output before you delete it) and records
   the exact signature bytes / proof object.
2. Signs the same payload with the **new** implementation (delegating to
   `createEd25519Proof()`).
3. Asserts byte-identical output between the two.

This protects both the existing CLI status-list signing path (which must
not silently change behavior) and the new grant-issuance path (which
should have exactly one signer to reason about, not two).

---

### B6. `AgentWallet.selectGrant()`

**File:** `helix-sdk-js/src/wallet/AgentWallet.ts`

No change needed to `addCredential()` — its ownership check
(`credentialSubject.id === this.did`) already works correctly for a
grant, since the grant schema's `credentialSubject.id` is the agent DID
being authorized, same as what the wallet checks today.

**New method needed** — `getLatestCredential({vcType}, ...)` only filters
by type + recency; it can't select "the grant for *this* SP and *this*
user." Add:

```ts
selectGrant(issuerDid: string, userDid: string): WalletCredential | undefined {
  // filter stored credentials where:
  //   - type includes 'DelegationGrantCredential'
  //   - issuer === issuerDid
  //   - credentialSubject.userDid === userDid
  // return the most recent match (mirror getLatestCredential's recency sort)
}
```

Mirror the LangChain adapter's existing `selectVC(wallet, targetService)`
pattern for structure/style consistency — nothing equivalent exists for
grants today, this is genuinely new code.

---

### B7. Error taxonomy consolidation

**File:** `helix-core/src/errors/HelixError.ts`

Two existing pairs of error classes cover conceptually similar ground:
- `MaxDelegationDepthExceededError`, `ScopeEscalationDeniedError` — in
  `helix-core/src/delegation.ts`.
- `DelegationChainInvalidError`, `DelegationScopeEscalationError` — in
  `helix-core/src/schemas/vc.ts` (used by `validateScopeSubset()`/
  `validateChainIntegrity()`).

**Task:**
1. Open `HelixError.ts` and list every existing exported error class and
   its constructor args.
2. Decide the merge/alias mapping for the four classes above into that
   shared file — e.g. do `MaxDelegationDepthExceededError` and any
   depth-related class collapse into one; does
   `ScopeEscalationDeniedError`/`DelegationScopeEscalationError` become
   one shared `ScopeEscalationError`. **This mapping is intentionally not
   pre-specified here** — you're doing this with the full file in hand,
   which nobody had at design time. Use your judgment, keep names
   consistent with the rest of the file's existing conventions.
3. Update the two source files (`delegation.ts`, `schemas/vc.ts`) to
   import and throw the consolidated classes instead of their own local
   ones.
4. New grant-issuance code (B2) throws from this same consolidated set
   for scope-escalation-shaped failures — e.g. a grant requesting scopes
   beyond what the issuing SP is itself authorized for should reuse the
   shared scope-escalation error, not introduce a fifth naming
   convention.

**Do not touch** `ConsentGrantSubjectMismatchError` /
`ConsentGrantInvalidError` — those are verification-time errors owned by
the separate VP doc and are structurally different (VP verification
failure vs. issuance-time policy violation). Leave them alone.

---

## Part C — Testing checklist

| Area | Test | Notes |
|---|---|---|
| A1 | `VCBaseSchema` importable from another file | trivial, but confirms Part B can proceed |
| A2 | `buildStatusListCredential()` output has `VC_CONTEXTS` values | assert exact array contents |
| A3 | Fetched status list — valid JSON parses and `getBit()` proceeds | happy path |
| A3 | Fetched status list — malformed JSON is rejected, treated as revoked | fail-closed, not an unhandled throw |
| A3 | Fetched status list — non-200/non-JSON response | existing revoked-error path still fires, unaffected by new validation |
| A4 | Repo-wide grep for registry references returns nothing after removal | routes, SDK methods, Console page, docs |
| A5 | `helix did create --method web` (default) produces both DID doc and status list | |
| A5 | `helix did create --method web --no-status-list` produces only the DID doc | opt-out path |
| B1 | `DelegationGrantVCSchema.parse()` accepts a well-formed grant, rejects a malformed one | missing `scopes`, wrong `durability` enum value, etc. |
| B2 | Issued grant VC has no `delegationChain` field | explicit assertion, this is the easy-to-regress part |
| B2 | Issued grant VC's `credentialStatus.statusListIndex` is within the status list's bit length | |
| B4 | `revokeGrant()` given a VC — correct index flipped | |
| B4 | `revokeGrant()` given a bare index — correct index flipped | |
| B4 | `revokeGrant()` given neither — throws a clear error | |
| B5 | Old vs. new `signCredential()` — byte-identical signature output | the regression test itself, see B5 |
| B6 | `selectGrant(issuerDid, userDid)` — returns correct grant among multiple stored credentials of mixed types | include an agent VC and a grant for a *different* SP/user in the wallet to confirm filtering actually filters |
| B7 | Existing callers of the four original error classes still throw *an* error (via the consolidated class) on the same bad inputs | regression, not new behavior |

**Regression suite (do not skip):** all four existing
`e2e-travel-concierge` demo scenarios (Search vs. Book, Delegate to a
Sub-Agent, Revoke Mid-Flight, Onboard a New Agent Live) must still pass
unmodified after every change in this doc. None of them touch grants, so
they're a good sanity check that Epic 3's additions haven't disturbed
existing agent-VC paths.

---

## Part D — Suggested order of work

1. **A1** (export `VCBaseSchema`) — unblocks B1.
2. **A2, A3** — independent of everything else, do anytime.
3. **B5** (signer merge + regression test) — do this before B2/B4, so the
   grant issuance/revocation functions you write next call the final,
   single signer from the start rather than being refactored later.
4. **B1, B2, B3** (schema → issuance, in that order — B3's random-index
   logic lives inside B2).
5. **B4** (revocation).
6. **B6** (wallet selector) — depends on B1's schema existing so you know
   what `type` string to filter on.
7. **B7** (error consolidation) — do this once you're touching
   `delegation.ts`/`schemas/vc.ts` enough to know exactly which throw
   sites need updating; fine to interleave with B2–B4 rather than
   treating as a separate pass.
8. **A4** (service registry removal) — largest surface area, most
   mechanical, no dependency on anything else in this doc. Good candidate
   to parallelize with someone else, or do last if you're working solo,
   since it's low-risk to sequence anywhere.
9. **A5** (single onboarding command) — depends on A2/A3 being done
   first, since it's producing the same status-list artifact those
   changes touch.
10. Run the full regression suite (Part C's last row) before considering
    either epic done.

---

## Part E — The one open item

**Index-allocation uniqueness (tracked as O4).** B3 has you assign a
random index at issuance and accept collision risk as improbable given a
generously-sized list. **Whether a stronger guarantee is needed later —
collision detection, a monotonic counter, a DB-backed allocator for the
`helix-api`-hosted case — is explicitly not decided yet.** Don't build
anything toward that now. If collisions turn out to be an observed
problem, or if this needs revisiting before you ship, that's a
conversation to have separately — flag it, don't solve it preemptively
in this PR.

Everything else in this doc is a locked decision — implement as stated.
