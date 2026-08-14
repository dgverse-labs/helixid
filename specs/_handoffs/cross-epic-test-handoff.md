# Cross-Epic Test Suite — Handover

**For:** the peer reviewer / incoming tech lead for this feature.
**Branch:** `feature/epics-1-5-consent-and-vp`
**Commit:** `b4d9914` — *Epic 5b — Cross-epic test suite* · **tag:** `epic5b-done`

---

## ⚠️ Read this first — status is PARTIAL, and the branch is RED

Two things you must know before reviewing anything else.

**1. This epic is roughly one-twelfth delivered.** Of the suite's 12 categories, **§7 (Cross-SP Isolation) is implemented**, plus three cases borrowed from adjacent categories. The other eleven categories are **untouched**. Work stopped deliberately — see below.

**2. The branch has a deliberately failing test committed.** `UX13` asserts the behaviour the suite spec requires; the implementation does not do it. CI on this branch **will be red**. That was the instruction: surface the gap, do not fix earlier epics' code without an explicit decision. Nothing is broken by accident.

Current workspace state (`pnpm test:non-live`, Node 24, Postgres on :5433):

| Package | Result |
|---|---|
| `@helixid/example-e2e-consent-demo` | **1 failed** / 24 passed (25) — the failure is UX13, by design |
| `@helixid/api` | **5 failed** / 210 passed (215) — pre-existing, five epics old, unrelated |
| core · sdk-js · widget · cli · mcp · langchain · did-hedera | all pass |
| `@helixid/e2e` | 5 files skipped (`it.todo` stubs, never implemented) |

---

## 1. Overview and objectives

The suite exists on a specific premise, stated in `specs/epics/cross-epic-test-suite.md`: per-epic test plans, written one epic at a time, **structurally miss seam-level bugs** — defects that only appear where two epics meet. It reorganises testing by *risk area* rather than by epic, and marks each case `[existing]` (already specified in an epic doc, restated for a single view) or `[NEW]` (a gap this doc found).

The assignment was: implement every `[NEW]` case except where constrained, run the `[existing]` ones and *report* failures rather than reshaping implementation to fit, and work in the doc's own gap-density priority order:

1. **§7 Cross-SP isolation** — 6 new cases, an entirely new risk surface introduced by Epic 5's two-SP demo
2. **§9 Audit trail** — least-specified category, but heavily constrained (see §4 below)
3. **§1 Schema**, **§2 Issuance**
4. Everything else

The premise proved correct almost immediately: the one category completed surfaced a real authorization gap that no per-epic test would have caught, because it lives precisely at the widget↔SP-backend seam.

---

## 2. What was implemented

Two new files, 487 lines, both under `examples/e2e-consent-demo/tests/`. They live there rather than in `e2e/` because that is where the working two-SP fixture already exists — see the design note in §6.

### `harness.ts` (170 lines) — shared two-SP fixture

Boots **real** SP servers on real ports with real `did:web` identities. Nothing is mocked below the test: real DID resolution over HTTP, real Ed25519 signing, real `verifyVP()`, real status-list fetches.

| Export | Purpose |
|---|---|
| `startHarness(airlinePort, hotelPort)` | temp dir, both SPs provisioned + listening, enrolled agent wallet, `stop()` teardown |
| `makeEnrolledWallet(dir, scopes, file)` | platform-signed agent VC in a file-backed `AgentWallet` |
| `grantConsent(sp, agentDid, userDid, scopes?)` | drives the SP's two consent routes exactly as the widget does |

`grantConsent()` deliberately goes through `GET /api/consent/scopes` before `POST /api/consent/accept`, so the SP's `scopeResolutions` counter remains a faithful proxy for "widget renders" — the metric Epic 5's step-5 assertion depends on.

### `cross-sp-isolation.test.ts` (317 lines) — 10 tests

