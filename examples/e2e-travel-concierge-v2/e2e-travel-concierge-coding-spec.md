# Coding Spec — `examples/e2e-travel-concierge`

**Audience note (read this first):** This spec is written the way I'd hand off
a ticket to someone a year into their first backend job. I'm going to over-explain
the *why* in places where I'd normally just say "trust me" — not because the code
is hard, but because this demo only works as a teaching tool if every file does
exactly one job. If you find yourself adding a second responsibility to a file
below, stop and come back to this doc — you're probably about to blur a boundary
that the whole demo depends on being sharp.

The one rule that matters more than any other in this spec:

> **Nothing that isn't `ai-agent` or `backend` ever touches a wallet, a VC, or a VP.**
> Not the frontend. Not `helixid-setup` after seeding is done. Not Console (Console
> *reads* the audit trail, it doesn't participate in trust decisions).

If a piece of code you're writing needs to import anything from `@helixid/sdk-js`
and it isn't in `ai-agent/` or `backend/`, you've made a wrong turn.

---

## 1. System overview

```
┌────────────┐   plain HTTP, no wallet/VP        ┌────────────┐
│  frontend  │ ───────────────────────────────▶  │  ai-agent  │
│ (chat UI)  │ ◀───────────────────────────────  │ (2 wallets)│
└────────────┘        { personaId, message }     └─────┬──────┘
                                                          │ signed VP
                                                          │ (local, no network
                                                          │  round trip except
                                                          │  StatusList fetch)
                                                          ▼
                                                   ┌────────────┐
                                                   │  backend   │
                                                   │ verifyVP() │
                                                   └─────┬──────┘
                                                          │ status-list check only
                                                          ▼
                                                   ┌────────────┐
                                                   │ helixid-api│
                                                   └─────┬──────┘
                                                          │ audit events
                                                          ▼
                                                   ┌────────────┐
                                                   │  console   │
                                                   └────────────┘
```

Two things to internalize before you write any code:

1. **The frontend is dumb on purpose.** It has one job: render chat, let the
   user pick a persona, send/receive messages. It does not know what a VP is.
   If you catch yourself importing SDK types into a React component, that's
   the smell.
2. **`helixid-setup` runs once, then gets out of the way.** It's not a
   service the other containers call at runtime — it's a batch job that
   exits after seeding. Don't build any runtime dependency on it.

---

## 2. Folder structure (final)

```
examples/e2e-travel-concierge/
├── docker-compose.yml
├── docker-compose.override.yml.example
├── .env.example
├── README.md
├── helixid-config/
│   ├── scopes.ts
│   ├── enrollment-policy.ts
│   └── service-registration.ts
├── helixid-setup/
│   ├── seed.ts
│   └── package.json
├── ai-agent/
│   ├── src/
│   │   ├── server.ts
│   │   ├── wallet/
│   │   │   ├── personas.ts
│   │   │   └── walletStore.ts
│   │   ├── onboarding.ts
│   │   ├── delegate.ts
│   │   ├── vp.ts
│   │   ├── tools/
│   │   │   ├── searchFlights.ts
│   │   │   └── bookFlights.ts
│   │   ├── chat/
│   │   │   ├── router.ts
│   │   │   └── llm.ts
│   │   └── cli/
│   │       └── onboardNewAgent.ts
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   └── flights.ts
│   │   ├── middleware/
│   │   │   └── verifyHelixVP.ts
│   │   └── services/
│   │       └── booking.ts
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.tsx
    │   ├── PersonaSwitcher.tsx
    │   └── ChatWidget.tsx
    └── package.json
```

Nothing here should surprise you at this point — this is the same shape we
locked in the decision log, just with files named.

---

## 3. `helixid-config/` — policy, no logic

This folder holds **data**, not behavior. If you find yourself writing an
`if` statement in here, it belongs in `helixid-setup` or `ai-agent` instead.

### `scopes.ts`

```typescript
export const SCOPES = {
  FLIGHTS_READ: 'flights:read',
  FLIGHTS_BOOK: 'flights:book',
} as const;

export type Scope = typeof SCOPES[keyof typeof SCOPES];
```

### `enrollment-policy.ts`

```typescript
export const ENROLLMENT_POLICY = {
  concierge: {
    agentName: 'concierge-agent',
    requestedScopes: [SCOPES.FLIGHTS_READ, SCOPES.FLIGHTS_BOOK],
    maxDelegationDepth: 1,
  },
  search: {
    agentName: 'search-agent',
    requestedScopes: [SCOPES.FLIGHTS_READ],
    maxDelegationDepth: 0,
  },
} as const;
```

`maxDelegationDepth: 1` on the concierge is what makes scenario 2 possible —
it's allowed to delegate exactly one level down, no further. The search
persona has `0` because it never delegates in this demo; don't be tempted to
give it a nonzero depth "for consistency." Every field in this file should be
justified by a specific scenario, not by symmetry.

### `service-registration.ts`

```typescript
export const BACKEND_SERVICE_REGISTRATION = {
  serviceName: 'travel-booking-backend',
  displayName: 'Travel Concierge Booking API',
  verifiedDomain: 'backend.internal', // matches docker-compose service name
  apiEndpoint: 'http://backend:4000',
  // publicKeyMultibase is generated at seed time, not hardcoded here —
  // see helixid-setup/seed.ts
};
```

---

## 4. `helixid-setup/` — the seeder

**Mental model:** this is a script, not a server. It runs `docker-compose up`
→ does its work → exits `0` → `docker-compose` moves on to starting
dependent services. Treat it like a database migration, not like an API.

### `seed.ts`

```typescript
import { HelixClient, AgentWallet } from '@helixid/sdk-js';
import { BACKEND_SERVICE_REGISTRATION, ENROLLMENT_POLICY } from '../helixid-config';

async function main() {
  const client = new HelixClient(process.env.HELIX_API_URL!, {
    adminApiKey: process.env.HELIX_ADMIN_API_KEY!,
  });

  // 1. Register the backend as a known service.
  //    This is the ONLY place in the whole example POST /v1/services is called.
  await client.registerService(BACKEND_SERVICE_REGISTRATION);
  //    ^ see §8 — this is a new SDK method we're adding, doesn't exist yet.

  // 2. Seed the status list.
  const statusList = await client.getStatusList('1').catch(async () => {
    return client.createStatusList({ length: 1 << 17 }); // new SDK method, implemented separately
  });

  // 3. Pre-onboard each seeded persona.
  for (const [personaId, policy] of Object.entries(ENROLLMENT_POLICY)) {
    const { bootstrapToken } = await client.createEnrollmentToken({
      agentName: policy.agentName,
      requestedScopes: policy.requestedScopes,
      maxDelegationDepth: policy.maxDelegationDepth,
    });

    const wallet = await AgentWallet.create(
      `/wallets/${personaId}.enc`,
      process.env.WALLET_PASSPHRASE!,
    );

    await client.enroll(bootstrapToken, wallet);
    // wallet now holds the issued VC on disk — ai-agent reads this file at boot.
  }

  console.log(`✅ Setup complete. Console: ${process.env.CONSOLE_URL}`);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
```

**Junior-engineer trap to avoid:** don't make `seed.ts` idempotent by wrapping
everything in try/catch-and-ignore. If re-running `docker-compose up` against
a stale volume produces silently-wrong seeded state, you'll spend an afternoon
debugging "why does the search agent have book scope" and the answer will be
"a partial seed run six commits ago." Fail loud, document `docker-compose down -v`
as the reset path in the README instead.

---

## 5. `ai-agent/` — the interesting one

This is where most of the SDK surface actually gets exercised. Break it into
five responsibilities and keep them in five files. Do not let `server.ts`
become a 400-line file that does all of this itself — that's the single
biggest way this codebase stops being readable as a teaching example.

### 5.1 `wallet/personas.ts` — persona registry

```typescript
export type PersonaId = 'concierge' | 'search';

export interface Persona {
  id: PersonaId;
  displayName: string;
  walletPath: string;
  toolNames: string[]; // which tools this persona is allowed to attempt
}

export const PERSONAS: Record<PersonaId, Persona> = {
  concierge: {
    id: 'concierge',
    displayName: 'Concierge Agent',
    walletPath: '/wallets/concierge.enc',
    toolNames: ['searchFlights', 'bookFlights'],
  },
  search: {
    id: 'search',
    displayName: 'Search Agent',
    walletPath: '/wallets/search.enc',
    toolNames: ['searchFlights', 'bookFlights'], // yes, both listed —
    // the LLM is allowed to *attempt* book; the VP gets rejected at backend.
    // This is deliberate: it's what makes scenario 1 visible. If you filter
    // bookFlights out of the search persona's tool list here, the demo
    // silently stops proving anything — the LLM just never tries, and the
    // viewer never sees a rejection happen.
  },
};
```

Read that comment twice. It's the most important design decision in this
whole file and it's easy to "fix" by accident.

### 5.2 `wallet/walletStore.ts` — loads wallets at boot, holds them in memory

```typescript
import { AgentWallet } from '@helixid/sdk-js';
import { PERSONAS, PersonaId } from './personas';

const wallets = new Map<PersonaId, AgentWallet>();

export async function loadAllWallets(): Promise<void> {
  for (const persona of Object.values(PERSONAS)) {
    const wallet = await AgentWallet.load(persona.walletPath, process.env.WALLET_PASSPHRASE!);
    wallets.set(persona.id, wallet);
  }
}

export function getWallet(personaId: PersonaId): AgentWallet {
  const w = wallets.get(personaId);
  if (!w) throw new Error(`No wallet loaded for persona: ${personaId}`);
  return w;
}

/** Scenario 2 support: register a delegated sub-agent wallet context that
 *  only exists in memory for the lifetime of the container — not persisted,
 *  not seeded, created live when the delegation scenario runs. */
export function registerEphemeralWallet(id: string, wallet: AgentWallet): void {
  wallets.set(id as PersonaId, wallet);
}
```

Note `registerEphemeralWallet` — that's how the sub-agent from scenario 2
lives "inside `ai-agent`" per the decision we made: it's just another entry
in this same map, keyed by a synthetic id like `"concierge:sub-1"`, created
on demand by `delegate.ts` below. No new process, no new wallet file on disk.

### 5.3 `vp.ts` — the only file that calls `VPBuilder`

```typescript
import { VPBuilder, AgentWallet } from '@helixid/sdk-js';

export async function signVP(
  wallet: AgentWallet,
  targetService: string,
): Promise<string> {
  const vc = wallet.getLatestCredential(); // AgentWallet.getLatestCredential()
  const vp = await new VPBuilder({
    vc,
    holderDid: wallet.getDID(),
    targetService,
  }).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`);
  return vp;
}
```

Every tool call in `tools/` routes through this one function. If you're
tempted to inline `VPBuilder` construction inside `bookFlights.ts` because
"it's just this once" — don't. The value of having one choke point is that
when someone reads this codebase to learn HelixID, there's exactly one place
to look.

### 5.4 `delegate.ts` — scenario 2

```typescript
import { delegate, AgentWallet } from '@helixid/sdk-js';
import { getWallet, registerEphemeralWallet } from './wallet/walletStore';
import { SCOPES } from '../../helixid-config';

