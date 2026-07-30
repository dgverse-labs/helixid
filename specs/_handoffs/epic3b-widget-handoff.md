# Epic 3b Handoff — `@helixid/widget` (Consent Scope Resolution + Durability)

**Branch:** `feature/epics-1-5-consent-and-vp`, on top of Epic 2 (`f998aa1`). **No commits made.**

**Scope implemented:** widget doc Part A (scope resolver), Part B (route contract — documented, not shipped, per the doc's own rule), Part C (props, `DEFAULT_DURABILITY_OPTIONS`, required-scope handling), Part E test table as amended. Part D is parked.

---

## Note on the prompt's premises

Both were nearly right, one detail off each:

- **Tag names.** The prompt cites `epic1-done` and `epic2-done`. The actual tags are **`epic1-epic3`** and **`epic-2-done`** (hyphen before the 2). Register D12 specifies `epic1-done`/`epic2-done`, so the repo has drifted from the register's naming scheme. Cosmetic, but `git diff epic2-done..epic3-done` from D12 will not work as written.
- Both epics *are* committed and the tree *was* clean at start, as stated. No issue there.

---

## What shipped

New package `packages/widget/` (`@helixid/widget` v0.1.0), scaffolded to match `packages/mcp` exactly (tsconfig, vitest config, script set, `files`/`exports` layout). Picked up automatically by `packages/*` in the workspace glob — turbo now runs 12 tasks instead of 11.

Two entry points, deliberately separated so the MCP-facing code can never reach a browser bundle:

| Import | Contains |
|---|---|
| `@helixid/widget/server` | `resolveConsentScopes()`, `humanizeScope()`, `ACCEPT_TERMS_SCOPE` |
| `@helixid/widget` | types, `DEFAULT_DURABILITY_OPTIONS`, `createConsentController()` |

### Part A — `resolveConsentScopes()` (`src/server/resolve-scopes.ts`)

Implements the **resolved** contract, not the doc as written:

```ts
export interface ResolveConsentScopesOptions {
  mcpServerUrl?: string;
  curatedFallback: CuratedScopeEntry[];
}
```

- **Step 1** — seed from `curatedFallback`. Unchanged.
- **Step 2** — call `tools/list` over plain JSON-RPC (`POST`, no MCP SDK dependency, no LLM) and insert **every** tool carrying `metadata.requiredScope`. No filtering against any requested set. MCP wins over curated.
- **Step 3** — **deleted.** There is no filtering pass; a comment marks where it was so a future reader does not "restore" it.
- **Step 4** — `accept-terms` always appended with `required: true`, `defaultChecked: true`. Unchanged.
- **Step 5** — `humanizeScope()` fallback for **any resolved scope** (reworded from "any requested scope") lacking a label.

Output is exactly curated ∪ MCP ∪ `accept-terms`.

`metadata.requiredScope` is read with the same convention `filterToolsByScope()` already uses. Tools without a `requiredScope` contribute nothing — which is what makes register D7's unscoped `search_*` tools produce no consent entry.

### Part C — types + headless controller

`src/types.ts` carries Part C's block **verbatim**: `DurabilityOption`, `HelixConsentWidgetProps` (including the `userIdentifier` §2.6 comment), `ConsentSelection`, and `DEFAULT_DURABILITY_OPTIONS` with both labels unchanged. `ScopeOption`/`CuratedScopeEntry` live here too and are re-exported from the server module, so both import paths work without a duplicate definition.

`src/controller.ts` implements Part C's *behavior* as a framework-agnostic controller (`createConsentController`) exposing `getState()`, `subscribe()`, `load()`, `toggleScope()`, `setDurability()`, `accept()`, `decline()`:

- `scopeOptions` wins over `scopesEndpoint`; when it is present **no fetch is issued at all**.
- Neither provided → the factory **throws**.
- `required: true` scopes cannot be unchecked and are in every `onAccept` payload.
- `durabilityOptions` always holds the full list; `defaultDurability` pre-selects without hiding the alternative. Defaults to `standing`.
- `onAccept` receives `{ scopes, durability }` with every required scope plus the optional ones still checked.

### D3 — `scopesEndpoint` fetch failure

Non-200, malformed JSON, valid-JSON-wrong-shape, and network failure all produce `status: 'error'`, `canAccept: false`, empty scope list. `decline()` works in every state including error. `accept()` is inert while `canAccept` is false. **No retry** — asserted by a test that the fetch is called exactly once.

### D4 — `agentDid`

The controller sends `agentDid` as the **only** query param (`?agentDid=<encoded>`, correctly appended with `&` when the endpoint already carries a query string). It is **not** an input to `resolveConsentScopes()` — the options interface has no field for it, so it is structurally incapable of affecting the catalog.

The required rationale comment exists in three places: the `resolveConsentScopes()` doc block, the controller's fetch site, and — see DIVERGED 1 — the README's reference route implementation.

---

## Which widget-doc sections were superseded

| Doc section | Status | Source |
|---|---|---|
| Part A signature — `requestedScopes: string[]` | **Removed** from `ResolveConsentScopesOptions` | Epic 5 Part E |
| Part A behavior step 2 — "and in `requestedScopes`" | **Removed**; every tool with a `requiredScope` is inserted | Epic 5 Part E |
| Part A behavior step 3 — filter to `requestedScopes` | **Deleted entirely** | Epic 5 Part E |
| Part A behavior step 5 — "any requested scope" | **Reworded** to "any resolved scope" | Epic 5 Part E |
| Part B query params — `agentDid`, `requestedScopes` | **`agentDid` only** | Epic 5 Part E + D4 |
| Part D — CLAUDE.md scaffold | **PARKED, not built** | D6 |
| Part E row 4 — entry for a scope not in `requestedScopes` | **Deleted** | D5 |
| Part E rows 1 and 3 | **Reworded** off "requested scope" framing; still cover curated labeling and `humanizeScope()` | D5 |
| Part E — new row | **Added**: full catalog returned regardless of `agentDid` | D5 |
| Part E last row — fetch failure "needs an explicit answer before this ships" | **Answered**: error state, Accept disabled, Decline available, no retry | D3 |
| Part F item 1 (scaffold) | Closed — parked | D6 |
| Part F item 2 (fetch error/loading UI) | Closed — specified | D3 |
| Part F item 3 (how the agent declares `requestedScopes`) | Closed — **no such declaration exists, by design** | D9 |

All three Part F carry-forward items are now closed. Nothing in Part F remains open.

**No unlisted conflict between the widget doc and the register/Part E was found.** The one structural tension I did hit is DIVERGED 1 below — a gap rather than a contradiction, so I resolved it rather than stopping.

---

## Test results

`packages/widget`: **2 files, 25 tests, all passing.**

Part E coverage, row by row:

| Part E row | Test |
|---|---|
| 1 (reworded) | curated-only → curated labels for every curated scope + `accept-terms`; asserts no fetch |
| 2 | curated + MCP same scope → MCP label and description win; curated-only scope untouched |
| 3 (reworded) | MCP tool contributing an unlabelled scope → `humanizeScope()`; every option has a non-empty label |
| ~~4~~ | deleted per D5 |
| 5 | `accept-terms` present with `required: true` across curated-only, empty-catalog, and MCP-only inputs |
| new (D5) | full catalog returned; resolver takes no agent identity at all |
| Part C | `scopeOptions` wins, no fetch |
| Part C | neither source → throws at mount |
| Part C | required scope non-uncheckable, in every `onAccept` payload |
| Part C | both durability options offered with `defaultDurability` set; selection reaches `onAccept` |
| Part B/D3 | non-200, malformed JSON, wrong shape, network failure → error + Accept disabled + Decline available; no retry |
| D4 | two different `agentDid`s transmitted, identical catalog returned |

Extra rows beyond the table: MCP tools without a `requiredScope` are ignored (D7's `search_*` case), MCP unreachable/non-200 falls back to curated, `humanizeScope()` unit cases, optional-scope re-toggling, custom `durabilityOptions`, and subscriber notification.

**Full workspace regression** (forced, uncached, Node 24 + the CI Postgres container): 12 tasks, 11 successful. `helix-api` fails 5 tests — **the identical 5 `audit-log.repository.test.ts` failures carried since Epic 1/3** (`findMany` vs `list`), unchanged and untouched. Everything else green: core 17 files, sdk-js 18, cli 6, mcp 1, langchain 1, did-hedera 4, widget 2, e2e 5 skipped. **No regression introduced.**

---

## DIVERGED

1. **D4's "code comment on the route handler" has no route handler to attach to in this epic.** Part B is explicit that HelixID ships the *contract only*, and D6 parks the CLAUDE.md scaffold that was the other vehicle for route guidance — so the literal instruction cannot be satisfied here. I put the rationale in the two places this package *does* own (the resolver's doc block and the controller's fetch site) and added a **copy-paste reference route implementation to the package README with the comment baked in**, prefaced "copy the `agentDid` comment with it." **The real route is written in Epic 5 C2 — that is where the comment must actually land, and it will not get there automatically.** Carry this forward.

2. **Part C implemented as a headless controller, not a rendering component.** Part A's scope boundary says "visual/render implementation is explicitly out of scope," but Part E's rows test behavior ("cannot be unchecked", "both options visibly rendered", "throws at mount"). A controller is the largest testable surface that does not invent a visual implementation the doc excludes, and it keeps the package framework-agnostic (no React dependency added to the monorepo). **Consequence: "both options *visibly* rendered" is covered only as "both options are offered in `state.durabilityOptions`."** The actual visual assertion belongs to whoever builds the render layer.

3. **MCP fetch failure falls back to the curated catalog rather than throwing.** Not specified anywhere — D3 covers the *widget's* fetch of `scopesEndpoint`, not the *resolver's* fetch of `tools/list`. I grounded the choice in consolidated log §4.3: *"read from SP's MCP role/scope metadata if exposed, else fall back to a manually curated list"* — which is also what the parameter name says. Note this narrows what the user can grant (fewer scopes offered), never widens it, so it is not a fail-open. If you would rather a dead MCP server take the consent page down, it is a one-line change.

4. **`defaultChecked` semantics for optional scopes.** Unspecified. Optional scopes start **checked** unless the resolver sets `defaultChecked: false`, because Part C describes the payload as "whichever optional ones were **left checked** at submit time" — an unchecking gesture, which implies they start checked. Required scopes are always checked regardless.

5. **MCP-over-curated is a field-level merge, not an object-level clobber.** "MCP data wins over curated data when both describe the same scope" is implemented as: MCP's defined fields win, fields MCP does not define keep the curated value (notably `required`). A whole-object replacement would silently drop a curated `required: true`.

6. **MCP label sourcing is an inference.** The doc never says which MCP fields become `label`/`description`. Implemented as `label` ← `metadata.label`, else the existing curated label, else `humanizeScope()`; `description` ← `metadata.description`, else the tool's own `description`, else curated. This is what makes step 5 fire exactly for unlabelled MCP scopes — the live coverage D5 preserves.

7. **Two additions beyond the letter of the spec**, both flagged rather than silent: `@helixid/widget` added to the root `test:unit` script (an explicit per-package enumeration that would otherwise skip the new package silently), and a **Consent Widget** section added to `docs/public-surfaces.md` (the repo's public-surface index; a new published package missing from it is the same doc-drift Epic 2 §8 existed to fix). Neither was requested. Revert either if you disagree.

---

## NEEDS VERIFYING

1. **The D4 comment must be carried into Epic 5 C2's actual route handlers** (`sp-airline/`, `sp-hotel/`). Copy it from the widget README. Without it, register D4's stated failure mode — a reviewer deleting an apparently-unused parameter — is live again.
2. **Confirm the MCP-unreachable fallback** (DIVERGED 3) is the behavior you want before the demo depends on it.
3. **`defaultChecked` default** (DIVERGED 4) is a UX decision with consent implications — worth a product look, not just an engineering one.
4. **Render layer is not built.** Epic 5's demo needs an actual consent UI embedded in each SP app; this package gives it types, state, and D3's error contract, nothing visual.
5. **Tag naming drift** — repo has `epic1-epic3`/`epic-2-done`, register D12 specifies `epic1-done`/`epic2-done`. Pick one before the tag-range review workflow D12 describes gets used.
6. **The 5 audit-log failures** are now three epics old and remain the only red in the workspace. Still worth clearing before Epic 5 so a real regression is visible.
7. **`@helixid/widget` has no LICENSE file** — but neither does any other package in `packages/`, while all of them list `"LICENSE"` in `files`. Pre-existing packaging gap, inherited deliberately rather than fixed unilaterally.

## Parked / not built

- **Part D CLAUDE.md scaffold — PARKED (D6).** Not built. Its draft text references `requestedScopes` and is stale against Part E, so reviving it would need a rewrite, not a copy.
- **Audit routing — PARKED (D2).** `agentDid` is retained for a correlation sink that does not exist yet; nothing was built toward it.
- **Grant issuance/persistence routes** — Epic 5 C3, explicitly downstream of this package.