| Case | What it asserts | Result |
|---|---|---|
| **ISO1** | A VP bound to the Airline is rejected by the Hotel on `targetService` alone → `VP_INVALID_STRUCTURE` | pass |
| **ISO1b** | The Airline's grant cannot authorize a Hotel booking *even in a correctly-targeted VP* → `CONSENT_REQUIRED` / `NO_GRANT_FOR_THIS_SERVICE` | pass |
| **ISO2** | Neither SP's catalog leaks the other's scopes; the only overlap is the resolver-appended `accept-terms` | pass |
| **ISO3** | Revoking the Airline grant fails Airline bookings closed (`VC_REVOKED`) while the Hotel grant keeps working | pass |
| **ISO4** | Distinct DIDs, distinct key material, distinct status lists — not one identity served twice | pass |
| **ISO5** | `selectGrant()` never returns the other SP's grant; an unknown DID returns `undefined` | pass |
| **ISO6** | Concurrent issuance at both SPs cross-contaminates neither status list nor grant store | pass |
| **REV8** (§5) | Airline list has a revoked bit, Hotel's does not — each verification reads only its own list, no resolver-cache bleed | pass |
| **UX11** (§8) | Scope route returns *exactly* `{ scopeOptions: ScopeOption[] }`, no extra keys, each option well-formed | pass |
| **UX13** (§8) | SP independently rejects a selection omitting a required scope | **FAIL — real gap** |

ISO1 was split into two tests because the spec's wording ("`vp.targetService` mismatch → rejected, independent of grant validity") conflates two distinct failure modes. ISO1 covers the literal target-binding check; ISO1b covers the substantive isolation question — what happens when the VP *is* correctly targeted but carries the wrong SP's grant. Both matter; only testing the first would have missed the more interesting one.

---

## 3. Bugs found

### BUG-1 — `POST /api/consent/accept` does not enforce required scopes (UX13)

**Severity:** moderate. Not remotely exploitable, but it defeats a stated product rule.
**Lives in:** `examples/e2e-consent-demo/sp-shared/app.ts`, the `/api/consent/accept` handler.
**Introduced by:** Epic 5.

A caller that bypasses the widget and POSTs directly with `accept-terms` omitted **receives a signed grant anyway**:

```
FAIL  §8 Consent UX > UX13: the SP independently rejects a selection
      omitting a required scope
AssertionError: expected 201 to be 400

[airline] grant issued to did:key:z6Mktx… for did:web:ux13-user.example [book:flights]
```

The suite is explicit that this must not happen: *"required scopes must be enforced server-side too, not only via UI disabling."* Today the accept route validates only that `agentDid`, `userDid`, `scopes` and `durability` are **present** — there is no check that `scopes` covers the entries the resolver marked `required: true`. (Every other `required` reference in that file is the unrelated `metadata.requiredScope` tool gate.)

Practically: the T&C scope folds into grant scopes by design (there is no separate acceptance field), so a grant issued without `accept-terms` is a grant where the user never accepted the terms — and nothing downstream can tell.

**Suggested fix**, small and contained: inside the accept handler, call `resolveConsentScopes()` with the same arguments the GET route uses, and reject with `400 MISSING_REQUIRED_SCOPE` when any `required: true` scope is absent from the submitted selection. That reuses the resolver as the single source of truth rather than hardcoding `accept-terms`.

**Left failing on purpose.** The test encodes the spec's requirement. Rewriting it to assert today's behaviour would convert a real finding into a passing test that documents a bug — the exact failure mode the suite was written to prevent.

### BUG-2 — ERR2 has no throw site to test (design gap, not a code defect)

**Lives in:** `helix-core/src/grant.ts`.
**Introduced by:** Epic 1/3 — already flagged in `epic1-epic3-handoff.md`.

ERR2 (marked `[existing, implied]`) expects grant issuance to throw the consolidated scope-escalation error when a grant requests scopes beyond the issuing SP's own authority. `issueGrant()` has exactly three throw sites, all `ValidationError`; no scope-escalation check exists.

This is **not** something a test can close. `IssueGrantOptions` carries no representation of what the SP is itself authorized for, so there is nothing to check a request against. Closing ERR2 requires deciding what bounds an SP's authority in the first place — a design question, not an implementation one. No test was written; writing one would have meant inventing the missing concept.

