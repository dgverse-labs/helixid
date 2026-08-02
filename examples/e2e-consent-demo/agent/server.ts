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
import { AgentWallet } from '@helixid/sdk-js';
import type { SignedVC } from '@helixid/core';
import { AIRLINE, DEMO_USER_DID, HOTEL, env, spDidFor } from '../helixid-config/index.js';
import { callSpTool, ConsentDeclinedError } from './consentAwareCall.js';
import { agentPageHtml } from './web.js';
import { createToolPlanner, DeterministicPlanner, type ChatContext, type PlannerMessage } from './gemini.js';

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

async function main(): Promise<void> {
  const walletFile = join(env.walletsDir, 'travel-planner.enc');
  const wallet = await AgentWallet.load(walletFile, env.walletPassphrase);
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
  log(`wallet loaded: ${wallet.did}`);

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const sessions = new Map<string, { userDid: string; username: string }>();
  const conversationHistory = new Map<string, PlannerMessage[]>();
  const plannerInfo = { provider: planner.provider, model: planner.model };

  app.get('/', (_req, res) => res.type('html').send(agentPageHtml()));

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

  app.post('/api/plan', async (req, res) => {
    const body = req.body as { message?: string; context?: ChatContext };
    if (typeof body.message !== 'string' || !body.message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    try {
      const token = String(res.locals['agentSessionToken'] ?? '');
      const history = conversationHistory.get(token) ?? [];
      const userMessage = body.message.trim();
      const plan = await planner.plan(userMessage, body.context ?? {}, history);
      const assistantMessage =
        plan.kind === 'message'
          ? plan.message
          : `Selected ${plan.tool} with arguments ${JSON.stringify(plan.args)}.`;
      const newTurns: PlannerMessage[] = [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: assistantMessage },
      ];
      conversationHistory.set(
        token,
        [...history, ...newTurns].slice(-12),
      );
      log(`${planner.provider} planned ${plan.kind === 'tool_call' ? plan.tool : 'a text response'}`);
      res.json(plan);
    } catch (error) {
      log(`${planner.provider} planning failed: ${(error as Error).message}`);
      res.status(502).json({ error: `LLM planning failed: ${(error as Error).message}` });
    }
  });

  /** Everything the UI needs to render current authorization state. */
  app.get('/api/state', (_req, res) => {
    const grants = Object.values(SP_BY_ID).map((sp) => {
      const serviceDid = spDidFor(env.host, sp.port);
      const held = wallet.selectGrant(serviceDid, DEMO_USER_DID);
      return { sp: sp.id, displayName: sp.displayName, serviceDid, hasGrant: Boolean(held) };
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

    try {
      const result = await callSpTool({
        wallet,
        userDid: DEMO_USER_DID,
        spMcpUrl: `${baseUrl}/api/mcp`,
        serviceDid,
        toolName: body.tool,
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
          consentUrl: `${publicBaseUrl}/consent?agentDid=${encodeURIComponent(wallet.did)}&userDid=${encodeURIComponent(DEMO_USER_DID)}`,
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