export async function createDelegatedSubAgent(): Promise<string> {
  const parentWallet = getWallet('concierge');
  const subAgentId = `concierge:sub-${Date.now()}`;

  const subKeypair = AgentWallet.generateKeypair(); // local, no network
  const childVC = await delegate(
    {
      to: subKeypair.did,
      scopes: [SCOPES.FLIGHTS_READ], // reduced — no book scope
      expiresIn: 300, // time-boxed, 5 minutes
    },
    parentWallet,
  );

  const subWallet = AgentWallet.fromKeypairAndCredential(subKeypair, childVC);
  registerEphemeralWallet(subAgentId, subWallet);
  return subAgentId;
}
```

`AgentWallet.generateKeypair()` and `AgentWallet.fromKeypairAndCredential()`
are two more small additions to the SDK surface we don't have yet — flagged
in §8, not invented here casually. Everything else in this function is
existing surface from `public-surfaces.md`.

### 5.5 `onboarding.ts` — scenario 4 (live onboarding)

```typescript
import { AgentWallet } from '@helixid/sdk-js';
import { getClient } from './helixClient';

export async function onboardNewAgent(bootstrapToken: string, personaId: string) {
  const client = getClient();
  const walletPath = `/wallets/${personaId}.enc`;

  const { challengeId, nonce } = await client.requestOnboardingChallenge(bootstrapToken);
  const wallet = await client.completeOnboarding(
    challengeId,
    nonce,
    process.env.WALLET_PASSPHRASE!,
    walletPath,
  );

  registerEphemeralWallet(personaId, wallet);
  return wallet.getDID();
}
```

This is invoked from `cli/onboardNewAgent.ts`, which is a thin wrapper:

```typescript
#!/usr/bin/env node
import { onboardNewAgent } from '../onboarding';

