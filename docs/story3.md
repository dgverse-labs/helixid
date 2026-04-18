STORY 3 — Boundary 3: VP Creation & Verification
What to Mock So This Story Can Start
B3 needs DID resolution (B1) and VC status checking (B2). Mock both:

resolveDID(did) → returns a hardcoded DID document with a known test public key
getVCStatus(vcId) → returns 'active' by default; tests override this to 'revoked' or 'expired' as needed

The mock for getVCStatus must be injectable — the security tests for B3 depend on being able to simulate a revoked VC coming through VP verification.

Overview
B3 handles the presentation layer. Helix ID generates an unsigned VP template with a unique vpId and short expiry. The agent signs it locally using the SDK. External services verify the signed VP either by calling Helix ID's verify endpoint or by self-verifying.

3.1 — Database Schema
New tables:
vp_ids — tracks every issued vpId and its consumption state

id — cuid
vpId — unique string (format: vp:helix:<cuid>)
agentDid — the DID the VP template was issued for
userDid — the delegating user's DID (from the delegatedBy claim)
targetService — the service name from the registry this VP was issued for
expiresAt — DateTime
consumedAt — DateTime nullable
createdAt — DateTime
@@index([vpId]) — fast lookup at verification time


3.2 — helix-core Additions
VP Schema — helix-core/src/schemas/vp.ts
Unsigned VP template structure (what Helix ID returns):
json{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiablePresentation"],
  "id": "vp:helix:<cuid>",
  "holder": "<agentDid>",
  "verifiableCredential": [ /* the agent's full signed VC */ ],
  "nonce": "<random 32-byte hex string>",
  "expirationDate": "<ISO 8601, VP_TTL_SECONDS from now>",
  "delegatedBy": "<userDid>"
}
Signed VP adds a proof block identical in shape to the VC proof — same Ed25519Signature2020 format. The agent signs the canonical JSON of the unsigned VP (without proof field) using its own private key from the wallet.
Export Zod schemas for UnsignedVP and SignedVP. Export TypeScript types.
Error codes to add
VP_NOT_FOUND                // vpId not in DB (was never issued by Helix ID)
VP_EXPIRED                  // VP expirationDate is in the past
VP_ALREADY_CONSUMED         // vpId was already used in a successful verification
VP_VERIFICATION_FAILED      // catch-all for sig invalid, DID resolution failure, revoked VC
                             // intentionally ambiguous externally per EH-4
VP_INVALID_STRUCTURE        // submitted VP does not match expected schema
VP_AGENT_DID_NOT_FOUND      // agent DID in VP holder field not found
Important: VP_VERIFICATION_FAILED is used for ALL of these internal failure reasons: invalid signature, DID not found, VC revoked, VC expired. This is EH-4 — no oracle attack. The internal audit log records the specific reason; the HTTP response does not.
Audit events to add
VP_TEMPLATE_ISSUED      // fields: vpId, agentDid, userDid, targetService, expiresAt
VP_VERIFIED             // fields: vpId, agentDid, result: 'success'
VP_REJECTED             // fields: vpId (if parseable), reason (for internal log only — never in HTTP response), timestamp

3.3 — SDK: buildAndSignVP
This is the most security-critical SDK function. It runs entirely client-side. No network call.
Location: helix-sdk-js/src/vp/VPBuilder.ts
Function signature:
typescriptbuildAndSignVP(unsignedVP: UnsignedVP, privateKeyHex: string): SignedVP
Steps:

Validate unsignedVP against the Zod schema — throw VP_INVALID_STRUCTURE if it fails
Ensure unsignedVP.expirationDate is in the future — throw VP_EXPIRED if already expired (prevents signing a stale template)
Serialize the unsigned VP to canonical JSON (no proof field present)
SHA-256 hash the serialized bytes
Sign the hash with privateKeyHex using Ed25519 (signBytes from helix-core crypto)
Attach proof block
Return the SignedVP

The private key is passed in as a parameter. It is the caller's responsibility to retrieve it from the wallet and not retain it longer than needed. The function itself never stores or logs the key.

