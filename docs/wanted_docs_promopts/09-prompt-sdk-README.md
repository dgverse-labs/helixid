# Prompt — helix-sdk-js/README.md

You have full context of the Helix ID codebase, specifically the helix-sdk-js
package including all source files, type definitions, and exported methods.
Write helix-sdk-js/README.md — the standalone reference for the JS/TS SDK.

## What this document is

The complete reference for a developer building an agent using the Helix ID JS/TS
SDK. It is self-contained — a developer building an agent should be able to read
only this document and the OpenAPI spec and have everything they need. It covers
installation, wallet lifecycle, onboarding, VP operations, VC management,
session JWT verification, delegation, DID resolution, and error handling.
A reader who finishes this document can build a fully functional agent without
reading any other Helix ID doc.

## Tone and style

- Reference-first. Every method is documented completely.
- Code blocks for every method call, parameter, and return value.
- TypeScript throughout. No JavaScript examples.
- Where a method has side effects or makes network calls, say so explicitly.
- Where a method makes NO network call (local operation), say so explicitly —
  this is a security-relevant distinction for methods that touch the private key.
- Where a method can fail, list the errors it throws.
- Short prose. Let the code do the explaining where possible.

## Critical rules for this document

- The signing algorithm throughout is Ed25519 via `@noble/curves`.
  Do not mention any other crypto library anywhere in this document.
- Any method that touches the private key is a local operation with no network call.
  This must be stated explicitly for: `sdk.generateKeypair()`,
  `sdk.buildAndSignVP()`, and the enrollment challenge signing step.
- The wallet stores exactly four fields: `did`, `privateKeyHex`, `publicKeyHex`,
  `vcJson`. Do not add or remove fields.
- Document every exported SDK method. Read the actual source before writing.
  Do not invent methods. Do not omit methods.

## Sections to write

### 1. Installation
The exact npm install command for `@helixid/sdk`. Any peer dependencies.
The minimum Node version. Whether the SDK works in browser environments or
Node only, and why.

### 2. Quick Start
A single end-to-end code block: from wallet creation through enrollment to
a signed VP being presented to an external service. 25-35 lines maximum.
Comments only inside the block — no prose. Below the block, one sentence
pointing to the section that covers each step in detail.
Link to examples/e2e-travel-concierge/ as a working reference.

### 3. The Agent Wallet

#### 3.1 What the Wallet Is
The encrypted local file holding the agent's `did`, `privateKeyHex`,
`publicKeyHex`, and `vcJson`. The SDK manages it entirely. The developer
interacts with it only through `AgentWallet.save()` and `AgentWallet.load()` —
never by reading or writing the file directly.

#### 3.2 Creating a New Wallet — AgentWallet.save()
Full method signature. All parameters with types and descriptions.
Return value. What the method does: encrypts the wallet object and writes it
to the specified file path. A complete TypeScript code example.
Errors thrown: if the file path is not writable, if encryption fails.

#### 3.3 Loading an Existing Wallet — AgentWallet.load()
Full method signature. All parameters. Return value. What the method does:
reads and decrypts the wallet file, validates its structure, returns the wallet
object. A complete TypeScript code example.
Errors thrown: if the file does not exist, if the passphrase is wrong,
if the file is corrupted.

#### 3.4 Wallet Encryption
The encryption algorithm used. What the passphrase is and how the developer
provides it. Best practices: environment variable or secrets manager, never
hardcoded. What happens if the passphrase is lost: the wallet cannot be
recovered, re-enrollment is required.

#### 3.5 Wallet Field Reference
A table with four rows: `did`, `privateKeyHex`, `publicKeyHex`, `vcJson`.
For each: what it is, when it is written, whether it ever changes after
initial write (it changes on renewal).

### 4. Onboarding

#### 4.1 Step 1 — Generate Keypair: sdk.generateKeypair()
Full method signature. Return value: `{ privateKeyHex, publicKeyHex }`.
State explicitly: local operation, no network call. The private key is
generated in memory using Ed25519 via `@noble/curves`. It never leaves
the agent process. A complete TypeScript code example.
Note: the developer is responsible for keeping `privateKeyHex` in memory
until the wallet is saved in step 3 of onboarding.

