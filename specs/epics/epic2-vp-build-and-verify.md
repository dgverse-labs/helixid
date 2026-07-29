# HelixID — VP Generation & Verification: Dev Design + Test Spec

**Status: ready to implement.** This supersedes an earlier draft of the
same name — that draft treated several things as open questions which are
now locked decisions, listed in §2. As of this revision, **all items in
§7 are resolved** — see each subsection for the decision. **Precondition:
Epic 1 (SP Identity & Revocation Infra) and Epic 3 (Consent Package) must
be complete before starting this epic** — §7.1's fix ships as part of
Epic 1, and the grant-array half of this doc depends on Epic 3's schema
and Epic 1's SP `did:web`/status-list infra.

**This doc is self-contained** — it doesn't assume you have the
conversation that produced it. It's a distilled fork of a broader
consolidated HelixID decision log; that log's §4/§5/§6 cover the
surrounding consent/grant/audit work if you need that context later, but
everything needed for VP generation and verification is repeated here.

**Audience:** implementing engineer, working directly in the repo. Where
this doc states a current-code fact, it's a compressed pointer, not a full
dump — open the actual file before writing a diff.

**Status key:** ✅ decided (implement as stated) · 🟩 recommended default
(implement it, but flag to your lead if you think it's wrong — don't just
silently pick something else) · 🔴 open (don't implement around this
without asking first).

---

## 1. Current code — compressed facts

**`helix-core/src/vp-builder.ts` (`VPBuilder`):** constructor takes
discrete fields — `vc: SignedVC`, `holderDid`, `targetService`, `userDid`
(all required today). Builds `id`/`nonce`/`expirationDate` internally.
Wire payload: `verifiableCredential: [vc]` (hardcoded 1 element),
`delegatedBy: userDid` (always serialized, unconditionally). Signs via
`createEd25519Proof(payload, privateKeyHex, verificationMethodId)`.

**`helix-core/src/vp-verifier.ts` (`verifyVP()`):** fully local — no
network calls except the revocation-status fetch. Reads
`vp.verifiableCredential[0]` (hardcoded index). Delegation-chain trust is
based entirely on the credential's own **embedded** `delegationChain`
array (`leaf.delegationChain ?? []`) — no database, no external lookups.
`verifyCredential(vc, options)` is a small generic helper (signature +
validity window + self-signed gate + revocation) that doesn't reference
`privilegeScopes` at all — it's subject-type-agnostic and directly
reusable for a grant credential with zero changes. Revocation check
(`verifyRevocation()`) already fetches whatever URL is in
`vc.credentialStatus.statusListCredential` — i.e. it's **already
issuer-agnostic**. **As of Epic 1 (task A3), the fetched response is
zod-parsed against `StatusListCredentialSchema` before use, failing
closed (treated as revoked/untrusted) on a parse failure** — this used to
be a straight, unvalidated cast (see §7.1).

**`helix-api/src/services/vp/vp.service.ts` (`VPService.verifyVP()`):** a
**second, independently-written verifier** — being retired per §2.1.
Ignores the embedded `delegationChain` field entirely; instead walks
`parentVcId` pointers via `this.vcService.findRecordByVcId()`, re-deriving
ancestry from `helix-api`'s own database. Revocation resolution is
hardcoded to a local `/v1/status-list/:listId` path + repository lookup
(`extractStatusListId()` + `vcService.getStatusList()`), not a network
fetch — this only works because agent VCs are always issued by this same
`helix-api` instance. Also contains `generateVPTemplate()` — **not listed
as a public route in the project's public-surfaces reference** (only
`POST /v1/vp/verify` is documented there); confirm whether this is
actually wired to a live endpoint before assuming it needs a deprecation
path (see §8).

**`helix-sdk-js/src/verify.js` and `helix-sdk-js/src/vp-builder.js`:**
confirmed pure re-exports —
`export { verifyVP } from '@helixid/core'` and
`export { VPBuilder } from '@helixid/core'`. There is only **one** real
implementation of each in the whole system.

**`helix-sdk-js/src/vp/VPBuilder.ts`:** a materially different,
**unexported**, orphaned file — different constructor (`UnsignedVP`-in,
caller pre-assembles the whole payload), different signing primitive
(`hashCanonicalPayload()` + `signBytes()` directly, not
`createEd25519Proof()`), and a static low-level `verify()` with no DID
resolution. Not the shipped surface. Treat as dead code (§8).

