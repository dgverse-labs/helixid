// One Service Provider app. Both demo SPs are this same shape — only the tool
// catalog and scope strings differ (Epic 5 Part C).
//
// This single app owns all four SP responsibilities:
//   C1  POST /api/mcp                    MCP endpoint (tools/list + tools/call)
//   C2  GET  /api/consent/scopes         scope resolution for the widget
//   C3  POST /api/consent/accept         grant issuance — signs with the SP's key
//   C4  the booking handlers behind C1's scope gate
//
// plus the two artifacts an SP must host for anyone to verify its grants:
//   GET /.well-known/did.json            its did:web document
//   GET /status-list/1                   its Bitstring status list
//
// The SP's private key lives only in this process. The browser never sees it;
// grant signing happens exclusively inside POST /api/consent/accept.

import express, { type Express, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  buildDIDDocument,
  issueGrant,
  verifyVP,
  type SignedVC,
  type SignedVP,
} from '@helixid/core';
import { resolveConsentScopes } from '@helixid/widget/server';
import type { SpDefinition } from '../helixid-config/index.js';
import { statusListUrlFor } from '../helixid-config/index.js';
import type { SpStore } from './store.js';

export interface SpIssuer {
  did: string;
  privateKeyHex: string;
  publicKeyHex: string;
}

export interface SpAppOptions {
  definition: SpDefinition;
  issuer: SpIssuer;
  /** Public base URL this SP is reachable at — must match its did:web host. */
  baseUrl: string;
  store: SpStore;
  /**
   * Where this SP's own MCP endpoint lives, for the scope resolver to read
   * tool metadata from. Defaults to this app's own /api/mcp.
   */
  mcpServerUrl?: string;
  /** Absolute path to @helixid/widget's dist, served to the consent page. */
  widgetDistPath?: string;
}

/** Test-visible counters. Part D's step-5 assertion reads these. */
export interface SpCounters {
  /** Times issueGrant() actually ran (i.e. POST /api/consent/accept succeeded). */
  grantsIssued: number;
  /** Times the widget resolved its scope catalog — one per consent render. */
  scopeResolutions: number;
  /** Times a tool call was refused for want of a grant. */
  consentRequired: number;
}