#### 4.2 Step 2 — Submit Public Key: sdk.enroll()
Full method signature: `sdk.enroll({ enrollmentToken, publicKeyHex, domains })`.
Makes a network call to `POST /v1/enroll`. What it returns: the challenge nonce.
State explicitly: only the public key is submitted — the private key is never sent.
What Helix ID does on receipt: validates the token, burns it, anchors the DID on
Hedera, returns the challenge nonce.
Errors thrown: token expired, token already used, invalid public key format.
A complete TypeScript code example.

#### 4.3 Step 3 — Complete Enrollment: sdk.completeEnrollment()
Full method signature: `sdk.completeEnrollment({ signature })`.
Makes a network call to `POST /v1/enroll/verify`.
What to pass as `signature`: the challenge nonce signed with the agent's
private key using Ed25519. State explicitly: the signing happens locally
before calling this method — `completeEnrollment` only submits the signature,
it does not touch the private key internally.
What it returns: the issued VC as a JSON object.
Errors thrown: challenge expired, invalid signature, anchoring failure.
A complete TypeScript code example showing the full three-step sequence:
generateKeypair → sign nonce locally → completeEnrollment → save wallet.

### 5. Working With VPs

#### 5.1 Requesting a VP Template: sdk.requestVPTemplate()
Full method signature. Parameters: target service identifier, `delegatedBy`
(userDID of the user on whose behalf the agent is acting).
Makes a network call to `POST /v1/vp/template`.
Return value: the unsigned VP template containing `{ agentVC, delegatedBy,
vpId, nonce, expiresAt }`. Explain each field.
A complete TypeScript code example.

#### 5.2 Signing a VP Locally: sdk.buildAndSignVP()
Full method signature: `sdk.buildAndSignVP(unsignedVP, privateKeyHex)`.
State explicitly: local operation, no network call. Signs the VP using
Ed25519 via `@noble/curves`. The private key is used in memory and never
transmitted. Returns the signed VP as a JSON object.
A complete TypeScript code example.

#### 5.3 The Request-Sign-Present Pattern
A combined code example showing the full cycle: request template → sign locally
→ add to Authorization header → call the target service. 15-20 lines maximum.
This is the pattern most agent developers will copy into their codebase.

#### 5.4 What the Signed VP Contains
A field-by-field breakdown: the embedded VC, the `proof` block (Ed25519 signature),
`vpId`, `delegatedBy` (userDID), `nonce`, `expiresAt`, target service.
For each field: what it is and why a verifier cares about it.

### 6. VP Verification (Verifier-Side SDK Methods)

#### 6.1 sdk.verifyVP()
Full method signature: `sdk.verifyVP(signedVP, options?)`.
Makes a network call to `POST /v1/vp/verify`.
What it verifies: delegates all checks to the Helix ID verification API.
Return value on success. Errors thrown on failure.
Important: this method does NOT handle vpId replay tracking. After calling
this method successfully, the caller must record the vpId in their own store
to prevent replay if using the self-verify path. When using the API path,
Helix ID handles vpId consumption.
A complete TypeScript code example.

#### 6.2 sdk.verifySessionToken()
Full method signature: `sdk.verifySessionToken(token, publicKeyHex)`.
State explicitly: local operation, no network call. Verifies the JWT signature
using Ed25519 via `@noble/curves` against the provided public key.
Return value on success: the decoded JWT payload.
Errors thrown: token expired, invalid signature, malformed token.
A complete TypeScript code example.

#### 6.3 sdk.fetchSessionPublicKey()
Full method signature. Makes a network call to `GET /v1/sessions/public-key`.
Return value: the public key string. How to use with `sdk.verifySessionToken()`.
When to call: once on startup, then again after a key rotation.
A complete TypeScript code example showing fetch-once-and-cache pattern.

### 7. VC Management

#### 7.1 Reading the Current VC
How to read the VC from the wallet object: `wallet.vcJson`. What it contains.
When to use this: checking `credentialSubject.privilegeScopes` before attempting
an action, logging the agent's credential state on startup.

#### 7.2 Checking Expiry
How to read the expiry from the VC. How to compare correctly against current time.
A code example showing a pre-flight expiry check pattern that decides whether
to renew before attempting an operation.

#### 7.3 Credential Renewal: sdk.renewVC()
Full method signature. Makes a network call to `POST /v1/vcs/:vcId/renew`.
What it returns: the new VC. What the developer must do after: update the
wallet using `AgentWallet.save()` with the new `vcJson`.
What stays the same: `did`, `privateKeyHex`, `publicKeyHex`.
What changes: `vcJson`.
Errors thrown: credential not yet expired (too early to renew), credential
already revoked (renewal not possible — re-enrollment required).
A complete TypeScript code example.