const token = process.argv[2];
if (!token) {
  console.error('Usage: onboard-new-agent <bootstrapToken>');
  process.exit(1);
}

onboardNewAgent(token, `live-agent-${Date.now()}`)
  .then((did) => console.log(`✅ Enrolled: ${did}`))
  .catch((err) => { console.error(err); process.exit(1); });
```

Wired up in `ai-agent/package.json` as `npm run onboard -- <token>`, invoked
per the README as:

```bash
docker-compose exec ai-agent npm run onboard -- <bootstrapToken>
```

### 5.6 `tools/searchFlights.ts` and `tools/bookFlights.ts`

Same shape, so I'll just show one. (Full version, using the shared
`callBackend` HTTP client, is in §5.7 alongside the rest of the
backend-connection detail — shown here at the signature level so the
tool-execution loop in §5.7 makes sense before you get there.)

```typescript
import { signVP } from '../vp';
import { getWallet } from '../wallet/walletStore';
import { callBackend } from './backendClient'; // see §5.7
import type { PersonaId } from '../wallet/personas';

interface BookFlightsArgs {
  flightId: string;
  passengerName: string;
}

export async function bookFlights(personaId: PersonaId, args: BookFlightsArgs) {
  const wallet = getWallet(personaId);
  const vp = await signVP(wallet, 'travel-booking-backend');

  const result = await callBackend<{ bookingId: string }>('/v1/flights/book', {
    ...args,
    _helixVP: vp,
  });

  if (!result.ok) {
    // This is the "money shot" of scenario 1 and scenario 3. Don't swallow
    // it into a generic error — surface the rejection reason back to the LLM
    // so the chat reply can actually say *why* it failed.
    return { success: false, reason: result.reason };
  }

  return { success: true, booking: result.data };
}
```

The tool function signature takes `personaId` explicitly rather than reading
some ambient "current persona" global. This matters because scenario 2 needs
to call this same function with a sub-agent id (`"concierge:sub-1"`) that
isn't one of the two static personas — explicit parameter passing is what
makes that work without special-casing.

### 5.7 `chat/llm.ts` — the real LLM call and tool-execution loop

**This file was missing from the first draft of this spec, and it's the one
that mattered most to get right.** Everything else in `ai-agent` — wallets,
signing, delegation — is deterministic: given the same inputs, the same
thing happens every time, which is exactly what you want for a demo. This
file is the opposite. It calls a real LLM (Anthropic or OpenAI, whichever
the reader configured), and a real LLM decides *for itself*, based on the
conversation, whether to call `searchFlights`, call `bookFlights`, call
nothing, or ask a clarifying question. Nothing in `ai-agent` forces a tool
call to happen.

That non-determinism is exactly why every other file in this spec keeps its
job small and boring — if the one genuinely unpredictable piece of the
system needs debugging, you want it isolated in one file, not spread across
the codebase.

#### Tool schema (shared, provider-agnostic)

Both providers need the same tool definitions, described in a
provider-neutral shape, then translated per-provider by the adapter below.

```typescript
// chat/toolSchemas.ts
export const TOOL_SCHEMAS = [
  {
    name: 'searchFlights',
    description: 'Search available flights between two cities on a given date.',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin city or airport code' },
        destination: { type: 'string', description: 'Destination city or airport code' },
        date: { type: 'string', description: 'Travel date, YYYY-MM-DD' },
      },
      required: ['origin', 'destination', 'date'],
    },
  },
  {
    name: 'bookFlights',
    description: 'Book a specific flight by id for a named passenger.',
    parameters: {
      type: 'object',
      properties: {
        flightId: { type: 'string' },
        passengerName: { type: 'string' },
      },
      required: ['flightId', 'passengerName'],
    },
  },
] as const;
```

#### Provider adapter interface

```typescript
// chat/providers/types.ts
export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;   // set on 'tool' role messages — result of a prior call
  toolName?: string;     // set on 'tool' role messages
}

