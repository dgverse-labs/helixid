import { AgentWallet, VPBuilder } from '@helixid/sdk-js';
import type { SignedVC } from '@helixid/core';

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

export interface HelixIDMiddlewareOptions {
  walletPassphrase: string;
  walletFilePath: string;
  targetService: string;
  userDid?: string;
}

export type LangChainMiddlewareOptions = HelixIDMiddlewareOptions;

export function HelixIDMiddleware(options: LangChainMiddlewareOptions): RunnableConfigLike {
  let wallet: AgentWallet | null = null;

  async function getWallet(): Promise<AgentWallet> {
    if (!wallet) {
      wallet = await AgentWallet.load(options.walletFilePath, options.walletPassphrase);
    }
    return wallet;
  }

  return {
    callbacks: [
      {
        async handleToolStart(_tool, input): Promise<void> {
          const w = await getWallet();
          const vc = selectVC(w, options.targetService);
          const vp = await new VPBuilder({
            vc,
            holderDid: w.getDID(),
            targetService: options.targetService,
            userDid: options.userDid ?? 'did:key:anonymous',
          }).sign(w.getPrivateKeyHex(), `${w.getDID()}#key-1`);

          const target = ensureObjectInput(input);
          target._helixVP = encodeBase64UrlJson(vp);
        },
      },
    ],
  };
}

export function HelixIDToolWrapper<T extends StructuredToolLike>(
  tool: T,
  options: LangChainMiddlewareOptions,
): T {
  let wallet: AgentWallet | null = null;

  async function getWallet(): Promise<AgentWallet> {
    if (!wallet) {
      wallet = await AgentWallet.load(options.walletFilePath, options.walletPassphrase);
    }
    return wallet;
  }

  return {
    ...tool,
    async _call(input: unknown, ...rest: unknown[]): Promise<unknown> {
      const w = await getWallet();
      const vc = selectVC(w, options.targetService);
      const vp = await new VPBuilder({
        vc,
        holderDid: w.getDID(),
        targetService: options.targetService,
        userDid: options.userDid ?? 'did:key:anonymous',
      }).sign(w.getPrivateKeyHex(), `${w.getDID()}#key-1`);

      const target = ensureObjectInput(input);
      target._helixVP = encodeBase64UrlJson(vp);

      return tool._call(input, ...rest);
    },
  };
}

export function selectVC(wallet: AgentWallet, targetService: string): SignedVC {
  const vcs = wallet.credentials;
  if (!vcs || vcs.length === 0) {
    throw new Error('No credential in wallet. Run enrollment first.');
  }
  if (vcs.length === 1) {
    return vcs[0]!;
  }
  const match = vcs.find((vc: any) => vc.targetService === targetService);
  if (match) {
    return match;
  }
  return vcs[0]!;
}

export function ensureObjectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('HelixIDMiddleware requires object tool input');
  }
  return input as Record<string, unknown>;
}

export function encodeBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
