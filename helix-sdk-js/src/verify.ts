import type { SignedVP, VerifyVPOptions } from '@helixid/core';
import type { HelixClient, VerifyVPApiResult } from './client/HelixClient.js';

export type { VerifyVPOptions, VerifyVPResult } from '@helixid/core';
export type { VerifyVPApiResult } from './client/HelixClient.js';

/**
 * Verifies a VP via the API's `/v1/vp/verify` endpoint (see
 * docs/proposal-sdk-api-only.md) — signature check, delegation-chain walk,
 * expiry, target service, and revocation all happen server-side, with
 * VP_VERIFIED/VP_REJECTED audit logging handled there too. There is no local
 * fallback: unlike `VPBuilder.sign()`, verification was decided to move to
 * the API for every SDK, without exception, so a `HelixClient` is required.
 */
export async function verifyVP(
  vp: SignedVP,
  client: HelixClient,
  options: VerifyVPOptions = {},
): Promise<VerifyVPApiResult> {
  return client.verifyVP(vp, options);
}
