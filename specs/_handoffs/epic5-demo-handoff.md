# Epic 5 Handoff — Seeder Update + Standalone Consent Demo

**Branch:** `feature/epics-1-5-consent-and-vp`, on top of the widget epic (`a4b19c3`). **No commits made.**

**Delivered:** `examples/e2e-consent-demo/` — two independent Service Providers, a Travel Planner agent, the seeder, compose orchestration, and an automated 5-step flow test. Part E was applied in the widget epic and was not touched here.

---

## READ FIRST — a stated constraint that could not be satisfied as written

> *"Compare against the Step 0.4 baseline output."*

**There is no Step 0.4, and no such baseline exists.** `Step 0.4` appears nowhere in `specs/`; the only "Step 0" reference is register O8 (baseline *storage location*). `specs/_baselines/` contains only the verifyVP artifacts I created in Epic 2, plus the 88-byte corrupt file flagged in the Epic 1/3 handoff. No capture of the four `e2e-travel-concierge` scenarios has ever existed — consistent with what I reported in both prior handoffs: those scenarios have no automated harness (all five `e2e/tests/*.ts` are single `it.todo` stubs) and need Docker plus LLM provider keys.

So I could not diff against a baseline. What I did instead, which is stronger than a text diff and is what the constraint was actually protecting:

```
git diff epic3-done --stat -- examples/e2e-travel-concierge   → empty
git status --short examples/e2e-travel-concierge              → empty
pnpm --filter @helixid/example-e2e-travel-concierge typecheck  → passes
```

**The folder is byte-for-byte unmodified** — not "probably fine", provably untouched at the git object level, with no untracked additions. It also still pins *published* `@helixid/*` packages, so nothing on this branch can reach it until a release is cut. What remains genuinely unverified is whether those four scenarios still *run* green, which needs Docker + an LLM key and a human. See NEEDS VERIFYING 1.

Also, as in the last two turns: the tags are `epic1-epic3`, `epic-2-done`, `epic3-done` — not the `epic1-done`/`epic2-done` the prompt and register D12 name.

---

## The design gap this epic surfaced (worth your attention)

Building the SP gate exposed a real hole in the consent model, and I want to be explicit because it changes how an SP must be written.

My first implementation gated bookings on `effectiveScopes.includes(requiredScope)` — the field Epic 2 §2.7 designates for enforcement. **The very first test run granted a booking with no grant at all.** The trace:

```
[airline] GRANTED book_flight  effectiveScopes=[book:flights, modify:booking, book:hotel]
```

The reason is structural, not a bug in core:

- With no grant present, `effectiveScopes` collapses to the agent's own `privilegeScopes` (§2.7).
- The agent VC **must itself carry** `book:flights` for a grant to have any effect, because the intersection is bounded by the agent's ceiling (§9.3 G10: a grant that is a superset yields the agent's scopes only).
- Therefore an agent presenting only its platform-issued credential clears an `effectiveScopes` check **having never asked the user anything.**

`effectiveScopes` alone cannot express "this action requires the End User's consent." Each SP must additionally require that a grant **it issued** is present in the presentation, and then enforce `effectiveScopes` on top. That is what the demo now does, and there is a test for the refusal (`NO_GRANT_FOR_THIS_SERVICE`).

This is not contradicted by any spec I read — but no spec states it either, and an SP integrator following §2.7 literally would ship an authorization bypass. **Recommend it be written into the VP doc or the widget's integration guidance.** See NEEDS VERIFYING 2.

---

## What shipped

```
examples/e2e-consent-demo/
├── helixid-config/    scope strings, per-SP catalogs, tool definitions, ports
├── seed/              Part A — SP did:web + status lists, then agent enrollment
├── sp-shared/         the SP app both SPs instantiate (app / identity / store / serve)
├── sp-airline/        Helix Air  — book:flights, modify:booking
├── sp-hotel/          Helix Stay — book:hotel
├── agent/             consentAwareCall (the flow) + an HTTP agent server
├── tests/             the 5-step flow, end to end
├── docker-compose.yml + override example + .env.example + README.md
```

### Part A — seeder

`seed/seed.ts` provisions each SP's `did:web` identity **and its initial status list in the same step** (Epic 1 A5's onboarding shape), then enrolls the Travel Planner Agent against the live API, then prints the required summary. Idempotent: re-running reuses existing identities and wallets.

**Verified by actually running it** against a live `helix-api` (sqlite mode, port 3999):

```
[SP] Provisioned Helix Air: did:web:localhost%3A4101
[SP]   status list -> http://localhost:4101/status-list/1
[SP] Provisioned Helix Stay: did:web:localhost%3A4102
[Helix ID] Issued agent credential vc:helix:1f09a159d3b545d5b87c6edc.
[Agent] Travel Planner DID : did:key:z6Mkmdh...
[Setup] Console            : http://localhost:8080
```

No `POST /v1/services` anywhere in the seed path — the only match in the whole demo is the comment explaining its absence.

### C1/C4 — MCP endpoint and booking backend

