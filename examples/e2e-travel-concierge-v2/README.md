# E2E Travel Concierge v2 — "does this actually work?" in one command

A real LLM agent enrolls with HelixID, gets a real verifiable credential, calls a
**real MCP server**, and a protected tool runs only after `@helixid/mcp` verifies
the agent's presentation against the **live HelixID API** — every step landing in
Console's audit view.

Then it goes one step further: you enroll a **second agent at runtime** (no
restart, no config edit), switch to it in the UI, and watch HelixID **refuse** its
booking because its credential lacks the required scope. Same request, different
credential, different real outcome.

There are no mocks anywhere. If a credential is missing, invalid, revoked, or
lacks the right scope, the action does not happen — and you can prove it.

---

## What happens

```
Browser ──{personaId, "book BA249 for Ada"}──▶ Agent (LLM + MCP client)
                                                   │  1. LLM picks book_flight
                                                   │  2. attachHelixVP() signs a VP with the
                                                   │     SELECTED persona's wallet
                                                   ▼
                                              MCP server ── @helixid/mcp ──▶ HelixID API
                                                   │   POST /v1/vp/verify → VP_VERIFIED / VP_REJECTED (audit)
                                                   │   requireScope(write:orders)
                                                   │   tool runs  ── only if verified AND authorized
                                                   ▼
Browser ◀── "Booked, BKG-…"  or  "refused: lacks write:orders" ── Agent (LLM speaks the real result)
```

- **Concierge Agent** (seeded at startup) holds `read:catalog` + `write:orders` →
  it can search *and* book.
- **Search Agent** (enrolled later, at runtime) holds only `read:catalog` → it can
  search, but HelixID refuses its bookings.

## Prerequisites

- **Docker + Docker Compose.**
- **An LLM API key** — Anthropic (default), OpenAI, or Azure OpenAI. The agent is a
  genuine LLM agent; it decides which tool to call.
- **No Hedera credentials.** This demo enrolls each agent with a local `did:key`
  wallet through the single-roundtrip `/v1/enroll` path (no on-chain DID
  anchoring), and the issuer runs in `did:key` mode. The trust flow is fully real
  and fully local. (If `did:key`/Hedera modes change upstream, only the API env in
  `docker-compose.yml` would need revisiting.)

## Run it

```sh
cd examples/e2e-travel-concierge-v2
cp .env.example .env
#   edit .env → set LLM_API_KEY (and LLM_PROVIDER=openai|azure if you prefer)
docker compose up --build
```

Wait for `helixid-setup` to print `Seed complete` and exit. Then open:

| URL | What |
| --- | --- |
| http://localhost:8090 | **Web chat** — pick the acting agent, talk to it |
| http://localhost:8080 | **Console** — log in `admin` / `admin`, open **Audit** |

### 1) Happy path — Concierge books

With **Concierge Agent** selected, type (or click a suggestion):

> **Book flight BA249 for Ada Lovelace**

You get a confirmation with a booking id. Refresh Console → Audit: a fresh
**`VP_VERIFIED`** event (plus the enrollment/issuance events from setup).

### 2) Enroll a second agent at runtime, then watch it get refused

Enroll a booking-restricted **Search Agent** through the agent's admin route (the
enrollment token is minted server-side; it never touches the browser):

```sh
curl -s -X POST http://localhost:4000/admin/onboard \
  -H 'content-type: application/json' \
  -H 'x-admin-api-key: dev-admin-key-change-in-production' \
  -d '{"personaId":"search","displayName":"Search Agent"}'
# → {"persona":{"id":"search","displayName":"Search Agent","scopes":["read:catalog"]}}
```

The web UI polls `/personas`, so **Search Agent** appears in the dropdown within a
few seconds — no restart. Select it and try:

> **Search flights from Mumbai to London** → succeeds (it has `read:catalog`).
>
> **Book flight BA249 for Grace Hopper** → the agent explains it was **refused**
> because it lacks `write:orders`.

Switch back to **Concierge Agent** and the same booking succeeds. That difference
is produced by HelixID, not by UI filtering — the booking tool is offered to both
agents; only the credential decides.

### Prove the enforcement is real (no LLM in the loop)

Call the MCP tool directly with **no presentation** — refused by HelixID, not the app:

```sh
curl -s http://localhost:7100/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"book_flight","arguments":{"flightId":"BA249","passengerName":"Mallory"}}}'
# → tool result is an error: "Refused by HelixID: no verifiable presentation was supplied."
```

### Reset

```sh
docker compose down -v      # wipes the SQLite DB, wallets, and persona manifest
```

## Configuration

