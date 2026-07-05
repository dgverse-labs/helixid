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
persona has `0` because it never delegates in this demo. Every field in
this file should be justified by a specific scenario, not by symmetry.

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

  await client.registerService(BACKEND_SERVICE_REGISTRATION);
  //    ^ see §8 — flagged as a new SDK method, not implemented at spec time.

  const statusList = await client.getStatusList('1').catch(async () => {
    return client.createStatusList({ length: 1 << 17 }); // also flagged, §8
  });

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
  }

  console.log(`✅ Setup complete. Console: ${process.env.CONSOLE_URL}`);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
```

**Junior-engineer trap to avoid:** don't make `seed.ts` idempotent by wrapping
everything in try/catch-and-ignore. Fail loud, document `docker-compose down -v`
as the reset path in the README instead.

---

## 5. `ai-agent/` — the interesting one

Break it into five responsibilities and keep them in five files. Do not let
`server.ts` become a 400-line file that does all of this itself.

### 5.1 `wallet/personas.ts` — persona registry

```typescript
export type PersonaId = 'concierge' | 'search';

export interface Persona {
  id: PersonaId;
  displayName: string;
  walletPath: string;
  toolNames: string[];
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
    // This is deliberate: it's what makes scenario 1 visible. Filtering
    // bookFlights out here silently kills the demo's rejection proof.
  },
};
```

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
 *  only exists in memory for the lifetime of the container. */
export function registerEphemeralWallet(id: string, wallet: AgentWallet): void {
  wallets.set(id as PersonaId, wallet);
}
```

### 5.3 `vp.ts` — the only file that calls `VPBuilder`

```typescript
import { VPBuilder, AgentWallet } from '@helixid/sdk-js';

export async function signVP(
  wallet: AgentWallet,
  targetService: string,
): Promise<string> {
  const vc = wallet.getLatestCredential();
  const vp = await new VPBuilder({
    vc,
    holderDid: wallet.getDID(),
    targetService,
  }).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`);
  return vp;
}
```

Every tool call in `tools/` routes through this one function. One choke
point, one place to look.

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
were flagged in §8 as not yet implemented at spec time.

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

Invoked via `cli/onboardNewAgent.ts`:

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

```bash
docker-compose exec ai-agent npm run onboard -- <bootstrapToken>
```

### 5.6 `tools/searchFlights.ts` and `tools/bookFlights.ts`

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
    // The "money shot" of scenario 1 and scenario 3 — surface the real
    // rejection reason to the LLM, don't swallow it into a generic error.
    return { success: false, reason: result.reason };
  }

  return { success: true, booking: result.data };
}
```

`personaId` is passed explicitly rather than read from an ambient global —
this is what lets scenario 2 call this same function with a sub-agent id.

### 5.7 `chat/llm.ts` — the real LLM call and tool-execution loop

Everything else in `ai-agent` is deterministic. This file is the opposite:
a real LLM decides, based on the conversation, whether to call
`searchFlights`, call `bookFlights`, call nothing, or ask a clarifying
question.

#### Tool schema

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
  toolCallId?: string;
  toolName?: string;
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

  for (let i = 0; i < 4; i++) {
    const response = await provider.complete(history);

    if (response.type === 'text') {
      history.push({ role: 'assistant', content: response.content });
      conversations.set(conversationId, history);
      return response.content;
    }

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

**`ai-agent` never writes the rejection sentence itself — the model does,
from the real tool result.** That's the connective tissue between "an LLM
decided to try something" and "the reply the user reads reflects a real,
cryptographically-enforced decision."

#### Non-determinism — what this means for the demo, concretely

Vague prompts can produce a turn where no tool call happens at all. The
README needs specific suggested prompts per scenario (e.g. "Book the 6:40pm
flight to Chicago for Jane Doe") rather than "try asking it to book
something."

#### Connecting to `backend`

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
      signal: AbortSignal.timeout(10_000),
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

Env vars, all landing in `.env.example`:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `chat/providers/index.ts` | `anthropic` or `openai`. |
| `LLM_API_KEY` | `AnthropicProvider` / `OpenAIProvider` | Real provider key, user-supplied. |
| `BACKEND_URL` | `tools/backendClient.ts` | Defaults to the compose service name. |

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

Entire contract between `frontend` and `ai-agent`. Two endpoints. No VP, VC,
or DID ever appears in a request or response body here.

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
      (req as any).helixResult = result;
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

**No import of `HelixClient` anywhere in `backend/`.** Only `verifyVP` and
`requireScope`, both pure/local functions.

---

## 7. `frontend/`

### 7.1 API contract

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

---

> **Note (verify against current repo state, not this doc):**
> `helixid-setup/seed.ts` (§4) and `ai-agent/delegate.ts` (§5.4) call four
> SDK methods — `registerService`, `createStatusList`,
> `AgentWallet.generateKeypair()`, `AgentWallet.fromKeypairAndCredential()`
> — that did **not** exist in `@helixid/sdk-js` at the time this spec was
> written. Confirm current status against `~/helixid-sdk` before assuming
> either state.

---

## 8. Testing the whole thing end-to-end

1. `docker-compose up` — wait for the setup service to print the Console URL and exit `0`.
2. Open frontend, select **Search Agent**, ask it to book a flight.
   Expect: search succeeds, book attempt returns a chat reply that explains
   the rejection (not a raw 403). Check Console's audit panel — one
   `vp_verification` event with `accepted: true` (search) and one with
   `accepted: false, reason: INSUFFICIENT_SCOPE` (book).
3. Switch to **Concierge Agent**, book the same flight. Expect success, one
   more `vp_verification: accepted` event in Console.
4. Trigger delegation, then attempt a book call from the sub-agent persona.
   Expect rejection with a `parentVcId` visible on that audit event.
5. In Console, revoke the Concierge Agent's VC. Immediately retry a book
   call from that persona. Expect rejection with zero code changes or
   restarts — purely from the status-list bit flipping.
6. Mint an enrollment token in Console, run
   `docker-compose exec ai-agent npm run onboard -- <token>`, confirm the
   new agent appears in Console's agent list within a few seconds.

If any of steps 2–6 requires restarting a container or editing config to
work, something in this spec has been implemented wrong.

---

## 9. Common mistakes to watch for in review

- **VP signing creeping into `frontend/` or `backend/services/booking.ts`.**
  Signing belongs only in `ai-agent/vp.ts`. Verification belongs only in
  `backend/middleware/verifyHelixVP.ts`.
- **`helixid-setup` becoming a long-running process.** It should exit.
- **Filtering `bookFlights` out of the Search persona's tool list.** The
  single most tempting "cleanup" that would quietly break scenario 1.
- **Backend importing `HelixClient`.** It shouldn't need to, per the
  pre-seeded-registration decision.