`POST /api/mcp` implements `tools/list` and `tools/call` as plain JSON-RPC. `tools/list` returns exactly the shape `resolveConsentScopes()` reads, so the widget resolver talks to a **real** MCP endpoint rather than a fixture.

The gate, in order: open tools run with no presentation at all → otherwise require a VP → `verifyVP()` (fails closed) → require a grant issued by this SP → require `effectiveScopes` to cover the tool's scope.

Per register D7, `search_flights` and `search_hotels` carry **no `metadata.requiredScope`** and no `metadata` block at all, so step 2 can never prompt.

### C2/C3 — consent routes

`GET /api/consent/scopes?agentDid=` calls `resolveConsentScopes()` with this SP's own MCP URL and curated catalog (register D8: Airline `book:flights`/`modify:booking`, Hotel `book:hotel`; `accept-terms` appended by the resolver, not listed). `agentDid` is read, logged, and deliberately not threaded into resolution — with the full D4 rationale comment on the handler, as required. **This is where the widget epic's carried-forward D4 item lands.**

`POST /api/consent/accept` calls `issueGrant()` in-process with the SP's own key and persists **both** the grant VC and the updated status list.

Live check against the running SPs — Airline and Hotel each returning only their own catalog, and labels from curated with descriptions from the live MCP endpoint (MCP-wins, observed rather than mocked):

```
airline → book:flights, modify:booking, accept-terms(required)
hotel   → book:hotel, accept-terms(required)
```

### Part D — agent

`agent/consentAwareCall.ts` is the whole behaviour: look for an existing grant for this (service, user) pair, build `[agentVC]` or `[agentVC, grantVC]`, call the tool, and on `CONSENT_REQUIRED` hand off to the SP's consent page, store the returned grant, retry once.

`agent/server.ts` exposes this over HTTP (`/api/call`, `/api/grants`, `/api/state`).

### Consent page

`GET /consent` serves the **real** `@helixid/widget` controller to the browser — the widget's dist is dependency-free relative-import ESM, so it is served statically at `/widget` and imported directly. The page is a render layer over the shipped state machine, not a re-implementation. Verified live: `import { createConsentController } from '/widget/index.js'` with the module returning 200.

---

## Part H checklist — actual results

| Row | Result |
|---|---|
| A: seeder provisions both SP DIDs + status lists, no `POST /v1/services` | **PASS** — run live against helix-api; grep-verified |
| A: seeder prints agent DID, both SP DIDs, both status-list URLs, Console URL | **PASS** — output above |
| C2: full catalog regardless of `agentDid` | **PASS** — test compares two different agentDids and the no-param case |
| C2: curated + MCP same scope → MCP wins | **PASS** — covered in the widget suite; observed live (descriptions from MCP, labels from curated) |
| C3: persists both `grantVC` and `updatedStatusList` | **PASS** — test reads the persisted state file |
| C3: runs under the consent page's own session auth, no separate token | **PARTIAL** — same-origin, no token scheme; the demo has no real login. See DIVERGED 4 |
| D step 3: consent shown, grant issued, VP is `[agentVC, grantVC]`, verify passes | **PASS** |
| D step 4: separate prompt, independent grant, Airline untouched | **PASS** |
| D step 5: **no prompt, no `issueGrant()`, grant reused, verify passes** | **PASS** — see below |
| D step 2: search triggers no consent, no scope failure | **PASS** |
| Regression: 4 travel-concierge scenarios pass unmodified | **NOT RUN** — folder proven unmodified; scenarios need Docker + LLM key |

### Step 5 — the non-negotiable assertion

Asserted on counts, not on "the booking succeeded". The test captures the SP's counters immediately before step 5 and requires every delta to be zero, with a consent handler that **throws if invoked**:

```ts
expect(result.consentPrompted).toBe(false);
expect(airline.counters.grantsIssued      - grantsBefore).toBe(0);
expect(airline.counters.scopeResolutions  - rendersBefore).toBe(0);
expect(airline.counters.consentRequired   - consentBefore).toBe(0);
```

`scopeResolutions` counts `GET /api/consent/scopes` — the call the widget makes at mount — so zero renders is measured, not assumed. The SP decision log proves the run is non-vacuous:

```
step 3: DENIED book_flight (no grant) → consent scopes requested → grant issued → GRANTED
step 4: DENIED book_hotel  (no grant) → consent scopes requested → grant issued → GRANTED
step 5: GRANTED book_flight            ← no DENIED, no scope request, no issuance
```

Because the SP now *refuses* any booking without a grant it issued, step 5 succeeding is itself proof a grant was presented; the throwing handler proves it was not a new one.

**15 tests pass.** Full workspace regression (forced, uncached): 14 tasks, 13 successful — the only failures are the same 5 pre-existing `audit-log.repository` tests carried since Epic 1/3.

---

## The audit-routing gap, as shipped

Epic 5's precondition list names audit routing (Epic 4). It is **parked** under register D2 and was not built, stubbed, or worked toward. Concretely, as shipped:

