# Travel Concierge v2 — Spec vs Implementation Gap Analysis

This document compares `e2e-travel-concierge-coding-spec.md` with the current
implementation in `examples/e2e-travel-concierge-v2/`. It is intended to be
reused as an implementation prompt. No implementation changes were made during
this review.

## Executive summary

The current v2 implementation is not an implementation of the full coding
spec. It is a deliberately reduced, one-agent/one-tool happy-path demo. The
README explicitly says that persona switching, delegation, revocation
walkthroughs, and rejection scenarios belong to v1.

The largest missing feature is persona/agent switching:

- The spec defines two personas, each backed by its own wallet and credential.
- The current implementation has one fixed `travel-concierge-v2` agent, one
  wallet path, and one credential.
- The web UI has no persona selector and never sends a `personaId`.
- The agent HTTP API has no `GET /personas` endpoint and ignores persona
  identity in `POST /chat`.
- Tool execution always loads the one wallet configured by `WALLET_PATH`.

The desired behavior should preserve initial enrollment while also supporting
runtime enrollment of another agent. A newly enrolled agent must become a
selectable chat persona without restarting or editing configuration.

## Implementation status (this document has now been actioned)

The persona/runtime-enrollment gaps described below are **implemented**. Summary
of what changed, keeping the MCP architecture (decision 1) and the recommended
target flow:

- **Persona registry** — `personas/store.ts`, a manifest-backed (`/wallets/personas.json`)
  in-memory registry with stable ids, display names, scopes, and per-persona wallet
  references. Shared enroll logic in `personas/enroll.ts`.
- **Initial enrollment** — `helixid-setup/seed.ts` enrolls one persona (`concierge`,
  `read:catalog` + `write:orders`) into its own wallet and records it in the manifest.
- **Later enrollment** — `POST /admin/onboard` on the agent (guarded by the admin
  key) mints a token server-side, enrolls a distinct `did:key` wallet, registers the
  persona, and returns safe metadata. The token/wallet never reach the browser.
- **Discover / select** — `GET /personas` returns safe metadata; the web UI renders a
  selector and polls every 4s so runtime-enrolled agents appear without a restart.
- **Chat contract** — `POST /chat` now requires `{ personaId, message, conversationId }`
  and returns `404` for an unknown persona. `runChatTurn` threads the persona; the
  selected persona's wallet signs every protected tool call.
- **Conversation state** — history is keyed by `(conversationId, personaId)`.
- **Search + book** — the MCP server exposes `search_flights` (`read:catalog`) and
  `book_flight` (`write:orders`), each guarded by `@helixid/mcp`.
- **Scope-rejection demo** — the booking-restricted Search Agent is still offered the
  booking tool; HelixID (not UI filtering) produces the denial, and the real result
  returns to the LLM.
- **Revocation walkthrough** — `POST /revoke-agent` loads the selected persona's
  wallet server-side, revokes its real VC through HelixID, and the web UI exposes
  Use case 3 so retrying a booking with Concierge is rejected by the live status
  list.
- **Delegation walkthrough** — Use case 4 creates Planner Agent
  (`read:catalog`, `write:orders`, `maxDelegationDepth: 1`) and Research Agent
  with no tool scopes, delegates only `read:catalog` to Research, and makes
  Research present that child VC for search/book attempts.
- **Verification/audit** — the MCP server calls the live `/v1/vp/verify` first, so
  both `VP_VERIFIED` (valid) and `VP_REJECTED` (invalid/revoked) land in Console;
  scope denials of an otherwise-valid VP are enforced by `@helixid/mcp` and logged
  (the shipped API has no scope-aware audit event — documented, not faked). For
  local delegated child VCs, the shipped API verifier cannot yet audit the child
  chain, so the MCP server logs that API limitation and continues with local
  SDK/MCP chain and scope enforcement.
- **Providers** — Anthropic, OpenAI, and Azure OpenAI all preserved.

**Verified on host (no LLM key needed for the trust path):** setup enrolled
Concierge; `POST /admin/onboard` enrolled Search Agent at runtime (401 without the
admin key, 201 with it, 409 on duplicate); `GET /personas` listed both without a
restart; Concierge `book_flight` → CONFIRMED; Search Agent `book_flight` → refused
("verified but lacks the write:orders scope", with a **different** signing DID);
Search Agent `search_flights` → success; Console audit showed `VP_VERIFIED`,
`AGENT_ONBOARDED`, `VC_ISSUED`, `ENROLLMENT_TOKEN_*` for the right subjects.