export interface ToolCallRequest {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface TextResponse {
  type: 'text';
  content: string;
}

export type LLMResponse = ToolCallRequest | TextResponse;

export interface LLMProvider {
  complete(messages: LLMMessage[]): Promise<LLMResponse>;
}
```

One interface, two implementations. This is the seam that makes
`LLM_PROVIDER=anthropic|openai` actually work — `runChatTurn` below only
ever talks to `LLMProvider`, never to a specific SDK.

```typescript
// chat/providers/anthropicProvider.ts
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_SCHEMAS } from '../toolSchemas';
import type { LLMProvider, LLMMessage, LLMResponse } from './types';

export class AnthropicProvider implements LLMProvider {
  private client = new Anthropic({ apiKey: process.env.LLM_API_KEY! });

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const res = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: toAnthropicMessages(messages),
      tools: TOOL_SCHEMAS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    });

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (toolUse) {
      return {
        type: 'tool_call',
        toolCallId: toolUse.id,
        toolName: toolUse.name,
        args: toolUse.input as Record<string, unknown>,
      };
    }

    const text = res.content.find((b) => b.type === 'text');
    return { type: 'text', content: text?.text ?? '' };
  }
}

function toAnthropicMessages(messages: LLMMessage[]) {
  // maps role: 'tool' messages into Anthropic's tool_result content blocks,
  // everything else passes through as user/assistant text blocks.
  // (implementation is mechanical — see Anthropic SDK docs for exact shape)
}
```

```typescript
// chat/providers/openaiProvider.ts
import OpenAI from 'openai';
import { TOOL_SCHEMAS } from '../toolSchemas';
import type { LLMProvider, LLMMessage, LLMResponse } from './types';

