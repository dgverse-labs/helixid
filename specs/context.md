# HelixID — Consolidated Decision Log

**Supersedes:** `helixid-decision-log-updated-audit.md` (main log),
`helixid-user-consent-decision-log.md` (consent log), the consent log
addendum, and `helixid-functional-breakdown.md`. Those four are merged and
compressed here; **do not treat them as independently authoritative going
forward** — this doc wins on any conflict, and within this doc **latest
conclusion wins**.

**Out of scope for this doc:** VP Generation and VP Verification mechanics.
Those are being specified in a **separate, dedicated dev design doc**,
currently on hold until the open questions listed in §5 are resolved. This
doc only carries the few cross-cutting *architecture* decisions that other
sections depend on (see §5's stub).

**Audience:** repo agent implementing against this. Where a section
references current code, it's a compressed fact, not a code dump — pull
the actual file before writing a diff.

**Status key:** ✅ decided · 🟡 direction, not finalized · 🔴 open.

---

## 1. System overview (compressed)

5-layer trust stack: **Identity** (DID), **Authority** (scoped VCs +
delegation), **Enforcement** (runtime verification), **Audit** (event
log), **Revocation** (Bitstring Status List). Three original roles —
Platform Operator, AI Agent, Service Provider — cover agent↔service trust
end to end. **✅ 4th role, "End User,"** now permanent, covering
human↔agent consent (§4).

---

## 2. Existing baseline — Console, Sample App, Demo, Distribution ✅

**Status: built, working, not a current design focus.** Kept here only so
nothing regresses — the active work is §4/§5/§6, not this.

- Console: real, general-purpose, open-source, independently
  versioned/released — a UI layer over existing SDK/API surfaces.
- Sample app (`examples/e2e-travel-concierge`): `frontend/` + `backend/`
  (incl. verifier) + `ai-agent/` (wallet, VP signing) + `helixid-config/`.
  Console is a separate codebase brought up via the sample's own compose
  file, not a folder inside it.
- `helix-api`/`helixid-console` ship as pre-built versioned registry
  images, never local build contexts — one compose file works for both
  the zip and local-dev paths. Escape hatch for hacking on core: a
  separate `docker-compose.override.yml`, documented in the sample's own
  README, not the main one.
- `helixid-setup` seeder: pre-onboards demo agents, seeds scopes/status
  list, prints Console URL. **Updated per §5.6:** provisions a DID for the
  booking backend via `POST /v1/dids` — no longer registers it via the
  now-removed `POST /v1/services`.
- 4 final demo scenarios (Search vs. Book, Delegate to Sub-Agent, Revoke
  Mid-Flight, Onboard a New Agent Live) — audit trail is a persistent
  panel across all of them, not its own scenario. Cross-org trust and
  session-bridge/JWT explicitly excluded from the demo.
- Distribution: website try-it link + zip download only — clone dropped
  as an option. `examples/e2e-travel-concierge` in the main repo is source
  of truth; the zip is auto-packaged from it via CI/release, never
  hand-maintained separately.
- README's "Full Demo" section: base draft approved; pending edits are the
  4th scenario, Console attribution for the audit panel, and the
  DID-provisioning wording. Website "Try the Demo" copy: on hold, don't
  regenerate until asked.

**Requirement going forward:** all of the above must keep passing exactly
as-is through the §5/§6 changes — treat it as a regression suite, not
something to redesign.

---

## 3. Audit Trail

**Baseline (✅ locked):** six event types —
`did_created`, `did_deactivated`, `service_registered` (**now removed**,
see §5.6 — not replaced, just dropped from the six), `vc_issued`,
`vc_renewed`, `vc_revoked`, `vp_verification` (accepted/rejected +
reason). Delegation is not its own event — visible only as `parentVcId`
on `vp_verification`. VP inspection stays audit-trail-only — no VP replay
endpoint, no VP storage schema on `helix-api`.

**🟡 New generic audit-routing module:** given an **agent DID** (always
agent DID — SPs may not be resolvable the same way), resolve its DID
document, look for a declared log-sink service endpoint (reuse
`addServiceEndpoint()`), POST the event there; no endpoint → local
stdout/file fallback. Existing six event call sites route through this
instead of writing directly to `helix-api`'s store. New consent events
(`consent_granted`, `consent_revoked`) route through the same module, no
special-casing. Exact event schema/shape: not designed yet.

**🔴 Watch-out flagged for later:** if VP verification consolidates into a
single `helix-core` implementation (§5's stub), the API's current
mid-verification audit calls (`CHAIN_VERIFIED`/`CHAIN_REJECTED` logged
*during* its own DB-walk) may need to move to a success/failure wrapper
around one core call instead, which could lose some of today's granular
logging detail. Not resolved — carry into the VP doc, don't design here.

---

## 4. End User & Consent

### 4.1 Scope & terminology ✅
Permanent 4th role: **"End User"** (not informal "User"/`userDid`),
alongside Platform Operator, AI Agent, Service Provider. Core product
surface, not a demo-only addition.

### 4.2 End-user identity & wallet

**✅ Binding & wallet model (unchanged):**
- Binding is **agent-dependent** — whatever auth the agent/SP already uses
  (login, SSO, OTP, eKYC) anchors the custodial DID; demo uses regular
  login. (Supersedes an earlier "self-sovereign, no KYC binding" idea —
  dropped.)
- **Custodial only, for now.** The **SP** holds the custodial DID/key
  material (not HelixID), read by the SDK via **env vars** after the CLI
  generation step. Self-custody option parked, not designed.

**🟡 Revised — the earlier "descoped entirely" framing was too broad,
splitting into two separate concerns that shouldn't have been merged:**

- **(a) Agent-side session/UX recognition** — "is this the same human I
  talked to five minutes ago, should I greet them by name" — **stays
  descoped.** HelixID doesn't standardize how an agent tracks or
  recognizes a returning user across chat turns; that's the agent's own
  session/UX implementation detail, not a protocol concern.
- **(b) Protocol-level user matching — NOT descoped.** Whatever `userDid`
  the agent embeds in a given VP must, at verification time, correctly
  correspond to the user who actually consented for that transaction.
  This is a direct, unavoidable consequence of grant granularity being per
  **(user, agent, service)** (§4.4) — without it, that granularity is
  meaningless. This is squarely HelixID's concern and is enforced as part
  of VP verification (mechanics pending in the separate VP doc, but the
  requirement itself is locked here).

The earlier single bullet conflated (a) and (b) into one "not our
problem" statement — only (a) is actually out of scope.

**Confirmed flow (✅):** end user logs in (per the binding model above) →
agent resolves/holds a `userDid` for them → the same `userDid` is embedded
in the VP (as `delegatedBy`) and in the grant
(`credentialSubject.userDid`) → verification matches the two. This is the
locked shape; exact matching logic lives in the VP doc.

**✅ Resolved — DID vs. fallback identifier for matching.** Decision: keep
it simple. **DID is primary; a plain email string is the accepted fallback**
when a user doesn't have a DID established. No tagged-union wrapper
(`{ type, value }`) for v1 — the identifier field (VP's `delegatedBy`,
grant's `credentialSubject.userDid`) is just a string that happens to hold
either a DID or an email address, and matching is plain string equality
between the two, same mechanism regardless of which form was used.

Trade-off carried forward, not re-litigated: an email string has no
cryptographic binding the way a DID does, so a matched email is a weaker
guarantee than a matched DID — accepted deliberately in the name of
simplicity. One thing worth being explicit about wherever the consent
widget/flow is built: whichever identifier form the agent used when
building the VP is whatever the grant must have captured at consent time
too, or the match fails — this needs a clear, documented rule (e.g. "use
DID if the End User has one, else fall back to the email used at login"),
not an implicit assumption.

### 4.3 Where/how consent happens 🟡
- **Location:** the **SP's own domain** — same principle as OAuth (user
  logs into the SP's real domain, password managers work, trust anchor
  stays with the SP, not the agent's chat UI).
- **Mechanism:** a HelixID-provided **embeddable widget**, packaged as
  `@helixid/widget`, sibling to `@helixid/mcp`/`@helixid/langchain`. Scope
  offering: read from SP's MCP role/scope metadata if exposed, else fall
  back to a manually curated list.
- **Still deferred, not decided here:** technical shape (iframe+postMessage
  vs. web component) and how it coexists with an SP's own existing consent
  UI — its own dedicated implementation discussion.

### 4.4 `DelegationGrantCredential` — schema ✅ (mostly resolved)

**Concept (✅ locked):** new VC type, issued by the **Service Provider
itself** (self-hosted, own key) — not `helix-api`, not a plain DB
row/OAuth-grants table. **Granularity: one per (user, agent, service)
triple**, standing grant with a scope list, not per-transaction.
**Durability**, user's choice at consent: `standing` (default, durable
until revoked) or `session` (expires with the agent session). Widget
offers both. **Revocation:** SP runs its own status-list infra, same
pattern `helix-api` uses for agent VCs, just SP-hosted; user can revoke
directly on the SP's site, or tell their agent in chat, which relays it to
the SP's revocation endpoint. **T&C acceptance** folds into grant scopes
(e.g. `accept-terms:flights`) — no separate field. New SDK surface needed:
local issuance (model on `delegate()` — fully local, **not**
`HelixClient.issueVC()`, confirmed API/admin-key-bound) and local
revocation (model on `helix revoke`'s status-list-file handling, needs an
SDK-callable equivalent).

**Schema — now grounded in confirmed repo facts (`helix-core/src/schemas/vc.ts`,
`.../schemas/vp.ts`, `.../status-list/index.ts`):**

- Follow the exact same pattern `AgentVCSchema` uses:
  `VCBaseSchema.extend({ type: z.array(z.string()).superRefine(...) })`
  with the `superRefine` requiring `'VerifiableCredential'` **and**
  `'DelegationGrantCredential'` both present in `type` (extra type strings
  still allowed, same convention as the agent VC).
- **✅ Decided: export `VCBaseSchema`.** The new grant schema lives in its
  own file, importing the exported base, rather than being co-located in
  `vc.ts` purely to reach a private symbol.
- `credentialSubject` for the grant: `{ id: <agentDid>, userDid:
  <granting user's DID>, scopes: string[], durability: 'standing' |
  'session' }` (`serviceDid` optional, redundant with `issuer` but useful
  for Console display).
- **`validFrom`/`validUntil` are both mandatory, non-optional strings** in
  `VCBaseSchema` (`z.string().datetime()`). This means a `standing` grant
  with "no real expiry" still needs a concrete far-future `validUntil` —
  there's no "no expiration" value in the base schema as it stands.
- `credentialStatus` is already optional in `VCBaseSchema` and its shape
  (`VCCredentialStatusSchema`) is generic enough to reuse as-is for
  SP-hosted status-list entries — no changes needed there.
- **Reuse `VC_CONTEXTS`** (`helix-core/src/schemas/vc.ts`, exported,
  readonly tuple of the two context URLs) for `@context` — spread it
  (`[...VC_CONTEXTS]`) since it's mutable-array-typed elsewhere. Existing
  builders (`delegation.ts`, `self-signed.ts`, `vc.service.ts`) currently
  hardcode these URLs instead of importing the constant — don't repeat
  that in the new grant builder.
- **`unsignedVPSchema`/`signedVPSchema`** (`helix-core/src/schemas/vp.ts`):
  `verifiableCredential` is currently `z.array(z.record(z.unknown())).min(1)`
  — the array-length change needed is `.min(1).max(2)` on
  `unsignedVPSchema`; since `signedVPSchema` extends it, both get the
  constraint from one edit.
- **`StatusListCredential`** (`helix-core/src/status-list/index.ts`) —
  **✅ decided: use the exact same format for both `helix-api`-hosted and
  SP-hosted status lists.** No divergent shape for the SP case. Concretely
  this also means: **when an SP's `did:web` DID is provisioned (§4.6/§6
  item 8), its initial status list is generated and hosted at the same
  time**, reusing the existing `helix status-list create` CLI as-is rather
  than inventing a second mechanism — folded into §4.6 below.

  Individual caveats on the shared shape, resolved separately rather than
  left as one vague flag:
  - **Hardcoded contexts instead of `VC_CONTEXTS`** — trivial, fix while
    touching this file, regardless of host.
  - **No `validUntil`, no `proof`, doesn't extend `HelixVC`** — leaving
    these as-is is consistent with the trust model already accepted for
    `did:web` (§4.6: DNS+HTTPS+server-uptime trust, no extra crypto
    layered on top of domain ownership). An unsigned status list fetched
    over HTTPS from a DID-resolvable domain isn't a lesser trust model
    than that — it's the same one. Not treated as blocking; only worth
    revisiting if the `did:web` trust-model assumption itself is ever
    revisited.
  - **No runtime schema validation on fetched JSON — still open, not
    resolved by the "same format" decision.** Unifying the format makes
    this easier to write (one shape to validate against instead of two),
    but doesn't remove the need for it: today's fetch always targets
    `helix-api`'s own generated output, implicitly trusted; that
    assumption breaks the moment the fetch target is an SP's own server.
    **This is the one item from this list that must land in the VP
    verification doc** — zod-parse the fetched JSON against the shared
    `StatusListCredential` shape before trusting `encodedList`/
    `statusListIndex` from an external host.
- **Note on signedness:** `proof` is optional in the zod schema even
  though the TS type `SignedVC<T>` requires it — signedness is enforced
  by the type wrapper, not the runtime parse. Same pre-existing gap
  applies to agent VCs today; nothing new introduced by the grant type,
  just worth being aware of when writing the grant's own runtime checks.

### 4.5 Composition with agent VCs — tracked in the separate VP doc

Historical note: earlier framings ("2 independent sibling credentials
both checked by `verifyVP()`," then "reattach grant into
`delegationChain`") were both **wrong** and are dropped — don't implement
either. The current, correct mechanics (VP credential array, verification
matching rules) belong to the dedicated **VP Generation & Verification
dev design doc**, on hold pending the open items below.

**Cross-cutting architecture decisions already locked, carried forward
into that doc:**
- **Single verification implementation.** Lives in `helix-core`.
  `helix-api` and `helix-sdk-js` both call it directly — no separate
  DB-walk-based re-implementation inside `helix-api`. Delegation-chain
  trust is based on the credential's own **embedded** `delegationChain`
  field only, agnostic of whether `helix-api` is present at all — this is
  what makes local/offline verification actually offline.
- **Confirmed: `helix-sdk-js`'s public exports are pure re-exports of
  core** — `src/verify.js` is `export { verifyVP } from '@helixid/core'`
  and `src/vp-builder.js` is `export { VPBuilder } from '@helixid/core'`.
  There is only **one** real implementation of each. The previously-flagged
  `helix-sdk-js/src/vp/VPBuilder.ts` (different constructor shape,
  different signing primitive) is **not** the shipped surface — it's
  orphaned/unused code, not a second active implementation. Worth a repo
  hygiene ticket to confirm and remove it, but it's not a design blocker.
- **✅ Decided: build-and-sign consolidates into the SDK only, with no
  `helix-api` dependency.** "SDK only" means the whole VP — construction
  and signing — happens client-side in the agent process. Earlier flow had
  VP template construction possibly happening on the API side
  (`generateVPTemplate()` in `vp.service.ts`) with signing done separately
  by the SDK/wallet; that split is dropped. No API-side
  template-construction step remains in the picture.
- Fail-closed verification semantics, the agent-match + user-match rule
  pair (user-match now also covers the DID-or-email fallback from §4.2 —
  matching is plain string equality either way), the new `effectiveScopes`
  result field, and the regression contract (existing 4 demo scenarios +
  1-element-array case must be byte-identical to today) were all worked
  through in discussion and are ready to drop into the VP doc once it's
  started — not restated here to keep this doc's scope clean.

**Repo cleanup to fold into the VP doc's implementation checklist** (not a
design question — just don't let it get lost once the above lands):
- Remove/replace `helix-api`'s DB-walk-based verification logic
  (`VPService.verifyVP()`'s `reconstructDelegationChain()` and related
  chain-walk code) in favor of calling the single `helix-core` `verifyVP()`
  directly, once the single-verifier decision is implemented.
- Confirm and remove the orphaned `helix-sdk-js/src/vp/VPBuilder.ts` file
  (different constructor shape, not the shipped export per
  `src/vp-builder.js`'s re-export) — dead code, not a second
  implementation to maintain going forward.
- Confirm whether `vp.service.ts`'s `generateVPTemplate()` is actually
  wired to a live route — it isn't listed in `public-surfaces.md`'s HTTP
  API table (only `POST /v1/vp/verify` is). If unused, remove it alongside
  the above; if it is reachable some other way, it needs an explicit
  deprecation as part of the SDK-only build-and-sign consolidation, not a
  second, now-contradictory way to build a VP left sitting in the codebase.

### 4.6 SP identity & discovery ✅

- **`POST /v1/services` and the service registry are removed outright** —
  not migrated, not deprecated. It bundled three concerns now each solved
  elsewhere or explicitly out of scope:
  - **SP identity → DID**, not a services-table row. Outsider SPs get a
    `did:web` DID via the existing `/v1/dids` flow; key material lives in
    the DID document.
  - **VP-target validation → DID resolution + signature check** (the
    verifier already needs to resolve+verify the grant issuer's DID —
    that *is* the legitimacy check, no separate whitelist needed).
  - **Discovery is explicitly out of scope** for HelixID — how an agent
    knows which SP to call is an integration concern, same as an OAuth
    client already knowing which API it's calling. A future Console
    "SPs we've seen" view, if ever built, would be read-only off audit
    events, not a registration system.
  - Resolves prior open items: `x-admin-api-key` gating for
    `/v1/services` — moot, endpoint gone. `amazon`/`helix-delegation`
    seeded services — moot, nothing to migrate; seed DIDs instead if a
    demo SP needs one pre-provisioned.
- **Website-SP DID method: `did:web`**, via the existing `helix did create
  --method web` CLI. `did:key`/`did:ethr` considered and dropped — neither
  ties the DID to the domain without an extra domain-binding proof layered
  on top anyway, and `did:ethr` adds chain plumbing for no real friction
  reduction. `did:web`'s trust model (DNS+HTTPS+server uptime, same as
  ordinary TLS/PKI) is accepted deliberately — same trust the user already
  extends by logging into the SP's domain.
  - Onboarding: `helix did create --method web --domain <sp-domain>`,
    host `did.json` at `.well-known/`, done.
  - **✅ Added to onboarding:** at the same time the SP's DID is created,
    its **initial status list is also generated and hosted**, via the
    existing `helix status-list create` CLI (`--length`, `--output`,
    `--base-url`, `--wallet` — already in `public-surfaces.md`) — no new
    mechanism, and it produces the exact same `StatusListCredential` shape
    `helix-api` uses for its own lists (§4.4's format-unification
    decision). Onboarding becomes two existing CLI commands run back to
    back, not one.
  - **Left open:** app-SP case (no domain) — **explicitly unsupported for
    now**, documented limitation only, no dev work planned.
  - Lower-priority open: thin SDK/CLI wrapper or docs polish around
    hosting/rotation guidance; whether `did:webvh` is worth adopting later.

### 4.7 Consent demo (Travel Planner Agent) ✅ — confirmed flow

Standalone demo, separate from `e2e-travel-concierge` — own folder,
seeding, README section. **Revised:** it does not have to build everything
from scratch — **it can reuse already-published HelixID packages (Console,
SDK) opportunistically if that turns out useful at implementation/discovery
time.** This is no longer a hard "own everything, no reuse" rule — it's
"build standalone by default, reuse published infra where it clearly
helps," decided when the implementer actually gets there, not mandated
up front.

Confirmed flow:
1. Login → custodial DID via regular login.
2. Search TVM → Delhi.
3. Book flight, Airline SP — first-time consent, grant issued.
4. Book hotel, **different** SP — separate consent, independent grant.
5. Book return flight, **same** Airline SP as step 3 — **no consent
   prompt**, standing grant reused. **Required regression test case**, not
   just a demo narrative beat.

---

## 5. VP Generation & Verification — tracked separately (stub)

**On hold** until the open items below are resolved. This section exists
only so this doc stays the single index of "where is X being decided,"
without duplicating VP mechanics here.

**What's already locked, ready to carry into that doc without
re-litigating:**
- Single verifier, lives in `helix-core`, no DB-walk path in `helix-api`.
- Build-and-sign consolidates fully into the SDK, no `helix-api`
  dependency — no API-side VP-template step.
- `helix-sdk-js`'s builder/verifier exports are confirmed pure re-exports
  of core; no second active implementation to reconcile.
- Fail-closed semantics: any array entry that fails its own check fails
  the whole VP.
- Agent-match rule (direct or ancestor DID) **and** user-match rule
  (`grant.userDid == vp.delegatedBy`) — both required, not either/or. The
  user-match side now also covers the DID-or-email fallback (§4.2): plain
  string equality regardless of which identifier form was used.
- New `effectiveScopes` field on the verification result, alongside the
  unchanged `privilegeScopes`; `checkScope()`/`requireScope()` need to
  switch to reading `effectiveScopes` for enforcement.
- Regression contract: 1-element-array case and all 4 existing demo
  scenarios must be byte-identical to current behavior.
- `DelegationGrantCredential` schema is drafted and resolved — see §4.4,
  including the shared `StatusListCredential` format decision and the
  decision to export `VCBaseSchema`.
- Repo cleanup checklist for consolidating to a single verifier and a
  single builder — see §4.5; treat as part of this doc's implementation
  checklist, not a separate workstream.

**What's left to resolve — no longer blocking the doc from starting:**
- Runtime schema validation on externally-fetched status lists (§4.4) —
  the one genuinely open item affecting the revocation-resolution design;
  resolve it as part of writing that section, not before starting.
- The mid-verification audit-logging question (§3's watch-out) — doesn't
  block the doc's start, but needs an answer before its audit-integration
  section is finished.

---

## 6. Functional area breakdown (full detail — kept uncompressed on request)

### 1. Onboarding & Enrollment — NO CHANGE
Covers `POST /v1/enrollment-tokens`, `POST /v1/onboard`,
`POST /v1/onboard/verify`, `HelixClient.requestOnboardingChallenge()`,
`HelixClient.completeOnboarding()`, `AgentWallet.save()`. Nothing in the
consent/delegation work touches this. No repo files needed.

### 2. VP Construction — EDIT — **see §5, tracked in separate doc**

### 3. VP Verification — EDIT (highest risk) — **see §5, tracked in separate doc**

### 4. Delegation (`delegate()` / child VC issuance) — NO CHANGE to
mechanism, EDIT to documentation only
Delegator signs a child `HelixAgentCredential` locally (issuer = parent
DID, subject = child DID — "delegator-signed issuance," not child
self-signing). Child VC embeds signed ancestor chain in `delegationChain`
at creation. **No code change.** Documentation-only correction to
`major-flows.md` §2: remove the earlier incorrect "reattach the grant into
`delegationChain`" guidance — the grant is always a separate, independent
VP array entry (§4.5), never merged into `delegationChain`.
Repo file(s) needed: `delegate()`/`buildDelegationVC()` signature, to
confirm `delegationChain` field name/shape for accurate documentation
(not for behavior change).

### 5. Consent Package (`DelegationGrantCredential` + issuance/revocation) — NEW
No existing equivalent. New credential type + new SDK surface, issued by
the SP, not `helix-api`. Schema: see §4.4 (now mostly resolved). New SDK
exports: local issuance (model on `delegate()`, fully local — not
`HelixClient.issueVC()`) and local revocation (model on `helix revoke`
CLI's status-list-file handling, needs an SDK-callable equivalent since
that CLI command is agent-focused today). T&C acceptance folds into grant
scopes, no separate field. Scope offering: SP's MCP metadata if available,
else a curated fallback list.
Repo file(s) needed: `delegate()` implementation (model), `helix revoke`
CLI implementation + status-list file format (model), `AgentWallet`
credential storage methods (to determine whether grant storage needs a new
concept or fits the existing wallet structure).

### 6. Consent Widget — NEW
Packaged as `@helixid/widget`, sibling to `@helixid/mcp`/`@helixid/langchain`
— not a separately hosted service. Technical shape (iframe+postMessage vs.
web component) and coexistence with an SP's own consent UI: still deferred
to a dedicated implementation discussion (§4.3).
Repo file(s) needed: `@helixid/mcp` or `@helixid/langchain` package
structure, as a packaging template only.

### 7. Service Registry — REMOVE
`POST /v1/services`, `GET /v1/services`, `GET /v1/services/:serviceName`,
`HelixClient.listServices()`, `HelixClient.getService()`,
`major-flows.md` §7 — delete outright, not migrated, not
deprecated-with-warning. Confirm no other internal code references these
before removal.
Repo file(s) needed: server route file(s) implementing `/v1/services`,
SDK client file implementing `listServices()`/`getService()`, search
results for any other internal callers before deletion.

### 8. SP Identity Provisioning — NEW (wiring/docs only, no new protocol)
Website SPs use `did:web` via the existing `helix did create --method web`
CLI, reused as-is. **Scope expanded:** onboarding also generates and hosts
the SP's initial status list at the same time, via the existing `helix
status-list create` CLI — same shared `StatusListCredential` format
`helix-api` uses for its own lists (§4.4), not a second shape. New work:
onboarding docs covering both steps back to back — hosting
`.well-known/did.json` **and** the initial status list file, verifying
resolution, key-rotation guidance. App-SP DID (no domain): explicitly
unsupported, documented limitation only, no dev work.
Repo file(s) needed: `helix did create --method web` CLI implementation,
`helix status-list create` CLI implementation — confirm current
behavior/output of both before writing onboarding docs (likely no code
change needed for either, just confirming and sequencing them into one
onboarding flow).

### 9. `StatusListCredential` — Format & Hosting — NEW (format decided; full detail deferred until picked up)
Tracked as its own functional area, separate from #8, because this format
is a shared contract used by `helix-api` *and* every SP, not just an
SP-onboarding detail.

**Decided so far:**
- Same `StatusListCredential` shape (`helix-core/src/status-list/index.ts`)
  used for both `helix-api`-hosted and SP-hosted lists — no divergent
  shape for the SP case.
- An SP's initial status list is generated and hosted at the same time
  its `did:web` DID is provisioned (#8), reusing the existing `helix
  status-list create` CLI as-is — no new mechanism.
- Caveats resolved individually rather than left as one vague flag:
  hardcoded contexts → fix to use `VC_CONTEXTS` (trivial); missing
  `validUntil`/`proof`/no `HelixVC` extension → left as-is, consistent
  with the `did:web` trust model already accepted (DNS+HTTPS trust, no
  extra crypto layered on top of domain ownership) — not a gap that needs
  closing.
- **Still open — the one piece of actual work here:** no runtime schema
  validation on the fetched status-list JSON. Today's fetch-and-cast
  (`await response.json() as StatusListCredential`, in
  `helix-core/src/vp-verifier.ts`) has no zod-parse or shape check at all.
  Low-risk while every fetch target is `helix-api`'s own generated output;
  becomes a real integrity gap once fetch targets can be arbitrary
  SP-hosted URLs (malformed/malicious JSON could crash the cast, cause
  `getBit()` to read garbage from a non-bitstring `encodedList`, or worst
  case be crafted so a revoked index reads as active). Needs: a proper zod
  schema for the full `StatusListCredential` shape (doesn't exist yet —
  only a TS interface, plus `VCCredentialStatusSchema` in `vc.ts` for the
  *entry* pointer, not the list itself), and a parse-before-use step
  wherever the list is fetched.
- **Rest of the detail (exact zod schema, where the validation call site
  lives, whether `helix-api` keeps a local-repo fast path for its own
  lists vs. always fetching over HTTP) is deferred until this area is
  picked up** — see the VP Generation & Verification dev design doc, which
  now owns this.

Repo file(s) needed: `helix-core/src/status-list/index.ts`, the `getBit()`
call site(s) (seen in `vp-verifier.ts`; confirm whether `vp.service.ts`'s
local-repository-based lookup needs the same treatment once it also
handles SP-hosted grant status lists), any existing zod schema for the
credential shape itself (none confirmed yet, only the entry-pointer
schema).

### 10. Audit / Logging — NEW generic module + EDIT existing call sites
`service_registered` becomes irrelevant once #7 is removed — dropped from
the six event types, no replacement. New generic module: given an agent
DID, resolve its DID document, check for a declared log-sink service
endpoint (reuse `addServiceEndpoint()`), POST the event there; no endpoint
→ local stdout/file fallback. Existing six-event call sites edited to
route through this instead of writing directly to `helix-api`'s store. New
consent events (`consent_granted`, `consent_revoked`) route through the
same module, no special-casing. See §3's watch-out re: mid-verification
audit calls once VP verification consolidates into `helix-core`.
Repo file(s) needed: current audit-log writer implementation (wherever the
six events are emitted/stored today), `addServiceEndpoint()`/DID
service-endpoint implementation (to confirm it's reusable for log-sink
declaration as-is).

### 11. `helixid-setup` Seeder — EDIT
Currently pre-registers the booking backend via `POST /v1/services`.
Change: replace with DID provisioning via `POST /v1/dids`, consistent with
#7's removal. Reusable for the new consent demo if convenient (§4.7) — not
a hard requirement.
Repo file(s) needed: `helixid-setup` seeder script/service source.

### 12. `helixid-console` — NO CHANGE, optional reuse
No dev work unless a specific need surfaces during consent demo build
(§4.7 now explicitly allows opportunistic reuse here).

### 13. New Standalone Consent Demo (Travel Planner Agent) — NEW
Own folder, own seeding (may reuse `helixid-setup`, #11), own README
section — does not modify `e2e-travel-concierge`. **May reuse published
Console/SDK packages if useful at implementation time (§4.7)** — not
required to build everything from scratch. Confirmed 5-step flow: see
§4.7.
Repo file(s) needed: none required upfront — `e2e-travel-concierge`'s
folder structure (frontend/backend/ai-agent/config split) is worth reusing
as a structural template only.

### 14. Test / Verification Structure — cross-cutting
- **#5 (consent issuance/revocation):** fully offline issuance/revocation
  (no `helix-api` reachable), revocation reflected on next verify attempt.
- **#9 (`StatusListCredential` validation):** fetched JSON that fails the
  new runtime schema check must be rejected (treated as untrusted/failed
  revocation-check), not silently used or allowed to throw an unhandled
  cast error.
- **#10 (audit routing):** agent DID with declared log endpoint routes
  correctly; agent DID with no endpoint falls back to local; confirm SP
  DID is never used for routing.
- **#13 (consent demo):** all 5 steps, with step 5 specifically verifying
  no consent re-prompt occurs.
- **Regression:** existing four `e2e-travel-concierge` scenarios must pass
  unmodified.
- **#2/#3 (VP construct/verify) test matrix:** deferred entirely to the
  separate VP Generation & Verification doc — don't design test cases for
  VP mechanics here.

### Summary table

| # | Area | Tag | Repo files needed |
|---|---|---|---|
| 1 | Onboarding & Enrollment | NO CHANGE | none |
| 2 | VP Construction | EDIT | see separate VP doc |
| 3 | VP Verification | EDIT | see separate VP doc |
| 4 | Delegation mechanism | NO CHANGE (docs EDIT) | `delegate()`/`buildDelegationVC()` signature |
| 5 | Consent Package (new VC type) | NEW | `delegate()` impl, `helix revoke` CLI + status-list format, `AgentWallet` storage methods |
| 6 | Consent Widget | NEW | `@helixid/mcp` or `@helixid/langchain` structure (template only) |
| 7 | Service Registry | REMOVE | `/v1/services` route file(s), SDK client file, internal caller search |
| 8 | SP Identity Provisioning | NEW (docs/wiring) | `helix did create --method web` CLI, `helix status-list create` CLI |
| 9 | `StatusListCredential` Format & Hosting | NEW (format decided, validation TBD) | `status-list/index.ts`, `getBit()` call sites, no existing credential-level zod schema |
| 10 | Audit / Logging | NEW + EDIT | current audit writer, `addServiceEndpoint()` impl |
| 11 | `helixid-setup` Seeder | EDIT | seeder script/service source |
| 12 | `helixid-console` | NO CHANGE | none |
| 13 | Standalone Consent Demo | NEW | none required; `e2e-travel-concierge` structure as template |
| 14 | Test Structure | cross-cutting | n/a |

---

## 6A. Epic Order & Sequencing ✅

Consolidates the 14 functional areas in §6 into 5 delivery epics, with
locked ordering/dependencies. This section is the sequencing index —
functional scope for each epic still lives in §6 / §4 / the separate VP
doc; not restated here.

**Epics:**

1. **SP Identity & Revocation Infra** — §6 items 7 + 8 + 9 (Service
   Registry removal, SP `did:web` provisioning, `StatusListCredential`
   format/hosting).
   - Includes: **runtime schema validation on the `StatusListCredential`
     JSON at verification time** (§4.4 / §6 item 9 / §7's flagged
     blocker) — a proper zod schema for the full status-list shape (not
     just the entry-pointer `VCCredentialStatusSchema`), with a
     parse-before-`getBit()` step; on parse failure, the credential is
     treated as **revoked/untrusted** (fail-closed), not an unhandled
     cast error. This applies to both `helix-api`-hosted and SP-hosted
     lists, since §4.4 already decided they share one format.
2. **VP Build & Verify** — §6 items 2 + 3, full scope of the separate VP
   Generation & Verification dev design doc: core consolidation (single
   `helix-core` verifier, retire `helix-api`'s DB-walk) **and** the
   grant-array extension (`effectiveScopes`, agent/user-match). One epic,
   not split.
3. **Consent Package** — §6 item 5 (`DelegationGrantCredential` schema,
   local issuance, local revocation), with the Consent Widget (§6 item 6)
   folded in as a task rather than its own epic — the widget is thin
   packaging over this same schema with no independent sequencing need.
4. **Audit Routing** — §3 + §6 item 10.
5. **Seeder Update + Standalone Consent Demo** — §6 items 11 + 13.

**Sequencing:**

- Epic 2 (VP Build & Verify) splits into two halves with different
  dependencies:
  - *Core consolidation half* (single verifier, retire
    `reconstructDelegationChain()`, remove orphaned builder, §2.9
    regression contract) has **no dependency on Epic 1** — pure internal
    refactor against the existing 1-element-array case. Proceed on this
    now.
  - *Grant-array half* (§3/§4 of the VP doc, the `[agentVC, grantVC]`
    path) **depends on Epic 1** — it needs (a) the status-list runtime
    validation from Epic 1 before an externally-hosted (SP) status list
    can be trusted, and (b) a real SP `did:web` DID from Epic 1 to issue
    a grant against.
- Epic 3 (Consent Package) depends on Epic 1 (a grant is SP-issued,
  needs an SP DID and status list to revoke against).
- Epic 4 (Audit Routing) has no hard blocking dependency — can run in
  parallel with Epics 1–3.
- Epic 5 (Seeder + Demo) is last — integration-only, depends on Epics
  1–4 all landing (SP DID, grant flow, VP grant path, audit routing).

**Locked order:** Epic 2 (core half) now → Epic 1 → Epic 3 → Epic 2
(grant half) → Epic 4 (parallel-able anytime) → Epic 5 last.

---

## 7. Open / unresolved items (consolidated, deduped)

- 🔴 Runtime schema validation on externally-fetched status lists, once
  revocation resolution is generalized to SP-hosted URLs (§4.4) — the
  only item still blocking full sign-off on the VP doc's design.
- 🔴 App-SP DID (no domain) — explicitly unsupported for now, no design.
- 🔴 `did:web` onboarding polish (hosting/rotation guidance, `did:webvh`
  evaluation) — not yet scoped, lower priority.
- 🔴 Consent widget technical shape (iframe/postMessage vs. web component)
  and coexistence with an SP's existing consent UI — deferred to its own
  discussion.
- 🟡 Audit event shape/routing module exact schema — design at
  implementation time (§3).
- 🟡 Mid-verification audit logging once VP verification consolidates into
  `helix-core` (§3's watch-out) — carry into the VP doc.

---

## 8. Superseded / discarded

- ThunderID as a structural reference — pattern kept, name dropped from
  all output copy.
- Earlier 3-scenario demo list — superseded by the 4-scenario list (§2).
- Consent log's original "2 independent sibling credentials" framing, and
  the pre-addendum "reattach grant into `delegationChain`" framing — both
  wrong, fully superseded (§4.5).
- Self-sovereign / mDL-first end-user identity assumption — dropped in
  favor of agent-dependent binding (§4.2).
- Service registry (`POST /v1/services` and friends) — removed outright,
  not deprecated (§4.6).
- **`HelixClient.registerService()` open question — moot, not just
  resolved-as-no.** This was originally an open question in the main log:
  "does the SDK get a `registerService()` convenience method, or does
  `POST /v1/services` stay a direct admin-authenticated call." Since the
  entire service registry was removed (§4.6), there's no registry left to
  add a convenience method for — the question doesn't need an answer, it
  no longer applies. (The actual replacement need — an SDK provisioning
  path for SPs to get a `did:web` DID — is tracked as its own new item
  under §4.6, not this one.)
- Original consent-log framing that agent-side user-recognition was
  "descoped entirely" — narrowed, not discarded; see §4.2's split into
  (a) session/UX recognition (still descoped) vs. (b) protocol-level user
  matching (not descoped, required).
- Standalone consent demo's earlier "own infra, own everything, no reuse"
  rule — relaxed to "reuse published Console/SDK packages opportunistically
  if useful" (§4.7).
- Earlier recommendation to keep user-matching **DID-only** for v1 —
  superseded by the decision to accept a plain email string as fallback,
  in the interest of keeping v1 simple (§4.2).