---

## 4. §9 Audit Trail — what is deferred and why

Register **D11** governs this category: audit routing (Epic 4) is parked, so §9 cases may be implemented **only** where they can assert against the six existing event types at their current call sites, and a routing module must **not** be stubbed to make them pass.

Applying that rule:

| Case | Disposition |
|---|---|
| AUD1 — event POSTed to a DID-declared log-sink endpoint | **DEFERRED** — requires the routing module |
| AUD2 — fallback to local stdout/file when no endpoint declared | **DEFERRED** — same |
| AUD3 — routing keyed by agent DID, never SP DID | **DEFERRED** — same |
| AUD4 — each of the six baseline event types fires exactly once | **IMPLEMENTABLE (not yet written)** — the "fires exactly once per triggering action" half is testable at current call sites; the "routed through the generic module" half is not |
| AUD5 — `consent_granted` fires on `issueGrant()` | **DEFERRED** — the event type does not exist. It was to be introduced *with* the routing module. Epic 5 ships with consent events emitted nowhere |
| AUD6 — `consent_revoked` fires on `revokeGrant()` | **DEFERRED** — same |
| AUD7/AUD8 — one `VP_VERIFIED` / one `VP_REJECTED` per verification | `[existing]`, **already covered** by Epic 2's `helix-api/tests/unit/services/vp.service.test.ts` (A5/A6) and passing |
| AUD9 — `service_registered` never fires anywhere | **IMPLEMENTABLE (not yet written)** — pure absence assertion against existing types |
| AUD10 — delegation never its own event, only `parentVcId` on `vp_verification` | **IMPLEMENTABLE (not yet written)** |
| AUD11 — unreachable sink still falls back locally | **DEFERRED** — requires the module, *and* the doc itself flags the behaviour as unspecified |
| AUD12 — two SPs, each with its own sink, no cross-delivery | **DEFERRED** — requires the module |

**Seven of twelve deferred**, three implementable but not yet written, two already passing elsewhere. Nothing was stubbed.

A consequence worth stating plainly, because it affects how the demo reads: consent issuance produces **no audit event anywhere**. Console shows the agent being enrolled and its VC issued, but not the user granting consent and not the SPs authorizing bookings. The most interesting half of the Epic 5 demo is invisible to the audit UI until Epic 4 lands.

---

## 5. `[existing]` cases that failed

**None.** No `[existing]` case failed during this work.

One clarification, since it looks like a failure and is not: the five `@helixid/api` `audit-log.repository` failures are **not** suite cases. They are pre-existing tests calling a `repository.findMany()` that the repository never had (it exposes `list()`). They predate this branch, are identical on `main`, and have survived five epics untouched under the standing "don't revise earlier epics" rule.

---

## 6. Design decisions and reasoning

