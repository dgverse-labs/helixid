import { NoCredentialInWalletError } from './errors/index.js';
import type { SignedVC } from './core/schemas/vc.js';
import type { StatusListCredential } from './core/status-list-schema.js';
import type { AgentWallet } from './wallet/AgentWallet.js';

export interface RenewAgentVCOptions {
  /** VC to renew. Defaults to `wallet.credentials[0]`, same fallback `delegate()` uses. */
  currentVC?: SignedVC;
  /** Status list the currentVC's credentialStatus entry lives on, unmodified — caller owns storage. */
  statusList: StatusListCredential;
  statusListCredentialUrl: string;
  expiresIn: number;
  /** Optional narrower scope set. Must be a subset of currentVC's scopes — renewal can only narrow. */
  scopes?: string[];
}

/**
 * Renews an agent's own VC via the API's prepare/finalize endpoints (see
 * docs/proposal-sdk-api-only.md). This is distinct from `HelixClient.renewVC()`,
 * which is fully server-signed — this path is for VCs the agent itself
 * signed (e.g. via `selfIssueVC()`), so the renewal must be re-signed by the
 * same key. Payload construction — window/revocation/renewal-count checks
 * included — happens server-side; only the signature is produced locally.
 */
export async function renewAgentVC(
  options: RenewAgentVCOptions,
  wallet: AgentWallet,
): Promise<SignedVC> {
  const currentVC = options.currentVC ?? wallet.credentials[0];
  if (!currentVC) {
    throw new NoCredentialInWalletError();
  }
  if (!wallet.client) {
    throw new Error('Wallet has no HelixClient');
  }

  const prepared = await wallet.client.prepareAgentRenewal({
    currentVC,
    statusList: options.statusList,
    statusListCredentialUrl: options.statusListCredentialUrl,
    expiresIn: options.expiresIn,
    ...(options.scopes !== undefined ? { scopes: options.scopes } : {}),
  });

  const signatureHex = wallet.sign(Buffer.from(prepared.canonicalHash, 'hex'));

  // The server expects the signer to match currentVC.issuer, not necessarily
  // this wallet's own DID — renewal is signed by whoever signed the original
  // VC. Self-renewal (the common case) has these be the same, but derive
  // from currentVC.issuer rather than assuming it.
  return wallet.client.finalizeAgentRenewal({
    token: prepared.token,
    verificationMethod: `${currentVC.issuer}#key-1`,
    signatureHex,
  });
}