3.4 — API Endpoints
POST /v1/vp/template — Request an Unsigned VP Template
Called by the agent before an action. Helix ID generates the vpId, sets the expiry, and returns the template for the agent to sign.
Request:
json{
  "agentDid": "did:helix:...",
  "userDid": "did:helix:...",
  "targetService": "amazon"   // must exist in service registry
}
Response 201:
json{
  "unsignedVP": { /* UnsignedVP structure */ },
  "vpId": "vp:helix:abc123",
  "expiresAt": "2025-06-01T12:05:00Z"
}
Error cases: 400 VALIDATION_ERROR, 404 VP_AGENT_DID_NOT_FOUND, 400 if targetService not in registry
Service behaviour: Validate agentDid exists via B1. Fetch the agent's active VC (the non-revoked, non-expired one) — if none exists, return 400 with message "Agent has no active VC". Fetch the targetService entry from the registry. Generate vpId and nonce (32 bytes of crypto random, hex-encoded). Persist vp_ids record. Build and return the unsigned VP. The agent's VC is embedded in verifiableCredential array.
POST /v1/vp/verify — Verify a Signed VP
Called by external services (Amazon, etc.) or by the agent itself in testing.
Request:
json{
  "signedVP": { /* SignedVP structure */ }
}
Response 200 (success):
json{
  "valid": true,
  "agentDid": "did:helix:...",
  "userDid": "did:helix:...",
  "targetService": "amazon",
  "verifiedAt": "2025-06-01T12:04:55Z"
}
Response 400 (failure) — always the same external error regardless of internal reason (EH-4):
json{
  "error": {
    "code": "VP_VERIFICATION_FAILED",
    "message": "The Verifiable Presentation could not be verified.",
    "requestId": "req_..."
  }
}
Service verification steps (all must pass — fail fast, but log specific reason):

Parse and validate VP structure against Zod schema → fail: VP_INVALID_STRUCTURE (logged), return VP_VERIFICATION_FAILED
Extract vpId from vp.id
Look up vpId in vp_ids table → not found: VP_NOT_FOUND (logged), return VP_VERIFICATION_FAILED
Check consumedAt is null → already consumed: VP_ALREADY_CONSUMED (logged), return VP_VERIFICATION_FAILED
Check expiresAt is in future → expired: VP_EXPIRED (logged), return VP_VERIFICATION_FAILED
Resolve agent DID from vp.holder → not found: VP_AGENT_DID_NOT_FOUND (logged), return VP_VERIFICATION_FAILED
Extract public key from resolved DID document
Verify VP signature against public key → invalid: logged as signature_invalid, return VP_VERIFICATION_FAILED
Extract the embedded VC from vp.verifiableCredential[0]
Check VC expirationDate is in future → expired: logged, return VP_VERIFICATION_FAILED
Check VC credentialStatus — fetch status list, call getBit(list, index) → bit is 1: logged as vc_revoked, return VP_VERIFICATION_FAILED
Mark vpId as consumed — atomic DB update setting consumedAt = now(). This must happen before returning success.
Emit VP_VERIFIED audit event
Return 200 success

Step 12 is critical — the consumption must be an atomic update with a uniqueness constraint check. Use UPDATE vp_ids SET consumed_at = NOW() WHERE vp_id = ? AND consumed_at IS NULL. If 0 rows updated, a concurrent request consumed it first — return VP_VERIFICATION_FAILED.

3.5 — Self-Verification Documentation
Produce a markdown document at helix-api/docs/self-verification.md. This is a contractual obligation for external services that choose not to call Helix ID's verify endpoint.
Document must specify:

How to resolve agent DID from Hedera Mirror Node REST API directly
How to extract public key from DID document
How to verify the Ed25519 signature (canonical JSON, SHA-256, verify)
How to fetch the status list credential from the public URL in the VC
How to check a specific bit using the StatusList2021 algorithm
The nonce/vpId checking obligation — self-verifying services MUST implement their own vpId consumption tracking. They cannot rely on Helix ID to prevent replay. Document the exact obligation: "You must store every vpId you have processed and reject any vpId you have seen before."
VP expiry checking
VC expiry checking


3.6 — Tests
Unit tests (helix-core)

buildAndSignVP with valid inputs produces a VP with a non-empty proof.proofValue
buildAndSignVP throws if unsignedVP is missing required fields
buildAndSignVP throws if expirationDate is already in the past
The signature in the returned VP verifies against the public key derived from the private key used

Integration tests (helix-api)

POST /v1/vp/template returns unsigned VP with correct holder, embedded VC, delegatedBy
Verify a correctly signed VP — 200 with valid: true
Verify an expired VP — 400 VP_VERIFICATION_FAILED
Verify a VP with unknown vpId — 400 VP_VERIFICATION_FAILED
Get status list, check bit for a fresh VP — 0 (not consumed)

Security tests

Replay attack: Submit same signed VP twice — second returns 400 VP_VERIFICATION_FAILED; check consumedAt is set after first call
Tampered VP: Flip one character in credentialSubject.id of embedded VC, resubmit — 400 VP_VERIFICATION_FAILED
Wrong private key: Sign VP with a different keypair than the one registered to the agent DID — 400 VP_VERIFICATION_FAILED
Expired VP: Generate template, manually set expiresAt to past in DB, submit — 400 VP_VERIFICATION_FAILED
Revoked VC: Revoke the agent's VC (via B2 mock), generate VP, verify — 400 VP_VERIFICATION_FAILED; audit log must contain reason vc_revoked internally
Concurrent replay: Submit the same signed VP from two concurrent requests using Promise.all — exactly one must succeed (200), the other must fail (400). This tests the atomic consumption.