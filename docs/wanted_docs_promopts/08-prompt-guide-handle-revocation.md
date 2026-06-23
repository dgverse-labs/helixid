# Prompt — guides/handle-revocation.md

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, and docs/. Write docs/guides/handle-revocation.md for the Helix ID
repository.

## What this document is

A complete operational playbook for credential revocation — written for all three
parties simultaneously: the agent owner who triggers revocation, the verifier who
detects it, and the agent that must respond to it. A reader from any of these
roles should find a clear, complete path through this document without reading
sections irrelevant to them. A reader who finishes this document has no ambiguity
about what to do when a credential is revoked.

## Tone and style

- Decisive. Revocation is a response to a problem. The document should feel
  like a runbook, not an essay.
- Label every section with the party it is written for: [Agent Owner], [Verifier],
  or [Agent]. Readers can skip sections that do not apply to them.
- Code blocks for every API call and code snippet.
- State consequences directly. If skipping a step creates a security gap, say so.
- Short paragraphs. One action or one concept per paragraph.

## Sections to write

### 1. What Revocation Is and Is Not

#### 1.1 Revocation vs Expiry
owner's response to something going wrong. A revoked credential is invalid from
the moment the revocation API call completes, regardless of its expiry date.

#### 1.2 What Gets Revoked — Credential, Not Agent
Revocation targets a specific VC, not the agent's DID. The agent's identity
agent owner decides to restore its access. Revocation is not permanent
decommissioning unless the agent owner also deactivates the DID.

#### 1.3 How Quickly Revocation Takes Effect
The StatusList bit is set to 1 at the moment the revocation API call completes.
The next VP verification that fetches the StatusList will see the credential
as revoked. There is no propagation delay within Helix ID itself.

Important exception for Session JWT path: Session JWTs issued before revocation
remain valid for up to 10 minutes (their remaining TTL). Verifiers using the
Session JWT path may not detect revocation until the JWT expires and the agent
presents a new VP. For systems where immediate revocation detection is required,
use `POST /v1/vp/verify` on every request (Path 1) — not the Session JWT path.

### 2. When to Revoke [Agent Owner]

#### 2.1 User Withdraws Consent
The user who authorized the agent to act on their behalf revokes that authorization.
Revoke immediately. Timing matters: revoke before notifying the agent, not after.

#### 2.2 Compromised Private Key
The agent's private key is known or suspected to have been extracted from the wallet.
This is the most urgent revocation scenario. Any party with the private key can
sign valid VPs until the credential is revoked. Revoke immediately. Issue a new
enrollment token only after the key compromise is understood and contained.

#### 2.3 Incorrect Scopes Issued
The enrollment token contained incorrect scopes and the resulting credential
gives the agent more permissions than intended. If over-permissioned: revoke
immediately and re-enroll with correct scopes. If under-permissioned: revocation
is optional — the agent simply cannot do what it needs to until re-enrolled.

#### 2.4 Anomalous Agent Behavior
The audit log shows VP presentations to unexpected services, at unexpected rates,
or for unexpected scopes. Revoke first, investigate second.

#### 2.5 Agent Decommissioned
The agent is being retired. Revoke the credential. If the agent will never be
re-enrolled, also deactivate its DID via `POST /v1/dids/:did/deactivate`.
Deactivating the DID removes the public key from the resolvable DID document,
making any VP signed with the agent's key unverifiable by self-verifiers.

### 3. How to Revoke [Agent Owner]

#### 3.1 The Revocation API Call
The endpoint: `POST /v1/vcs/:vcId/revoke`. Requires the admin API key in the
Authorization header. A complete curl example. What the successful response
looks like.

#### 3.2 Finding the Credential ID
How to retrieve the vcId: from the enrollment log, from `GET /v1/vcs/:vcId`,
or from the audit log. A curl example for finding the right credential by
agent DID.

#### 3.3 What Happens Internally
Helix ID sets the StatusList bit to 1 for this credential's index. The VC record
is updated with a revocation timestamp. An audit log entry is written.
The change takes effect immediately for any subsequent verification that
fetches the StatusList.

#### 3.4 Confirming Revocation Took Effect
How to verify: fetch the credential via the API and check its status field.
A curl example. Optionally: fetch the StatusList directly at
`GET /v1/status-list/:listId` and verify the bit at the credential's index is set.

#### 3.5 Revoking a Delegation Chain
Revoking a parent VC invalidates all child VCs below it in the delegation chain.
To revoke only a specific child VC without affecting the parent or siblings,
use `POST /v1/vcs/:vcId/revoke` with the child's vcId specifically.

### 4. Detecting Revocation [Verifier]

