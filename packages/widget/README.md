# `@helixid/widget`

Consent-screen building blocks for a Service Provider issuing
`DelegationGrantCredential`s: an SP-side scope resolver and a headless
consent-selection controller.

Two entry points, deliberately separated:

| Import | Runs | Contains |
|---|---|---|
| `@helixid/widget/server` | SP backend only | `resolveConsentScopes()` — talks to the SP's internal MCP server |
| `@helixid/widget` | Browser-safe | types, `DEFAULT_DURABILITY_OPTIONS`, `createConsentController()` |

The server module must never be bundled into the browser. The SP's MCP server
is internal infrastructure; exposing tool introspection to an untrusted client
would mean CORS plus a surface nobody wants public.

**Visual rendering is not shipped here.** This package provides the types and
the selection logic; drawing the consent screen is normal frontend work owned
by the SP.

---

## Part A — `resolveConsentScopes()`

```ts
import { resolveConsentScopes } from '@helixid/widget/server';

const scopeOptions = await resolveConsentScopes({
  mcpServerUrl: process.env.HELIX_MCP_SERVER_URL, // optional
  curatedFallback: [
    { scope: 'book:flights', label: 'Book flights', description: 'Buy tickets on your behalf' },
    { scope: 'modify:booking', label: 'Modify bookings' },
  ],
});
```

Output is the full union of **curated fallback ∪ MCP tool scopes ∪
`accept-terms`**.

1. Seed the catalog from `curatedFallback`.
2. If `mcpServerUrl` is set, call `tools/list` (plain JSON-RPC — no LLM) and
   insert **every** tool carrying a `metadata.requiredScope`. MCP data wins
   over curated data for the fields it defines.
3. Always append `accept-terms` with `required: true` — T&C acceptance folds
   into grant scopes rather than living in a separate field.
4. Any resolved scope that neither source labels falls back to
   `humanizeScope()` (`book:flights` → `book flights`). No scope is ever
   rendered without a label.

**There is no `requestedScopes` input.** The SP always advertises its own
complete grantable-scope catalog. The grant's scopes and the agent's own VC
scopes are independently scoped and intersected at verification time
(`effectiveScopes`), never merged — so an agent narrowing this menu would be
constraining a ceiling that has nothing to do with its own.

`curatedFallback` is SP-owned. HelixID provides the mechanism, not the scope
strings — the same division as the SP choosing its own `did:web` domain or
status-list length.

If the MCP server is unreachable or errors, the catalog falls back to
`curatedFallback` alone. That narrows what the user can grant; it never
widens it.

---

## Part B — the SP's scope-resolution route (contract, not shipped code)

HelixID does not ship this route. The SP's routing framework, auth middleware,
and MCP server URL are all SP-owned. The route must satisfy:

| | |
|---|---|
| Method | `GET` — pure resolution, no state mutation |
| Path | SP's choice; passed to the widget as `scopesEndpoint` |
| Query params | `agentDid` — **and only `agentDid`** |
| Auth | Same authenticated session context as the consent page. No separate token scheme; reuse the session middleware already protecting that page. |
| Response | `{ "scopeOptions": ScopeOption[] }` |

Reference implementation — **copy the `agentDid` comment with it**:

```ts
// GET /api/consent/scopes?agentDid=<did>
export async function GET(request: Request) {
  const agentDid = new URL(request.url).searchParams.get('agentDid') ?? '';

  // `agentDid` is retained for AUDIT CORRELATION only. It is deliberately NOT
  // passed into resolveConsentScopes() and must not affect the returned
  // catalog: the SP advertises its full scope catalog to every agent. Do not
  // delete this parameter as "unused" — the route contract requires it, and
  // the full-catalog-regardless-of-agentDid assertion depends on it staying.
  void agentDid;

  const scopeOptions = await resolveConsentScopes({
    mcpServerUrl: process.env.HELIX_MCP_SERVER_URL,
    curatedFallback: SP_SCOPE_CATALOG,
  });

  return Response.json({ scopeOptions });
}
```

The audit sink this correlates into is not built yet (audit routing is
parked); the parameter is retained ahead of that work, not wired to it.

---

## Part C — the consent controller

```ts
import { createConsentController, DEFAULT_DURABILITY_OPTIONS } from '@helixid/widget';

const controller = createConsentController({
  agentDid, agentName, userIdentifier, serviceDid,
  scopesEndpoint: '/api/consent/scopes',   // or pre-resolved scopeOptions
  defaultDurability: 'standing',
  onAccept: async ({ scopes, durability }) => { /* POST to your grant route */ },
  onDecline: () => { /* close the dialog */ },
});

await controller.load();                      // mount
controller.subscribe((state) => render(state));
```

Behavior:

- Provide **one** of `scopeOptions` (pre-resolved, SSR path) or
  `scopesEndpoint` (fetched at mount). If both are given, `scopeOptions` wins
  and no fetch occurs. If neither is given, the factory throws — that is a
  caller integration error, not a state to render around.
- `userIdentifier` must be the same form (DID or email) the grant captures at
  consent time, or VP verification's user-match fails later.
- Durability is an explicit control: `defaultDurability` pre-selects one
  option, it never hides the other. `state.durabilityOptions` always holds the
  full list.
- `required: true` scopes (i.e. `accept-terms`) cannot be unchecked and appear
  in every `onAccept` payload. Decline is the way not to proceed.
- Optional scopes start checked unless the resolver sets
  `defaultChecked: false`, so `onAccept` carries every required scope plus
  whichever optional ones were left checked.

### Fetch failure

If the `scopesEndpoint` request fails — non-200, malformed JSON, or network
failure — the controller enters `status: 'error'` with `canAccept: false`.
Accept is disabled; **Decline stays available**. There is no retry.

---

## Downstream

`onAccept`'s handler is the SP's own route: it calls `issueGrant()` with
`selection.scopes` and `selection.durability`, persists the returned grant VC
and updated status list, and returns the grant to the caller. The browser
never sees the SP's private key.