- **`consent_granted` / `consent_revoked` are never emitted.** These were to be new event types routed through the generic module. There is no module, so consent issuance produces no audit event anywhere. Each SP logs its decisions to stdout only.
- **The `agentDid` correlation parameter has no sink.** It is captured and logged at `GET /api/consent/scopes` per D4, but the audit trail it was meant to correlate into does not exist.
- **SP-side decisions are outside the audit trail entirely.** Grants are issued by the SPs, not `helix-api`, so Console shows nothing about them. The platform's six existing event types still land in Console for agent enrollment and credential issuance.
- **Net effect for a demo viewer:** Console shows the agent being enrolled and its VC issued, but *not* the user granting consent, and *not* the SPs authorizing bookings. The most interesting half of this demo is invisible to the audit UI.

Nothing was improvised to paper over this.

---

## DIVERGED

1. **Express apps, not Next.js.** Part B specifies "one Next.js app per SP", with the rationale that an SP is one self-contained app and shouldn't be split into frontend/backend folders. I kept that structure — one folder per SP, one app owning routes and page — but implemented it with Express. Reasons: Express is already the proven dependency in this `examples/` tree and its Docker/compose shape; Next.js would be a new framework whose build I could not verify here; and nothing Part H asserts depends on the framework. If Next.js is wanted for the shipped demo, the route handlers port over almost unchanged.

2. **`sp-shared/` and `tests/` are folders the Part B tree does not list.** Part C says both SPs are identical except catalog and tools, so a shared app factory is the direct expression of that; `tests/` holds the step-5 regression Part D requires.

3. **The agent is a deterministic HTTP driver, not an LLM chat loop.** Part D specifies "same shape as `e2e-travel-concierge`'s `ai-agent/`: LLM loop". I built the wallet/VP/consent-handoff half faithfully and skipped the conversational shell, because an LLM loop cannot be tested in CI and the demo's assertion is about grant reuse, not about the model. Consequence: no chat UI, and no `LLM_API_KEY` needed to run the demo. If the narrative demo needs the chat shell, it can be ported from `e2e-travel-concierge` on top of `consentAwareCall()`.

4. **No real end-user authentication.** C2/C3 require running "in the same authenticated session context as the consent page". The routes are same-origin with `credentials: 'same-origin'` and no separate token scheme, which satisfies the *shape* of the requirement, but the demo has no login — `userDid` is a fixed config value. Step 1 of the flow ("login → custodial DID") is therefore represented, not implemented. Part D did allow "demo can hardcode a regular-login stand-in".

5. **The demo depends on `workspace:*`, unlike `e2e-travel-concierge`.** It must: `issueGrant()`, `effectiveScopes`, the new `VPBuilder` shape, and `@helixid/widget` do not exist in any published version. This makes it the **first example that actually exercises this branch's code** — and means it cannot be zip-distributed until those packages are released.

6. **SP identities are provisioned with core primitives, not by shelling out to `helix did create --method web`.** Same artifacts, same shapes; done in-process so the seeder cannot be killed by the CLI's `process.exit()` error path. Documented as such in `sp-shared/identity.ts`.

7. **SP key material is stored as plain JSON**, not an encrypted CLI wallet. Acceptable for a demo whose keys are generated on `docker compose up` and destroyed on `down -v`, but it is not the pattern a real SP should copy — flagged in the file.

---

## NEEDS VERIFYING

1. **The four `e2e-travel-concierge` scenarios still need one manual run** (Docker + LLM key). The folder is provably unmodified and pins published packages, so the risk is very low — but "unmodified" is not "verified green", and I will not claim it is. This is the third epic in a row carrying this gap; capturing a real baseline once would close it permanently.
2. **Decide whether "a scoped action requires a grant from this SP" belongs in the VP doc.** Right now it is demo-local knowledge, and an integrator reading §2.7 alone would build a bypass. This is the most consequential finding of the epic.
3. **Audit routing** (above) — Epic 4 remains the gating work before this demo tells a complete story.
4. **The 5 `audit-log.repository` failures** are now four epics old and remain the only red in the workspace.
5. **`did:web` with a percent-encoded port only resolves over HTTP because the host is loopback.** That is a deliberate core affordance, but it means the demo's SP DIDs are localhost-only; deploying these SPs anywhere real requires HTTPS and a genuine domain.
6. **Ports 14101/14102 are bound by the test suite**, and 4101/4102/4100/3000/8080 by compose. Conflicts will surface as test failures rather than clear errors.
7. **`docker compose up` was not executed.** The compose file is written against the proven `e2e-travel-concierge` Dockerfile and service shape, and every service it starts was run directly on the host (seeder, both SPs, both verified over HTTP) — but the composed stack itself, and the browser consent page rendering, have not been exercised.

## Parked / not built (per register)
- **Epic 4 audit routing — PARKED (D2).** No module, no stub, no refactoring toward one.
- **Widget Part D CLAUDE.md scaffold — PARKED (D6).**
- **Index-allocation uniqueness (O4/D9)** — untouched; grants still take a random index.
