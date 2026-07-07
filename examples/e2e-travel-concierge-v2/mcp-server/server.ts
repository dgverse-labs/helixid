// mcp-server — a real Model Context Protocol server exposing exactly one
// protected tool: book_flight.
//
// The only thing standing between an inbound tool call and the booking is
// @helixid/mcp's middleware. It verifies the presented VP against the live
// HelixID API (issuer DID resolution + status-list revocation check, all real)
// and enforces the required scope. No VP, or the wrong scope, and the tool never
// runs. That is the whole point: this is not "the server trusts the caller
// because it sent a request" — it is a cryptographically enforced decision.
import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { helixidMCPMiddleware } from '@helixid/mcp';
import type { SignedVP } from '@helixid/core';
import { PROTECTED_TOOL, SCOPES, TARGET_SERVICE, env } from '../config.js';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [MCP] ${message}`);
}

// The @helixid/mcp gate: verify the VP against the live API and require the
// booking scope. This is the enforcement decision — it throws on any failure.
const requireBookingScope = helixidMCPMiddleware({
  requiredScopes: [SCOPES.FLIGHTS_BOOK],
  allowSelfSigned: false,
});

/**
 * After the gate passes, submit the same presentation to the live API's
 * (unauthenticated) /v1/vp/verify. The API re-verifies it authoritatively and
 * writes a VP_VERIFIED audit event — which is what makes this exact step show up
 * in Console's audit view. (The @helixid/mcp middleware verifies locally and
 * does not itself emit an audit event — see the README "shipped-capability
 * gaps" note.)
 */
async function recordVerificationInConsole(
  signedVP: SignedVP,
): Promise<{ agentDid: string; verifiedAt: string }> {
  const res = await fetch(`${env.helixApiUrl}/v1/vp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedVP }),
  });
  const body = (await res.json()) as {
    valid?: boolean;
    agentDid?: string;
    verifiedAt?: string;
    error?: unknown;
  };
  if (!res.ok || body.valid !== true) {
    throw new Error(`API /v1/vp/verify rejected the presentation: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return { agentDid: body.agentDid ?? 'unknown', verifiedAt: body.verifiedAt ?? new Date().toISOString() };
}

// Build a fresh MCP server per request (stateless mode). The single tool's
// handler runs the HelixID gate before doing any work.
function buildServer(): McpServer {
  const server = new McpServer({ name: 'travel-booking-mcp', version: '0.1.0' });

  server.registerTool(
    PROTECTED_TOOL,
    {
      title: 'Book a flight',
      description:
        'Book a specific flight for a named passenger. Requires a HelixID verifiable presentation carrying the write:orders scope.',
      inputSchema: {
        flightId: z.string().describe('The flight identifier to book, e.g. BA249'),
        passengerName: z.string().describe('Full name of the passenger'),
        // Attached programmatically by the calling agent via attachHelixVP.
        // Optional in the schema so the HelixID layer — not JSON-schema
        // validation — is what reports a missing presentation.
        _helixVP: z.any().optional(),
      },
    },
    async (args) => {
      const { flightId, passengerName, _helixVP } = args as {
        flightId: string;
        passengerName: string;
        _helixVP?: SignedVP;
      };

      // 1) The enforcement gate. Verifies signature, issuer, revocation, expiry,
      //    and requires write:orders — all against the live API. Throws on any
      //    failure.
      const toolCall = { name: PROTECTED_TOOL, input: { flightId, passengerName, _helixVP } };
      try {
        await requireBookingScope(toolCall);
      } catch (err) {
        const reason = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
        log(`DENIED  ${PROTECTED_TOOL}(${flightId})  ${reason}`);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Booking refused by HelixID: ${reason}. The presentation is missing, invalid, revoked, or lacks the write:orders scope.`,
            },
          ],
        };
      }

      // 2) Persist the authoritative verification so it appears in Console audit.
      const { agentDid, verifiedAt } = await recordVerificationInConsole(_helixVP as SignedVP);
      log(`GRANTED ${PROTECTED_TOOL}(${flightId}) for "${passengerName}"  agent=${agentDid}  verifiedAt=${verifiedAt}`);

      // 3) Do the protected thing.
      const bookingId = `BKG-${randomUUID().slice(0, 8).toUpperCase()}`;
      const booking = {
        bookingId,
        flightId,
        passengerName,
        status: 'CONFIRMED',
        verifiedAgent: agentDid,
        targetService: TARGET_SERVICE,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(booking) }],
        structuredContent: booking,
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', tool: PROTECTED_TOOL }));

// Stateless Streamable HTTP: one server + transport per POST, closed on response.
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log(`transport error: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
});

// Stateless mode does not use GET/DELETE session streams.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.listen(env.mcpPort, '0.0.0.0', () => {
  log(`travel-booking MCP server listening on :${env.mcpPort}/mcp`);
  log(`Guarding tool "${PROTECTED_TOOL}" with @helixid/mcp (requires ${SCOPES.FLIGHTS_BOOK}).`);
});
