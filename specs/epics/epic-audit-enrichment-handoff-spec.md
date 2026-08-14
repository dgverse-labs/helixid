# New Epic — Audit Payload Enrichment + Consent Events

**Status:** spec, not yet built. Sits on top of Epic 2 (VP Build & Verify), which is
complete. No epic number assigned — treat as a standalone follow-on to the parked
Epic 4 (audit routing), not a continuation of it.

**Scope boundary:** agent-side and `helix-api`-side only. SP-side audit (the SP's own
`consent_granted`/`consent_revoked` emission from its own infra, per the consolidated
decision log §4.4) is explicitly out of scope for this epic — deferred, not decided
against.

**Revocation handling (`CONSENT_REVOKED`) is deferred to a follow-up discussion** and
is not part of this epic's deliverables. See §3 for the open options, kept here for
context only.

---

## 0. Baseline — what Epic 2 already resolved

Confirmed from the Epic 2 handoff, no work needed here:

- `CHAIN_VERIFIED` / `CHAIN_REJECTED` are already gone. §7.3 was implemented as:
  exactly one `VP_VERIFIED` after `verifyVPCore()` returns, or exactly one
  `VP_REJECTED` (with `internalReason`) after it throws. No mid-verification audit
  events anywhere.
- The generic audit-routing module (DID resolution → discover a log-sink service
  endpoint → POST there → stdout/file fallback) was never built. Confirmed parked
  (register item D2). This epic does not revive it — the premise (agent/SP need to
  *discover* where to log) doesn't hold once both sides already know their own API
  base URL.

This epic is purely additive: richer payloads on the two existing VP events, plus
one new event pair for consent.

---

## 1. Enrich `VP_VERIFIED` / `VP_REJECTED` payloads

**Problem:** `VP_VERIFIED` already carries `delegatedFrom` / `delegatedTo` /
`parentVcId` / `delegationDepth`, but only because it's built from the *successful*
`result.delegationChain`. `VP_REJECTED` currently carries only `internalReason` — no
delegation context, because `verifyVP()` throws before or during chain construction
and there is no `result` to read from.

**Fix:** on the rejection path, pull identifying fields directly off the **raw,
unverified** VP/VC objects — not off `result`, which doesn't exist — and attach them
as best-effort, unverified context for log correlation only (not a trust claim).

**New fields on the audit entry (rejection path):**
- `attemptedVcId` — `vp.verifiableCredential[0]?.id`
- `attemptedParentVcId` — `vp.verifiableCredential[0]?.credentialSubject?.parentVcId`
- `attemptedDelegatedFrom` — `vp.verifiableCredential[0]?.credentialSubject?.delegatedFrom`

All three read via guarded optional chaining; a malformed/garbage VP must never
throw out of the audit call itself.

**Where:**
- `helix-sdk-js/src/client/HelixClient.ts` — `verifyVP()`'s `catch` block and the
  `VPVerificationAuditEntry` interface get the three new optional fields.
- `helix-api/src/services/vp/vp.service.ts` — the post-Epic-2 thin-wrapper's catch
  block gets the same treatment, reading off the parsed-but-not-yet-verified VP
  before `verifyVPCore()` throws.

No new event types. No schema change to `AuditEvents`.

---

## 2. New events: `CONSENT_GRANTED` / `CONSENT_REVOKED`

Add to `helix-core/src/audit/events.ts`:

```ts
CONSENT_GRANTED: 'CONSENT_GRANTED',
CONSENT_REVOKED: 'CONSENT_REVOKED',
```

These are confirmed as the **only** new event types for this epic.

### 2a. `CONSENT_GRANTED` — agent-side, in scope

The grant VC lands in the agent's wallet via `AgentWallet.addCredential()`. This is
the agent-side analogue of `VC_ISSUED` — the agent has first-hand, definite knowledge
the moment it stores the credential, and (per the scoping decision) it already knows
`helix-api`'s URL, so there is no log-sink discovery problem to solve.

**Hook point:** `helix-sdk-js/src/wallet/AgentWallet.ts`, `addCredential(vc: SignedVC)`.
Detect `vc.type.includes('DelegationGrantCredential')` (same detection pattern the
grant schema's `superRefine` already uses). On that branch, after the existing add
succeeds, fire an audit call.

**Mechanism:** reuse the pattern already established by
`HelixClient.recordVPVerificationAudit()` — POST to a `helix-api` audit-log route,
best-effort, never throws, never blocks the wallet write if it fails or if no
`HelixClient` is attached to the wallet (`AgentWalletOptions.client` is optional
today).

**Payload:**
- `agentDid` — wallet DID (grant subject / `credentialSubject.id`)
- `issuer` — the SP DID
- `userDid` — `credentialSubject.userDid`
- `scopes` — `credentialSubject.scopes`
- `durability` — `standing` | `session`
- `vcId`

**Route:** either a new sibling route next to the existing
`/v1/audit-log/vp-verification` (e.g. `/v1/audit-log/consent-granted`), or a single
generalized `/v1/audit-log` ingestion route shared by both event kinds — pick one at
implementation time; no strong preference recorded here.

### 2b. `CONSENT_REVOKED` — deferred, not built this epic

Revocation is SP-initiated (the SP flips its own status-list bit). The agent has no
push notification of that event and no clean first-hand trigger point, unlike
`CONSENT_GRANTED`. It only discovers a revocation indirectly, the next time it
attempts to build/verify a VP using that grant and the SP's status-list check fails.

Kept here only as context for the later discussion — **not a deliverable of this
epic:**

- **Option (a):** no agent-side `CONSENT_REVOKED` event at all. A revoked grant just
  surfaces as an ordinary `VP_REJECTED`, using §1's enrichment to identify which
  grant was involved via `attemptedVcId`. Zero new hooks required.
- **Option (b):** promote the specific "grant revoked" failure inside `verifyVP()`'s
  catch path into its own `CONSENT_REVOKED` audit event instead of a generic
  `VP_REJECTED`, so revocation is visible as its own timeline entry.

No default is assumed; revisit when this is picked back up.

---

## 3. Explicitly out of scope for this epic

- SP-side audit emission (SP's own `consent_granted`/`consent_revoked` from its own
  infra, per §4.4 of the consolidated decision log) — deferred, separate epic/task.
- The generic audit-routing module (DID → log-sink discovery) — stays parked (D2),
  not revived.
- `CONSENT_REVOKED` mechanics — deferred per §2b above.

---

## 4. Summary of file-level changes

| File | Change |
|---|---|
| `helix-core/src/audit/events.ts` | Add `CONSENT_GRANTED`, `CONSENT_REVOKED` to `AuditEvents` |
| `helix-sdk-js/src/client/HelixClient.ts` | Enrich `VPVerificationAuditEntry` + rejection-path catch block with `attemptedVcId` / `attemptedParentVcId` / `attemptedDelegatedFrom` |
| `helix-api/src/services/vp/vp.service.ts` | Same enrichment on the thin-wrapper's catch block |
| `helix-sdk-js/src/wallet/AgentWallet.ts` | `addCredential()` — detect grant VCs, fire best-effort `CONSENT_GRANTED` audit call |
| `helix-api` audit-log routes | New route(s) to accept `CONSENT_GRANTED` (and later `CONSENT_REVOKED`) posts from the agent, mirroring the existing `/v1/audit-log/vp-verification` pattern |