export class OpenAIProvider implements LLMProvider {
  private client = new OpenAI({ apiKey: process.env.LLM_API_KEY! });

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: toOpenAIMessages(messages),
      tools: TOOL_SCHEMAS.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const choice = res.choices[0].message;
    const toolCall = choice.tool_calls?.[0];
    if (toolCall) {
      return {
        type: 'tool_call',
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments),
      };
    }

    return { type: 'text', content: choice.content ?? '' };
  }
}

function toOpenAIMessages(messages: LLMMessage[]) {
  // maps role: 'tool' messages into OpenAI's tool-result message shape
  // (tool_call_id + name + content), everything else passes through.
}
```

```typescript
// chat/providers/index.ts
import { AnthropicProvider } from './anthropicProvider';
import { OpenAIProvider } from './openaiProvider';
import type { LLMProvider } from './types';

export function getProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic';
  if (provider === 'openai') return new OpenAIProvider();
  return new AnthropicProvider();
}
```

#### `runChatTurn` — the tool-execution loop

This is the orchestration function `chat/router.ts` calls. It owns
conversation history (in-memory, keyed by `conversationId` — fine for a
demo, don't reach for a database here), and it's the piece that connects an
LLM's tool-call decision to an actual signed request against `backend`.

```typescript
// chat/llm.ts
import { getProvider } from './providers';
import { searchFlights } from '../tools/searchFlights';
import { bookFlights } from '../tools/bookFlights';
import type { PersonaId } from '../wallet/personas';
import type { LLMMessage } from './providers/types';