**Intentionally deferred** (the gap matrix marks this optional / out of scope for
v2): the spec's **separate HTTP backend** (superseded by the MCP server per
decision 1).
**Automated tests** are not yet added.

## Requirement clarification to carry into implementation

Treat a "persona" as a selectable enrolled-agent context, not merely a visual
LLM character:

1. At least one agent is enrolled during initial setup so the demo works
   immediately.
2. The running system also supports enrolling another agent later using an
   enrollment token.
3. Different enrolled agents may have different names, wallets, credentials,
   scopes, and delegation limits.
4. All enrolled/loaded agents are exposed through the personas API and can be
   selected in chat.
5. The selected `personaId` determines the wallet/credential used to sign every
   protected tool call.
6. Enrollment and persona switching must work without a container restart or a
   config-file edit.
7. The browser remains HelixID-unaware: it sends only a persona identifier,
   message, and conversation identifier. It must never receive or handle a
   wallet, VC, VP, private key, or enrollment token.

The existing spec's CLI-only live onboarding creates/registers a wallet, but it
does not explicitly make the new agent selectable in the UI. The implementation
should close that final loop.

## Gap matrix

| Area | Coding spec | Current v2 implementation | Gap / required direction |
| --- | --- | --- | --- |
| Personas | `concierge` and `search` persona registry | No persona registry | Add a runtime registry with stable IDs, display names, wallet references, and allowed tool metadata. |
| Initial enrollment | Seeder enrolls every configured persona | Seeder enrolls exactly one fixed agent | Keep initial enrollment, but seed configured initial persona(s) into distinct wallet files. |
| Later enrollment | `onboarding.ts` plus CLI accepts a bootstrap token | No onboarding module, CLI, endpoint, or package script | Add live enrollment for a different agent and register it in the running wallet/persona store. |
| Discover personas | `GET /personas` | Endpoint absent | Return safe persona metadata only. Include newly enrolled agents. |
| Select persona | `PersonaSwitcher` in frontend | No selector; static single-agent page | Fetch personas, render a selector, and maintain active persona state. |
| Chat request | `{ personaId, message, conversationId }` | `{ message, conversationId }` | Require and validate `personaId`; pass it through the complete tool loop. |
| Wallet selection | In-memory wallet store keyed by persona | One `WALLET_PATH`; wallet loaded inside `attachHelixVP` | Resolve wallet/credential from selected persona for every tool call. Unknown or unenrolled personas must fail safely. |
| Conversation state | Tool loop receives persona explicitly | History keyed only by `conversationId` | Bind history to persona, e.g. `(conversationId, personaId)`, or define/reset behavior on switching so identities cannot share accidental context. |
| Search capability | `searchFlights` and `bookFlights` tools | Only `book_flight` exists | Add search tool/path if the full spec scenarios remain required. |
| Scope rejection demo | Search persona can attempt booking and is rejected by scope enforcement | Only fully privileged agent exists; rejection shown only through direct curl with missing VP | Enroll/select an agent without booking scope while still exposing the booking tool to the LLM. Surface the real denial result back to the model. |
| Delegation | Runtime delegated sub-agent with reduced scope and ephemeral wallet | SDK/MCP delegation walkthrough implemented; API-side delegation issuance remains absent | Keep docs explicit that local child-chain enforcement is real, but Console/API chain audit is not yet shipped. |
| Revocation scenario | Revoke concierge VC and retry live | Implemented as Use case 3 | Switching continues to select the revoked agent's actual credential. |
| Service boundary | Separate HTTP backend with search/book routes | MCP server owns the protected booking tool | This is a major architectural divergence. Decide whether MCP is the accepted v2 evolution or whether the spec's backend service must be restored. Do not implement both accidentally. |
| Verification/audit | Backend verifies locally; spec expects accepted and rejected audit events | MCP middleware verifies locally; API is called for audit only after successful verification | Denials currently do not call the audit-writing API, so rejected verification events may not appear in Console as required by the spec. |
| Service/status setup | Register backend service and seed status list | Neither is explicitly done; current shipped API path is used | Confirm whether these setup steps are obsolete for the MCP-based v2 path or add equivalents. |
| Seeder behavior | Spec says fail loudly on stale/partial seeded state | Reuses an existing wallet and skips enrollment | Reconcile intentionally. For multiple personas, detect missing/mismatched partial state instead of silently accepting it. |
| Frontend structure | React components (`App`, `PersonaSwitcher`, `ChatWidget`) | Single static `web/index.html` | Component structure differs, but behavior is the important missing piece. Static HTML is acceptable only if it cleanly implements the same contract. |
| Provider support | Anthropic and OpenAI | Anthropic, OpenAI, and Azure OpenAI | Azure support is an intentional implementation extension, not a gap. Preserve it. |
| Tool-call history | Spec sketch omits an explicit assistant tool-call history entry | Implementation records it | Current implementation is stronger here; preserve this provider-correct behavior. |
| Automated tests | Manual end-to-end scenarios are specified | No tests in the example package | Add focused API/unit coverage plus a repeatable manual scenario script when implementing the gaps. |

