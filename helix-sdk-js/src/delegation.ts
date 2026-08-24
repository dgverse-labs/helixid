import { NoCredentialInWalletError, type SignedVC } from '@helixid/core';
import type { AgentWallet } from './wallet/AgentWallet.js';

export interface DelegateOptions {
  to: string;
  scopes: string[];
  expiresIn: number;
  fromVC?: SignedVC;
}

/**
 * Builds and signs a delegation VC via the API's prepare/finalize endpoints
 * (see docs/proposal-sdk-api-only.md). Payload construction — scope-subset
 * and max-depth checks included — happens server-side; only the signature is
 * produced locally, so the wallet's private key never leaves this process.
 */
export async function delegate(
  options: DelegateOptions,
  wallet: AgentWallet,
): Promise<SignedVC> {
  const fromVC = options.fromVC ?? wallet.credentials[0];
  if (!fromVC) {
    throw new NoCredentialInWalletError();
  }
  if (!wallet.client) {
    throw new Error('Wallet has no HelixClient');
  }

  const prepared = await wallet.client.prepareDelegation({
    delegatorDid: wallet.getDID(),
    fromVC,
    to: options.to,
    scopes: options.scopes,
    expiresIn: options.expiresIn,
  });

  const signatureHex = wallet.sign(Buffer.from(prepared.canonicalHash, 'hex'));

  return wallet.client.finalizeDelegation({
    token: prepared.token,
    verificationMethod: `${wallet.getDID()}#key-1`,
    signatureHex,
  });
}