**`helix-core/src/delegation.ts` (`buildDelegationVC()`):** no change
needed. Delegator signs a child `HelixAgentCredential` locally (issuer =
parent DID, subject = child DID); child embeds its full signed ancestor
chain in `delegationChain` at creation.

**Schema files** (`helix-core/src/schemas/vc.ts`, `.../schemas/vp.ts`,
`helix-core/src/status-list/index.ts`) — exact current shapes:

```ts
// vc.ts
const VCBaseSchema = z.object({           // currently private — will be exported, see §2.6
  '@context': z.array(z.string()).min(1),
  id: z.string(),
  issuer: z.string(),
  validFrom: z.string().datetime(),        // mandatory, no "no expiry" value
  validUntil: z.string().datetime(),       // mandatory, no "no expiry" value
  credentialStatus: VCCredentialStatusSchema.optional(),
  proof: VCProofSchema.optional(),         // NOTE: optional even though the TS type SignedVC<T> requires it
});

export const AgentVCSchema = VCBaseSchema.extend({
  type: z.array(z.string()).superRefine((val, ctx) => {
    if (!val.includes('VerifiableCredential') || !val.includes('HelixAgentCredential')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Agent VC types' });
    }
  }),
  credentialSubject: AgentCredentialSubjectSchema,
});

export const VCCredentialStatusSchema = z.object({
  id: z.string().url(),
  type: z.literal('BitstringStatusListEntry'),
  statusPurpose: z.literal('revocation'),
  statusListIndex: z.string(),
  statusListCredential: z.string().url(),
});

export const VC_CONTEXTS = [
  'https://www.w3.org/ns/credentials/v2',
  'https://helixid.io/contexts/v1',
] as const;   // readonly tuple — spread as [...VC_CONTEXTS] where a mutable string[] is expected
```

```ts
// vp.ts
verifiableCredential: z.array(z.record(z.unknown())).min(1),   // -> needs .max(2), see §3.1

export const signedVPSchema = unsignedVPSchema.extend({
  proof: proofSchema,
});
```