### 8. DID Resolution

#### 8.1 sdk.resolveDID()
Full method signature: `sdk.resolveDID(did)`.
Behaviour depends on DID format:
- `did:hedera:testnet:...` or `did:hedera:mainnet:...`: makes a network call
  to resolve from Hedera via the Helix ID API
- Note: `did:key:` format is planned but not yet implemented

Return value: the DID document containing the public key and service endpoints.
Errors thrown: DID not found, network failure, invalid DID format.
A complete TypeScript code example.

### 9. Delegation

#### 9.1 sdk.delegate()
Full method signature: `sdk.delegate({ delegateeAgentDid, requestedScopes, ... })`.
What it does: signs a VP locally (local operation), then calls
`POST /v1/vcs/delegate` (network call). Helix ID verifies the parent agent's VP
and issues a child VC to the delegatee agent.
Prerequisites: the parent agent's VC must have `maxDelegationDepth` greater than 0.
If `maxDelegationDepth` is 0, delegation is blocked at Helix ID.
Constraints enforced by Helix ID: child scopes cannot exceed parent scopes,
child expiry cannot exceed parent expiry.
Return value: the child VC issued to the delegatee.
Errors thrown: delegation not permitted (maxDelegationDepth is 0), scope
escalation attempt, delegatee DID not found.
A complete TypeScript code example.

### 10. Error Types

#### 10.1 Full Error Reference
A table of every error class or code the SDK can throw, organised by category:

Wallet errors: WalletNotFound, WalletDecryptionFailed, WalletCorrupted
Onboarding errors: EnrollmentTokenExpired, EnrollmentTokenUsed,
  ChallengeExpired, InvalidSignature, AnchoringFailed
VP errors: VPTemplateFailed, VPSigningFailed, VPVerificationFailed
VC errors: VCRenewFailed, VCRevoked, VCNotExpired
Session errors: SessionTokenExpired, SessionTokenInvalid
Delegation errors: DelegationNotPermitted, ScopeEscalationAttempt
Network errors: HelixAPIUnreachable, RequestTimeout

For each: the error class name, the condition that causes it, and the
recommended response from the calling code.

Read the actual SDK source to ensure this list is complete and accurate.
Do not invent error names. Do not omit errors that exist.

#### 10.2 Recoverable vs Non-Recoverable Errors
Two lists.
Recoverable (retry or corrective action possible): ChallengeExpired,
  VPTemplateFailed, HelixAPIUnreachable, RequestTimeout, SessionTokenExpired.
Non-recoverable (re-enrollment or agent owner intervention required):
  EnrollmentTokenExpired, EnrollmentTokenUsed, VCRevoked, WalletCorrupted,
  DelegationNotPermitted.

#### 10.3 Error Handling Patterns
Two code examples.
First: retry with backoff for transient network errors around VP template requests.
Second: graceful degradation when VPVerificationFailed is returned — stop
attempting credentialed actions, notify upstream, wait for agent owner action.

### 11. TypeScript Types Reference
A complete list of every exported type and interface from the SDK.
For each: the name, a one-sentence description, and the key fields with types.
Organise alphabetically. Read the actual TypeScript source and type definitions.
Do not invent types. Do not omit exported types.

### 12. Changelog
The current version and what changed in it. If no changelog exists yet,
write the section header and note that entries will be added with each release.
Do not fabricate version history.

## Constraints

- Read every source file in helix-sdk-js before writing. Every method name,
  parameter, return type, and error class must match the actual implementation.
- Do not document methods that do not exist. Do not omit methods that do exist.
- The full method list to document: `sdk.generateKeypair()`, `sdk.enroll()`,
  `sdk.completeEnrollment()`, `AgentWallet.load()`, `AgentWallet.save()`,
  `sdk.buildAndSignVP()`, `sdk.verifyVP()`, `sdk.verifySessionToken()`,
  `sdk.fetchSessionPublicKey()`, `sdk.delegate()`, `sdk.resolveDID()`,
  and any additional methods found in the actual source.
- Every method that touches the private key must be documented as a local
  operation with no network call.
- The crypto library is `@noble/curves` (Ed25519). Do not mention any other
  library.
- `did:key:` format is planned but not implemented. Do not document it as
  currently available.
- Link to ENROLLMENT-FLOW.md in section 4.
- Link to guides/verify-a-vp.md in section 6.
- Link to examples/e2e-travel-concierge/ in section 2.
