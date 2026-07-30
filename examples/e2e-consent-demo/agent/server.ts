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
// NOTE: this is a deterministic HTTP driver, not an LLM chat loop. See the
// README — the conversational shell from e2e-travel-concierge is not ported.

import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { AgentWallet } from '@helixid/sdk-js';
import type { SignedVC } from '@helixid/core';
import { AIRLINE, DEMO_USER_DID, HOTEL, env, spDidFor } from '../helixid-config/index.js';
import { callSpTool, ConsentDeclinedError } from './consentAwareCall.js';

const SP_BY_ID = { airline: AIRLINE, hotel: HOTEL } as const;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [agent] ${message}`);
}

async function main(): Promise<void> {
  const walletFile = join(env.walletsDir, 'travel-planner.enc');
  const wallet = await AgentWallet.load(walletFile, env.walletPassphrase);
  log(`wallet loaded: ${wallet.did}`);

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agentDid: wallet.did, userDid: DEMO_USER_DID });
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
    const body = req.body as { sp?: 'airline' | 'hotel'; tool?: string; args?: Record<string, unknown> };
    const sp = body.sp ? SP_BY_ID[body.sp] : undefined;
    if (!sp || !body.tool) {
      res.status(400).json({ error: 'sp and tool are required' });
      return;
    }

    const serviceDid = spDidFor(env.host, sp.port);
    const baseUrl = `http://${env.host}:${sp.port}`;

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
        log(`${body.tool} succeeded (consentPrompted=${result.consentPrompted})`);
        res.json({ status: 'ok', data: result.data, reusedStandingGrant: !result.consentPrompted });
        return;
      }
      res.json({ status: 'error', error: result.error });
    } catch (error) {
      if (error instanceof ConsentDeclinedError) {
        res.json({
          status: 'consent_required',
          sp: sp.id,
          serviceDid,
          consentUrl: `${baseUrl}/consent?agentDid=${encodeURIComponent(wallet.did)}&userDid=${encodeURIComponent(DEMO_USER_DID)}`,
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
