HelixID Console — Developer Spec

Audience: implementer with ~1 year experience. You know React, TypeScript,
and REST. This doc tells you what to build and why; it doesn't re-explain
the basics.

Status: ready to implement, except two items marked OPEN ITEM below —
don't guess on those, ask before building them.



1. What Console is

A single-page React app. Three pages (Agents, Enroll, Services) plus one
persistent panel (Audit Rail) that's visible on all three. No real-time
infra — everything is fetch-on-load or manual refresh. This is an internal
operator tool, not a consumer product, so we're optimizing for "correct and
easy to maintain" over "impressive."



2. Tech stack (and why)







Choice



Why





React + Vite



Already decided. Fast dev loop, no framework lock-in.





react-router-dom



3 routes + a layout wrapper. Don't hand-roll routing.





Plain fetch wrapped in a small API client module



We don't need React Query / SWR / Redux for 3 pages and no real-time updates. One extra dependency for caching/retries we don't need is not worth it. If Console grows past this scope later, revisit.





@helixid/sdk-js (HelixClient)



Use it wherever it already covers what we need (services, DID resolve, revoke, onboarding). Don't hand-write fetch calls for things the SDK already does — that's how client and server drift.





Vitest + React Testing Library



Standard pairing for Vite projects, no extra config needed.





No global state library



Component state + one small AuditContext for the rail's refresh trigger (see §6) is enough. Don't reach for Redux/Zustand here.



3. Folder structure

console/
  src/
    api/
      client.ts            # thin wrapper: HelixClient + new endpoints (§4)
      types.ts              # shared response types
    components/
      layout/
        AppLayout.tsx        # nav + <Outlet/> + <AuditRail/>
        AuditRail.tsx
      agents/
        AgentList.tsx
        AgentDetailPanel.tsx
        RevokeButton.tsx
      enroll/
        EnrollForm.tsx
        EnrollmentStatus.tsx  # polling, see §5.2
      services/
        ServiceList.tsx
        ServiceForm.tsx
    hooks/
      usePolling.ts
      useAuditRefresh.ts
    pages/
      AgentsPage.tsx
      EnrollPage.tsx
      ServicesPage.tsx
    context/
      AuditRefreshContext.tsx
    App.tsx
    main.tsx
  tests/                     # mirrors src/, one test file per module below
  package.json
  vite.config.ts

Rule of thumb: a page composes components and wires up API calls. A
component under components/ should be usable without knowing which page
it's on. Keep API calls out of leaf components — pages own the fetch, pass
data + callbacks down as props.



4. New API surfaces required

Console's design requires two things that don't exist in public-surfaces.md
today. Both are warranted — there's no way to build the required screens
without them. Add these to helix-api and helix-sdk-js before starting
Console work; Console has a hard dependency on both.

4.1 GET /v1/vcs — list credentials

Why it's needed: the Agents page needs a list of agents. Today the API
only supports fetching one VC by id (GET /v1/vcs/:vcId) or resolving one
DID (GET /v1/dids/:did). There is no way to enumerate agents at all.





Auth: x-admin-api-key (same boundary as the other admin VC endpoints).



Query params: subjectDid?, status? (active|revoked|expired), limit? (default 50).



Response: array of VC summaries — vcId, subjectDid, agentName,
scopes, status, issuedAt, expiresAt, parentVcId? (present when
the VC came from delegate() — this is what lets the Agent Detail panel
show delegation lineage without a separate endpoint).

SDK addition: HelixClient.listVCs(filters?) — same pattern as
getVC, just plural. Add it next to getVC in HelixClient.

4.2 GET /v1/audit-log — list audit events

Why it's needed: the audit rail is a hard requirement (persistent panel
across all screens) and enrollment polling (§5.2) depends on it. Today
audit events exist per the README (Layer 4, adapter-based store) but
nothing exposes them over HTTP.





Auth: x-admin-api-key.



Query params: eventType? (vc_issued | vc_revoked | vp_verified | onboarding_complete), since? (ISO timestamp), limit? (default 50, newest first).



Response: array of { id, eventType, timestamp, subjectDid?, vcId?, targetService?, result? }.

SDK addition: HelixClient.getAuditLog(filters?).

If either of these already exists under a different name, use that instead
— check with whoever owns helix-api before adding a duplicate.



5. Pages

5.1 Agents (/agents, default route)

Purpose: browse every agent (DID + its VC), see scopes/status/lineage,
revoke.





On mount: client.listVCs(). One row per VC (a DID with multiple VCs —
e.g. renewed — should show its latest VC in the list; older ones are
visible in the detail panel, not the list).