#### 4.1 Via API Verification (Path 1)
`POST /v1/vp/verify` checks the StatusList on every call. A revoked credential
causes the endpoint to return `VP_VERIFICATION_FAILED`. This is the same error
code returned for all verification failures — the external response never reveals
that the specific reason is revocation. Log the internal reason; return
`VP_VERIFICATION_FAILED` to the caller.

#### 4.2 Via Session JWT Path (Path 2)
Session JWTs issued before revocation remain valid until they expire (up to
10 minutes). The verifier will not detect revocation on JWT-verified calls
until the JWT expires and the agent presents a new VP. See section 1.3 for
the implication. If immediate revocation detection is required, do not use
the Session JWT path.

#### 4.3 Via Self-Verification (Path 3)
The verifier fetches the StatusList at `GET /v1/status-list/:listId` and checks
the bit at the credential's index. If the bit is 1, the credential is revoked.
Treat this as a hard failure. A code snippet showing the bit check.

#### 4.4 What to Return to the Agent
Return a 401 with body `{ error: 'VP_VERIFICATION_FAILED' }`. Do not reveal
that the specific failure reason is revocation. The agent receives the same
opaque error it would receive for any other verification failure.

#### 4.5 What Not to Reveal in the Error Response
Do not include: revocation timestamp, reason for revocation, the agent owner's
identity, or the StatusList index. Internal audit log receives the full detail.

#### 4.6 Logging Revocation Detection
What to log: timestamp, agent DID, vpId, verification path used, and the
specific internal failure reason (revoked). This gives the agent owner an
evidence trail.

### 5. Handling Revocation [Agent]

#### 5.1 What the Agent Receives
A 401 response with `{ error: 'VP_VERIFICATION_FAILED' }` from the verifier.
The agent does not receive the internal reason. Treat any VP_VERIFICATION_FAILED
response as potentially revocation-related, especially if the credential has
not expired.

#### 5.2 Distinguishing Revocation From Other Failures
The agent can check its VC's expiry date locally. If not expired but
VP_VERIFICATION_FAILED is returned, the likely cause is revocation or a key
issue. The agent can confirm by attempting to request a new VP template from
Helix ID — a revoked credential will cause that request to fail with a
specific error code from Helix ID (not the opaque external code).

#### 5.3 Graceful Degradation
Do not retry the same VP after VP_VERIFICATION_FAILED. Stop attempting actions
that require the revoked credential. Notify the upstream system or user.
Wait for agent owner action. A TypeScript code pattern showing this behavior.

#### 5.4 Notifying Upstream
What the agent should communicate: it cannot currently perform credentialed
actions, the agent owner needs to be contacted, and no action has been taken
since detecting the failure. Do not expose Helix ID internals to the end user.

#### 5.5 Re-enrollment Path
The agent cannot self-re-enroll. It must receive a new enrollment token from
the agent owner. Once it has the token it follows the standard enrollment flow.
Reference ENROLLMENT-FLOW.md for the full sequence.

### 6. StatusList2021 Internals

#### 6.1 How the Bit Gets Set
The StatusList is a compressed bitstring. Each issued credential is assigned
an index at issuance — the bit at that index is 0 (active). When revoked,
Helix ID sets the bit to 1. The bitstring is re-encoded and the StatusList
credential at `GET /v1/status-list/:listId` is updated. Explain this in plain
English without assuming the reader knows the W3C spec.

#### 6.2 The StatusList Credential
The StatusList is itself a signed credential. Verifiers should verify its
signature before reading the bitstring — this prevents a man-in-the-middle
from serving a fake StatusList with manipulated bits.

#### 6.3 Caching Considerations
Verifiers may cache the StatusList for performance. Short TTL (seconds to low
minutes) is acceptable for most systems. Never cache longer than the sensitivity
of the scopes in the credential warrants. For credentials with high-risk scopes,
do not cache at all — fetch on every verification.

#### 6.4 Further Reading
Link to the W3C StatusList2021 specification for readers who want to implement
status checking in environments not covered by Helix ID's SDK or API.

## Constraints

- Read the actual revocation endpoint implementation in helix-api before writing.
  The endpoint path, request shape, response shape, and error code must match
  the actual implementation.
- The external error code for all verification failures is `VP_VERIFICATION_FAILED`.
  Use this exact string. Do not invent a different error code.
- The Session JWT revocation lag (up to 10 minutes) must be documented clearly
  in sections 1.3 and 4.2. This is a known limitation of the Session JWT path,
  not a bug.
- The StatusList internals must be accurate against the actual StatusList2021
  implementation in helix-core.
- Every API call section must include a complete curl example.
- Link to guides/verify-a-vp.md for verifiers who need the full verification
  implementation context.
- Link to ENROLLMENT-FLOW.md for agents who need the re-enrollment steps.
- Link to the revocation-check.ts example in examples/ at the start of section 4.
- Link to the E2E example in examples/e2e-travel-concierge/ for readers who want
  to see revocation in a full working system.
