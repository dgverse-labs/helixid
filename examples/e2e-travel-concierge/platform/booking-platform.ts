// e2e travel concierge/ platform /booking-platform.ts
import 'dotenv/config';
import Fastify from 'fastify';
import type { SignedVP } from '@helixid/core';

const helixApiUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const targetService = process.env.HELIX_TARGET_SERVICE ?? 'amazon';
const port = Number(process.env.BOOKING_PLATFORM_PORT ?? 3001);

type Scope = 'read:catalog' | 'write:orders' | 'read:inventory' | 'write:inventory';

type VerifyResponse = {
  valid: true;
  agentDid: string;
  userDid: string;
  targetService: string;
  verifiedAt: string;
};

type AgentVC = {
  credentialSubject?: {
    privilegeScopes?: unknown;
  };
};

const fastify = Fastify({ logger: false });

// This platform is a verifier, not an agent-side SDK user. It calls Helix ID's
// verification API directly and performs its own route-level authorization.

function decodeSignedVP(authorization: string | undefined): SignedVP {
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('missing_bearer_vp');
  }
  const encoded = authorization.slice('Bearer '.length);
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedVP;
}

function extractScopes(signedVP: SignedVP): string[] {
  const vc = signedVP.verifiableCredential[0] as AgentVC | undefined;
  const scopes = vc?.credentialSubject?.privilegeScopes;
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string') : [];
}

async function verifyWithHelix(signedVP: SignedVP): Promise<VerifyResponse> {
  // Helix ID checks the VP signature, embedded VC signature, expiry,
  // StatusList revocation, single-use vpId replay, and registered target service.
  const response = await fetch(`${helixApiUrl}/v1/vp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedVP }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const reason = typeof payload === 'object' && payload !== null ? JSON.stringify(payload) : String(payload);
    throw new Error(reason);
  }

  return payload as VerifyResponse;
}

function decisionLog(scope: Scope, verified: boolean, did: string, decision: 'GRANTED' | 'DENIED', reason: string): void {
  const mark = verified ? '✓' : '✗';
  console.log(`[${new Date().toISOString()}] [Platform] [${scope}] VP verified ${mark}  ${did}  ${decision}  ${reason}`);
}

function registerRoute(path: string, requiredScope: Scope, data: unknown): void {
  fastify.post(path, async (request, reply) => {
    let signedVP: SignedVP;
    try {
      signedVP = decodeSignedVP(request.headers.authorization);
    } catch (error) {
      decisionLog(requiredScope, false, 'did:hedera:unknown', 'DENIED', error instanceof Error ? error.message : 'parse_failed');
      // The platform keeps internal verification reasons in logs so callers cannot
      // distinguish replay, revocation, malformed payload, or signature failures.
      return reply.code(401).send({ error: 'VP_VERIFICATION_FAILED' });
    }

    try {
      const verified = await verifyWithHelix(signedVP);
      const did = verified.agentDid;

      if (verified.targetService !== targetService) {
        decisionLog(requiredScope, true, did, 'DENIED', `target_service_mismatch:${verified.targetService}`);
        return reply.code(401).send({ error: 'VP_VERIFICATION_FAILED' });
      }

      // Verification is authentication; scope checking is authorization. A valid
      // identity still needs the right privilege for the requested business action.
      const scopes = extractScopes(signedVP);
      if (!scopes.includes(requiredScope)) {
        decisionLog(requiredScope, true, did, 'DENIED', 'insufficient_scope');
        return reply.code(403).send({ error: 'INSUFFICIENT_SCOPE' });
      }

      decisionLog(requiredScope, true, did, 'GRANTED', 'scope_allowed');
      return reply.code(200).send(data);
    } catch (error) {
      const did = signedVP.holder || 'did:hedera:unknown';
      decisionLog(requiredScope, false, did, 'DENIED', error instanceof Error ? error.message : String(error));
      // The caller gets one stable failure code while the log preserves the
      // internal reason for operators and auditors.
      return reply.code(401).send({ error: 'VP_VERIFICATION_FAILED' });
    }
  });
}

registerRoute('/flights/search', 'read:catalog', {
  flights: [
    { id: 'flt-101', route: 'BOM-LHR', seats: 12 },
    { id: 'flt-204', route: 'BOM-LGW', seats: 7 },
  ],
});

registerRoute('/flights/book', 'write:orders', {
  bookingId: 'flight-booking-demo-001',
  status: 'confirmed',
});

registerRoute('/hotels/search', 'read:inventory', {
  hotels: [
    { id: 'hotel-langham', name: 'The Langham', available: true },
    { id: 'hotel-goring', name: 'The Goring', available: true },
  ],
});

registerRoute('/hotels/book', 'write:inventory', {
  bookingId: 'hotel-booking-demo-001',
  status: 'confirmed',
});

fastify.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`[Platform] Listening on http://localhost:${port}`);
});