export interface SpApp {
  app: Express;
  counters: SpCounters;
  definition: SpDefinition;
  issuerDid: string;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function jsonRpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

export function createSpApp(options: SpAppOptions): SpApp {
  const { definition, issuer, baseUrl, store } = options;
  const statusListUrl = statusListUrlFor(baseUrl);
  const mcpServerUrl = options.mcpServerUrl ?? `${baseUrl}/api/mcp`;

  const counters: SpCounters = { grantsIssued: 0, scopeResolutions: 0, consentRequired: 0 };

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const log = (message: string): void => {
    console.log(`[${new Date().toISOString()}] [${definition.id}] ${message}`);
  };

  // ── Hosted identity artifacts ──────────────────────────────────────────
  // Both are required for anyone to verify a grant this SP issued: the DID
  // document to check its signature, the status list to check revocation.

  app.get('/.well-known/did.json', (_req, res) => {
    res.json(buildDIDDocument(issuer.did, issuer.publicKeyHex));
  });

  app.get('/status-list/:listId', (_req, res) => {
    res.json(store.getStatusList());
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      sp: definition.id,
      did: issuer.did,
      statusListUrl,
      tools: definition.tools.map((tool) => tool.name),
    });
  });

  // ── C2: scope resolution for the consent widget ────────────────────────

  app.get('/api/consent/scopes', async (req: Request, res: Response) => {
    // `agentDid` is retained for AUDIT CORRELATION only. It is deliberately NOT
    // passed into resolveConsentScopes() and must not affect the returned
    // catalog: this SP advertises its full scope catalog to every agent. Do not
    // delete this parameter as "unused" — the route contract requires it, and
    // Part H's "full catalog regardless of agentDid" assertion depends on it
    // staying. (Register D4. The audit sink it will correlate into is parked
    // under D2 and does not exist yet.)
    const agentDid = String(req.query['agentDid'] ?? '');
    log(`consent scopes requested (agentDid=${agentDid || 'none'})`);

    counters.scopeResolutions += 1;
    try {
      const scopeOptions = await resolveConsentScopes({
        mcpServerUrl,
        curatedFallback: definition.curatedFallback,
      });
      res.json({ scopeOptions });
    } catch (error) {
      res.status(500).json({
        error: { code: 'SCOPE_RESOLUTION_FAILED', message: (error as Error).message },
      });
    }
  });

  // ── C3: grant issuance ─────────────────────────────────────────────────

  app.post('/api/consent/accept', async (req: Request, res: Response) => {
    const body = req.body as {
      agentDid?: string;
      userDid?: string;
      scopes?: string[];
      durability?: 'standing' | 'session';
    };

    if (!body.agentDid || !body.userDid || !Array.isArray(body.scopes) || !body.durability) {
      res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'agentDid, userDid, scopes and durability are required' },
      });
      return;
    }

    try {
      // The SP signs with its own key, in this process. This is the custodial
      // boundary: the browser posts a selection, never a signature.
      const { grantVC, updatedStatusList } = await issueGrant(
        {
          agentDid: body.agentDid,
          userDid: body.userDid,
          scopes: body.scopes,
          durability: body.durability,
          serviceDid: issuer.did,
          statusList: store.getStatusList(),
          statusListCredentialUrl: statusListUrl,
        },
        { did: issuer.did, privateKeyHex: issuer.privateKeyHex },
      );

      // Persist BOTH — the grant so this SP can revoke by VC later, the status
      // list so the allocated index survives a restart.
      await store.recordGrant(
        {
          grantVC,
          agentDid: body.agentDid,
          userDid: body.userDid,
          scopes: body.scopes,
          durability: body.durability,
          issuedAt: new Date().toISOString(),
        },
        updatedStatusList,
      );

      counters.grantsIssued += 1;
      log(`grant issued to ${body.agentDid} for ${body.userDid} [${body.scopes.join(', ')}]`);
      res.status(201).json({ grantVC });
    } catch (error) {
      res.status(500).json({
        error: { code: 'GRANT_ISSUANCE_FAILED', message: (error as Error).message },
      });
    }
  });

  // ── C1 + C4: MCP endpoint and the booking handlers behind it ───────────

  app.post('/api/mcp', async (req: Request, res: Response) => {
    const rpc = req.body as JsonRpcRequest;

    if (rpc.method === 'tools/list') {
      // Shape the scope resolver reads: name/description plus optional
      // metadata.requiredScope. Search tools carry none (register D7).
      res.json(
        jsonRpcResult(rpc.id, {
          tools: definition.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            ...(tool.metadata !== undefined ? { metadata: tool.metadata } : {}),
          })),
        }),
      );
      return;
    }

    if (rpc.method !== 'tools/call') {
      res.json(jsonRpcError(rpc.id, -32601, `Method not found: ${String(rpc.method)}`));
      return;
    }

    const toolName = rpc.params?.name ?? '';
    const args = rpc.params?.arguments ?? {};
    const tool = definition.tools.find((entry) => entry.name === toolName);
    if (!tool) {
      res.json(jsonRpcError(rpc.id, -32602, `Unknown tool: ${toolName}`));
      return;
    }

    const requiredScope = tool.metadata?.requiredScope;

    // Open, read-only tools run with no presentation and no scope check.
    // This is what guarantees step 2 of the demo never prompts for consent.
    if (!requiredScope) {
      log(`OPEN    ${toolName}`);
      res.json(jsonRpcResult(rpc.id, { structuredContent: runTool(toolName, args, 'anonymous') }));
      return;
    }

    const vp = args['_helixVP'] as SignedVP | undefined;
    if (!vp) {
      counters.consentRequired += 1;
      log(`DENIED  ${toolName}  no presentation supplied`);
      res.json(
        jsonRpcError(rpc.id, -32001, 'Consent required', {
          code: 'CONSENT_REQUIRED',
          reason: 'NO_PRESENTATION',
          requiredScope,
          serviceDid: issuer.did,
          consentUrl: `${baseUrl}/consent`,
        }),
      );
      return;
    }

    let effectiveScopes: string[];
    let agentDid: string;
    try {
      // One verification implementation: helix-core's verifyVP. It checks the
      // agent VC, the grant (agent-match AND user-match), both signatures, both
      // validity windows, and revocation — failing closed on any of them.
      const result = await verifyVP(vp, { expectedTargetService: issuer.did });
      effectiveScopes = result.effectiveScopes;
      agentDid = result.agentDid;
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'VP_VERIFICATION_FAILED';
      log(`DENIED  ${toolName}  verification failed (${code})`);
      res.json(
        jsonRpcError(rpc.id, -32002, 'Presentation could not be verified', {
          code: 'VP_INVALID',
          reason: code,
        }),
      );
      return;
    }

    // A scoped tool at this SP requires the End User's consent, which means a
    // grant THIS SP issued must actually be in the presentation.
    //
    // Checking effectiveScopes alone is not sufficient and it is worth being
    // explicit about why: per the VP design, effectiveScopes collapses to the
    // agent's own privilegeScopes when no grant is present, and the agent VC
    // must itself carry `book:flights` for a grant to have any effect (the
    // intersection is bounded by the agent's ceiling). So an agent presenting
    // only its platform-issued VC would clear an effectiveScopes check while
    // never having asked the user anything. Requiring the grant entry is what
    // makes consent load-bearing rather than decorative.
    const grantFromThisSp = (vp.verifiableCredential as SignedVC[]).find(
      (entry) =>
        Array.isArray(entry.type) &&
        (entry.type as string[]).includes('DelegationGrantCredential') &&
        entry.issuer === issuer.did,
    );
    if (!grantFromThisSp) {
      counters.consentRequired += 1;
      log(`DENIED  ${toolName}  agent ${agentDid} verified but presented no grant from this SP`);
      res.json(
        jsonRpcError(rpc.id, -32001, 'Consent required', {
          code: 'CONSENT_REQUIRED',
          reason: 'NO_GRANT_FOR_THIS_SERVICE',
          requiredScope,
          serviceDid: issuer.did,
          consentUrl: `${baseUrl}/consent`,
        }),
      );
      return;
    }

    // effectiveScopes is the enforcement field: the intersection of the agent's
    // own authority and the user's consent grant. Reading privilegeScopes here
    // would ignore the grant entirely.
    if (!effectiveScopes.includes(requiredScope)) {
      counters.consentRequired += 1;
      log(`DENIED  ${toolName}  agent ${agentDid} verified but lacks ${requiredScope}`);
      res.json(
        jsonRpcError(rpc.id, -32001, 'Consent required', {
          code: 'CONSENT_REQUIRED',
          reason: 'INSUFFICIENT_EFFECTIVE_SCOPE',
          requiredScope,
          serviceDid: issuer.did,
          consentUrl: `${baseUrl}/consent`,
        }),
      );
      return;
    }

    log(`GRANTED ${toolName}  agent=${agentDid}  effectiveScopes=[${effectiveScopes.join(', ')}]`);
    res.json(jsonRpcResult(rpc.id, { structuredContent: runTool(toolName, args, agentDid) }));
  });

  // ── Consent page ───────────────────────────────────────────────────────
  // Serves the real @helixid/widget controller to the browser (its dist is
  // dependency-free ESM), so the page renders against the shipped state
  // machine rather than a re-implementation of it.

  if (options.widgetDistPath) {
    app.use('/widget', express.static(options.widgetDistPath));
  }

  app.get('/consent', (req: Request, res: Response) => {
    const agentDid = String(req.query['agentDid'] ?? '');
    const userDid = String(req.query['userDid'] ?? '');
    res.type('html').send(consentPageHtml({ definition, agentDid, userDid, serviceDid: issuer.did }));
  });

  return { app, counters, definition, issuerDid: issuer.did };
}