Row shows: agent name, DID (truncated, click to copy), scopes (as chips),
status badge, "delegated from ..." if parentVcId is set.



Manual Refresh button at the top of the list — no auto-poll here.
This is how an operator sees a revoke or a new onboarding take effect
(per your call: no real-time updates needed).



Click a row → AgentDetailPanel:





Full VC JSON (collapsed by default, expandable — don't dump raw JSON
as the primary view, operators want scopes/status/dates first).



Credential history: call listVCs({ subjectDid }) to show prior VCs
for the same DID (renewals, prior revocations).



RevokeButton — calls client.revokeVC(vcId), then re-fetches this
agent's detail and shows a success/failure toast. Do not optimistically
mark it revoked in the UI before the API confirms — revocation is the
one action in this whole app where getting it wrong (showing "revoked"
when it wasn't) is actively misleading to an operator.

Acceptance criteria:





Revoking an agent and clicking Refresh shows status flip to revoked.



A delegated agent visibly shows which agent it was delegated from.

5.2 Enroll (/enroll)

Purpose: mint an enrollment token, then show it get consumed —
this is Scenario 4, the one non-pre-seeded demo moment.





EnrollForm: agent name, requested scopes (multi-input), optional
domains, max delegation depth → POST /v1/enrollment-tokens (add
HelixClient.createEnrollmentToken() if it isn't already in the SDK —
check first, this one might already exist under a different call).



On success, render the token and hand off to EnrollmentStatus.

EnrollmentStatus (polling component):





Starts polling client.getAuditLog({ eventType: 'onboarding_complete', since: tokenCreatedAt }) every 3 seconds.



Stop conditions: found a matching event (show "✅ Agent enrolled — view in Agents"), OR 2 minutes elapsed with nothing found (show "Still waiting — check the Agents list manually" and stop polling; don't poll forever in the background).



Implement this as a usePolling(fn, intervalMs, { timeoutMs }) hook —
generic enough to reuse if another page ever needs polling. Keep it
simple: setInterval + cleanup in useEffect, no library.

Acceptance criteria:





Minting a token displays it immediately.



Completing onboarding externally (via CLI or SDK) causes the status
component to detect it within ~3–6 seconds and stop polling.



Leaving the page cancels the interval (check this in a test — a leaked
interval is the most common bug here).

5.3 Services (/services)

Purpose: list and register services.





ServiceList: client.listServices() on mount, manual refresh.



ServiceForm: serviceName, displayName, verifiedDomain,
publicKeyMultibase, apiEndpoint, metadata → client.registerService()
if present in the SDK, otherwise call POST /v1/services directly through
api/client.ts.



Note: whether this endpoint requires x-admin-api-key is still open
per the decision log (service registry Option A). Don't hardcode an
assumption in this component — read the key requirement from api/client.ts
config in one place, so when that's resolved it's a one-line change, not
a component rewrite.

5.4 Audit Rail (persistent, not a route)





Lives in AppLayout, rendered alongside <Outlet/> on every page.



Fetches client.getAuditLog({ limit: 20 }) on mount.



Exposes a refresh trigger via AuditRefreshContext — any action that
changes state (revoke, successful enrollment) calls refreshAudit() from
context so the rail updates without the operator needing to separately
refresh it. This is the one place we allow an action to trigger a
secondary fetch automatically; everywhere else stays manual-refresh only.



Each row: eventType, timestamp, short description, and a link that
navigates to /agents with that subjectDid pre-filtered (pass via
route state or query param — either is fine, pick one and be consistent).



6. api/client.ts — design

One module, one exported object. Wrap the SDK where it exists; add thin
fetch calls only for the two new endpoints in §4 until they land in the
SDK.

import { HelixClient } from '@helixid/sdk-js'

const client = new HelixClient(API_BASE_URL, { adminApiKey: ADMIN_API_KEY })

export const api = {
  listAgents: (filters?: VcFilters) => client.listVCs(filters),
  getAgent: (vcId: string) => client.getVC(vcId),
  revokeAgent: (vcId: string) => client.revokeVC(vcId),
  listServices: () => client.listServices(),
  registerService: (input: ServiceInput) => client.registerService(input),
  createEnrollmentToken: (input: EnrollInput) => client.createEnrollmentToken(input),
  getAuditLog: (filters?: AuditFilters) => client.getAuditLog(filters),
}

Components import api, never HelixClient directly. This is the one
seam you'd need if the transport ever changes (e.g., admin key moves to a
login-derived session token instead of an env var) — one file to touch.

ADMIN_API_KEY is reused from the root .env (same value the
helixid-setup seeder and other services already read). No separate
Console-side auth flow to build; same trust level as everything else in
the compose stack.

Important — this can't be a build-time Vite env var. Console ships as
a pre-built, versioned image (per the locked image-strategy decision), and
the same image gets run with different ADMIN_API_KEY / API URL values in
different environments. import.meta.env.VITE_* is baked in at build
time, so it can't vary per docker-compose up. Use runtime injection
instead:





Container entrypoint script runs before the static server starts, reads

ADMIN_API_KEY and API_BASE_URL from the container's actual env, and
 writes them to a small generated file, e.g. env-config.js:



index.html loads env-config.js via a plain <script> tag before

the app bundle.



api/client.ts reads window.__HELIXID_CONFIG__ instead of

import.meta.env — this is the only place in the app that should touch
 this object.

API_BASE_URL needs the same treatment, for a second reason: the
browser — not the container — makes the fetch calls, so it needs a
host-reachable URL (e.g. http://localhost:4000), not the internal Docker
DNS name (http://helixid-api:3000) the container sees. That value is
only known at docker-compose time, which is exactly why it can't be
baked in at image build time either.

For local npm run dev (no container), fall back to
import.meta.env.VITE_ADMIN_API_KEY / VITE_API_BASE_URL from a .env
file in console/ if window.__HELIXID_CONFIG__ isn't present — keeps
plain local dev simple without needing the entrypoint script.



7. Testing

Match whatever coverage threshold the main helix-api/helix-sdk-js
repos already enforce — don't invent a new number for Console. If nothing
is enforced yet, a reasonable default for this size of app:





api/client.ts: unit test every exported function against a mocked
HelixClient (or fetch for the two raw calls) — success path + one
error path each.



usePolling: test start/stop/timeout behavior in isolation with fake
timers (vi.useFakeTimers()). This is the trickiest piece of logic in
the app — give it real test coverage, not a smoke test.



RevokeButton, EnrollForm, EnrollmentStatus: component
tests with RTL — render, interact, assert on API calls and resulting UI
state (loading → success/error). Mock api/client.ts, don't hit real
network in these tests.



Pages: one integration-style test per page covering the happy path
end to end (list loads → click row → detail shows). Skip exhaustive
edge-case coverage at the page level; that belongs in the component tests
underneath.

Don't chase 100%. Untested: pure layout components with no logic
(AppLayout markup itself), trivial prop-passthrough components.



8. Explicit non-goals (don't build these)





No auto-polling or WebSocket/SSE anywhere except EnrollmentStatus
(§5.2), which is the one place it's justified.



No full VP payload inspection — audit-trail events only.
OPEN ITEM: this was explicitly left undecided and flagged for a future
call. If it's resolved before you start, the answer changes §4.2's
response shape (add vpPayload? field) and possibly the Agent Detail
panel (add a VP tab). Until then, build without it.



No console-side authentication/login flow — Console reuses the root
.env ADMIN_API_KEY, injected at container runtime (see §6), same as
the rest of the compose stack.



Console's own README is not part of this spec. Since Console is a
standalone released product, it needs its own README (env vars, local
dev instructions, image usage) living in the Console codebase — separate
from both the main HelixID README and the sample app's README. Outline
of what that README needs is in §9 below; content itself is a separate
follow-on task.



No pagination beyond simple limit params — if lists grow past ~50 items
in practice, revisit; don't build infinite scroll speculatively.



9. Console README — required sections (outline only)

This is a separate deliverable from this dev spec and lives in the Console
codebase, not the main repo README or the sample app's README. Content is
not written yet — this is the section/subsection list to write against
when that task is picked up.





Overview

1.1 What Console is
 1.2 Where it fits in the HelixID trust stack (link back to main README's
     5-layer table)



Prerequisites



Running Console

3.1 As part of the sample app (pre-built image via docker-compose)
 3.2 Standalone self-hosting (docker run / Kubernetes — env var based)
 3.3 Local development (npm run dev)



Configuration / Environment Variables

4.1 ADMIN_API_KEY
 4.2 API_BASE_URL
 4.3 How runtime injection works (short summary + link to this dev
     spec's §6 for the full mechanism — don't duplicate the explanation)



Features

5.1 Agents
 5.2 Enroll
 5.3 Services
 5.4 Audit Rail



Versioning & Releases

6.1 Image tags (ghcr.io/nicedigverse/helixid-console)
 6.2 Compatibility with helix-api versions



Contributing / Development

7.1 Folder structure (pointer to this dev spec §3)
 7.2 Running tests



Known Limitations

8.1 No real-time updates (manual refresh model)
 8.2 VP inspection scope (pointer to current decision, once locked)


