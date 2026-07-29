# HelixID — Epic 5: Seeder Update + Standalone Consent Demo — Implementation Handover

**Purpose of this doc:** you should be able to work through this top-to-bottom
and build the seeder update and the new standalone consent demo
(`examples/e2e-consent-demo`) without needing the design conversation that
produced it.

**Precondition:** Epics 1–4 complete. This epic assumes: a working SP
`did:web` + status-list provisioning path (Epic 1), `issueGrant()`/
`revokeGrant()` (Epic 3), the `[agentVC, grantVC]` VP path with
`effectiveScopes` (Epic 2/VP doc), `@helixid/widget`'s
`resolveConsentScopes()` + widget props (widget handover doc), and audit
routing (Epic 4).

**Companion docs, for background:**
- `helixid-consolidated-decision-log.md` §4.7 (confirmed 5-step flow), §6A
  (epic sequencing), §6 items 11+13
- `helixid-widget-handover.md` (Parts A–C — **amended by Part E below**)
- `helixid-vp-generation-verification-dev-design.md` (grant-array VP
  shape, `effectiveScopes`)
- `epic1-epic3-implementation-handover.md` (`issueGrant()`/`revokeGrant()`
  signatures — this doc calls them, doesn't respecify them)

**Scope boundary:** this doc covers (1) the `helixid-setup` seeder change,
(2) the new demo's folder structure and per-package responsibilities, (3)
docker-compose orchestration, (4) the amendment to the widget handover
doc's `requestedScopes` behavior. It does **not** respecify `issueGrant()`,
`verifyVP()`, or the widget's render implementation — those are locked
elsewhere.

**One thing is deliberately left open** — see Part G.

---

## Part A — `helixid-setup` seeder update

**File(s):** wherever `helixid-setup`'s seeder script/service lives today.

**Change:** replace the `POST /v1/services` call (pre-registering the demo
booking backend) with `POST /v1/dids`, per §4.6/§6 item 11 — the registry
this seeder called against no longer exists.

**Scope for this epic, concretely:**
1. Provision a `did:web` DID for each demo SP (Airline, Hotel) via
   `POST /v1/dids` (or the `helix did create --method web` CLI path,
   whichever the existing seeder convention uses for non-agent DIDs).
2. Generate and host each SP's initial status list at the same time
   (`helix status-list create`), per §4.6's "onboarding is two CLI
   commands run back to back."
3. Provision/enroll the Travel Planner Agent as today (no change to this
   part — agent enrollment isn't touched by the registry removal).
4. Print, at the end of the seed run: agent DID, both SP DIDs, both status
   list URLs, Console URL — mirroring the existing `e2e-travel-concierge`
   seeder's printed summary.

**Reusability:** per §4.7, this may reuse `helixid-setup` directly rather
than forking a second seeder — confirm the existing script can take a
config list of SPs-to-provision rather than a single hardcoded one; if
not, that's a small, worthwhile generalization, not a rewrite.

---

## Part B — Demo folder structure

**New folder:** `examples/e2e-consent-demo/`, standalone, does not modify
`e2e-travel-concierge`.

```
examples/e2e-consent-demo/
├── agent/                    # Travel Planner Agent
├── sp-airline/                # Next.js app: frontend + backend + MCP + widget routes
├── sp-hotel/                  # same shape, independent SP
├── helixid-config/            # shared env/compose-time config
├── seed/                      # calls into helixid-setup (Part A), demo-specific config only
├── docker-compose.yml
├── docker-compose.override.yml.example   # escape hatch for local-core hacking, per §2 convention
└── README.md
```

**Why one Next.js app per SP, not split frontend/backend folders:** each
SP is a single self-contained web app in real life — a Next.js API route
*is* its backend. Splitting `sp-airline/frontend` and `sp-airline/backend`
the way `e2e-travel-concierge` does would suggest two deployable services
where there's really one. Keep it simple, one folder per SP.

**Console:** brought up via its own compose file, not a folder here — same
convention as the existing baseline (§2).

---

## Part C — Per-SP responsibilities (`sp-airline/`, `sp-hotel/`)

Each SP app owns four things. Identical shape for both SPs; only the tool
catalog and scope strings differ.

### C1. MCP endpoint
Mounted as a Next.js API route (e.g. `/api/mcp`), not a separate service.
Exposes this SP's tools:
- **Airline:** `search_flights`, `book_flight`, `modify_booking`
- **Hotel:** `search_hotels`, `book_hotel`

Each tool declares `metadata.requiredScope`, same convention
`filterToolsByScope()` already reads (`public-surfaces.md`). Wrapped with
`helixidMCPMiddleware({ requiredScopes: [...] })` per tool, same as
`e2e-travel-concierge`'s protected MCP server.

### C2. Scope-resolution route
Implements the widget handover doc's Part B contract, **as amended by
Part E below** — no `requestedScopes` query param, always resolves this
SP's full scope catalog.

```
GET /api/consent/scopes?agentDid=<did>
→ { scopeOptions: ScopeOption[] }
```

Calls `resolveConsentScopes()` (amended signature, Part E) with:
- `mcpServerUrl`: this SP's own `/api/mcp` route
- `curatedFallback`: a small static list per SP (e.g. Airline:
  `book:flights`, `modify:booking`; Hotel: `book:hotel`)

### C3. Grant-issuance route
Not previously specified in the widget doc (flagged there as "downstream,
not this doc's job" — now in scope, here).

```
POST /api/consent/accept
Body: { agentDid, userDid, scopes: string[], durability: 'standing' | 'session' }
→ { grantVC: SignedVC }
```

- Must run in the same authenticated session context as the consent page
  (same rule as C2).
- Handler: read the SP's own `did:web` wallet + current status list
  (env-configured, from Part A's seeding) → call `issueGrant()`
  (`epic1-epic3-implementation-handover.md` §B2) → persist the returned
  `grantVC` **and** the `updatedStatusList` (SP's own DB/file, whatever
  this demo already uses for persistence) → return `{ grantVC }` to the
  widget's `onAccept` caller.
- This is the SP's own custodial signing operation — the widget/browser
  never sees the SP's private key, consistent with the custodial model in
  §4.2.

### C4. Booking backend
Existing `search_*`/`book_*` handlers, gated by `helixidMCPMiddleware`.
No new design here — same pattern as `e2e-travel-concierge`'s protected
tool server, just two independent instances instead of one.

---

## Part D — Agent (`agent/`)

Same shape as `e2e-travel-concierge`'s `ai-agent/`: LLM loop, `AgentWallet`,
`VPBuilder`/`attachHelixVP()`, no consent logic of its own — consent
happens entirely on the SP's side (widget), the agent just calls tools and
gets refused-until-consented or succeeds.

**Concrete behavior needed for the 5-step flow (§4.7):**
1. Login → agent resolves/holds a `userDid` (or falls back to email, per
   §2.6) — demo can hardcode a regular-login stand-in, this isn't
   reinventing end-user auth.
2. Search TVM → Delhi — plain MCP call, `read`-shaped scope only, no
   grant needed (search tools don't require `accept-terms`/booking
   scopes — confirm each SP's `search_*` tool declares a scope that's
   pre-granted or scope-free, so search never triggers consent).
3. Book flight — first MCP call to `book_flight` without a valid
   `[agentVC, grantVC]` VP for this (user, agent, Airline) triple → SP
   rejects/signals consent-needed → demo surfaces the consent widget
   (frontend embed) → user accepts → agent retries with the new grant in
   its wallet (`selectGrant()`, Epic 1/3 §B6) → booking succeeds.
4. Book hotel, different SP → same pattern, independent grant, no
   coordination with Airline's grant.
5. Book return flight, same Airline SP → agent's `selectGrant()` finds
   the existing standing grant for (this user, this agent, Airline) →
   **no widget shown**, VP built directly with the reused grant →
   `verifyVP()` passes without a new grant being issued.

**Required regression test:** step 5 must not trigger the widget or
`issueGrant()` — assert on call count, not just "booking succeeds."

---

## Part E — Amendment to `helixid-widget-handover.md` Part A/B

**Decision: drop `requestedScopes` as an external input.** The SP always
advertises its own full grantable-scope catalog — there is no reason for
the agent to constrain what the user is shown, since the grant and the
agent's own VC scope are independently-scoped and intersected at
verification time (`effectiveScopes`, VP doc §2.7), not merged. The agent
narrowing the menu would be constraining a ceiling that has nothing to do
with its own.

**Concrete changes to the widget handover doc's contract:**

- `ResolveConsentScopesOptions` drops `requestedScopes: string[]`.
- Step 2 of `resolveConsentScopes()`'s required behavior ("call
  `tools/list`... for each tool whose `metadata.requiredScope` is...in
  `requestedScopes`") becomes: for **every** tool with a
  `metadata.requiredScope`, overwrite/insert into the map — no filtering
  against a requested set.
- Step 3 ("filter the final result down to exactly `requestedScopes`") is
  **removed** — the output is the full union of curated fallback ∪ MCP
  tool scopes ∪ `accept-terms`.
- Step 4 (`accept-terms` always appended) — unchanged.
- Step 5 (`humanizeScope()` fallback labeling) — unchanged, still applies
  to any curated/MCP entry without a clean label.
- Part B's contract table: `Query params` row drops `requestedScopes`,
  keeps `agentDid` only.
- Part E's test table: the two rows exercising `requestedScopes`
  filtering ("excluded from output — resolver never expands the requested
  set") are removed; add one row confirming the **full catalog** is always
  returned regardless of agent identity.
- Part F's carried-forward open item ("how the agent declares
  `requestedScopes`... needs its own decision") is **resolved, not
  carried forward**: there is no such declaration, by design.

Nothing else in the widget doc changes — Part C (widget props),
`DEFAULT_DURABILITY_OPTIONS`, and the `required: true` handling for
`accept-terms` all stand as written.

---

## Part F — Distribution

Per §2's existing baseline convention (website try-it link + zip download,
`clone` dropped as an option, auto-packaged via CI/release from
`examples/e2e-consent-demo` as source of truth) — no new distribution
mechanism for this epic, reuse exactly what `e2e-travel-concierge` already
does. Not respecified here.

---

## Part G — The one open item

**Whether search tools need their own scope at all, or are unscoped by
convention.** Part D assumes `search_flights`/`search_hotels` are either
scope-free or covered by a scope that's implicitly pre-granted (so step 2
of the demo flow never triggers a consent prompt). This wasn't decided
explicitly anywhere upstream — §4.7's flow describes step 2 as "nothing
security-related yet," which implies search is unscoped, but the exact
mechanism (no `metadata.requiredScope` on those tools at all, vs. a scope
that's granted automatically at agent enrollment rather than via consent)
isn't locked. Recommend: **no `metadata.requiredScope` on search tools —
they're genuinely open, read-only, no grant needed**, simplest option and
consistent with "nothing security-related yet." Flag if you disagree
before building C1.

---

## Part H — Testing checklist

| Area | Test | Notes |
|---|---|---|
| A | Seeder run provisions both SP DIDs + status lists via `POST /v1/dids` | no `POST /v1/services` call anywhere in the seed path |
| A | Seeder output prints agent DID, both SP DIDs, both status-list URLs, Console URL | |
| C2 | Scope-resolution route returns full catalog regardless of `agentDid` value | confirms Part E's amendment — no filtering |
| C2 | Curated + MCP entry for the same scope | MCP wins (unchanged from widget doc) |
| C3 | Grant-issuance route persists both `grantVC` and `updatedStatusList` | |
| C3 | Grant-issuance route runs under the consent page's own session auth, no separate token | |
| D | Step 3 (first Airline booking) | consent prompt shown, grant issued, VP is `[agentVC, grantVC]`, `verifyVP()` passes |
| D | Step 4 (Hotel booking) | separate prompt, independent grant, Airline grant untouched |
| D | Step 5 (second Airline booking) | **no prompt**, no `issueGrant()` call, existing grant reused, `verifyVP()` passes |
| D | Search calls (step 2) | no consent prompt, no scope check failure (per Part G's resolution) |
| Regression | All 4 existing `e2e-travel-concierge` scenarios | pass unmodified — this demo doesn't touch that folder |

---

## Part I — Suggested order of work

1. **Part A** (seeder) — small, unblocks everything else needing SP DIDs.
2. **Part E** (widget doc amendment) — do before C2, since C2 is written
   against the amended contract.
3. **Part C1, C4** (MCP endpoint + booking backend) per SP — mechanical,
   mirrors `e2e-travel-concierge`'s existing protected-tool pattern.
4. **Part C2, C3** (scope-resolution + grant-issuance routes) — depends on
   Part E and on Epic 1/3's `issueGrant()` being available.
5. **Part D** (agent) — depends on both SPs being callable.
6. **Part D's step-5 regression test** — the one non-negotiable assertion
   for this epic, don't skip it.
7. Full regression suite (Part H's last row) before considering this epic
   done.
