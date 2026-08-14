# HelixID — Resolved Decisions Register

**Status:** authoritative. Where this file conflicts with an epic handover doc,
**this file wins**. The epic docs were written before these answers existed and
have not been retro-edited.

**Source:** CTO clarification round, answers from Harish.
**Commit to:** `specs/decisions-resolved.md`

---

## D1 — Build order

**Locked:** Epic 1+3 → Epic 2 (VP) → Widget → Epic 5 → Cross-epic test suite.

Supersedes decision log §6A's split ordering (Epic 2 core half first,
parallelized). Epic 2 runs as a single branch after Epics 1+3, per the VP doc's
own header precondition.

> ⚠️ **Assumption requiring one-line confirmation:** the answer read
> *"Epic 1-3, epic4, widget, epic 5, test suite"*. "epic4" is taken to mean the
> **VP generation/verification doc** — which was originally filed as
> `epic_4helixid-vp-…` but is Epic 2 per decision log §6A — **not** audit
> routing. Basis: the sequence matches the original five-doc list exactly, and
> audit routing is separately parked in §1.2 and §5. Under any other reading,
> Epic 2 is absent from the build order entirely.

## D2 — Epic 4 (Audit Routing): PARKED

Not in scope for this run. Design incomplete upstream ("exact event schema/shape:
not designed yet"), further items pending before handover.

**Consequences to carry, not to solve:**
- Epic 5's precondition list names audit routing. The demo ships without it.
  Note this in Epic 5's handoff rather than improvising a substitute.
- Cross-epic test suite §9 (Audit Trail Integrity) — 9 `[NEW]` cases have no
  routing module to assert against. See D11.
- Existing six event types keep writing to their current call sites. **Do not**
  refactor them toward the routing module in anticipation.

## D3 — Widget `scopesEndpoint` fetch failure

Error state, **Accept disabled**, Decline remains available.

Closes widget doc Part E's last row and Part F item 2.

Applies to: non-200 response, malformed JSON, network failure. No retry logic —
if retries are wanted later that's a separate decision.

## D4 — `agentDid` retained

Stays in the Part B route contract. **Reason: audit correlation.**

It is deliberately **not** passed into `resolveConsentScopes()` and does not
affect the returned catalog. Epic 5 Part H's assertion — full catalog returned
regardless of `agentDid` — stands.

**Required:** write the reason into a code comment on the route handler. Without
it a reviewer removes an apparently-unused parameter and breaks Epic 5 C2's
contract.

*Note:* the audit sink this correlates into is parked under D2. The parameter is
retained ahead of that work, not wired to it.

## D5 — Widget Part E test table

- Delete **row 4 only** (`Curated/MCP entry exists for a scope not in requestedScopes`).
- **Reword** rows 1 and 3 to drop "requested scope" framing — they test curated
  labeling and `humanizeScope()` fallback, which remain live coverage.
- **Add** one row: full catalog returned regardless of `agentDid`.

Supersedes Epic 5 Part E's "the two rows... are removed" — only one row matched
that description. Taken literally it would have deleted the `humanizeScope()`
test.

## D6 — Widget Part D CLAUDE.md scaffold: PARKED

Not shipped with `@helixid/widget` v1. Do not build.

If it is ever revived, its draft text in Part D references `requestedScopes` and
is already stale against Part E.

## D7 — Search tools carry no scope

`search_flights` and `search_hotels` have **no `metadata.requiredScope`** — open,
read-only, no grant required.

Closes Epic 5 Part G. Guarantees step 2 of the 5-step demo flow never triggers a
consent prompt.

## D8 — `curatedFallback` ownership and demo catalog

Ownership: **SP-owned**, as specified. HelixID does not invent scope strings.

For `e2e-consent-demo`, the demo SP apps are the SP, so their catalogs are:
- **Airline:** `book:flights`, `modify:booking`
- **Hotel:** `book:hotel`

Per Epic 5 Part C2. `accept-terms` is appended by the resolver, not listed in the
curated catalog.

## D9 — Confirmed as read, no action

- E1E3 Part E / O4 (index-allocation uniqueness) — **stays open**. Random index
  per B3. Build nothing toward collision detection or a DB allocator.
- VP doc §7.1–7.3 — all resolved upstream, implement as stated.
- Widget Part F item 3 (how the agent declares `requestedScopes`) — **resolved**:
  no such declaration exists, by design.
- Test suite ISS7 — probabilistic by design. Fixed seed or large N to catch a
  broken RNG. Do not assert uniqueness as a guarantee.

## D10 — `epic1-epic3-code-analysis.md` not required

Read the current code directly from the repo instead. This reinforces the
standing rule: verify shipped status against source, never against a doc's
description of the source.

## D12 — Branching model: single branch

All five epics land on **one branch**, not one branch per epic.

**Required discipline, since a single branch removes the natural checkpoints:**
- Commit at each epic boundary with a conventional message.
- Tag each boundary: `epic1-done`, `epic2-done`, `epic3-done`, `epic5-done`,
  `tests-done`. Enables `git diff epic2-done..epic3-done` for scoped review and
  `git revert` on a known range.
- Re-run prior epics' regression rows before starting the next epic. Without
  this, a regression introduced in Epic 2 surfaces at Epic 5's Part H check with
  no way to isolate it.

Supersedes the one-branch-per-epic model. Closes O6 (merge cadence) — no
intermediate merges occur.

**Accepted cost:** one large PR at review time. Review per tag range, not as a
single diff.

## D11 — Cross-epic test suite §9, given D2

Branch 5 implements §9 cases **only** where they can assert against the six
existing event types at their current call sites. Cases that require the
audit-routing module are deferred and listed explicitly in the branch handoff.

Do not stub a routing module to make them pass.

---

## Still open — does not block Branch 1

| # | Item | Blocks | Fallback if unanswered |
|---|---|---|---|
| O1 | Confirm "epic4" = VP doc, not audit routing (see D1) | Branch 2 | Proceed on the stated reading |
| O2 | Do `public-surfaces.md` and `major-flows.md` exist in-repo, and where? | Branch 1 (A4 doc edits), Branch 5 (RM6/RM7) | Locate by search at Step 1; if absent, A4's doc tasks and RM6/RM7 can't complete — report, don't create them |
| O3 | Are `helixid-user-consent-decision-log.md`, `helixid-functional-breakdown.md`, `helixid-decision-log-updated-audit.md` superseded by the consolidated log? | Nothing directly | Treat as superseded |
| O4 | Repo access + PR permissions | **Branch 1 — hard** | None. Cannot start |
| O5 | Env/credentials: SP `did:web` domain, status-list hosting | Branch 1 (B-series), Branch 4 (seeder) | None for a real run; local-only stand-ins for tests |
| ~~O6~~ | ~~Merge cadence~~ | — | **Closed by D12** — single branch, no intermediate merges |
| O7 | Reviewer for VP §2.9 regression contract and Epic 5 Part D step-5 assertion | PR review | Self-review, flag both explicitly in the PR description |
| O8 | Baseline storage location | Step 0 | `specs/_baselines/`, committed |

Self-serviceable at Step 1, no answer needed: whether `packages/widget/` exists,
whether `examples/e2e-travel-concierge/` is present and green, `helixid-setup`
location, current `pnpm test` state on `main`.
