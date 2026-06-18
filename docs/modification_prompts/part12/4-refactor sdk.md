Refactor @helix-id/sdk-js to cleanly separate API-dependent operations from pure SDK operations. The goal: agent code and verifier code must never instantiate HelixClient or reference an API URL. API URL only appears in enrollment/setup code run by the Platform Operator.
1. Add standalone verifier function
Add a top-level exported function verifyVP(vp, options?) that requires no HelixClient, no API URL:
typescriptimport { verifyVP } from '@helix-id/sdk-js'

const result = await verifyVP(vp, {
  expectedTargetService: 'orders',
  allowSelfSigned: false
})
// result.valid, result.agentDid, result.privilegeScopes, result.vpId
// result.delegationChain, result.warning
Internally: resolves issuer DID from inside the VC (did:key local, did:web HTTPS fetch), fetches StatusList from URL in VC, verifies all signatures locally. Zero API calls except StatusList fetch which is a static file.
2. Refactor VPBuilder to not need HelixClient
Remove dependency on client.createVPTemplate(). VPBuilder constructs the VP directly from wallet contents:
typescriptimport { VPBuilder } from '@helix-id/sdk-js'

const vp = await new VPBuilder({
  vc: wallet.credentials[0],
  holderDid: wallet.did,
  targetService: 'orders',
  userDid: 'did:key:user'
}).sign(wallet.privateKeyHex)
VPBuilder generates vpId (UUID v4) internally. No API call needed for VP template.
3. Add standalone delegate function
Add top-level exported function delegate(options, wallet) for Option A self-signed delegation:
typescriptimport { delegate } from '@helix-id/sdk-js'

const delegationVC = await delegate({
  to: 'did:key:sub-agent',
  scopes: ['read:orders'],   // SDK enforces subset of wallet.credentials[0].scopes
  expiresIn: 3600,
  fromVC: wallet.credentials[0]
}, wallet)
SDK enforces scopes are strict subset of parent VC scopes. SDK enforces delegationDepth does not exceed maxDelegationDepth from parent VC. Throws SCOPE_ESCALATION_DENIED or MAX_DELEGATION_DEPTH_EXCEEDED if violated. No API call.
4. Restrict HelixClient to enrollment only
HelixClient remains but is explicitly for enrollment/setup only. Add JSDoc:
typescript/**
 * For Platform Operator enrollment use only.
 * Agent and verifier code should not use HelixClient.
 * Use verifyVP(), VPBuilder, delegate() instead.
 */
export class HelixClient {
  constructor(apiUrl: string) {}
  requestOnboardingChallenge(...)
  completeOnboarding(...)
  // remove: createVPTemplate, verifyVP, delegate
}
Remove createVPTemplate(), verifyVP(), delegate() from HelixClient. These are now standalone functions.
5. Update package exports
typescript// @helix-id/sdk-js index.ts

// agent
export { AgentWallet } from './wallet'
export { VPBuilder } from './vp-builder'
export { delegate } from './delegation'

// verifier
export { verifyVP } from './verify'
export { checkScope } from './scope'

// enrollment only — Platform Operator setup
export { HelixClient } from './client'

// types
export type { VerifyVPResult, DelegationVC, SignedVP } from './types'
6. Update all examples
Update examples/e2e-travel-concierge/agent/ — remove HelixClient, use VPBuilder and delegate() directly.

Update examples/e2e-travel-concierge/booking-platform/ — remove HelixClient, use verifyVP() directly.

Keep examples/e2e-travel-concierge/operator/enroll-agent.ts using HelixClient — this is the only correct place for it.
7. Update LangChain middleware
HelixIDMiddleware in @helix-id/langchain currently takes helixClient. Remove that. It should take walletPath and passphrase only, use VPBuilder and verifyVP() internally:
typescriptconst middleware = HelixIDMiddleware({
  walletPassphrase: process.env.WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.enc',
  targetService: 'orders'
  // no helixClient, no apiUrl
})
8. Update MCP middleware
Same change for @helix-id/mcp. Remove helixClient from helixidMCPMiddleware and attachHelixVP. Use verifyVP() and VPBuilder internally.
Write unit tests covering: VPBuilder produces valid VP without API, verifyVP resolves did:key locally without API, verifyVP fetches StatusList from URL in VC, delegate() enforces scope subset, delegate() enforces maxDelegationDepth, HelixClient throws clear error if used for verifyVP or createVPTemplate.