// ── C4: the booking backend ──────────────────────────────────────────────

function runTool(
  toolName: string,
  args: Record<string, unknown>,
  agentDid: string,
): Record<string, unknown> {
  switch (toolName) {
    case 'search_flights':
      return {
        flights: [
          { flightId: 'HA401', carrier: 'Helix Air', origin: String(args['origin'] ?? 'TVM'), destination: String(args['destination'] ?? 'DEL'), departs: '08:20' },
          { flightId: 'HA733', carrier: 'Helix Air', origin: String(args['origin'] ?? 'TVM'), destination: String(args['destination'] ?? 'DEL'), departs: '19:05' },
        ],
      };
    case 'book_flight':
      return {
        bookingId: `FLT-${randomUUID().slice(0, 8).toUpperCase()}`,
        flightId: String(args['flightId'] ?? ''),
        status: 'CONFIRMED',
        bookedBy: agentDid,
      };
    case 'modify_booking':
      return {
        bookingId: String(args['bookingId'] ?? ''),
        status: 'MODIFIED',
        modifiedBy: agentDid,
      };
    case 'search_hotels':
      return {
        hotels: [
          { hotelId: 'HS-DEL-1', name: 'Helix Stay Aerocity', city: String(args['city'] ?? 'DEL'), nightlyRate: 7400 },
          { hotelId: 'HS-DEL-2', name: 'Helix Stay Connaught', city: String(args['city'] ?? 'DEL'), nightlyRate: 9100 },
        ],
      };
    case 'book_hotel':
      return {
        bookingId: `HTL-${randomUUID().slice(0, 8).toUpperCase()}`,
        hotelId: String(args['hotelId'] ?? ''),
        status: 'CONFIRMED',
        bookedBy: agentDid,
      };
    default:
      return { ok: true };
  }
}

