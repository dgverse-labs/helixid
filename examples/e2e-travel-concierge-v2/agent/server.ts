// agent — the HTTP surface the web app talks to.
//
// Public surface (browser): GET /personas, POST /chat, POST /onboard-agent, and
// POST /revoke-agent for the guided revocation demo. The browser may carry a
// one-time Console-generated onboarding token, but it never receives a wallet,
// VC, VP, private key, admin key, or persisted credential material.
//
// Runtime onboarding consumes a token minted by HelixID Console. This app only
// keeps local persona convenience state (manifest + encrypted wallet); HelixID
// remains the source of truth for enrollment, scopes, revocation, and audit.
import 'dotenv/config';
import express from 'express';
import { AgentWallet, HelixClient } from '@helixid/sdk-js';
import { runChatTurn } from './chat/runChatTurn.js';
import { env } from '../config.js';
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

// ── Public: consume a Console-generated token and enroll another agent ─────
interface OnboardBody {
  personaId?: string;
  displayName?: string;
  bootstrapToken?: string;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `agent-${slug || Date.now()}`;
}

function uniquePersonaId(base: string): string {
  if (!hasPersona(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!hasPersona(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

app.post('/onboard-agent', async (req, res) => {
  const { personaId, displayName, bootstrapToken } = req.body as OnboardBody;
  if (!bootstrapToken || typeof bootstrapToken !== 'string') {
    return res.status(400).json({ error: 'bootstrapToken is required' });
  }

  const resolvedDisplayName =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : `Agent ${new Date().toISOString().slice(11, 19)}`;
  const resolvedPersonaId =
    typeof personaId === 'string' && personaId.trim()
      ? personaId.trim()
      : uniquePersonaId(slugify(resolvedDisplayName));

  if (!/^[a-z][a-z0-9-]*$/.test(resolvedPersonaId)) {
    return res.status(400).json({ error: 'personaId must match ^[a-z][a-z0-9-]*$' });
  }
  if (hasPersona(resolvedPersonaId)) {
    return res.status(409).json({ error: `persona "${resolvedPersonaId}" already exists` });
  }

  try {
    const { persona, vcId, did } = await enrollPersona({
      id: resolvedPersonaId,
      displayName: resolvedDisplayName,
      scopes: [],
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

// ── Demo admin action: revoke the selected persona's real credential ───────
interface RevokeBody {
  personaId?: string;
}

app.post('/revoke-agent', async (req, res) => {
  const { personaId } = req.body as RevokeBody;
  if (!personaId || typeof personaId !== 'string') {
    return res.status(400).json({ error: 'personaId is required' });
  }

  const persona = getPersona(personaId);
  if (!persona) {
    return res.status(404).json({ error: `Unknown persona: ${personaId}` });
  }

  try {
    const wallet = await AgentWallet.load(persona.walletFile, env.walletPassphrase);
    const vc = wallet.credentials[0];
    if (!vc?.id) {
      return res.status(409).json({ error: `Persona "${personaId}" has no credential to revoke` });
    }

    const client = new HelixClient(env.helixApiUrl, { adminApiKey: env.adminApiKey });
    const result = await client.revokeVC(vc.id);
    console.log(`[Agent] Revoked persona "${persona.id}" credential ${vc.id}.`);
    return res.json({
      persona: toPublic(persona),
      vcId: vc.id,
      revoked: true,
      revokedAt: result.revokedAt ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Agent] revoke failed:', error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'revoke_failed' });
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
