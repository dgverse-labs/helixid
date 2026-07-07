# E2E Travel Concierge v2 — the 60-second "does this actually work?" demo

One command. One happy path. A real LLM agent enrolls with HelixID, gets a real
verifiable credential, calls a **real MCP server**, and the protected tool only
runs after `@helixid/mcp` verifies the agent's presentation against the **live
HelixID API** — with every step landing in Console's audit view.

There are no mocks anywhere in this example. If the credential is missing,
invalid, revoked, or lacks the right scope, the booking does not happen — and you
can prove it.

> Looking for delegation, persona-switching, revocation walkthroughs, or a
> rejection scenario? That's [`../e2e-travel-concierge`](../e2e-travel-concierge)
> (v1). This one does exactly one thing, on purpose.

---

## What happens

```
Browser ──"book flight BA249 for Ada"──▶ Agent (LLM + MCP client)
                                              │  1. LLM decides to call book_flight
                                              │  2. attachHelixVP() signs a VP locally
                                              ▼
                                         MCP server  ── @helixid/mcp middleware ──▶ HelixID API
                                              │        verify VP (issuer + revocation, live)
                                              │        require scope write:orders
                                              │        POST /v1/vp/verify  ─────────▶  VP_VERIFIED (audit)
                                              │  tool runs → booking confirmed
                                              ▼
Browser ◀──"Booked! Confirmation BKG-…"── Agent (LLM writes the reply from the real result)

Operator opens Console → Audit and sees: ENROLLMENT_TOKEN_GENERATED,
AGENT_ONBOARDED, VC_ISSUED, and VP_VERIFIED.
```

## Prerequisites

- **Docker + Docker Compose.**
- **An LLM API key** — Anthropic (default), OpenAI, or Azure OpenAI. The agent is
  a genuine LLM agent; it decides to call the tool.
- **No Hedera credentials.** Unlike some HelixID flows, this demo enrolls the
  agent with a local `did:key` wallet through the single-roundtrip `/v1/enroll`
  path (no on-chain DID anchoring), and the issuer runs in `did:key` mode. The
  trust flow is fully real and fully local. (If/when `did:key` and Hedera modes
  change upstream, only the API env in `docker-compose.yml` would need revisiting.)

## Run it

```sh
cd examples/e2e-travel-concierge-v2
cp .env.example .env
#   edit .env → set LLM_API_KEY (and LLM_PROVIDER=openai if you prefer)
docker compose up --build
```

Wait for `helixid-setup` to print `Seed complete` and exit. Then open:

| URL | What |
| --- | --- |
| http://localhost:8090 | **Web chat** — talk to the agent |
| http://localhost:8080 | **Console** — log in `admin` / `admin`, open **Audit** |

In the chat, click a suggestion or type:

> **Book flight BA249 for Ada Lovelace**

You'll get a confirmation with a booking id. Refresh Console → Audit and you'll
see a fresh **`VP_VERIFIED`** event (plus the enrollment/issuance events from
setup).

### Prove it's real (the part that matters)

The booking only happened because the credential carried `write:orders`. To see
the enforcement, call the MCP tool directly **without** a valid presentation:

```sh
# Missing presentation → refused by HelixID, not by the app
curl -s http://localhost:7100/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"book_flight","arguments":{"flightId":"BA249","passengerName":"Mallory"}}}'
# → the tool result is an error: "Booking refused by HelixID: VPMissingError …"
```

The agent's own denial path is the same: if the credential lacked `write:orders`,
`@helixid/mcp` throws `InsufficientScopeError` and the tool never runs.

### Reset

```sh
docker compose down -v      # wipes the SQLite DB and the agent wallet
```

## Configuration

| Variable | Service | Default | Purpose |
| --- | --- | --- | --- |
| `LLM_PROVIDER` | agent | `anthropic` | `anthropic`, `openai`, or `azure` |
| `LLM_API_KEY` | agent | — (**required**) | Your real provider key (Azure: the resource key) |
| `AZURE_OPENAI_ENDPOINT` | agent | — | `azure` only, e.g. `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | agent | — | `azure` only — your chat deployment name (used as the model) |
| `AZURE_OPENAI_API_VERSION` | agent | `2024-10-21` | `azure` only |
| `HELIX_ADMIN_API_KEY` | setup, console | `dev-admin-key-change-in-production` | Mint token / read audit |
| `WALLET_PASSPHRASE` | setup, agent | `demo-passphrase` | Encrypts the agent wallet |

For Azure OpenAI, set `LLM_PROVIDER=azure`, put the resource key in `LLM_API_KEY`,
and set `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT` (your model deployment,
e.g. a `gpt-4o` deployment that supports tool calling).

The HelixID API's identity settings (`DID_METHOD=key`, the issuer DID, the
signing key) are fixed in `docker-compose.yml` because they must agree with each
other; they're dev values and clearly marked.

## Layout — one file, one job

```
helixid-setup/seed.ts     run-once: mint token → enroll did:key agent → save wallet → exit 0
mcp-server/server.ts      real MCP server; one tool book_flight guarded by @helixid/mcp
agent/                    LLM agent + MCP client
  chat/providers/         anthropic (default) | openai | azure adapter (v1 SPEC §5.7 pattern)
  chat/runChatTurn.ts     the LLM tool-loop — never authors the outcome itself
  tools/bookFlight.ts     the only place a VP is created (attachHelixVP)
web/                      static chat UI (nginx), reverse-proxies /chat to the agent
config.ts                 shared constants (scopes, target service, ports)
docker/                   Dockerfiles + the Console nginx override
```

Nothing outside `helixid-setup/` and `agent/` ever touches a wallet, VC, or VP.
The MCP server only ever *verifies*; the web app doesn't know HelixID exists.

## Shipped-capability notes (honest caveats)

- **`@helixid/mcp` verifies but does not emit an audit event.** Its middleware
  runs `verifyVP` locally (real: it resolves the issuer DID and checks the live
  status list), which is the enforcement decision — but it does not write to the
  audit log. So that a *verification* also shows up in Console, `mcp-server`
  additionally calls the API's authoritative `POST /v1/vp/verify` (which writes
  `VP_VERIFIED`). Both calls are real; nothing is fabricated. If `@helixid/mcp`
  gains audit emission upstream, that second call can be dropped.
- **Authorization is the shipped scope/expiry/revocation check**, not OPA/Rego
  (which isn't live). `book_flight` requires `write:orders` via
  `helixidMCPMiddleware({ requiredScopes: ['write:orders'] })` — the same
  `verifyVP` + `requireScope` path v1 uses.
- **A working API image.** Two pre-existing problems in `helix-api` make its
  shipped Docker path unusable, so this demo ships its own `docker/api.Dockerfile`
  (and does **not** modify `helix-api`):
  1. the repo-root Dockerfile runs `pnpm deploy --prod`, which prunes the
     generated Prisma client, so the API crash-loops on `import { PrismaClient }`;
  2. `pnpm --filter @helixid/api build` (tsc) currently fails to compile on
     `main` (duplicate `listVCs` / `ListVCsFilters` typo in `vc.service.ts`,
     `findMany` on `AuditLogRepository` in `audit/index.ts`), so there is no clean
     `dist/`.
  The demo image generates the Prisma client in place and runs the API from
  source with `tsx` (transpile-only) — the same way the repo's own `dev` script
  runs it. It is still 100% the real API.