**Tests placed in `examples/e2e-consent-demo/tests/`, not `e2e/`.** `e2e/` looks like the natural home for a cross-epic suite, but §7 needs two live SPs with `did:web` identities, status lists and consent routes — that fixture exists only in the Epic 5 demo. Rebuilding it inside `e2e/` would have meant a second copy of the SP app drifting from the first. The trade-off: the suite is now distributed by fixture locality rather than centralised. If later categories need a different home (§9 needs `helix-api`'s Fastify+DB harness; §1/§2 need nothing but `helix-core`), expect the suite to span three or four packages. **Recommend documenting the case→file map** as it grows; §12 below has a starting point.

**A shared `harness.ts` rather than copy-pasted setup.** `consent-flow.test.ts` (Epic 5) already had ~100 lines of two-SP setup. Rather than refactor a passing file at the end of a branch, the new harness was written alongside it and the old file left alone. That duplicates setup once. **This is deliberate technical debt** — see §8.

**Real servers over mocks.** Every assertion runs against real HTTP, real `did:web` resolution, real signatures. Slower (~1s for the file) but it is the only way §7's questions can be answered honestly: "does one SP's status list bleed into another's verification" is meaningless against a stubbed resolver.

**Ports fixed, not ephemeral.** `14201`/`14202` here; `14101`/`14102` in `consent-flow.test.ts`. `did:web` embeds the port in the DID, so the identity must be provisioned against a known port before the server binds. Ephemeral ports would require provisioning after bind, complicating the harness. Cost: parallel runs on a busy machine can collide — see §8.

**ISO3 corrected mid-flight, in the test not the implementation.** ISO3 initially asserted a `ConsentDeclinedError`. It failed. Investigation showed the *implementation was right and the test was wrong*: a revoked grant produces `VP_INVALID` / `VC_REVOKED` and never reaches the consent handler — correct behaviour, because a revoked grant is not "needs consent", and an SP that re-prompted there would invite the user to consent around a revocation. The assertion was corrected to expect the verification rejection. **This is the distinction the brief asked for** — test bug fixed, implementation untouched; contrast with UX13, left failing.

---

## 7. What went well

- **The suite's own premise validated itself immediately.** UX13 sits exactly at the widget↔SP-backend seam. Epic 3b tested the widget's UI constraint; Epic 5 tested the SP's routes; neither tested that the backend independently re-checks what the UI enforced. One category of cross-cutting testing found it.
- **Epic 5's fixtures paid off.** `provisionSpIdentity`, `SpStore`, `createSpApp` and `callSpTool` were all reusable as-is. §7 needed no production-code changes to become testable.
- **`did:web` over loopback works cleanly.** `helix-core`'s resolver maps a percent-encoded loopback port to plain HTTP, so two SPs can hold genuinely distinct, resolvable web DIDs inside one test process. ISO4 verifies distinct key material rather than just distinct strings.
- **The counter instrumentation held up.** `grantsIssued` / `scopeResolutions` / `consentRequired` on the SP app, added for Epic 5's step-5 assertion, turned out to be exactly what ISO6 needed for concurrency.

---

## 8. Known limitations, technical debt, outstanding work

**Outstanding — eleven categories not started:**

| Category | New cases | Notes for whoever picks this up |
|---|---|---|
| §1 Schema | SCH5, 9, 10, 11, 12, 13, 14 | Pure `helix-core` unit tests, no fixtures. Cheapest category; good warm-up |
| §2 Issuance | ISS4, 5, 6, 7, 11 | ISS7 is probabilistic **by design** (register D9) — large N or fixed seed to catch a broken RNG, **never** assert uniqueness; that's O4, still open |
| §4 Grant-array | GR13, GR14 | GR14 is a *flag-not-assert* case: confirm `serviceDid` is genuinely inert at verification time |
| §5 Revocation | REV7 | REV8 done. REV7 wants the revoked-entry error attributed to the grant, not the agent VC |
| §6 Delegation | DEL5, DEL6 | DEL5 = depth-limit enforcement; DEL6 = grant issued to a non-ancestor |
| §8 Consent UX | UX12 | Genuinely open per WIDGET Part F — session-auth behaviour unspecified. **Do not invent a rule**; list it |
| §9 Audit | AUD4, AUD9, AUD10 | Only these three. See §4 |
| §10 E2E | E2E10 | `docker compose up` cold-start. **Never executed** — the compose file has not been run once, in this epic or Epic 5 |
| §11 Error taxonomy | ERR5, ERR6, ERR8 | ERR2 is blocked on BUG-2's design question |
| §12 Removed surfaces | RM1–RM12 | Brief requires **runtime** proof (route 404s from the built app), not grep alone |
| §3 Single-cred regression | — | Zero new cases; `[existing]` R1–R8 already covered by `specs/_baselines/verifyvp-baseline-harness.mjs` |

**Technical debt introduced here:**

- **Duplicated two-SP setup.** `consent-flow.test.ts` and `harness.ts` both build the fixture. Migrating the former onto the latter is ~20 lines and should happen before a third file needs it.
- **Fixed test ports** (14101/2, 14201/2). Collisions surface as confusing failures rather than clear port-in-use errors.
- **A committed failing test.** Intentional, but it means "is the branch green?" no longer answers "is the branch healthy?". Whoever fixes BUG-1 should confirm UX13 flips to green rather than deleting it.

**Pre-existing debt this epic did not touch** (all documented in the sibling handoffs, all still open): the five `audit-log.repository` failures; audit routing parked, blocking most of §9; `e2e/tests/*` still five `it.todo` stubs; the four `e2e-travel-concierge` scenarios never executed in any epic; index-allocation uniqueness (O4).

---

## 9. Files and components

**Modified by this epic — two files, both new:**

```
examples/e2e-consent-demo/tests/harness.ts               170 lines  (new)
examples/e2e-consent-demo/tests/cross-sp-isolation.test.ts  317 lines  (new)
```

**No production code was modified.** That is the headline for review purposes: this epic is additive test code only. `git show --stat b4d9914` confirms 2 files, 487 insertions, 0 deletions.

**Read-only dependencies you will want context on while reviewing:**

| Component | Why it matters here |
|---|---|
| `examples/e2e-consent-demo/sp-shared/app.ts` | The SP app under test. **BUG-1 lives here**, in `/api/consent/accept` |
| `examples/e2e-consent-demo/sp-shared/identity.ts` · `store.ts` | `did:web` + status-list provisioning; per-SP persistence |
| `examples/e2e-consent-demo/agent/consentAwareCall.ts` | Grant reuse logic ISO3/ISO5 exercise |
| `helix-core/src/vp-verifier.ts` | `verifyVP()` — the single verification implementation everything funnels through |
| `helix-core/src/grant.ts` | `issueGrant()` / `revokeGrant()`. **BUG-2 lives here** |
| `packages/widget/src/server/resolve-scopes.ts` | Catalog resolution behind ISO2/UX11 — and the suggested fix for BUG-1 |

---

## 10. Testing performed and current status

**Commands** (Node 24 is mandatory — Node 20 fails `pnpm install` on a `@prisma/streams-local` engine constraint):

```bash
# the new suite
pnpm --filter @helixid/example-e2e-consent-demo test

# full workspace, CI-equivalent
pnpm exec turbo run test:non-live --force
```

`@helixid/api` additionally needs Postgres 16 on `:5433`, matching CI:

```bash
docker run -d --name helixid-test-pg -e POSTGRES_USER=helixid_test \
  -e POSTGRES_PASSWORD=helixid_test -e POSTGRES_DB=helixid_test \
  -p 5433:5432 public.ecr.aws/docker/library/postgres:16-alpine
DATABASE_URL='postgresql://helixid_test:helixid_test@localhost:5433/helixid_test' \
  NODE_ENV=test pnpm --filter @helixid/api db:test:prepare
```

*(Docker Hub was unreachable from this machine; the ECR mirror above works.)*

**Results as committed:**

| Suite | Tests | Status |
|---|---|---|
| `cross-sp-isolation.test.ts` | 10 | 9 pass, **1 fail (UX13, intentional)** |
| `consent-flow.test.ts` (Epic 5) | 15 | all pass |
| `@helixid/core` | 17 files | all pass |
| `@helixid/sdk-js` | 18 files | all pass |
| `@helixid/widget` | 2 files | all pass |
| `@helixid/cli` | 28 tests | all pass |
| `@helixid/api` | 215 tests | 210 pass, 5 fail (pre-existing) |
| `@helixid/mcp` · `langchain` · `did-hedera` | — | all pass |
| `@helixid/e2e` | 5 files | skipped — `it.todo` stubs |

**Not run, and not claimed:** the four `e2e-travel-concierge` scenarios (need Docker + LLM keys; folder verified byte-unmodified via `git diff epic3-done`), and `docker compose up` for the consent demo (E2E10).

The Epic 2 regression baseline is independent of all this and still passes:

```bash
node specs/_baselines/verifyvp-baseline-harness.mjs compare   # 8/8 IDENTICAL
```

---

## 11. Recommendations for the reviewer

**Review in this order** — the whole diff is 487 lines of test code, so this should be quick:

1. **Decide BUG-1 first.** Everything else is downstream. Three options: fix the accept route (recommended — small, contained, reuses `resolveConsentScopes()` as the source of truth); accept the gap and rewrite UX13 to document it (I'd argue against — it converts a finding into a passing test); or defer with a ticket and mark UX13 skipped with a link. **Do not leave it failing and unowned** — a red branch that everyone has learned to ignore is worse than either fix.
2. **Decide BUG-2 separately.** It needs a product answer — what bounds an SP's own authority? — before any code or test. Reasonable to defer to a post-v1 discussion; just record it.
3. **Sanity-check the ISO1/ISO1b split** (§2). I read one spec line as two cases. If you disagree, ISO1b is the one to keep.
4. **Confirm the §9 deferral list** in §4 is the reading of D11 you intended. It is the judgment call with the widest blast radius: it defers seven of twelve cases.
5. **Skim `harness.ts` for reusability**, since every remaining category that needs live SPs will build on it.

**Next steps, in the order I would take them:**

| # | Work | Effort | Why this order |
|---|---|---|---|
| 1 | Resolve BUG-1 | S | Unblocks a green branch |
| 2 | §1 Schema + §2 Issuance | M | Pure unit tests, no fixtures, closes 12 cases fast |
| 3 | §11 Error taxonomy (ERR5, ERR6, ERR8) | S | Small; pairs naturally with §1/§2 |
| 4 | §12 Removed surfaces | M | Needs the runtime-not-grep harness; mostly mechanical |
| 5 | §4/§5/§6 remaining | M | Extends existing `helix-core` fixtures |
| 6 | §9 implementable three (AUD4/9/10) | M | Needs `helix-api`'s Fastify+DB harness |
| 7 | §10 E2E10 `docker compose up` | L | First-ever run of the composed stack; expect surprises |
| 8 | Fold `consent-flow.test.ts` onto `harness.ts` | S | Debt cleanup once the suite stabilises |

---

## 12. Additional context for resuming quickly

**Environment gotchas that will cost you an hour each if unknown:**
- **Node 24 required.** Node 20 fails install outright.
- **Postgres on :5433** for `@helixid/api` only; every other package runs clean.
- **Docker Hub was unreachable here**; `public.ecr.aws/docker/library/postgres:16-alpine` works.
- **`examples/` resolve to *published* npm packages** — except `e2e-consent-demo`, which uses `workspace:*` because `issueGrant()`, `effectiveScopes`, the current `VPBuilder` shape and `@helixid/widget` exist in no published version. **It is the only example that actually exercises this branch.** `e2e-travel-concierge` cannot regress from source changes, and equally cannot validate them.

**Cross-cutting findings from earlier epics that shape this suite** — worth reading the sibling handoffs in `specs/_handoffs/` before extending it:

- **`effectiveScopes` alone cannot express "requires consent."** With no grant present it collapses to the agent's own `privilegeScopes`, and the agent VC must itself carry the scope for a grant to have any effect. An SP must *additionally* require that a grant it issued is present. This is demo-local knowledge today and belongs in the VP doc — full write-up in `epic5-demo-handoff.md`. It is the single most consequential finding across the five epics.
- **`helix-api` was building against a published `@helixid/core@0.1.0`**, not the workspace, until Epic 2 fixed it — meaning Epic 1/3's core changes were never exercised through the API before then. See `epic2-vp-handoff.md`.
- **The committed `verifyvp-baseline-2026-07-29.txt` is an 88-byte error string**, not a baseline. The real harness is `verifyvp-baseline-harness.mjs`, added in Epic 2. Delete the stale file.
- **Tag naming has drifted from register D12**, which specifies `epic1-done`/`epic2-done`. Actual tags: `epic1-epic3`, `epic-2-done`, `epic3-done`, `epic5-done`, `epic5b-done`. D12's `git diff epic2-done..epic3-done` review workflow does not work as written.

**Sibling handoffs, in branch order:**
`epic1-epic3-handoff.md` → `epic2-vp-handoff.md` → `epic3b-widget-handoff.md` → `epic5-demo-handoff.md` → this document.