const conversations = new Map<string, LLMMessage[]>();

const TOOL_IMPLS: Record<string, (personaId: PersonaId, args: any) => Promise<unknown>> = {
  searchFlights,
  bookFlights,
};

interface ChatTurnInput {
  personaId: PersonaId;
  message: string;
  conversationId: string;
}

export async function runChatTurn({ personaId, message, conversationId }: ChatTurnInput): Promise<string> {
  const history = conversations.get(conversationId) ?? [];
  history.push({ role: 'user', content: message });

  const provider = getProvider();

  // Tool-call loop: keep going until the model returns plain text.
  // Cap iterations — a real LLM misbehaving shouldn't be able to loop forever.
  for (let i = 0; i < 4; i++) {
    const response = await provider.complete(history);

    if (response.type === 'text') {
      history.push({ role: 'assistant', content: response.content });
      conversations.set(conversationId, history);
      return response.content;
    }

    // response.type === 'tool_call'
    const impl = TOOL_IMPLS[response.toolName];
    if (!impl) {
      history.push({
        role: 'tool',
        toolCallId: response.toolCallId,
        toolName: response.toolName,
        content: JSON.stringify({ error: `Unknown tool: ${response.toolName}` }),
      });
      continue;
    }

    // This is where a tool call becomes a signed VP and a real request to
    // backend — see tools/bookFlights.ts (§5.6). The result (success or a
    // 403 rejection reason) goes straight back to the model as a tool
    // result message, so the model can explain the outcome in its own words
    // rather than ai-agent hardcoding "sorry, you don't have permission" text.
    const result = await impl(personaId, response.args);
    history.push({
      role: 'tool',
      toolCallId: response.toolCallId,
      toolName: response.toolName,
      content: JSON.stringify(result),
    });
  }

  return "Sorry, I wasn't able to complete that — could you rephrase?";
}
```

Walk through what happens end to end for scenario 1: user (talking to
Search Agent) says "book me the 6:40pm flight." The model calls
`bookFlights`. `TOOL_IMPLS.bookFlights` runs (§5.6), signs a VP with the
Search Agent's wallet, POSTs to `backend`, gets back `403 INSUFFICIENT_SCOPE`.
That JSON — `{ success: false, reason: 'INSUFFICIENT_SCOPE' }` — becomes a
`tool` message appended to history, and gets fed back into the model on the
next loop iteration. The model then produces the actual chat reply, in its
own words, explaining it can't book. **`ai-agent` never writes that
rejection sentence itself — the model does, from the real tool result.**
That's the connective tissue between "an LLM decided to try something" and
"the reply the user reads reflects a real, cryptographically-enforced
decision," and it's the part that was missing when this file was left as a
black box.

#### Non-determinism — what this means for the demo, concretely

Because a real model is choosing when to call tools, vague prompts can
produce a turn where no tool call happens at all — the model asks a
clarifying question instead, or just chats. That's not a bug to fix in this
file; it's a property of using a real LLM instead of a scripted one. It does
mean the README needs **specific suggested prompts** per scenario (e.g. "Book
the 6:40pm flight to Chicago for Jane Doe") rather than "try asking it to
book something" — vague phrasing is the main way someone runs through the
demo and sees nothing happen. Add this to README §4 (Try the scenarios) when
that section gets written.

#### Connecting to `backend` — full detail

`tools/searchFlights.ts` and `tools/bookFlights.ts` are the only two places
that reach `backend`, and they should share one small HTTP client rather
than each rolling their own `fetch` — this matters for the demo because a
raw network failure (backend not up yet, wrong port) should surface as a
readable chat message, not an unhandled promise rejection that kills the
whole turn.

```typescript
// tools/backendClient.ts
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://backend:4000';

