# HelixID — `@helixid/widget`: Consent Scope Resolution + Durability — Implementation Handover

**Purpose of this doc:** you should be able to work through this top-to-bottom
and implement the SDK-side scope resolver, the SP-side API contract it's
wrapped in, and the widget's consent-selection surface (scopes + durability),
without needing the design conversation that produced it.

**Companion docs, for background:**
- `helixid-consolidated-decision-log.md` §4.3 (consent location/mechanism),
  §4.4 (`DelegationGrantCredential` schema, durability)
- `epic1-epic3-implementation-handover.md` §B2 (`issueGrant()` — this doc's
  output feeds directly into that function; don't re-derive it here)
- `public-surfaces.md` (`filterToolsByScope()` — existing precedent for
  reading `metadata.requiredScope` off tool objects)

**Scope boundary:** this doc covers (1) the SDK's scope-resolution method,
(2) the contract for the SP-hosted route that wraps it, (3) the widget's
props/types for rendering scopes + durability and collecting a selection.
**Visual/render implementation is explicitly out of scope** — that's normal
frontend work done at build time, not something to spec here. Grant signing
itself (`issueGrant()`) is also out of scope — already specified in the Epic
1/Epic 3 handover, this doc only produces that function's *inputs*.

**One thing is deliberately left open** — see Part D. Everything else here
is a locked decision, implement as stated.

---

## Part A — SDK: `resolveConsentScopes()`

**New file:** `packages/widget/src/server/resolve-scopes.ts`

**Why a new package path and not `helix-sdk-js`:** this function talks to an
MCP server (`tools/list`) — that's an MCP-client concern, not something
`helix-sdk-js` currently does anywhere else. Keeping it in a
`@helixid/widget`-owned server module keeps `helix-sdk-js` free of an MCP
dependency it doesn't otherwise need. If you have a reason `helix-sdk-js` is
actually the better home, flag it — this placement is a recommendation, not
a hard requirement.

**Why this function exists at all:** the widget is a browser bundle embedded
on the SP's domain. It must never talk to the SP's MCP server directly
(internal infra, not meant to be browser-reachable, would need CORS +
exposing tool-introspection surface to an untrusted client). So scope
resolution has to happen server-side, and be exposed to the widget only as a
plain JSON list. This function is the piece the SP's backend calls to
produce that list.

**Signature:**

```ts
export interface ScopeOption {
  scope: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  required?: boolean;
}

export interface CuratedScopeEntry {
  scope: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface ResolveConsentScopesOptions {
  mcpServerUrl?: string;
  requestedScopes: string[];
  curatedFallback: CuratedScopeEntry[];
}

export async function resolveConsentScopes(
  opts: ResolveConsentScopesOptions,
): Promise<ScopeOption[]>;
```

**Required behavior:**
1. Seed a `scope -> ScopeOption` map from `curatedFallback` first.
2. If `mcpServerUrl` is given, call `tools/list` (plain JSON-RPC — **no LLM
   involved**, this is a metadata read, same category of operation as
   `filterToolsByScope()` reading `tool.metadata.requiredScope` in the
   LangChain adapter). For each tool whose `metadata.requiredScope` is both
   present and in `requestedScopes`, overwrite/insert into the map — MCP
   data wins over curated data when both describe the same scope.
3. Filter the final result down to exactly `requestedScopes` (plus item 4)
   — this function **labels** what was requested, it never expands the
   requested set. A curated or MCP entry for a scope nobody asked for must
   not appear in the output.
4. Always append one additional entry: `scope: 'accept-terms'`,
   `required: true`, `defaultChecked: true`, per §4.4's "T&C folds into
   grant scopes, no separate field" decision.
5. Fall back to `humanizeScope(scope)` (e.g. `book:flights` → `book
   flights`) as the label for any requested scope that neither the curated
   list nor MCP metadata describes — never leave a scope with no label.

**Not this function's job:** persistence, session/auth handling, and
issuing the grant itself. It is a pure `options -> ScopeOption[]` resolver.

---

## Part B — SP-hosted API route: contract, not code

**This route is written by the SP integrator (or their coding agent, see
Part D) — HelixID does not ship an implementation of it, only the contract
it must satisfy**, because the SP's routing framework, auth middleware, and
MCP server URL are all SP-owned.

**Required contract:**

| | |
|---|---|
| Method | `GET` (no state mutation — pure resolution) |
| Path | SP's choice; passed into the widget via `scopesEndpoint` prop |
| Query params | `agentDid`, `requestedScopes` (comma-separated) |
| Auth | **Must run in the same authenticated session context as the consent page itself.** No separate token scheme — this is a same-origin call from a widget already embedded on an authenticated page; reuse whatever session middleware already protects that page. |
| Response | `{ "scopeOptions": ScopeOption[] }`, exactly the shape `resolveConsentScopes()` returns |
| Body | The handler's entire job is: read query params → call `resolveConsentScopes()` with the SP's own `mcpServerUrl` (env-configured) and `curatedFallback` (SP-owned static config) → return the result as JSON. |

**Why `GET` with query params and not `POST` with a body:** this is a pure
read with no side effects — resolving scopes doesn't create or change
anything server-side. Keeps it cacheable and simple to reason about.

**Why the SP provides its own `curatedFallback`, not HelixID:** the fallback
list is inherently SP-specific — HelixID has no way to know what "book
flights" should say for a given airline's product. This is intentionally
the same shape of decision as the SP configuring its own status-list
`--length` or its own `did:web` domain: infra HelixID provides the
mechanism for, not the content of.

---

## Part C — Widget: scope + durability props

**File:** `packages/widget/src/types.ts`

```ts
export interface DurabilityOption {
  value: 'standing' | 'session';
  label: string;
  description?: string;
}

export interface HelixConsentWidgetProps {
  agentDid: string;
  agentName: string;
  agentAvatarUrl?: string;
  userIdentifier: string;   // DID or email, per §2.6 — must match the form
                             // the grant captures at consent time, or
                             // VP verification's user-match fails later
  serviceDid: string;

  // Provide ONE of these two:
  scopeOptions?: ScopeOption[];   // pre-resolved server-side (SSR path)
  scopesEndpoint?: string;        // widget fetches from this at mount
                                    // (client round-trip path) — see Part B

  durabilityOptions?: DurabilityOption[]; // defaults below if omitted
  defaultDurability?: 'standing' | 'session'; // defaults to 'standing'

  onAccept: (selection: ConsentSelection) => Promise<void> | void;
  onDecline: () => void;
}

export interface ConsentSelection {
  scopes: string[];
  durability: 'standing' | 'session';
}

export const DEFAULT_DURABILITY_OPTIONS: DurabilityOption[] = [
  { value: 'standing', label: 'Keep this connected until I revoke it' },
  { value: 'session', label: 'Only for this session' },
];
```

**Required behavior:**
- If both `scopeOptions` and `scopesEndpoint` are given, `scopeOptions`
  wins — treat `scopesEndpoint` as unused in that case, don't fetch.
- If neither is given, throw at mount — this is a caller integration error,
  not a state the widget should silently render around.
- Durability must be a visible, explicit control the user interacts with —
  not a value baked in without the user seeing it. §4.4 says the widget
  "offers both"; a `defaultDurability` pre-selects one, it doesn't hide the
  other option.
- `required: true` scope entries (i.e. `accept-terms`) render checked and
  disabled/non-uncheckable — Decline remains available as the way to not
  proceed, there's no unchecking your way past required scopes while still
  clicking Accept.
- `onAccept`'s `selection.scopes` must include every `required` scope's
  `scope` string plus whichever optional ones were left checked at submit
  time.

**Downstream, not this doc's job:** `onAccept`'s handler on the SP side
calls `issueGrant()` (Epic 1/Epic 3 handover §B2) with
`selection.durability` and `selection.scopes` — already specified there,
not repeated here.

---

## Part D — The one open item

**Whether to ship a `CLAUDE.md`/agent-instructions scaffold alongside
`@helixid/widget` for Part B's route.** Part B's contract is simple enough
that an integrator (or their coding agent) can write it from the table
above directly. The open question is whether HelixID additionally ships a
literal instructions file — packaged with `@helixid/widget` — whose sole
purpose is to get that route auto-generated correctly by whatever coding
agent the integrator is using, rather than relying on them reading Part B
themselves.

**If we do this, the file's content should say, roughly:**

> This SP already has `@helixid/widget` installed. Create ONE backend route
> that: imports `resolveConsentScopes` from `@helixid/widget/server`; reads
> `requestedScopes` from the query string (comma-separated); reads
> `HELIX_MCP_SERVER_URL` from env (optional); passes a curated fallback
> list — ask the user for their scope catalog if one doesn't already exist
> in this repo, don't invent scope strings; returns `{ scopeOptions }` as
> JSON; mounts at whatever path the widget's `scopesEndpoint` prop expects.
> Do not add auth logic beyond what this route's framework already applies
> to authenticated pages.

**Don't build this now.** It's a real packaging commitment (keeping the
scaffold doc in sync with Part A/B's actual contract indefinitely, forever)
and hasn't been decided as in-scope for `@helixid/widget` v1. Flag it,
don't ship it preemptively.

---

## Part E — Testing checklist

| Area | Test | Notes |
|---|---|---|
| Part A | `resolveConsentScopes()` with only `curatedFallback`, no `mcpServerUrl` | returns curated labels for every requested scope + `accept-terms` |
| Part A | `resolveConsentScopes()` with both sources describing the same scope | MCP metadata wins |
| Part A | Requested scope with no curated entry and no matching MCP tool | falls back to `humanizeScope()` |
| Part A | Curated/MCP entry exists for a scope **not** in `requestedScopes` | excluded from output — resolver never expands the requested set |
| Part A | `accept-terms` entry | always present, `required: true`, regardless of inputs |
| Part C | Both `scopeOptions` and `scopesEndpoint` passed | `scopeOptions` wins, no fetch occurs |
| Part C | Neither passed | throws at mount |
| Part C | `required` scope | cannot be unchecked; present in every `onAccept` payload |
| Part C | Durability control | both options visibly rendered even when `defaultDurability` is set; selection reflected in `onAccept`'s payload |
| Part B (integration) | Route returns non-200 / malformed JSON | widget's fetch-path error handling — needs an explicit "what does the widget do" answer before this ships (not yet specified — flag if this is missing when you get here) |

---

## Part F — Still not decided, carried forward

- Part D's CLAUDE.md scaffold — ship or don't, needs an explicit answer.
- Error/loading UI for the `scopesEndpoint` fetch path (Part E's last row)
  — behavior contract not yet specified, only flagged as missing.
- How the agent declares `requestedScopes` to the SP in the first place,
  upstream of all of this (i.e. before the widget mounts, before the SP
  even knows what to resolve) — not addressed by this doc, needs its own
  decision (possibly reusing the enrollment-token `requestedScopes`
  pattern from `public-surfaces.md`, possibly something new).
