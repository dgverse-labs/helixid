# e2e-consent-demo — End User consent, two independent Service Providers

The point of this demo is one assertion: **the second booking with the same
Service Provider does not ask the user again.**

Everything else exists to make that assertion mean something — two SPs with
their own `did:web` identities and their own status lists, real grant
credentials signed by each SP's own key, and real `verifyVP()` enforcement on
every protected call.

This demo does **not** modify `examples/e2e-travel-concierge`. It is a separate
folder with its own seeding, its own compose file, and its own SPs.

---

## The 5-step flow

| Step | What happens | What to watch |
|---|---|---|
| 1 | User logs in; the agent holds a `userDid` | no VP exists yet |
| 2 | Search TVM → Delhi | **no consent prompt** — `search_flights` is open, read-only, and carries no `requiredScope` |
| 3 | Book a flight (Airline SP, first time) | SP refuses → consent page → grant issued → booking succeeds |
| 4 | Book a hotel (**different** SP) | a separate prompt and a separate grant; the Airline's grant is untouched |
| 5 | Book a return flight (**same** Airline SP) | **no prompt, no new grant** — the standing grant is reused |

Step 5 is covered by an automated regression test that asserts on counts, not
on "the booking succeeded":

```bash
pnpm --filter @helixid/example-e2e-consent-demo test
```

The test drives two real SP servers over real HTTP — real `did:web` resolution,
real signing, real `verifyVP()`, real status-list fetches. No LLM is involved,
so it runs in CI.

---

## Running it

```bash
cp .env.example .env
docker compose up --build
```

| Service | URL |
|---|---|
| Airline SP (Helix Air) | http://localhost:4101 |
| Hotel SP (Helix Stay) | http://localhost:4102 |
| Agent | http://localhost:4100 |
| Console (audit) | http://localhost:8080 — `admin` / `admin` |

Reset to a clean slate: `docker compose down -v`.

No LLM API key is required.

---

## What each piece owns

```
seed/            provisions both SP did:web identities + their initial status
                 lists, then enrolls the Travel Planner Agent
sp-airline/      Helix Air  — catalog: book:flights, modify:booking
sp-hotel/        Helix Stay — catalog: book:hotel
sp-shared/       the SP app both of the above are instances of
agent/           wallet, VP construction, consent handoff, grant storage
helixid-config/  scope strings, tool catalogs, ports
tests/           the 5-step flow, asserted end to end
```

Each SP app owns four things and hosts two artifacts:

| Route | Purpose |
|---|---|
| `POST /api/mcp` | MCP endpoint — `tools/list` and `tools/call`, with the scope gate |
| `GET /api/consent/scopes?agentDid=` | resolves this SP's full grantable-scope catalog |
| `POST /api/consent/accept` | signs and persists the grant — **the only place the SP's key is used** |
| `GET /consent` | the consent page, rendering the real `@helixid/widget` controller |
| `GET /.well-known/did.json` | its `did:web` document, so anyone can verify its grants |
| `GET /status-list/1` | its Bitstring status list, so anyone can check revocation |

---

## Two things worth understanding

**Why a scoped tool checks for a grant, not just for scope.** When a VP carries
no grant, `effectiveScopes` is just the agent's own `privilegeScopes` — and the
agent VC must itself carry `book:flights` for a grant to have any effect at all,
since the intersection is bounded by the agent's ceiling. So an agent presenting
only its platform-issued credential would pass a scope check having never asked
the user anything. Each SP therefore requires that a grant **it issued** is
present in the presentation, and then enforces `effectiveScopes` on top. That is
what makes consent load-bearing rather than decorative.

**Why the browser never sees a private key.** The consent page collects a
selection and POSTs it. `issueGrant()` runs inside `POST /api/consent/accept`,
in the SP's own process, with the SP's own key. The page receives a signed
credential back and never any key material. A test asserts the SP's private key
appears in none of its responses.

---

## Not included

- **No LLM chat loop.** The agent here is a deterministic HTTP driver so the
  flow is reproducible and testable. The conversational shell lives in
  `examples/e2e-travel-concierge`.
- **No audit routing.** Epic 4's routing module is parked, so consent events
  (`consent_granted` / `consent_revoked`) are not emitted anywhere. Each SP logs
  its decisions to stdout, and the platform's own six event types still land in
  Console via `helix-api`. See the epic handoff for the exact gap.
