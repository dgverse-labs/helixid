# Prompt — guides/verify-a-vp.md

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, and docs/. Write docs/guides/verify-a-vp.md for the Helix ID repository.

## What this document is

A task-oriented guide for anyone building a service that receives VP presentations
from agents. It covers four verification paths — API verification, Session JWT,
self-verification, and SDK helper — with enough detail to implement any of them
correctly. A reader who finishes this document has working verification code and
understands the tradeoffs they made in choosing their path.

## Tone and style

- Task-first. Every section answers "how do I do this" before "why does it work."
- Code blocks for every request, response, and implementation snippet.
- TypeScript throughout. Use fetch for HTTP calls — not axios or any other library.
- Tradeoffs stated plainly. Do not recommend one path as universally better.
- Where a step is a security requirement, say so directly.
- Short paragraphs. One decision per paragraph.

## Sections to write

### 1. Overview

#### 1.1 What You Are Verifying
What a VP contains and what a successful verification confirms: the VP signature
is valid (Ed25519, signed by the agent using @noble/curves), the embedded VC was
issued and signed by Helix ID, the credential is active (not expired, not revoked),
the target service matches, and the vpId has not been consumed before.
List these as the five things verification covers.

#### 1.2 Choosing a Verification Path
A decision table with four rows and columns for: runtime dependency on Helix ID,
replay protection included, per-request latency, implementation effort, best for.

Row 1 — API Verification: runtime dependency yes, replay protection yes (Helix ID
consumes vpId), one network call per request, minimal effort, recommended default.

Row 2 — Session JWT: runtime dependency only on first VP verification (then local),
replay protection yes on first VP, near-zero latency for subsequent calls within
10-minute window, low effort, best for high-frequency agent interactions.

Row 3 — Self-Verify: runtime dependency only for StatusList fetch, replay protection
is the verifier's own responsibility, no Helix ID call for signature checks,
highest implementation effort, best for air-gapped or latency-critical systems.

Row 4 — SDK Helper: runtime dependency yes, replay protection yes, one network
call per request, minimal effort, best for Node/TypeScript services that want
self-verify logic without implementing it manually.

One sentence of guidance below the table on how to choose.

### 2. Path 1 — API Verification

#### 2.1 When to Use This
Services that are always networked, want the simplest integration, and are
comfortable with one Helix ID call per VP received. The recommended default path.

#### 2.2 What the API Checks
Enumerate exactly what Helix ID's verification endpoint checks internally:
VP signature (Ed25519), VC signature (Ed25519, HELIX_SIGNING_KEY), VC expiry,
StatusList2021 revocation bit, target service field, vpId replay store.
The reader delegates all of these to Helix ID when using this path.

#### 2.3 Request Format
The exact endpoint: `POST /v1/vp/verify`. The request body shape: `{ signedVP }`.
A complete curl example and a complete fetch example in TypeScript.

#### 2.4 Response Structure
The success response shape: `{ valid: true, agentDid, userDid, targetService, verifiedAt }`.
What each field means. A complete example response.

#### 2.5 Error Responses and What They Mean
All verification failures return the same external error code: `VP_VERIFICATION_FAILED`.
Internal reasons are recorded in the audit log only — never exposed externally.
Explain why: revealing whether a failure was due to revocation vs bad signature
vs replay gives an attacker diagnostic information.

Include a table of internal failure reasons (for the implementer's understanding,
not for the external response): invalid VP signature, invalid VC signature,
expired credential, revoked credential, replay detected (vpId already consumed),
target service mismatch, malformed VP.

For each internal reason: what the verifier should do (log it, return
VP_VERIFICATION_FAILED to the caller, do not expose the internal reason).

#### 2.6 Wiring Into Fastify Middleware
A complete preHandler hook. Reads the VP from the Authorization header,
calls `POST /v1/vp/verify`, attaches `{ agentDid, userDid, verifiedAt, scopes }`
to the request object, calls next() on success, returns 401 with
`{ error: 'VP_VERIFICATION_FAILED' }` on failure. Handles the case where
Helix ID itself is unreachable (network error → 503, not 401).

#### 2.7 Wiring Into Express Middleware
The same as 2.6 but using Express middleware signature
`(req, res, next) => void`.

### 3. Path 2 — Session JWT

#### 3.1 When to Use This
Services that receive multiple requests from the same agent within a short window
and want to reduce the number of Helix ID calls. The agent presents its VP once,
gets a JWT, and the verifier checks subsequent calls locally for up to 10 minutes.
When the JWT expires, the agent presents its VP again — there are no refresh tokens.

#### 3.2 How It Works End to End
Step by step:
1. Verifier calls `POST /v1/vp/verify` with `{ signedVP, session: true }`
2. On success, Helix ID returns the normal verification response plus
   `{ session: { token, expiresAt, publicKeyEndpoint } }`
3. Verifier fetches `GET /v1/sessions/public-key` once and caches the public key
4. For subsequent requests from the same agent, verifier calls
   `sdk.verifySessionToken(token, publicKeyHex)` locally — no network call
5. When the JWT expires (10 minutes), the agent must present its VP again
   to get a new JWT

#### 3.3 Fetching and Caching the Public Key
The endpoint: `GET /v1/sessions/public-key`. What it returns. How to cache it
in the verifier process. When to re-fetch: after a Helix ID key rotation
(HELIX_JWT_SIGNING_KEY change). A TypeScript code example.

#### 3.4 Verifying Session Tokens Locally
The SDK method: `sdk.verifySessionToken(token, publicKeyHex)`. What it returns
on success. What it throws on failure. A complete TypeScript code example.

