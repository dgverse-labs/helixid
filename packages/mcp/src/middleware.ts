import { AgentWallet, verifyVP, VPBuilder, type HelixClient } from '@helix-id/sdk-js';
import type { HelixJWTPayload, SignedVC, SignedVP, VerifyVPResult } from '@helix-id/core';

export interface MCPRequestLike {
  headers?: Record<string, string | undefined>;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MCPToolCall {
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface MCPError {
  code: number;
  message: string;
}

export interface VerifiedHelixContext {
  agentDid: string;
  userDid: string;
  targetService: string;
  scopes: string[];
}

export interface MCPMiddlewareResult {
  ok: boolean;
  request?: MCPRequestLike;
  context?: VerifiedHelixContext;
  error?: MCPError;
}

export type MCPNext = (request: MCPRequestLike) => unknown | Promise<unknown>;
export type MCPMiddleware = (request: MCPRequestLike, next?: MCPNext) => Promise<unknown>;

export interface MCPMiddlewareOptions {
  helixClient: Pick<HelixClient, 'verifySessionToken'>;
  verifyVP?: (signedVP: SignedVP) => Promise<VerifyVPResult>;
  requiredScopes?: string[];
  allowSession?: boolean;
  sessionPublicKeyHex?: string;
}

export interface WalletLoader {
  load(passphrase: string, filePath: string): Promise<WalletData>;
}

export interface WalletData {
  did: string;
  publicKeyHex: string;
  privateKeyHex: string;
  credentials: Array<{
    vcId: string;
    vcJson: string;
    type: string[];
    issuer?: string;
    subjectDid?: string;
    addedAt: string;
    updatedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface VPAttachOptions {
  walletPassphrase: string;
  walletFilePath: string;
  targetService: string;
  userDid: string;
  vcType?: string;
  vcId?: string;
  walletLoader?: WalletLoader;
}

export function helixidMCPMiddleware(options: MCPMiddlewareOptions): MCPMiddleware {
  return async (request, next) => {
    const parsed = parseAuthorization(request.headers);
    if (!parsed) return failure(-32001, 'Missing authorization');

    let context: VerifiedHelixContext;
    if (parsed.scheme === 'HelixVP') {
      const signedVP = decodeBase64UrlJson<SignedVP>(parsed.token);
      const result = await (options.verifyVP ?? verifyVP)(signedVP);
      context = contextFromVerifyResult(result, signedVP);
    } else if (parsed.scheme === 'HelixSession') {
      if (!options.allowSession) return failure(-32001, 'Unsupported authorization scheme');
      if (!options.sessionPublicKeyHex) return failure(-32001, 'Missing session public key');
      const payload = options.helixClient.verifySessionToken(parsed.token, options.sessionPublicKeyHex);
      context = contextFromSessionPayload(payload);
    } else {
      return failure(-32001, 'Unsupported authorization scheme');
    }

    if (!hasRequiredScopes(context.scopes, options.requiredScopes ?? [])) {
      return failure(-32003, 'Insufficient scopes');
    }

    request.context = {
      ...(request.context ?? {}),
      helix: context,
    };

    if (next) return next(request);
    return { ok: true, request, context } satisfies MCPMiddlewareResult;
  };
}

export async function attachHelixVP(toolCall: MCPToolCall, options: VPAttachOptions): Promise<MCPToolCall> {
  const signedVP = await createSignedVP(options);
  return {
    ...toolCall,
    headers: {
      ...(toolCall.headers ?? {}),
      Authorization: `HelixVP ${encodeBase64UrlJson(signedVP)}`,
    },
  };
}

async function createSignedVP(options: VPAttachOptions): Promise<SignedVP> {
  const wallet = await (options.walletLoader ?? new AgentWallet()).load(options.walletPassphrase, options.walletFilePath);
  const credential = selectMatchingCredential(wallet, options.vcType ?? 'HelixAgentCredential', options.vcId);
  const vc = JSON.parse(credential.vcJson) as SignedVC;
  return new VPBuilder({
    vc,
    holderDid: wallet.did,
    userDid: options.userDid,
    targetService: options.targetService,
  }).sign(wallet.privateKeyHex, `${wallet.did}#key-1`);
}

function selectMatchingCredential(
  wallet: WalletData,
  vcType: string,
  vcId: string | undefined,
): WalletData['credentials'][number] {
  const now = Date.now();
  const matches = wallet.credentials.filter((credential) => {
    if (vcId && credential.vcId !== vcId) return false;
    if (!credential.type.includes(vcType)) return false;
    const vc = JSON.parse(credential.vcJson) as { validUntil?: unknown; expirationDate?: unknown };
    const expiresAt = typeof vc.validUntil === 'string'
      ? vc.validUntil
      : typeof vc.expirationDate === 'string'
        ? vc.expirationDate
        : undefined;
    return !expiresAt || Date.parse(expiresAt) > now;
  });
  if (matches.length === 1) return matches[0]!;
  throw new Error(`Helix MCP adapter requires vcId when the wallet has ${matches.length} matching active credentials. Select the credential in application code.`);
}

function parseAuthorization(headers: MCPRequestLike['headers']): { scheme: string; token: string } | null {
  const value = headers?.Authorization ?? headers?.authorization;
  if (!value) return null;
  const [scheme, token] = value.split(/\s+/, 2);
  if (!scheme || !token) return null;
  return { scheme, token };
}

function contextFromVerifyResult(result: VerifyVPResult, signedVP: SignedVP): VerifiedHelixContext {
  return {
    agentDid: result.agentDid,
    userDid: signedVP.delegatedBy,
    targetService: signedVP.targetService,
    scopes: result.privilegeScopes,
  };
}

function contextFromSessionPayload(payload: HelixJWTPayload): VerifiedHelixContext {
  return {
    agentDid: payload.sub,
    userDid: payload.userDid,
    targetService: payload.targetService,
    scopes: payload.scopes,
  };
}

function hasRequiredScopes(actual: string[], required: string[]): boolean {
  return required.every((scope) => actual.includes(scope));
}

function failure(code: number, message: string): MCPMiddlewareResult {
  return { ok: false, error: { code, message } };
}

export function encodeBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}