export async function callBackend<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; reason: string }> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000), // don't hang a chat turn forever
    });
  } catch (err) {
    return { ok: false, status: 0, reason: 'BACKEND_UNREACHABLE' };
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, reason: json.reason ?? 'UNKNOWN_ERROR' };
  }
  return { ok: true, data: json };
}
```

`tools/bookFlights.ts` is shown in full in §5.6 — it imports `callBackend`
from this file. `searchFlights.ts` follows the identical shape, calling
`/v1/flights/search` instead, with the persona's `flights:read`-scoped VP.

Environment variables this introduces, all of which need to land in
`.env.example`:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `chat/providers/index.ts` | `anthropic` or `openai` — already in the README, now has a concrete consumer. |
| `LLM_API_KEY` | `AnthropicProvider` / `OpenAIProvider` | Real provider key, user-supplied. |
| `BACKEND_URL` | `tools/backendClient.ts` | Defaults to the compose service name; override only needed for the local-override dev path. |

### 5.8 `chat/router.ts` — the HTTP surface `frontend` talks to

```typescript
import express from 'express';
import { PERSONAS, PersonaId } from '../wallet/personas';
import { runChatTurn } from './llm';

export const router = express.Router();

interface ChatRequestBody {
  personaId: PersonaId;
  message: string;
  conversationId: string;
}

router.post('/chat', async (req, res) => {
  const { personaId, message, conversationId } = req.body as ChatRequestBody;

  if (!PERSONAS[personaId]) {
    return res.status(400).json({ error: `Unknown persona: ${personaId}` });
  }

  const reply = await runChatTurn({ personaId, message, conversationId });
  res.json({ reply });
});

router.get('/personas', (_req, res) => {
  res.json(
    Object.values(PERSONAS).map((p) => ({ id: p.id, displayName: p.displayName })),
  );
});
```

This is the **entire contract** between `frontend` and `ai-agent`. Two
endpoints. No VP, VC, or DID ever appears in a request or response body here
— if you ever see one, something upstream leaked, and that's a bug, not a
feature.

---

## 6. `backend/`

### 6.1 `middleware/verifyHelixVP.ts`

```typescript
import { verifyVP, requireScope } from '@helixid/sdk-js';
import type { Request, Response, NextFunction } from 'express';

export function requireHelixScope(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { _helixVP } = req.body;
    if (!_helixVP) {
      return res.status(401).json({ reason: 'MISSING_VP' });
    }

    try {
      const result = await verifyVP(_helixVP, { expectedTargetService: 'travel-booking-backend' });
      requireScope(result, scope); // throws if missing
      (req as any).helixResult = result; // stash for route handler / audit
      next();
    } catch (err: any) {
      return res.status(403).json({ reason: err.code ?? 'VERIFICATION_FAILED', message: err.message });
    }
  };
}
```

### 6.2 `routes/flights.ts`

```typescript
import { Router } from 'express';
import { requireHelixScope } from '../middleware/verifyHelixVP';
import { SCOPES } from '../../../helixid-config';
import * as booking from '../services/booking';

export const router = Router();

router.post('/v1/flights/search', requireHelixScope(SCOPES.FLIGHTS_READ), async (req, res) => {
  res.json(await booking.search(req.body));
});

router.post('/v1/flights/book', requireHelixScope(SCOPES.FLIGHTS_BOOK), async (req, res) => {
  res.json(await booking.book(req.body));
});
```

Notice: **no import of `HelixClient` anywhere in `backend/`.** Per the
decision to keep registration pre-seeded-only, this package's `package.json`
doesn't even need `@helixid/sdk-js`'s client half — only `verifyVP` and
`requireScope`, both pure/local functions. That's worth calling out in a
code comment at the top of `verifyHelixVP.ts` so the next person doesn't
"helpfully" add a `HelixClient` import out of habit.

---

## 7. `frontend/`

### 7.1 API contract (this is the whole interface — memorize it, it's small)

```typescript
// GET /personas
type PersonasResponse = { id: string; displayName: string }[];

