import { AgentWallet, VPBuilder, type HelixClient } from '@helix-id/sdk-js';
import type { SignedVP, UnsignedVP } from '@helix-id/core';

export interface RunnableConfigLike {
  callbacks: Array<{
    handleToolStart(tool: unknown, input: unknown): Promise<void>;
  }>;
}

export interface StructuredToolLike {
  name?: string;
  _call(input: unknown, ...rest: unknown[]): unknown | Promise<unknown>;
  [key: string]: unknown;
}

export interface VPTemplateClient {
  createVPTemplate(options: {
    agentDid: string;
    userDid: string;
    targetService: string;
    vcType?: string;
    vcId?: string;
  }): Promise<{ unsignedVP: UnsignedVP; vpId?: string; expiresAt?: string }>;
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

export interface WalletLoader {
  load(passphrase: string, filePath: string): Promise<WalletData>;
}

export interface LangChainMiddlewareOptions {
  helixClient: Pick<HelixClient, 'createVPTemplate'> | VPTemplateClient;
  walletPassphrase: string;
  walletFilePath: string;
  targetService: string;
  userDid: string;
  vcType?: string;
  vcId?: string;
  walletLoader?: WalletLoader;
}

export function HelixIDMiddleware(options: LangChainMiddlewareOptions): RunnableConfigLike {
  return {
    callbacks: [
      {
        async handleToolStart(_tool, input): Promise<void> {
          await attachVPToInput(input, options);
        },
      },
    ],
  };
}

export function HelixIDToolWrapper<T extends StructuredToolLike>(
  tool: T,
  options: LangChainMiddlewareOptions,
): T {
  return {
    ...tool,
    async _call(input: unknown, ...rest: unknown[]): Promise<unknown> {
      await attachVPToInput(input, options);
      return tool._call(input, ...rest);
    },
  };
}

export async function attachVPToInput(input: unknown, options: LangChainMiddlewareOptions): Promise<void> {
  const target = ensureObjectInput(input);
  const signedVP = await createSignedVP(options);
  target._helixVP = encodeBase64UrlJson(signedVP);
}

async function createSignedVP(options: LangChainMiddlewareOptions): Promise<SignedVP> {
  const wallet = await (options.walletLoader ?? new AgentWallet()).load(options.walletPassphrase, options.walletFilePath);
  const vcId = options.vcId ?? selectOnlyMatchingCredentialId(wallet, options.vcType ?? 'HelixAgentCredential');
  const template = await options.helixClient.createVPTemplate({
    agentDid: wallet.did,
    userDid: options.userDid,
    targetService: options.targetService,
    ...(options.vcType ? { vcType: options.vcType } : {}),
    vcId,
  });
  return new VPBuilder(template.unsignedVP).sign(wallet.privateKeyHex, `${wallet.did}#key-1`);
}

function selectOnlyMatchingCredentialId(wallet: WalletData, vcType: string): string {
  const now = Date.now();
  const matches = wallet.credentials.filter((credential) => {
    if (!credential.type.includes(vcType)) return false;
    const vc = JSON.parse(credential.vcJson) as { validUntil?: unknown; expirationDate?: unknown };
    const expiresAt = typeof vc.validUntil === 'string'
      ? vc.validUntil
      : typeof vc.expirationDate === 'string'
        ? vc.expirationDate
        : undefined;
    return !expiresAt || Date.parse(expiresAt) > now;
  });
  if (matches.length === 1) return matches[0]!.vcId;
  throw new Error(`Helix LangChain adapter requires vcId when the wallet has ${matches.length} matching active credentials. Select the credential in application code.`);
}

function ensureObjectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('HelixIDMiddleware requires object tool input');
  }
  return input as Record<string, unknown>;
}

export function encodeBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