#### 3.5 Handling JWT Expiry
When `sdk.verifySessionToken` throws due to expiry, the verifier should return
a response that instructs the agent to present a fresh VP. A TypeScript code
example showing this pattern.

#### 3.6 What Session JWT Does Not Replace
The Session JWT is a short-lived session layer, not a permanent trust cache.
It does not replace revocation checking for the initial VP — the first
`POST /v1/vp/verify` call still checks revocation. If a credential is revoked,
existing Session JWTs issued before revocation remain valid until they expire
(up to 10 minutes). For high-security systems where 10-minute revocation lag
is unacceptable, use Path 1 on every request instead.

### 4. Path 3 — Self Verification

#### 4.1 When to Use This
Air-gapped or high-throughput environments where a network call to Helix ID
per request is not acceptable. The verifier takes full responsibility for
every check. Link to the self-verify.ts example in examples/.

#### 4.2 What You Are Now Responsible For
Enumerate explicitly — missing any one of these is a security gap:
- DID resolution from Hedera
- VP signature verification (Ed25519 via @noble/curves)
- VC signature verification against the Helix ID issuer public key
- Expiry checking
- StatusList2021 fetching and bit checking
- vpId replay protection using your own store

#### 4.3 Step by Step

##### 4.3.1 Resolve DID Document from Hedera
How to resolve the agent's DID from Hedera using `sdk.resolveDID(did)` for
`did:hedera:` format. What the DID document returns and which field contains
the public key.

##### 4.3.2 Verify VP Signature
How to verify the VP's proof against the public key from the DID document.
The algorithm: Ed25519 via `@noble/curves`. A TypeScript code snippet.

##### 4.3.3 Verify VC Signature Against Issuer Key
How to verify the embedded VC's signature against the Helix ID issuer public key.
Where to get the issuer public key: from environment config, not fetched at
runtime. Why: fetching it at runtime from Helix ID reintroduces the network
dependency self-verification was meant to avoid. A TypeScript code snippet.

##### 4.3.4 Check Expiry
The field in the VC to check. How to compare it to current time correctly.
What timezone assumptions to avoid.

##### 4.3.5 Check StatusList2021
How to fetch the StatusList credential from the URL in the VC at
`GET /v1/status-list/:listId`. How to decode the compressed bitstring.
How to check the bit at the credential's index. A TypeScript code snippet.
Note: this is the one remaining network dependency in self-verification.

##### 4.3.6 vpId Replay Protection — Your Responsibility
Self-verification has no shared vpId store. The verifier must implement one.
What to store: the vpId and the time it was consumed. Minimum TTL: the VC expiry.
Why this matters: without a vpId store, an intercepted VP can be re-presented
indefinitely until the credential expires. This is not optional.

### 5. Path 4 — SDK Helper

#### 5.1 When to Use This
Node/TypeScript services that want self-verification logic without implementing
each step manually.

#### 5.2 The SDK Method
`sdk.verifyVP(signedVP, options?)`. What it does internally: wraps the
self-verification steps from Path 3. What options it accepts.
What it returns on success. What it throws on failure.

#### 5.3 What It Does Not Handle
Replay protection. The caller is still responsible for checking and recording
the vpId after calling this method. A code example showing the correct pattern:
call `sdk.verifyVP`, then check the vpId against your own store before
granting access.

### 6. Scope Checking After Verification
Verification (any path) confirms the VP is valid. It does not confirm the agent
is permitted to perform this specific action. The verifier owns scope checking.

A complete TypeScript function `requiresScope(verifiedPayload, requiredScope)`
that the reader can lift directly into their middleware. Show how to use it after
any of the four verification paths. Explain the distinction: verification is
authentication, scope checking is authorization.

### 7. Handling Verification Failures

#### 7.1 External Response
Always return `{ error: 'VP_VERIFICATION_FAILED' }` to the caller regardless
of the internal reason. Never expose whether the failure was due to revocation,
bad signature, replay, or expiry.

#### 7.2 What to Log Internally
The full internal reason, the agent DID if extractable, the vpId if present,
the timestamp, and the verification path used.

#### 7.3 What the Agent Should Do for Each Failure Type
- Invalid signature: agent should re-generate and re-sign the VP
- Expired credential: agent must renew or re-enroll
- Revoked credential: agent must contact the agent owner
- Replay detected: agent must request a new VP template and sign a fresh VP
- Scope mismatch: agent does not have permission; return 403 not 401

### 8. What Not to Do

#### 8.1 Never Cache VP Verification Results
State this as a hard rule. The Session JWT path is the supported mechanism
for reducing per-request Helix ID calls. Ad-hoc caching of VP results is not.

#### 8.2 Never Skip Revocation Checking
A VP with a valid signature from a revoked credential is still invalid.
Signature validity and revocation status are independent checks. Both required.

#### 8.3 Never Skip Target Service Check
A VP is bound to a specific target service. The verifier must confirm the
target service in the VP matches itself before accepting the presentation.

#### 8.4 Never Expose Internal Failure Reasons
The external error is always `VP_VERIFICATION_FAILED`. Internal reasons
belong in the audit log only.

## Constraints

- Read the actual verification endpoint implementation in helix-api before writing.
  Request/response shapes must match the actual implementation.
- Read the actual SDK verifyVP and verifySessionToken methods before writing
  sections 4 and 5. Name the real methods with real signatures.
- All code snippets must be TypeScript using fetch — no axios, no got,
  no other HTTP libraries.
- Ed25519 via @noble/curves is the signing algorithm throughout.
  Do not mention any other crypto library.
- Link to self-verify.ts in examples/ at the start of section 4.
- Link to verify-vp.ts in examples/ at the start of section 2.
- Link to TRUST-MODEL.md section 6 at the start of this document.
