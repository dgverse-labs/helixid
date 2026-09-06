// Travel Planner Agent.
//
// The agent holds a wallet and calls SP tools. It has no consent logic of its
// own: when an SP answers "not without a grant", the agent hands the user off
// to that SP's consent page and waits for the grant to come back.
//
// How the grant reaches the wallet in the browser flow:
//   1. POST /api/call     -> { status: 'consent_required', consentUrl }
//   2. the UI opens consentUrl (the SP's own page, on the SP's own origin)
//   3. the page posts the signed grant back via postMessage
//   4. the UI forwards it to POST /api/grants, which stores it in the wallet
//   5. the UI retries POST /api/call, which now finds the grant and succeeds
//
// Step 5 of the demo flow short-circuits all of that: /api/call finds the
// existing standing grant on the first attempt.
//
// Tool planning is provider-neutral: Gemini, OpenAI, or Anthropic when a key
// is configured, with a deterministic scripted fallback when it is not.

import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AgentWallet, HelixClient } from '@helixid/sdk-js';
import type { SignedVC } from '@helixid/sdk-js';
import { AIRLINE, DEMO_USER_DID, HOTEL, env, spDidFor } from '../helixid-config/index.js';
import { callSpTool, ConsentDeclinedError } from './consentAwareCall.js';
import { agentPageHtml } from './web.js';
import {
  createToolPlanner,
  DeterministicPlanner,
  describePlanForHistory,
  phraseQuestion,
  ToolValidationError,
  type ChatContext,
  type PlannerMessage,
} from './gemini.js';
import {
  cityLabel,
  extractSlots,
  mentionsBookingConfirmation,
  mentionsFlight,
  mentionsTripPlanning,
  nextFlightQuestion,
  nextHotelQuestion,
  nextReturnQuestion,
  resolveTrack,
  summariseProfile,
  type ConversationTrack,
  type TripProfile,
} from './conversation.js';

const SP_BY_ID = { airline: AIRLINE, hotel: HOTEL } as const;
const AGENT_USERNAME = 'traveler';
const AGENT_PASSWORD = 'demo123';

function cookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((pair) => pair.length === 2),
  );
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [agent] ${message}`);
}

/** What the agent already knows, in the plain words a rewrite can reuse. */
function knownFacts(profile: TripProfile): Record<string, string | number> {
  const known: Record<string, string | number> = {};
  if (profile.origin) known['flyingFrom'] = cityLabel(profile.origin);
  if (profile.destination) known['flyingTo'] = cityLabel(profile.destination);
  if (profile.departureDate) known['departureDate'] = profile.departureDate;
  if (profile.returnDate) known['returnDate'] = profile.returnDate;
  if (profile.travelers) known['travellers'] = profile.travelers;
  if (profile.airlinePreference) known['airline'] = profile.airlinePreference;
  if (profile.hotelBudget) known['nightlyBudget'] = profile.hotelBudget;
  return known;
}

async function main(): Promise<void> {
  const walletFile = join(env.walletsDir, 'travel-planner.enc');
  // The client is attached purely so the wallet can emit CONSENT_GRANTED to
  // helix-api when a grant lands. Audit is best-effort — if helix-api is down
  // the grant still stores and the demo still runs.
  const wallet = await AgentWallet.load(
    walletFile,
    env.walletPassphrase,
    new HelixClient(env.helixApiUrl, { adminApiKey: env.adminApiKey }),
  );
  const defaultModels = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-5',
  } as const;
  const planner = env.llmApiKey
    ? createToolPlanner({
        provider: env.llmProvider,
        apiKey: env.llmApiKey,
        model: env.llmModel || defaultModels[env.llmProvider],
      })
    : new DeterministicPlanner();
  // Always available, whatever the configured provider is doing.
  const fallbackPlanner = new DeterministicPlanner();
  log(`wallet loaded: ${wallet.did}`);

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const sessions = new Map<string, { userDid: string; username: string }>();
  const conversationHistory = new Map<string, PlannerMessage[]>();
  /** What the agent has gathered about the trip, per signed-in session. */
  const tripProfiles = new Map<string, TripProfile>();
  const plannerInfo = { provider: planner.provider, model: planner.model };

  // The page only accepts postMessage from these exact origins — the two SP
  // consent popups — so a stray window cannot inject a forged grant.
  const spOrigins = Object.values(SP_BY_ID).map((sp) => `http://${env.host}:${sp.port}`);

  app.get('/', (_req, res) => res.type('html').send(agentPageHtml(spOrigins)));

  app.get('/api/session', (req, res) => {
    const session = sessions.get(cookies(req.headers.cookie)['agent_session'] ?? '');
    res.json(session ? { authenticated: true, ...session, agentDid: wallet.did, planner: plannerInfo } : { authenticated: false, planner: plannerInfo });
  });

  app.post('/api/login', (req, res) => {
    const body = req.body as { username?: string; password?: string };
    if (body.username !== AGENT_USERNAME || body.password !== AGENT_PASSWORD) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    const token = randomUUID();
    sessions.set(token, { username: AGENT_USERNAME, userDid: DEMO_USER_DID });
    conversationHistory.set(token, []);
    res.setHeader('set-cookie', `agent_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    res.json({ authenticated: true, username: AGENT_USERNAME, userDid: DEMO_USER_DID, agentDid: wallet.did, planner: plannerInfo });
  });

  app.post('/api/logout', (req, res) => {
    const token = cookies(req.headers.cookie)['agent_session'] ?? '';
    sessions.delete(token);
    conversationHistory.delete(token);
    res.setHeader('set-cookie', 'agent_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.status(204).end();
  });

  app.use('/api', (req, res, next) => {
    if (req.path === '/login' || req.path === '/session') return next();
    const token = cookies(req.headers.cookie)['agent_session'] ?? '';
    const session = sessions.get(token);
    if (!session) {
      res.status(401).json({ error: 'Please log in to the demo agent' });
      return;
    }
    res.locals['agentSessionToken'] = token;
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentDid: wallet.did, userDid: DEMO_USER_DID, llm: plannerInfo });
  });

  /** Appends one exchange to the rolling planner history. */
  function recordTurn(
    token: string,
    history: PlannerMessage[],
    userMessage: string,
    plan: Parameters<typeof describePlanForHistory>[0],
  ): void {
    conversationHistory.set(
      token,
      [
        ...history,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: describePlanForHistory(plan) },
      ].slice(-12) as PlannerMessage[],
    );
  }

  app.post('/api/plan', async (req, res) => {
    const body = req.body as {
      message?: string;
      context?: ChatContext;
      /** Set when the message is a direct answer to the agent's last question. */
      answering?: boolean;
      /** Which search the conversation is currently gathering for. */
      track?: ConversationTrack;
    };
    if (typeof body.message !== 'string' || !body.message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const token = String(res.locals['agentSessionToken'] ?? '');
    const history = conversationHistory.get(token) ?? [];
    const userMessage = body.message.trim();
    const context = body.context ?? {};

    // ── Conversational gathering ────────────────────────────────────────
    // A real assistant collects what it needs before acting. Slot-filling is
    // resolved here rather than inside a planner so the agent asks the same
    // questions in the same order with or without a model provider — the LLM
    // still handles booking confirmations and free-form chat below.
    const answeringSlot = body.answering === true;
    // Which leg we are on has to be settled before the message is read, because
    // it decides where a bare date lands. See resolveTrack().
    const track = resolveTrack({
      message: userMessage,
      answering: answeringSlot,
      ...(body.track ? { track: body.track } : {}),
    });
    const returning = track === 'return';

    const profile = extractSlots(userMessage, tripProfiles.get(token) ?? {}, { forReturn: returning });
    tripProfiles.set(token, profile);

    const wantsHotel = track === 'hotel';
    const wantsFlight = mentionsFlight(userMessage) || mentionsTripPlanning(userMessage) || returning;
    // Confirming a specific offered option is a booking, never a new search —
    // otherwise "book flight HA733" would re-run the flight search forever.
    const confirmingOption = mentionsBookingConfirmation(userMessage);
    const searchIntent = !confirmingOption && (wantsHotel || wantsFlight || answeringSlot);

    if (searchIntent) {
      const question = track === 'hotel'
        ? nextHotelQuestion(profile)
        : track === 'return'
          ? nextReturnQuestion(profile)
          : nextFlightQuestion(profile);

      if (question) {
        // The engine picked the question; the model only says it better. If the
        // provider is slow or down, phraseQuestion returns the engine's own
        // wording, so the conversation is identical either way.
        const spoken = await phraseQuestion(planner, {
          question: question.question,
          suggestions: question.suggestions,
          known: knownFacts(profile),
        });
        // Worth saying out loud: a silent fallback looks identical to a working
        // rewrite, and on a rate-limited key that is the difference between the
        // agent sounding written and sounding scripted.
        log(
          spoken === question.question
            ? `asking ${question.field} in the engine's own words`
            : `asking ${question.field}, reworded by ${planner.provider}`,
        );
        const ask = {
          kind: 'ask' as const,
          field: question.field,
          message: spoken,
          suggestions: question.suggestions,
        };
        recordTurn(token, history, userMessage, ask);
        res.json({
          ...ask,
          planner: plannerInfo,
          profile,
          summary: summariseProfile(profile),
          track,
        });
        return;
      }

      // Everything needed is known — run the search the user actually asked for.
      const toolPlan = track === 'hotel'
        ? {
            kind: 'tool_call' as const,
            tool: 'search_hotels' as const,
            args: {
              city: profile.destination!,
              maxNightlyRate: String(profile.hotelBudget ?? 0),
              guests: String(profile.travelers ?? 1),
            },
          }
        : {
            kind: 'tool_call' as const,
            tool: 'search_flights' as const,
            args: track === 'return'
              ? {
                  origin: profile.destination!,
                  destination: profile.origin!,
                  departureDate: profile.returnDate!,
                  travelers: String(profile.travelers ?? 1),
                  carrier: profile.airlinePreference ?? 'any',
                }
              : {
                  origin: profile.origin!,
                  destination: profile.destination!,
                  departureDate: profile.departureDate!,
                  travelers: String(profile.travelers ?? 1),
                  carrier: profile.airlinePreference ?? 'any',
                },
          };

      recordTurn(token, history, userMessage, toolPlan);
      log(`gathered details, searching ${toolPlan.tool}`);
      // The track goes back on searches too, so the page never keeps asking
      // against a leg the conversation has already moved off.
      res.json({ ...toolPlan, planner: plannerInfo, profile, summary: summariseProfile(profile), track });
      return;
    }

    let plan: Awaited<ReturnType<typeof planner.plan>>;
    let usedPlanner = plannerInfo;
    try {
      plan = await planner.plan(userMessage, context, history);
    } catch (error) {
      if (error instanceof ToolValidationError) {
        // The model was understood and refused — tell the user plainly rather
        // than retrying somewhere else or leaking a stack trace into chat.
        log(`rejected a planned tool call: ${error.message}`);
        plan = { kind: 'message', message: `${error.message}. Could you restate what you'd like?` };
      } else {
        // The provider itself is unavailable (quota, outage, network). The demo
        // must keep working: fall back to the deterministic planner, which
        // drives the identical validated tool-call and consent path.
        log(`${planner.provider} unavailable, falling back to the scripted planner: ${(error as Error).message}`);
        try {
          plan = await fallbackPlanner.plan(userMessage, context, history);
          usedPlanner = { provider: fallbackPlanner.provider, model: fallbackPlanner.model };
        } catch (fallbackError) {
          const message =
            fallbackError instanceof ToolValidationError
              ? fallbackError.message
              : 'I could not work out what to do next.';
          plan = { kind: 'message', message: `${message}. Could you restate what you'd like?` };
          usedPlanner = { provider: fallbackPlanner.provider, model: fallbackPlanner.model };
        }
      }
    }

    recordTurn(token, history, userMessage, plan);
    log(`${usedPlanner.provider} planned ${plan.kind === 'tool_call' ? plan.tool : 'a text response'}`);
    res.json({
      ...plan,
      planner: usedPlanner,
      profile: tripProfiles.get(token) ?? {},
      summary: summariseProfile(tripProfiles.get(token) ?? {}),
    });
  });

  /** Everything the UI needs to render current authorization state. */
  app.get('/api/state', (_req, res) => {
    const grants = Object.values(SP_BY_ID).map((sp) => {
      const serviceDid = spDidFor(env.host, sp.port);
      const held = wallet.selectGrant(serviceDid, DEMO_USER_DID);
      // Surface the actual granted scopes and durability so the UI can show
      // what the user consented to, not just that they consented.
      const subject = held
        ? ((JSON.parse(held.vcJson) as { credentialSubject?: { scopes?: string[]; durability?: string } })
            .credentialSubject ?? {})
        : {};
      return {
        sp: sp.id,
        displayName: sp.displayName,
        serviceDid,
        hasGrant: Boolean(held),
        scopes: subject.scopes ?? [],
        durability: subject.durability ?? null,
      };
    });
    res.json({ agentDid: wallet.did, userDid: DEMO_USER_DID, grants });
  });

  app.post('/api/call', async (req, res) => {
    const body = req.body as {
      sp?: 'airline' | 'hotel';
      tool?: string;
      args?: Record<string, unknown>;
      /** Observability only. The SP still authorizes exclusively from the VP. */
      authorizationSource?: 'fresh_consent';
    };
    const sp = body.sp ? SP_BY_ID[body.sp] : undefined;
    if (!sp || !body.tool) {
      res.status(400).json({ error: 'sp and tool are required' });
      return;
    }

    const serviceDid = spDidFor(env.host, sp.port);
    // The MCP URL may use a compose-internal hostname, while the consent URL
    // returned to the browser must remain on localhost.
    const baseUrl = sp.id === 'airline' ? env.airlineUrl : env.hotelUrl;
    const publicBaseUrl = `http://${env.host}:${sp.port}`;

    // One id per user-initiated action, so the SP's presentation /
    // verification / authorization / invocation events all stitch back to it.
    const correlationId = `act_${randomUUID().slice(0, 12)}`;

    try {
      const result = await callSpTool({
        wallet,
        userDid: DEMO_USER_DID,
        spMcpUrl: `${baseUrl}/api/mcp`,
        serviceDid,
        toolName: body.tool,
        correlationId,
        ...(body.args !== undefined ? { args: body.args } : {}),
        // In the browser flow the agent does not resolve consent itself — it
        // reports back where the user must go, and the UI drives the handoff.
        onConsentRequired: async (prompt) => {
          log(`consent required for ${body.tool} at ${prompt.serviceDid}`);
          return null;
        },
      });

      if (result.ok) {
        const protectedTool = Boolean(
          sp.tools.find((tool) => tool.name === body.tool)?.metadata?.requiredScope,
        );
        const authorizationSource = protectedTool
          ? body.authorizationSource === 'fresh_consent'
            ? 'fresh_consent'
            : 'standing_grant'
          : 'not_required';
        log(`${body.tool} succeeded (authorizationSource=${authorizationSource})`);
        res.json({ status: 'ok', data: result.data, authorizationSource });
        return;
      }
      res.json({ status: 'error', error: result.error });
    } catch (error) {
      if (error instanceof ConsentDeclinedError) {
        res.json({
          status: 'consent_required',
          sp: sp.id,
          serviceDid,
          consentUrl: `${publicBaseUrl}/consent?agentDid=${encodeURIComponent(wallet.did)}&userDid=${encodeURIComponent(DEMO_USER_DID)}&correlationId=${encodeURIComponent(correlationId)}`,
          correlationId,
        });
        return;
      }
      res.status(500).json({ status: 'error', error: { message: (error as Error).message } });
    }
  });

  /** Receives a grant the SP's consent page issued, and stores it. */
  app.post('/api/grants', async (req, res) => {
    const body = req.body as { grantVC?: SignedVC };
    if (!body.grantVC) {
      res.status(400).json({ error: 'grantVC is required' });
      return;
    }
    try {
      await wallet.addCredential(body.grantVC);
      log(`stored grant ${body.grantVC.id} from ${body.grantVC.issuer}`);
      res.status(201).json({ stored: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.listen(env.agentPort, '0.0.0.0', () => {
    log(`Travel Planner Agent listening on :${env.agentPort}`);
    log(`agent DID ${wallet.did}`);
    log(`acting for ${DEMO_USER_DID}`);
  });
}

main().catch((error: unknown) => {
  console.error('[agent] failed to start:', error);
  process.exit(1);
});
