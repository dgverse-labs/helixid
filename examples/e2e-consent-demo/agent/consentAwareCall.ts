// The agent's consent-aware tool call — the whole of Part D's behaviour in one
// function.
//
// The agent itself has no consent logic: it never decides what the user may
// authorize, it only notices when an SP says "not without a grant" and hands
// off to that SP's own consent page. What makes step 5 of the demo work is the
// first line of doWork(): before building any presentation, ask the wallet
// whether a grant for THIS (service, user) pair already exists. If it does, it
// travels in the VP and the SP is satisfied on the first attempt — no prompt,
// no second grant issued.

import { VPBuilder, type SignedVC, type SignedVP } from '@helixid/core';
import type { AgentWallet } from '@helixid/sdk-js';

export interface ConsentPrompt {
  serviceDid: string;
  consentUrl: string;
  requiredScope: string;
}

/**
 * Surfaces consent to the End User and returns the grant the SP issued, or
 * null if the user declined. In the browser demo this opens the SP's consent
 * page; in tests it drives the same two HTTP routes directly.
 */
export type ConsentHandler = (prompt: ConsentPrompt) => Promise<SignedVC | null>;

export interface CallSpToolOptions {
  wallet: AgentWallet;
  /** DID or email — must be the identifier the grant captured at consent time. */
  userDid: string;
  spMcpUrl: string;
  serviceDid: string;
  toolName: string;
  args?: Record<string, unknown>;
  onConsentRequired: ConsentHandler;
  /**
   * Stitches every audit event this call produces — presentation,
   * verification, authorization, invocation, and any grant issued along the
   * way — into one traceable chain for a single user action.
   */
  correlationId?: string;
}

export interface CallSpToolResult {
  ok: boolean;
  data?: Record<string, unknown>;
  /** True when this call had to stop and ask the user to authorize. */
  consentPrompted: boolean;
  error?: { code: string; reason?: string; message: string };
}

export class ConsentDeclinedError extends Error {
  constructor(serviceDid: string) {
    super(`User declined consent for ${serviceDid}`);
    this.name = 'ConsentDeclinedError';
  }
}

interface JsonRpcResponse {
  result?: { structuredContent?: Record<string, unknown> };
  error?: {
    code?: number;
    message?: string;
    data?: { code?: string; reason?: string; requiredScope?: string; consentUrl?: string };
  };
}

/** The wallet's existing standing grant for this SP and this user, if any. */
function findExistingGrant(
  wallet: AgentWallet,
  serviceDid: string,
  userDid: string,
): SignedVC | undefined {
  const stored = wallet.selectGrant(serviceDid, userDid);
  // selectGrant returns the wallet's metadata row, not a parsed credential.
  return stored ? (JSON.parse(stored.vcJson) as SignedVC) : undefined;
}

async function buildVP(
  wallet: AgentWallet,
  serviceDid: string,
  userDid: string,
  grant: SignedVC | undefined,
): Promise<SignedVP> {
  const agentVC = wallet.credentials.find((vc) =>
    (vc.type as string[]).includes('HelixAgentCredential'),
  );
  if (!agentVC) {
    throw new Error('Agent wallet holds no HelixAgentCredential. Run enrollment first.');
  }

  return new VPBuilder({
    // Grant is always the second, independent entry — never merged into the
    // agent VC's delegation chain.
    credentials: grant ? [agentVC, grant] : [agentVC],
    holderDid: wallet.getDID(),
    targetService: serviceDid,
    userDid,
  }).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`);
}

async function postToolCall(
  spMcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  vp: SignedVP,
  correlationId?: string,
): Promise<JsonRpcResponse> {
  const response = await fetch(spMcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: {
          ...args,
          _helixVP: vp,
          ...(correlationId !== undefined ? { _helixCorrelationId: correlationId } : {}),
        },
      },
    }),
  });
  return (await response.json()) as JsonRpcResponse;
}

export async function callSpTool(options: CallSpToolOptions): Promise<CallSpToolResult> {
  const { wallet, userDid, spMcpUrl, serviceDid, toolName } = options;
  const args = options.args ?? {};

  // Step 5 hinges on this: reuse a standing grant if the wallet already has one.
  const existingGrant = findExistingGrant(wallet, serviceDid, userDid);
  const first = await postToolCall(
    spMcpUrl,
    toolName,
    args,
    await buildVP(wallet, serviceDid, userDid, existingGrant),
    options.correlationId,
  );

  if (!first.error) {
    return { ok: true, consentPrompted: false, ...(first.result?.structuredContent !== undefined ? { data: first.result.structuredContent } : {}) };
  }

  if (first.error.data?.code !== 'CONSENT_REQUIRED') {
    return {
      ok: false,
      consentPrompted: false,
      error: {
        code: first.error.data?.code ?? 'CALL_FAILED',
        ...(first.error.data?.reason !== undefined ? { reason: first.error.data.reason } : {}),
        message: first.error.message ?? 'Tool call failed',
      },
    };
  }

  // The SP wants a grant. Hand off to its consent page.
  const grantVC = await options.onConsentRequired({
    serviceDid,
    consentUrl: first.error.data.consentUrl ?? '',
    requiredScope: first.error.data.requiredScope ?? '',
  });
  if (!grantVC) {
    throw new ConsentDeclinedError(serviceDid);
  }

  await wallet.addCredential(grantVC);

  const retry = await postToolCall(
    spMcpUrl,
    toolName,
    args,
    await buildVP(wallet, serviceDid, userDid, grantVC),
    options.correlationId,
  );

  if (retry.error) {
    return {
      ok: false,
      consentPrompted: true,
      error: {
        code: retry.error.data?.code ?? 'CALL_FAILED',
        ...(retry.error.data?.reason !== undefined ? { reason: retry.error.data.reason } : {}),
        message: retry.error.message ?? 'Tool call failed after consent',
      },
    };
  }

  return {
    ok: true,
    consentPrompted: true,
    ...(retry.result?.structuredContent !== undefined ? { data: retry.result.structuredContent } : {}),
  };
}
