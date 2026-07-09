// agent — the HTTP surface the web app talks to.
//
// Public surface (browser): GET /personas and POST /chat. Neither ever exposes a
// wallet, VC, VP, private key, or enrollment token — the browser only ever sees
// persona ids and display names.
//
// Operator surface: POST /admin/onboard, guarded by the admin key. It enrolls a
// new agent at runtime and makes it appear in /personas — no restart, no config
// edit. The enrollment token is minted server-side and never leaves this process.
import 'dotenv/config';
import express from 'express';
import { runChatTurn } from './chat/runChatTurn.js';
import { SCOPES, env } from '../config.js';
import { enrollPersona } from '../personas/enroll.js';
import { addPersona, getPersona, hasPersona, listPersonas, loadPersonas } from '../personas/store.js';
import { toPublic } from '../personas/types.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', provider: env.llmProvider }));

// ── Public: discover selectable agents (safe metadata only) ────────────────
app.get('/personas', (_req, res) => {
  res.json({ personas: listPersonas() });
});

// ── Public: chat as a selected persona ─────────────────────────────────────
interface ChatRequestBody {
  personaId?: string;
  message?: string;
  conversationId?: string;
}

app.post('/chat', async (req, res) => {
  const { personaId, message, conversationId } = req.body as ChatRequestBody;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!personaId || typeof personaId !== 'string') {
    return res.status(400).json({ error: 'personaId is required' });
  }
  const persona = getPersona(personaId);
  if (!persona) {
    return res.status(404).json({ error: `Unknown persona: ${personaId}` });
  }
  try {
    const reply = await runChatTurn({
      persona,
      message,
      conversationId: conversationId ?? 'default',
    });
    return res.json({ reply, personaId });
  } catch (error) {
    console.error('[Agent] chat turn failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'chat_failed' });
  }
});

// ── Operator: enroll another agent at runtime ──────────────────────────────
interface OnboardBody {
  personaId?: string;
  displayName?: string;
  scopes?: string[];
  bootstrapToken?: string;
}

app.post('/admin/onboard', async (req, res) => {
  const submitted = req.header('x-admin-api-key');
  if (!submitted || submitted !== env.adminApiKey) {
    return res.status(401).json({ error: 'admin key required' });
  }

  const { personaId, displayName, scopes, bootstrapToken } = req.body as OnboardBody;
  if (!personaId || !/^[a-z][a-z0-9-]*$/.test(personaId)) {
    return res.status(400).json({ error: 'personaId must match ^[a-z][a-z0-9-]*$' });
  }
  if (!displayName || typeof displayName !== 'string') {
    return res.status(400).json({ error: 'displayName is required' });
  }
  if (hasPersona(personaId)) {
    return res.status(409).json({ error: `persona "${personaId}" already exists` });
  }

  try {
    const { persona, vcId, did } = await enrollPersona({
      id: personaId,
      displayName,
      // Default a runtime-onboarded agent to search-only, so it visibly cannot book.
      scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : [SCOPES.FLIGHTS_READ],
      bootstrapToken,
    });
    await addPersona(persona);
    console.log(`[Agent] Onboarded persona "${persona.id}" (${persona.scopes.join(', ')}) DID ${did}, VC ${vcId}.`);
    return res.status(201).json({ persona: toPublic(persona) });
  } catch (error) {
    console.error('[Agent] onboard failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'onboard_failed' });
  }
});

async function start(): Promise<void> {
  await loadPersonas();
  app.listen(env.agentPort, '0.0.0.0', () => {
    console.log(
      `[Agent] Travel concierge listening on :${env.agentPort} ` +
        `(LLM_PROVIDER=${env.llmProvider}, personas: ${listPersonas().map((p) => p.id).join(', ') || 'none'}).`,
    );
  });
}

start().catch((error: unknown) => {
  console.error('[Agent] failed to start:', error);
  process.exit(1);
});