## Original evidence before this document was actioned

- `config.ts` exports singular constants: `AGENT_NAME`,
  `AGENT_REQUESTED_SCOPES`, and one `env.walletPath`.
- `helixid-setup/seed.ts` says it enrolls "exactly one agent" and writes one
  wallet.
- `docker-compose.yml` mounts/configures `/wallets/agent.enc` for setup and the
  agent.
- `agent/server.ts` defines only `/health` and `/chat`; its chat body has no
  `personaId`.
- `agent/chat/runChatTurn.ts` accepts no persona and its tool functions accept
  only tool arguments.
- `agent/tools/bookFlight.ts` always calls `attachHelixVP` with the one
  environment-configured wallet path.
- `web/index.html` has no persona selector and posts only `message` and
  `conversationId`.
- `README.md` explicitly describes v2 as "one happy path" and directs readers
  elsewhere for persona switching and later scenarios.

## Prompt-ready implementation acceptance criteria

- Initial startup leaves at least one enrolled agent available and selected.
- `GET /personas` lists safe metadata for every currently selectable agent.
- `POST /chat` requires `{ personaId, message, conversationId }` and rejects an
  unknown or unenrolled persona with a clear 4xx error.
- Switching personas changes the wallet and credential used for the very next
  protected tool call.
- The UI visibly identifies the active agent and allows switching without a
  page/container restart.
- A runtime onboarding command or agent-side administrative route accepts a
  one-use bootstrap token plus safe persona metadata, enrolls a distinct wallet,
  registers it, and makes it appear in `GET /personas`.
- Runtime enrollment never exposes the token or wallet material through the
  public chat API or browser.
- Two agents with different scopes produce different real authorization
  outcomes for the same booking request.
- The booking tool remains visible to the restricted agent so HelixID—not UI
  filtering—produces the denial.
- Tool results, including real scope/revocation failures, return to the LLM so
  it explains the outcome rather than receiving a canned success/failure.
- Conversation history cannot silently cross persona identities.
- Existing Anthropic, OpenAI, and Azure provider support continues to work.
- Successful and rejected verification behavior is documented accurately,
  especially whether each result appears in Console audit.
- README wording is updated so it no longer claims persona switching and later
  enrollment are intentionally outside v2 once they are implemented.

## Decisions needed before coding

1. **MCP or spec backend:** Prefer keeping the current MCP architecture because
   it demonstrates `@helixid/mcp`; adapt the persona requirements to it. Restore
   the separate backend only if exact spec conformance is more important than
   the current v2 purpose.
2. **Runtime onboarding control surface:** The spec uses a CLI. A protected
   local/admin endpoint could make the UI update easier, but enrollment tokens
   must not pass through the ordinary public chat UI.
3. **Persistence model:** Decide whether later-enrolled personas survive
   restarts. Wallets can be persisted in the existing volume; persona metadata
   then also needs a small manifest or safe discovery mechanism.
4. **Initial persona count:** The user's requirement guarantees an initially
   enrolled agent, but does not require both spec personas to be pre-enrolled.
   A clean demo can start with Concierge and enroll Search Agent later, which
   visibly proves the later-enrollment flow.
5. **Switching semantics:** Prefer separate history per
   `(conversationId, personaId)` and show a system/meta line on switch. This
   prevents one agent from inheriting another agent's claims or tool context.

## Recommended target flow

1. Setup enrolls Concierge and persists its wallet plus persona metadata.
2. Agent boot loads the persona manifest and wallets into a registry.
3. Browser fetches `/personas`, selects Concierge, and includes its ID in chat.
4. Tool execution resolves Concierge's wallet and signs the MCP request.
5. An operator mints a token and invokes live onboarding for Search Agent with
   read-only scope.
6. The running agent registers Search Agent and `/personas` exposes it.
7. Browser refreshes/polls the persona list, switches to Search Agent, and sends
   a booking request.
8. The LLM attempts `book_flight`; HelixID rejects the Search Agent's real VP
   for insufficient scope; the LLM explains that real result.
9. Switching back to Concierge makes the same booking succeed.
