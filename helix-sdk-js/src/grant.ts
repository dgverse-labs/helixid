import { signData, type SignedVC, type StatusListCredential } from '@helixid/core';
import type { HelixClient } from './client/HelixClient.js';

/** SP-held issuer key material. The SP signs grants with its own key, which never leaves this process. */
export interface IssuerKeyMaterial {
  did: string;
  privateKeyHex: string;
}

export interface IssueGrantOptions {
  agentDid: string;
  userDid: string;
  scopes: string[];
  durability: 'standing' | 'session';
  serviceDid?: string;
  statusList: StatusListCredential; // current list, unmodified
  statusListCredentialUrl: string; // public URL of the list above
}

export interface IssueGrantResult {
  grantVC: SignedVC;
  /**
   * Same object as `options.statusList` — issuance doesn't set bits (only
   * revocation does), returned for drop-in compatibility with the old
   * `@helixid/core` `issueGrant()` call shape.
   */
  updatedStatusList: StatusListCredential;
}

/**
 * Builds and signs a DelegationGrantCredential via the API's prepare/finalize
 * endpoints (see docs/proposal-sdk-api-only.md). Payload construction — index
 * allocation on the status list included — happens server-side; only the
 * signature is produced locally, so the SP's issuer key never leaves this
 * process.
 */
export async function issueGrant(
  options: IssueGrantOptions,
  issuerWallet: IssuerKeyMaterial,
  client: HelixClient,
): Promise<IssueGrantResult> {
  const prepared = await client.prepareGrant({
    issuerDid: issuerWallet.did,
    agentDid: options.agentDid,
    userDid: options.userDid,
    scopes: options.scopes,
    durability: options.durability,
    ...(options.serviceDid !== undefined ? { serviceDid: options.serviceDid } : {}),
    statusList: options.statusList,
    statusListCredentialUrl: options.statusListCredentialUrl,
  });

  const signatureHex = signData(
    Buffer.from(prepared.canonicalHash, 'hex'),
    issuerWallet.privateKeyHex,
  );

  const grantVC = await client.finalizeGrant({
    token: prepared.token,
    verificationMethod: `${issuerWallet.did}#key-1`,
    signatureHex,
  });

  return { grantVC, updatedStatusList: options.statusList };
}
