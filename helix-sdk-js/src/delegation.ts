import {
  buildDelegationVC,
  NoCredentialInWalletError,
  type SignedVC,
} from '@helixid/core';
import type { AgentWallet } from './wallet/AgentWallet.js';

export interface DelegateOptions {
  to: string;
  scopes: string[];
  expiresIn: number;
  fromVC?: SignedVC;
}

export async function delegate(
  options: DelegateOptions,
  wallet: AgentWallet,
): Promise<SignedVC> {
  const fromVC = options.fromVC ?? wallet.credentials[0];
  if (!fromVC) {
    throw new NoCredentialInWalletError();
  }

  return buildDelegationVC(
    { ...options, fromVC },
    {
      did: wallet.getDID(),
      privateKeyHex: wallet.getPrivateKeyHex(),
    },
  );
}