function consentPageHtml(params: {
  definition: SpDefinition;
  agentDid: string;
  userDid: string;
  serviceDid: string;
}): string {
  const { definition, agentDid, userDid, serviceDid } = params;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${definition.displayName} — authorize agent</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #16181d; }
  h1 { font-size: 1.25rem; }
  .scope { display: flex; gap: .6rem; align-items: flex-start; padding: .55rem 0; border-bottom: 1px solid #e6e8ec; }
  .scope small { display: block; color: #5c6370; }
  .row { margin: 1.25rem 0; }
  button { font: inherit; padding: .55rem 1.1rem; border-radius: .4rem; border: 1px solid #c9ccd4; background: #fff; cursor: pointer; }
  button.primary { background: #1c6fe0; border-color: #1c6fe0; color: #fff; }
  button[disabled] { opacity: .5; cursor: not-allowed; }
  .error { color: #a3211a; background: #fdecea; padding: .7rem; border-radius: .4rem; }
</style>
</head>
<body>
<h1>${definition.displayName}</h1>
<p><strong>${agentDid || 'An agent'}</strong> is asking to act for <strong>${userDid || 'you'}</strong>.</p>
<div id="root">Loading…</div>

<script type="module">
  // The shipped widget controller — not a re-implementation.
  import { createConsentController } from '/widget/index.js';

  const root = document.getElementById('root');
  const controller = createConsentController({
    agentDid: ${JSON.stringify(agentDid)},
    agentName: 'Travel Planner Agent',
    userIdentifier: ${JSON.stringify(userDid)},
    serviceDid: ${JSON.stringify(serviceDid)},
    scopesEndpoint: '/api/consent/scopes',
    defaultDurability: 'standing',
    onAccept: async (selection) => {
      const res = await fetch('/api/consent/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          agentDid: ${JSON.stringify(agentDid)},
          userDid: ${JSON.stringify(userDid)},
          scopes: selection.scopes,
          durability: selection.durability,
        }),
      });
      const body = await res.json();
      window.parent.postMessage({ type: 'helixid:consent-accepted', grantVC: body.grantVC }, '*');
      root.innerHTML = '<p>Authorized. You can return to your agent.</p>';
    },
    onDecline: () => {
      window.parent.postMessage({ type: 'helixid:consent-declined' }, '*');
      root.innerHTML = '<p>Declined. Nothing was authorized.</p>';
    },
  });

  function render(state) {
    if (state.status === 'loading') { root.textContent = 'Loading…'; return; }
    if (state.status === 'error') {
      // Accept is disabled; Decline stays available. No retry (register D3).
      root.innerHTML =
        '<p class="error">Could not load permissions: ' + (state.error ?? 'unknown error') + '</p>' +
        '<div class="row"><button disabled>Accept</button> <button id="decline">Decline</button></div>';
      document.getElementById('decline').onclick = () => controller.decline();
      return;
    }

    root.innerHTML =
      state.scopeOptions.map((option) => {
        const checked = state.selectedScopes.includes(option.scope) ? 'checked' : '';
        const locked = option.required ? 'disabled' : '';
        return '<label class="scope"><input type="checkbox" data-scope="' + option.scope + '" ' + checked + ' ' + locked + ' />' +
          '<span>' + option.label + (option.required ? ' <em>(required)</em>' : '') +
          (option.description ? '<small>' + option.description + '</small>' : '') + '</span></label>';
      }).join('') +
      '<div class="row">' +
        state.durabilityOptions.map((option) =>
          '<label style="display:block"><input type="radio" name="durability" value="' + option.value + '"' +
          (state.durability === option.value ? ' checked' : '') + ' /> ' + option.label + '</label>').join('') +
      '</div>' +
      '<div class="row"><button class="primary" id="accept"' + (state.canAccept ? '' : ' disabled') + '>Accept</button> ' +
      '<button id="decline">Decline</button></div>';

    root.querySelectorAll('input[data-scope]').forEach((input) => {
      input.onchange = () => controller.toggleScope(input.dataset.scope);
    });
    root.querySelectorAll('input[name=durability]').forEach((input) => {
      input.onchange = () => controller.setDurability(input.value);
    });
    document.getElementById('accept').onclick = () => controller.accept();
    document.getElementById('decline').onclick = () => controller.decline();
  }

  controller.subscribe(render);
  render(controller.getState());
  await controller.load();
</script>
</body>
</html>`;
}