// POST /chat
type ChatRequest = { personaId: string; message: string; conversationId: string };
type ChatResponse = { reply: string };
```

### 7.2 `PersonaSwitcher.tsx`

```tsx
interface PersonaSwitcherProps {
  personas: { id: string; displayName: string }[];
  activePersonaId: string;
  onChange: (personaId: string) => void;
}

export function PersonaSwitcher({ personas, activePersonaId, onChange }: PersonaSwitcherProps) {
  return (
    <select value={activePersonaId} onChange={(e) => onChange(e.target.value)}>
      {personas.map((p) => (
        <option key={p.id} value={p.id}>{p.displayName}</option>
      ))}
    </select>
  );
}
```

### 7.3 `ChatWidget.tsx`

```tsx
interface ChatWidgetProps {
  personaId: string;
  conversationId: string;
}

export function ChatWidget({ personaId, conversationId }: ChatWidgetProps) {
  const sendMessage = async (message: string) => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaId, message, conversationId }),
    });
    const { reply } = await res.json();
    return reply;
  };
  // render loop omitted — standard chat UI, nothing HelixID-specific here.
}
```

That's genuinely it for the frontend. If your `ChatWidget.tsx` diff ever
touches anything that looks like a DID or a scope string, back up — you've
drifted into `ai-agent`'s job.

---

> **Note:** `helixid-setup/seed.ts` (§4) and `ai-agent/delegate.ts` (§5.4)
> call four SDK methods — `registerService`, `createStatusList`,
> `AgentWallet.generateKeypair()`, `AgentWallet.fromKeypairAndCredential()`
> — that don't exist in `helix-sdk-js` yet. These are being implemented
> separately; not specced here.

---

## 8. Testing the whole thing end-to-end

Manual test script, in order — this doubles as the README's "Try the
scenarios" walkthrough, so write it once and link both places rather than
maintaining two descriptions of the same steps.

1. `docker-compose up` — wait for the setup service to print the Console URL and exit `0`.
2. Open frontend, select **Search Agent**, ask it to book a flight.
   Expect: search succeeds, book attempt returns a chat reply that explains
   the rejection (not a raw 403 — the LLM should translate `INSUFFICIENT_SCOPE`
   into something readable). Check Console's audit panel — you should see one
   `vp_verification` event with `accepted: true` (search) and one with
   `accepted: false, reason: INSUFFICIENT_SCOPE` (book).
3. Switch to **Concierge Agent**, book the same flight. Expect success,
   one more `vp_verification: accepted` event in Console.
4. Trigger delegation (however you've wired the UI/CLI trigger for scenario
   2), then attempt a book call from the sub-agent persona. Expect rejection
   with a `parentVcId` visible on that audit event in Console, tying it back
   to the concierge's VC.
5. In Console, revoke the Concierge Agent's VC. Immediately retry a book
   call from that persona. Expect rejection — this should happen with zero
   code changes or restarts, purely from the status-list bit flipping.
6. Mint an enrollment token in Console, run
   `docker-compose exec ai-agent npm run onboard -- <token>`, confirm the new
   agent appears in Console's agent list within a few seconds.

If any of steps 2–6 requires you to restart a container or edit a config
file to make it work, something in the spec above has been implemented
wrong — every one of these should work purely by interacting with Console
and the running chat UI.

---

## 9. Common mistakes to watch for in review

- **VP signing creeping into `frontend/` or `backend/services/booking.ts`.**
  Signing belongs only in `ai-agent/vp.ts`. Verification belongs only in
  `backend/middleware/verifyHelixVP.ts`.
- **`helixid-setup` becoming a long-running process.** It should exit. If
  someone adds a `setInterval` or an Express server to it "just to expose
  health status," that's scope creep — `docker-compose`'s own health checks
  are enough.
- **Filtering `bookFlights` out of the Search persona's tool list.** Covered
  above, but worth repeating because it's the single most tempting "cleanup"
  that would quietly break scenario 1.
- **Backend importing `HelixClient`.** It shouldn't need to, per the
  pre-seeded-registration decision. If a future change makes this necessary,
  that's a big enough shift it should go back through the decision log, not
  get slipped into a routine PR.