```ts
// status-list/index.ts
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
Note: `StatusListCredential` has no `validUntil`, no `proof`, doesn't
extend `HelixVC`, and its builder hardcodes context URLs instead of using
`VC_CONTEXTS`. These are accepted as-is (§7.1) — not something to "fix"
here — except for the context hardcoding, which is a trivial fix while
you're touching this file (use `VC_CONTEXTS` like everywhere else should).

Existing builders (`delegation.ts`, `self-signed.ts`,
`helix-api/.../vc.service.ts`) currently hardcode context URLs instead of
importing `VC_CONTEXTS` — don't repeat that pattern in any new code you
write.

---

## 2. Locked architecture decisions

### 2.1 Single verification implementation ✅
Verification logic lives in **`helix-core`** only. `helix-api`'s
`POST /v1/vp/verify` route becomes a thin wrapper: call `helix-core`'s
`verifyVP()`, then layer its own API-specific extras on top (JWT session
issuance, its own audit logging) around that single call. **The DB-walk
(`reconstructDelegationChain()`, `parentVcId` traversal via
`vcService.findRecordByVcId()`) is retired entirely** — not kept as a
fallback, not run in parallel. Delegation-chain trust is based purely on
the credential's own embedded `delegationChain` field, exactly as
`helix-core`'s local verifier already does it, agnostic of whether
`helix-api` is present at all.

### 2.2 Single VP builder ✅
`VPBuilder` lives in `helix-core` only. `helix-sdk-js` re-exports it as-is
(confirmed, §1) — no parallel implementation to reconcile.

### 2.3 Build-and-sign: SDK-only, no `helix-api` dependency ✅
The whole VP — construction **and** signing — happens client-side, fully
in the agent/SDK process, using the agent's own wallet/private key. There
is **no** API-side VP-template-construction step in the target design
(earlier flow had `generateVPTemplate()` build a template on the API side
before the SDK signed it separately — that split is gone). See §8 for what
this means for cleanup.

### 2.4 Fail-closed verification ✅
If **any** entry present in the VP's credential array fails its own
independent check (bad signature, expired, revoked, subject mismatch —
agent-match or user-match), `verifyVP()` throws and the **whole VP is
rejected**. A failing entry is never silently dropped from the scope
intersection — this is what makes revoking a consent grant actually revoke
the agent's ability to act for that user, rather than having the verifier
quietly fall back to the agent's own (wider) scope.

### 2.5 Both agent-match AND user-match required for a grant ✅
A `DelegationGrantCredential` entry is only valid if **both**:
1. **Agent match:** `grant.credentialSubject.id` equals `vp.holder`, or
   equals any DID appearing in the already-verified `delegationChain`
   (covers a delegated sub-agent inheriting a grant issued to an
   ancestor — no extra lookups, this list already exists from the chain
   walk).
2. **User match:** `grant.credentialSubject.userDid` equals
   `vp.delegatedBy`. Required, not optional — grant granularity is
   explicitly per **(user, agent, service)**; checking agent-match alone
   would collapse that back to (agent, service), letting one user's grant
   be reused for a different user's transaction through the same agent
   DID (a real authorization bypass, not just a style gap, given a single
   agent DID like a Concierge Agent serves many different end users).

### 2.6 User identifier: DID primary, plain email string as fallback ✅
Kept deliberately simple: the identifier field on both sides (VP's
`delegatedBy`, grant's `credentialSubject.userDid`) is just a **string**
that holds either a DID or an email address — **no tagged union**
(`{ type, value }`). Matching is plain string equality, same mechanism
regardless of which form was used. Trade-off accepted deliberately: an
email string has no cryptographic binding the way a DID does, so a
matched email is a weaker guarantee than a matched DID. Whichever form the
agent used when building the VP must be the same form the grant captured
at consent time, or the match fails — this needs a clear, documented rule
in the consent flow (e.g. "use DID if the End User has one, else fall
back to the email captured at login"), not an implicit assumption.

### 2.7 `effectiveScopes` — new field, `privilegeScopes` unchanged ✅
`VerifyVPResult` gets a new field, `effectiveScopes`:
- No grant present → `effectiveScopes === privilegeScopes` (identical
  value, just present under both names).
- Grant present → `effectiveScopes = intersect(privilegeScopes,
  grant.credentialSubject.scopes)`.

`privilegeScopes` keeps its exact current meaning (the agent-authority
credential's own scope, post chain-narrowing) — no backward-compat break
for anything already reading it. **Required consequential change:**
`checkScope()`/`requireScope()` must switch to reading `effectiveScopes`
for actual enforcement decisions — otherwise the grant intersection is
inert metadata and enforcement still runs off the pre-grant scope,
silently defeating the whole point of the grant.

### 2.8 `VCBaseSchema` will be exported ✅
The new `DelegationGrantCredential` schema (§5) lives in its own file,
importing the exported base — not co-located in `vc.ts` purely to reach a
private symbol. **This is delivered by Epic 3, not this epic** — by the
time you start this doc, `VCBaseSchema` is already exported and
`DelegationGrantVCSchema` already exists.

### 2.9 Regression contract — non-negotiable
With a 1-element `verifiableCredential` array (today's only case, both
root and delegated agents), the new `verifyVP()` must produce
**byte-for-byte identical** output to current behavior — same `agentDid`,
`privilegeScopes` (and `effectiveScopes` trivially equal to it), same
`delegationChain`, same errors thrown for the same bad inputs. None of the
new array/grant validation should ever fire for a correctly-formed
1-element array. All 4 existing `e2e-travel-concierge` demo scenarios
(Search vs. Book, Delegate to Sub-Agent, Revoke Mid-Flight, Onboard a New
Agent Live) must pass unmodified.

---

## 3. VP Generation — target design

### 3.1 `VPBuilderOptions`

```ts
export interface VPBuilderOptions {
  credentials: SignedVC[];   // 1 or 2 entries, see population rules below
  holderDid: string;
  targetService: string;
  userDid?: string;          // now optional; DID or plain email string
}
```

Schema change needed: `unsignedVPSchema`'s
`verifiableCredential: z.array(z.record(z.unknown())).min(1)` becomes
`.min(1).max(2)`. Since `signedVPSchema` extends `unsignedVPSchema`, one
edit covers both.

**Population rules:**

| Presenter situation | `credentials` array |
|---|---|
| Root agent, no consent grant applies | `[agentVC]` |
| Delegated sub-agent, no consent grant applies | `[delegatedVC]` (delegation chain still embedded inside this one entry, unchanged mechanics) |
| Root or delegated agent, consent grant applies | `[agentVC-or-delegatedVC, grantVC]` — grant is always the **second**, independent entry |

**Builder-level validation (fail fast, before signing):**
- `credentials.length` must be 1 or 2.
- Exactly one entry must be an agent-authority credential (`type` includes
  `HelixAgentCredential`).
- At most one entry may be a `DelegationGrantCredential` (`type` includes
  `DelegationGrantCredential`).
- Reject anything else (0 or 2+ agent-authority entries, 2+ grants,
  unrecognized `type`).

**`userDid` optional — canonicalization detail:** when `userDid` is
absent, **omit the `delegatedBy` key entirely** from the payload before
hashing/signing — don't serialize `null`/`undefined`. Including the key
with an empty value creates two different wire shapes for what should be
one semantic state ("no user"), and can change canonical-JSON hashing
behavior depending on your canonicalizer's null-handling. Write a unit
test asserting `'delegatedBy' in signedVP === false` when `userDid` isn't
passed.

Wire field name stays `verifiableCredential` — don't invent a new field
name for the array. It's already an array today (just hardcoded to length
1); this change only relaxes its length constraint.

### 3.2 Where building/signing happens
Per §2.3, entirely in the agent/SDK process. No API-side template step.

---

## 4. VP Verification — target design

### 4.1 Control flow (core `verifyVP()`)

```ts
export async function verifyVP(vp: SignedVP, options: VerifyVPOptions = {}): Promise<VerifyVPResult> {
  // ...existing VP-level checks unchanged: expiry, expectedTargetService, holder signature...

  const entries = vp.verifiableCredential;
  if (entries.length < 1 || entries.length > 2) {
    throw new VPInvalidStructureError('VP must carry 1 or 2 credentials');
  }

  const agentEntries = entries.filter(isAgentAuthorityType);   // type includes 'HelixAgentCredential'
  const grantEntries = entries.filter(isGrantType);            // type includes 'DelegationGrantCredential'
  if (agentEntries.length !== 1 || grantEntries.length > 1 ||
      agentEntries.length + grantEntries.length !== entries.length) {
    throw new VPInvalidStructureError(
      'VP credential array must contain exactly one agent-authority credential and at most one consent grant'
    );
  }

  const agentVC = agentEntries[0] as AgentSignedVC;
  assertAgentVC(agentVC);
  // ...existing vc.targetService check, unchanged, against agentVC...

  const warning = agentVC.credentialSubject.delegatedFrom
    ? undefined
    : await verifyCredential(agentVC, options);
  const delegationChain = await verifyDelegationChain(agentVC, options); // UNCHANGED — embedded field only

  let effectiveScopes = agentVC.credentialSubject.privilegeScopes;

  if (grantEntries.length === 1) {
    const grant = grantEntries[0];
    await verifyCredential(grant, options);   // reused as-is — already subject-type-agnostic
    assertGrantVC(grant);                     // new: checks scopes[]/durability/userDid/id shape

    const chainDids = delegationChain.map((link) => link.subject);
    const agentMatches = grant.credentialSubject.id === vp.holder
      || chainDids.includes(grant.credentialSubject.id);
    const userMatches = grant.credentialSubject.userDid === vp.delegatedBy;   // plain string equality — DID or email, either form
    if (!agentMatches || !userMatches) {
      throw new ConsentGrantSubjectMismatchError();
    }

    effectiveScopes = intersect(effectiveScopes, grant.credentialSubject.scopes);
  }

  return {
    valid: true,
    agentDid: agentVC.credentialSubject.id,
    privilegeScopes: agentVC.credentialSubject.privilegeScopes,   // unchanged meaning
    effectiveScopes,                                              // new field
    vpId: vp.id,
    delegationChain,
    ...(warning ? { warning } : {}),
  };
}
```

### 4.2 `helix-api`'s `POST /v1/vp/verify` route
Becomes a thin wrapper around the single core `verifyVP()`:
1. Call `verifyVP(signedVP, options)`.
2. On success: issue the JWT session (if requested) using
   `result.effectiveScopes`, not the raw agent VC scopes. Log a single
   `VP_VERIFIED` audit event after the call returns (see §4.3 — no
   mid-verification logging is needed).
3. On failure: catch and log a single `VP_REJECTED` audit event with the
   error reason, same as today, after the call throws.

This retires `reconstructDelegationChain()`, `verifyDelegationChain()`
(the API's own copy), and the local-repo-based revocation lookup path for
agent VCs specifically (§4.3 covers the one nuance worth building
deliberately here rather than naively).

### 4.3 ✅ Decided: injectable status-list resolver, local-repo fast path for `helix-api`'s own lists
**Confirmed — build this.** If `helix-api`'s revocation check for its own
agent VCs always did an HTTP fetch of its own `/v1/status-list/:listId`
endpoint (i.e. "single implementation" naively taken to mean "always the
core code path, which always fetches over HTTP"), that would be a real
self-inflicted round-trip for every single verification `helix-api` does
for its own agent VCs — a performance regression versus today's direct
local-repository read.

**Implement the following pattern:** give core's `verifyVP()` (or the
internal revocation-check helper it calls) an **optional injectable
status-list resolver** — `(statusListUrl: string) =>
Promise<StatusListCredential>` — defaulting to the existing HTTP-fetch
implementation. `helix-api` supplies its own resolver that checks "is
this URL one of my own locally-hosted lists — if so, read the repository
directly; otherwise, fetch over HTTP like anyone else." This keeps **one**
verification implementation and **one** set of rules (no second code
path, no duplicated logic) while avoiding an unnecessary network round
trip for the case `helix-api` can answer locally.

Note: even when `helix-api`'s resolver takes the local-repo path, the
fetched/loaded object must still pass through the §7.1 schema validation
before use — the fast path changes how the bytes are obtained, not
whether they're validated.

### 4.4 Error taxonomy — new types needed
Add alongside existing `HelixError` subclasses:
- `ConsentGrantSubjectMismatchError` — covers both agent-match and
  user-match failures for a grant entry.
- `ConsentGrantInvalidError` — structural validation failure (missing
  `scopes`, unrecognized `durability`, etc.) — grant-specific analogue of
  `VPInvalidStructureError`, for clearer client-side error handling.
- Reuse existing `VCRevokedError`, `VCExpiredError`,
  `VCSignatureInvalidError` for the corresponding grant-specific failures —
  no need for grant-specific variants of these three.

**Do not fold these two new classes into the B7 error-taxonomy
consolidation** from the Epic 1/Epic 3 handover doc — that consolidation
explicitly excludes `ConsentGrantSubjectMismatchError` /
`ConsentGrantInvalidError` as verification-time errors owned by this doc,
structurally different from the issuance-time policy errors it merges.

---

## 5. `DelegationGrantCredential` — schema (final)

**Delivered by Epic 3 — restated here for reference only, not a task in
this epic.**

```ts
// vc.ts (or wherever VCBaseSchema now lives once exported)
export const DelegationGrantVCSchema = VCBaseSchema.extend({
  type: z.array(z.string()).superRefine((val, ctx) => {
    if (!val.includes('VerifiableCredential') || !val.includes('DelegationGrantCredential')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Delegation Grant VC types' });
    }
  }),
  credentialSubject: z.object({
    id: z.string(),                 // agent DID being authorized
    type: z.literal('DelegationGrant'),
    userDid: z.string(),            // DID or plain email string of the granting End User — §2.6
    scopes: z.array(z.string()),
    durability: z.enum(['standing', 'session']),
    serviceDid: z.string().optional(),  // redundant with issuer, useful for Console display
  }),
});
```

Field-level notes:
- `'@context'`: use `[...VC_CONTEXTS]` (spread, since it's a readonly
  tuple) — don't hardcode the URLs.
- `validFrom`/`validUntil`: both **mandatory** on `VCBaseSchema` — a
  `standing` grant with "no real expiry" still needs a concrete
  far-future `validUntil`, there's no "no expiration" value available.
- `credentialStatus`: reuse `VCCredentialStatusSchema` as-is — already
  generic enough for SP-hosted status-list entries, no changes needed.
- `proof` is optional in the zod schema even though `SignedVC<T>`'s TS
  type requires it — same pre-existing pattern as agent VCs; whatever
  consumes a parsed grant must still explicitly check `.proof` before
  treating it as valid.
- Issuer = the SP's own `did:web` DID, provisioned in Epic 1 (SP identity
  & revocation infra) — the resulting DID/status-list URL is what ends up
  in this credential's `issuer`/`credentialStatus` fields.

SDK surface for local grant issuance/revocation is Epic 3 scope, already
delivered by the time you start this doc — not restated here.

---

## 6. Backward compatibility — restated as a checklist

- [ ] 1-element array (root agent VC): identical `agentDid`,
      `privilegeScopes`, `effectiveScopes === privilegeScopes`,
      `delegationChain`, identical errors for identical bad inputs.
- [ ] 1-element array (delegated child VC): same, chain-walk output
      unchanged.
- [ ] All 4 existing demo scenarios pass unmodified end-to-end.
- [ ] `checkScope()`/`requireScope()` behave identically for 1-element-array
      callers (since `effectiveScopes === privilegeScopes` in that case).

---

## 7. Open items

All previously-open items are now resolved. Kept here (rather than
deleted) so the reasoning and decision are visible to whoever implements
against this doc.

### 7.1 ✅ Resolved — runtime schema validation on fetched status lists
`verifyRevocation()`-equivalent code used to fetch
`vc.credentialStatus.statusListCredential` and cast the response straight
to `StatusListCredential` with no zod-parse — fine while every fetch
target was `helix-api`'s own trusted output, a real integrity gap once
fetch targets include arbitrary SP-hosted URLs.

**Decision: implemented in Epic 1 (task A3).** A `StatusListCredentialSchema`
now parses the fetched JSON before `getBit()` is called; on parse failure
the credential is treated as **revoked/untrusted** (fail closed,
consistent with §2.4) rather than throwing an unhandled cast error or
proceeding with unvalidated data. By the time this epic starts, the
validation step already exists in `helix-core/src/vp-verifier.ts` — you
are consuming it, not building it. Confirm it's wired into the revocation
check before relying on it, but do not re-implement it here.

### 7.2 ✅ Resolved — local-repo fast path for `helix-api`'s own status lists
**Decision: proceed as recommended.** Build the injectable status-list
resolver described in §4.3 — `helix-api` supplies a resolver that reads
its own locally-hosted lists from the repository directly and falls back
to HTTP fetch for everything else (including SP-hosted lists). This is no
longer a flag-to-your-lead item; it's in scope for this epic. See §4.3
for the implementation pattern and the note on §7.1 validation still
applying to the local-repo path.

### 7.3 ✅ Resolved — mid-verification audit granularity
`helix-api`'s current implementation logs `CHAIN_VERIFIED`/
`CHAIN_REJECTED` audit events **during** its own chain walk. Once
verification is just "call core's `verifyVP()`, then log success/
failure," reproducing that mid-function granularity would require adding
a logging callback parameter to an otherwise dependency-free core
function.

**Decision: no mid-verification logging is needed.** `helix-api`'s
`POST /v1/vp/verify` route logs a single `VP_VERIFIED` or `VP_REJECTED`
audit event (with reason, on rejection) after the single `verifyVP()`
call returns or throws — coarser than today's granular chain-walk events,
and that's accepted. Do not add a logging-callback parameter to core's
`verifyVP()` for this purpose. See §4.2, step 2/3.

---

## 8. Repo cleanup checklist

Fold these into your implementation PR(s) rather than treating them as a
separate follow-up — leaving any of them half-done creates exactly the
kind of "two implementations of the same thing" confusion this whole doc
exists to resolve:

- [ ] Remove `helix-api`'s DB-walk verification logic
      (`VPService.verifyVP()`'s `reconstructDelegationChain()` and its own
      copy of chain-walk/revocation-check code) in favor of calling core's
      `verifyVP()` directly (§2.1, §4.2).
- [ ] Confirm and remove the orphaned `helix-sdk-js/src/vp/VPBuilder.ts`
      file — not the shipped export, not a second implementation to
      maintain (§1, §2.2).
- [ ] Confirm whether `vp.service.ts`'s `generateVPTemplate()` is actually
      wired to a live route. If unused, remove it alongside the above; if
      reachable some other way, deprecate it explicitly as part of the
      SDK-only build-and-sign consolidation (§2.3) rather than leaving a
      second, now-contradictory way to build a VP in the codebase.
- [ ] Fix context-URL hardcoding to use `VC_CONTEXTS` in any new code you
      write for this work (§1) — don't propagate the existing debt in
      `delegation.ts`/`self-signed.ts`/`vc.service.ts` into new files.
- [ ] **Update public docs/examples that show the old single-credential
      `VPBuilder` shape.** `README.md`'s Quick Start, "Present and Verify a
      VP," and MCP/LangChain sections, and `public-surfaces.md`'s
      `VPBuilder` export row, all currently document the old
      `{ vc, holderDid, targetService, userDid }` constructor. Update them
      to the new `{ credentials: SignedVC[], holderDid, targetService,
      userDid? }` shape (§3.1) so the shipped docs don't contradict the
      shipped code once this lands.

---

## 9. Testing — major flows & test matrix

### 9.1 Unit — `VPBuilder` (core)

| # | Case | Assert |
|---|---|---|
| B1 | 1 credential, `userDid` provided | `verifiableCredential.length === 1`, `delegatedBy` present and equal to `userDid` |
| B2 | 1 credential, `userDid` omitted | `'delegatedBy' in signedVP === false` |
| B3 | 2 credentials (agentVC + grantVC) | `verifiableCredential.length === 2`, order preserved (agent first, grant second) |
| B4 | 0 credentials passed | throws structural error, no signing attempted |
| B5 | 3 credentials passed | throws structural error |
| B6 | 2 credentials, both agent-authority type (no grant) | throws structural error |
| B7 | 2 credentials, both grant type (no agent VC) | throws structural error |
| B8 | `userDid` as an email string (not a DID) | builds and signs identically to a DID-valued `userDid` — no special-casing in the builder |
| B9 | Signed VP round-trips through `verifyVP()` for both B1 and B3 shapes | passes without error |

### 9.2 Unit — `verifyVP()` (core) — regression baseline (run against **current** code first, record results, then confirm identical post-change)

| # | Case | Expected |
|---|---|---|
| R1 | Root agent VC, 1-element array, valid | `valid: true`, `privilegeScopes` == `effectiveScopes` == VC's scopes, `delegationChain.length === 1` |
| R2 | Delegated child VC, 1-element array, valid chain | `valid: true`, `delegationChain.length === chain depth` |
| R3 | Delegated child, tampered `delegationChain` (scope escalation) | throws `DelegationChainInvalidError` |
| R4 | Root VC, expired | throws `VCExpiredError` |
| R5 | Root VC, revoked (status bit set) | throws `VCRevokedError` |
| R6 | VP itself expired | throws `VPExpiredError` |
| R7 | VP signature invalid (wrong holder key) | throws `VPSignatureInvalidError` |
| R8 | `vc.targetService` mismatch vs `vp.targetService` | throws `VPInvalidStructureError` |

### 9.3 Unit — `verifyVP()` (core) — grant behavior

| # | Case | Expected |
|---|---|---|
| G1 | Root agent VC + grant, agent-match direct, user-match (both DIDs), all valid | `valid: true`, `effectiveScopes` == intersection(agentVC.scopes, grant.scopes) |
| G2 | Delegated sub-agent VC + grant, agent-match via an **ancestor** DID (not the leaf) | `valid: true` — exercises the ancestor branch of the agent-match rule |
| G3 | Agent-match fails (grant subject matches neither presenter nor any ancestor) | throws `ConsentGrantSubjectMismatchError` |
| G4 | Agent-match passes, **user-match fails** (`grant.userDid !== vp.delegatedBy`) | throws `ConsentGrantSubjectMismatchError` — required, don't skip this case |
| G5 | User-match using the **email fallback** form on both sides | `valid: true` — same as DID case, plain string equality |
| G6 | Grant present, `vp.delegatedBy` absent entirely | rejected — a grant with no user identifier to match against on the VP side is a structural failure, not a pass |
| G7 | Grant expired, agent VC still valid | whole VP rejected (fail-closed, §2.4) |
| G8 | Grant revoked, agent VC still valid | whole VP rejected |
| G9 | Grant signature invalid | whole VP rejected |
| G10 | Grant scopes are a **superset** of agent VC scopes | effective scope == agent VC's scopes only (agent-side ceiling still applies) |
| G11 | Grant scopes are a **narrower subset** | effective scope == grant's scopes only |
| G12 | Grant malformed (`scopes` missing or not an array) | throws `ConsentGrantInvalidError`, never falls through to signature check |

### 9.4 Unit — `helix-api`'s `POST /v1/vp/verify` (post-consolidation)

| # | Case | Expected |
|---|---|---|
| A1 | Same G1–G12 matrix, run against the API route | identical behavior — confirms the route is a genuine thin wrapper, not a re-divergent copy |
| A2 | `options.issueSession: true` with a grant present | issued JWT's `scopes` claim reflects `effectiveScopes`, not raw agent VC scopes |
| A3 | Revocation check for `helix-api`'s own agent VC | passes, and the injected local-repo resolver (§4.3) is used — no HTTP round-trip to its own status-list endpoint |
| A4 | Revocation check for an SP-hosted grant status list | resolves via HTTP fetch, passes the §7.1 schema validation |
| A5 | Successful verification via the API route | exactly one `VP_VERIFIED` audit event is logged, after `verifyVP()` returns — no mid-verification chain-walk events (§7.3) |
| A6 | Rejected verification via the API route | exactly one `VP_REJECTED` audit event is logged with the failure reason, after `verifyVP()` throws |

### 9.5 Unit — status-list runtime validation (§7.1)

| # | Case | Expected |
|---|---|---|
| S1 | Fetched status list matches the expected shape | parses successfully, `getBit()` proceeds normally |
| S2 | Fetched JSON is missing required fields | rejected — treated as revoked/untrusted, not an unhandled crash |
| S3 | Fetched JSON has an `encodedList` that isn't valid for `getBit()` to read | rejected cleanly, no uncaught exception propagates out of `verifyVP()` |
| S4 | Fetched URL returns a non-200 / non-JSON response | existing error path (`VCRevokedError`) still fires, unaffected by the new validation step |
| S5 | Local-repo fast path (§4.3) returns a malformed record | same fail-closed treatment as S2 — validation applies regardless of resolver source |

### 9.6 Repo-cleanup verification (§8)

| # | Case | Expected |
|---|---|---|
| C1 | `helix-api`'s `VPService.verifyVP()` no longer contains `reconstructDelegationChain()` or its own chain-walk logic | confirmed by code review / grep, not just behavior |
| C2 | `helix-sdk-js/src/vp/VPBuilder.ts` removed (or confirmed genuinely unreferenced anywhere and ticketed for removal) | no import in the repo resolves to this file |
| C3 | `generateVPTemplate()` either removed or explicitly deprecated with a clear reason | not left as a silently-still-working second way to build a VP |
| C4 | `README.md` and `public-surfaces.md` reflect the new `VPBuilder({ credentials, ... })` shape | no doc/example still shows the old single-`vc` constructor |

### 9.7 Integration — regression, existing 4 demo scenarios
Must pass **unmodified** end-to-end: Search vs. Book; Delegate to a
Sub-Agent; Revoke Mid-Flight; Onboard a New Agent, Live. None of these
involve a consent grant, so all exercise the 1-element-array path only —
a good sanity signal if any of them regress.

### 9.8 Integration — consent demo, 5-step flow

| Step | Action | Verify |
|---|---|---|
| 1 | Login, custodial identifier established (DID or email per §2.6) | no VP involved yet |
| 2 | Search TVM → Delhi | read-only agent action, scope check only |
| 3 | Book flight, Airline SP — first time | consent prompt shown, grant issued, VP for the booking carries `[agentVC, grantVC]`, `verifyVP()` passes |
| 4 | Book hotel, **different** SP | separate consent prompt, separate/independent grant |
| 5 | Book return flight, **same** Airline SP as step 3 | **no consent prompt** — VP reuses the existing standing grant, `verifyVP()` passes without a new grant being issued |

Step 5 is the explicit regression target for standing-grant reuse — its
own test case, not just a demo narrative beat.

### 9.9 Fixtures needed
- A minimal signed `HelixAgentCredential` (root, non-delegated).
- A 2-hop delegated chain fixture (for G2).
- A signed `DelegationGrantCredential` fixture, both `standing`/`session`
  durability, and both a DID-valued and an email-valued `userDid` variant.
- A revoked-grant fixture (status bit set).
- An externally-hosted status list fixture, including at least one
  deliberately malformed variant (for S2/S3) — likely needs a small mock
  HTTP server or `fetch` stub in the test harness, since the revocation
  check does a real `fetch()`.
