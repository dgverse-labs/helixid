import { NoCredentialInWalletError, type SignedVC } from '@helixid/core';
import { AgentWallet, VPBuilder } from '@helixid/sdk-js';
import type { AttachHelixVPOptions, MCPToolCall } from './types.js';

export async function attachHelixVP(
  toolCall: MCPToolCall,
  options: AttachHelixVPOptions,
): Promise<MCPToolCall> {
  const wallet = await AgentWallet.load(options.walletFilePath, options.walletPassphrase);
  const vc = selectVC(wallet, options.targetService);

  const vp = await new VPBuilder({
    credentials: [vc],
    holderDid: wallet.getDID(),
    targetService: options.targetService,
    userDid: options.userDid ?? 'did:key:anonymous',
  }).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`);

  return {
    ...toolCall,
    input: {
      ...(toolCall.input ?? {}),
      _helixVP: vp,
    },
  };
}

function selectVC(wallet: AgentWallet, targetService: string): SignedVC {
  const vcs = wallet.credentials;
  if (!vcs || vcs.length === 0) {
    throw new NoCredentialInWalletError('No credential in wallet');
  }
  if (vcs.length === 1) {
    return vcs[0]!;
  }
  const match = vcs.find((vc) => (vc as SignedVC & { targetService?: string }).targetService === targetService);
  if (match) {
    return match;
  }
  return vcs[0]!;
}