| Variable | Service | Default | Purpose |
| --- | --- | --- | --- |
| `LLM_PROVIDER` | agent | `anthropic` | `anthropic`, `openai`, or `azure` |
| `LLM_API_KEY` | agent | — (**required**) | Your real provider key (Azure: the resource key) |
| `AZURE_OPENAI_ENDPOINT` | agent | — | `azure` only, e.g. `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | agent | — | `azure` only — chat deployment name (used as the model) |
| `AZURE_OPENAI_API_VERSION` | agent | `2024-10-21` | `azure` only |
| `HELIX_ADMIN_API_KEY` | setup, agent, console | `dev-admin-key-change-in-production` | Mint token / guard onboard / read audit |
| `WALLET_PASSPHRASE` | setup, agent | `demo-passphrase` | Encrypts every persona wallet |

For Azure OpenAI, set `LLM_PROVIDER=azure`, put the resource key in `LLM_API_KEY`,
and set `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT` (a deployment of a
tool-calling model such as `gpt-4o`).

The HelixID API's identity settings (`DID_METHOD=key`, the issuer DID, the signing
key) are fixed in `docker-compose.yml` because they must agree with each other;
they're dev values and clearly marked.

## Personas, wallets, and the browser boundary

- A **persona** is a selectable enrolled-agent context: its own wallet, credential,
  and scopes. The active persona's wallet signs the next protected tool call.
- The persona registry is backed by a manifest on the shared `wallets` volume, so
  runtime-enrolled agents survive restarts and a freshly-booted agent sees them.
- The **browser is HelixID-unaware**: it only ever sends `{ personaId, message,
  conversationId }` and receives `{ reply }`. It never receives a wallet, VC, VP,
  private key, or enrollment token. Runtime onboarding is an operator action
  (admin-key-guarded), never a browser action.
- Conversation history is keyed by `(conversationId, personaId)`, so one agent's
  context never leaks into another's.

## Layout — one file, one job

```
config.ts                 shared constants (scopes, tools, target service, wallets dir)
personas/                 the runtime persona model
  store.ts                manifest-backed registry (list / get / add), on the shared volume
  enroll.ts               shared enroll (mint token → did:key wallet → POST /v1/enroll)
helixid-setup/seed.ts     run-once: enroll the Concierge persona → manifest → exit 0
mcp-server/server.ts      real MCP server; search_flights + book_flight, each guarded by @helixid/mcp
agent/
  server.ts               GET /personas, POST /chat (needs personaId), POST /admin/onboard (guarded)
  chat/providers/         anthropic (default) | openai | azure adapter (v1 SPEC §5.7 pattern)
  chat/runChatTurn.ts     LLM tool-loop; runs every tool call as the selected persona
  tools/protectedCall.ts  the only place a VP is created (attachHelixVP, per-persona wallet)
web/                      static chat UI (nginx): persona selector + reverse-proxy to the agent
docker/                   Dockerfiles + the Console nginx override
```

Nothing outside `helixid-setup/`, `personas/`, and `agent/` ever touches a wallet,
VC, or VP. The MCP server only ever *verifies*; the web app doesn't know HelixID
exists.

## Shipped-capability notes (honest caveats)

- **Verification vs. authorization in the audit trail.** The shipped API's
  `/v1/vp/verify` audits the *verification* result: `VP_VERIFIED` for a valid
  presentation, `VP_REJECTED` for a forged/expired/revoked one. It does **not**
  model scope. So when the Search Agent is refused for lacking `write:orders`, its
  presentation still shows as `VP_VERIFIED` in Console (its identity *was* verified)
  — the scope denial is enforced by `@helixid/mcp` and surfaced in the MCP server
  logs and back to the agent. There is no shipped "insufficient-scope" audit event
  to emit; we don't fabricate one.
- **`@helixid/mcp` verifies but does not emit an audit event.** Its middleware runs
  `verifyVP` locally (real: it resolves the issuer DID and checks the live status
  list) and enforces scope — that is the decision. To make the *verification* also
  visible in Console, `mcp-server` additionally calls the API's authoritative
  `POST /v1/vp/verify`. Both calls are real. If `@helixid/mcp` gains audit emission
  upstream, that second call can be dropped.
- **Authorization is the shipped scope/expiry/revocation check**, not OPA/Rego
  (which isn't live) — the same `verifyVP` + `requireScope` path v1 uses.
- **A working API image.** Two pre-existing problems in `helix-api` make its
  shipped Docker path unusable, so this demo ships its own `docker/api.Dockerfile`
  (and does **not** modify `helix-api`):
  1. the repo-root Dockerfile runs `pnpm deploy --prod`, which prunes the generated
     Prisma client, so the API crash-loops on `import { PrismaClient }`;
  2. `pnpm --filter @helixid/api build` (tsc) currently fails to compile on `main`,
     so there is no clean `dist/`.
  The demo image generates the Prisma client in place and runs the API from source
  with `tsx` (transpile-only) — the same way the repo's own `dev` script runs it.
  It is still 100% the real API.
