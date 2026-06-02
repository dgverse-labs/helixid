# Prompt — TRUST-MODEL.md

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, and docs/. Write docs/TRUST-MODEL.md for the Helix ID repository.

## What this document is

The security architecture document. More precise and more opinionated than
CONCEPTS.md. Written for a developer or security reviewer who needs to understand
exactly who is responsible for what, what the attack surface is, and what Helix ID
does and does not protect against. A reader who finishes this document should be
able to make confident security decisions when integrating Helix ID into their system.

## Tone and style

- Precise. Prefer exact statements over approximate ones.
- No hedging. If something is a security responsibility, say so directly.
- Short paragraphs. One claim per paragraph.
- Where there is a common mistake, name it as a mistake.
- No code blocks. This is an architecture document.

## Sections to write

### 1. Parties in the System

#### 1.1 Helix ID (Issuer)
What Helix ID is in the trust model: the credential issuer and the verification
API provider. What it controls: the VC signing key (`HELIX_SIGNING_KEY`), the
JWT signing key (`HELIX_JWT_SIGNING_KEY`), the StatusList, the VP replay store,
the enrollment token lifecycle, challenge nonces during enrollment, and the
service registry. These two signing keys are always separate values — they sign
different artifacts and must never be the same key.

#### 1.2 The Agent Owner
The developer or company that onboards and operates an agent. What the agent
owner controls: enrollment token creation (via the Helix ID dashboard or API),
scope definitions embedded in tokens, credential revocation, and the admin key.
The agent owner is the root of trust for what an agent is permitted to do.
Note: the agent owner and the operator (who deploys Helix ID) may be the same
person in a self-hosted setup but are distinct roles in a multi-tenant model.

#### 1.3 The Operator
The entity that deploys and runs the Helix ID instance. What the operator controls:
the Helix ID signing keys, the Hedera account and HCS topic, the database, and
the runtime environment. In a self-hosted setup the operator and agent owner are
the same. In a managed setup they are different parties.

#### 1.4 The Agent
The running software that holds a wallet and presents VPs. What the agent controls:
its private key and the encrypted wallet file on its filesystem. What the agent
cannot do: escalate its own scopes, forge a VC, sign a VP that Helix ID would
treat as issued by a different agent, or present a VP to a service it was not
credentialed for without detection.

#### 1.5 The Verifier (External Service)
The service or system that receives VP presentations and decides whether to grant
access. What the verifier controls: the decision to call the Helix ID verification
API, use the Session JWT path, or self-verify; the scope-to-action mapping; and
session management after a successful verification.

#### 1.6 Hedera Network
The public ledger. Its role is narrow but foundational: it provides an immutable,
ordered log of DID document operations that anyone can read without trusting
any party in the system.

### 2. Trust Relationships

#### 2.1 Agent Owner Trusts Helix ID to Issue Correctly
The agent owner defines scopes in the enrollment token. Helix ID is trusted to
embed those exact scopes into the VC and sign it accurately with `HELIX_SIGNING_KEY`.

#### 2.2 Verifier Trusts Helix ID as Issuer
The verifier trusts that a VC signed by Helix ID's issuer key was issued
legitimately. This trust is established by knowing the issuer public key,
not by calling Helix ID at verification time.

#### 2.3 Verifier Trusts Hedera for DID Resolution
The verifier trusts that the DID document resolved from Hedera reflects the
agent's actual public key. This trust derives from Hedera's tamper-evidence,
not from Helix ID.

#### 2.4 Agent Trusts Helix ID for VP Templates
The agent requests an unsigned VP template from Helix ID before signing.
The agent trusts that the template reflects the correct target service,
user DID, vpId, and nonce. This is the one Helix ID interaction the agent
performs per request cycle.

#### 2.5 Verifier Trusts Helix ID for Session JWT Public Key
When using the Session JWT path, the verifier fetches the JWT public key once
from Helix ID and caches it. All subsequent JWT verification is local. This is
a one-time trust establishment, not a per-request dependency.

#### 2.6 Nobody Trusts the Agent's Claims Without a VP
An agent that presents an unverified claim about its identity or permissions
receives no trust. The VP is the only accepted form of self-assertion.

### 3. What Helix ID Is Responsible For

#### 3.1 DID Creation and Anchoring
Creating the DID document, writing it to Hedera HCS, and serving DID resolution
as a convenience API. The ground truth is Hedera, not Helix ID's database.

#### 3.2 VC Issuance and Signing
Embedding the correct `credentialSubject.privilegeScopes`, expiry, subject DID,
and StatusList metadata into the VC and signing it with `HELIX_SIGNING_KEY`.

#### 3.3 Challenge Nonce Management
During enrollment, Helix ID issues a short-lived challenge nonce to the agent.
The agent signs it with its private key to prove key ownership. Helix ID verifies
the signature and burns the nonce. This step cannot be skipped.

#### 3.4 Revocation Status Serving
Maintaining and serving the StatusList2021 credential at `GET /v1/status-list/:listId`
so verifiers can check revocation status without calling Helix ID for a per-VC answer.

#### 3.5 Replay Record Keeping
Recording consumed vpIds and rejecting duplicates. This state is owned entirely
by Helix ID when using the API verification path. A verifier that self-verifies
must implement its own vpId store.

#### 3.6 Session JWT Issuance
When a verifier passes `session: true` with a VP verification request, Helix ID
issues a short-lived JWT signed with `HELIX_JWT_SIGNING_KEY`. This key is always
separate from `HELIX_SIGNING_KEY`.

#### 3.7 Service Registry Maintenance
Helix ID stores and serves verified service endpoint records. Agents query the
registry before communicating with external services.

### 4. What the Agent Owner Is Responsible For

#### 4.1 Defining Scopes Correctly
Scopes embedded in the VC reflect exactly what the agent owner specified in the
enrollment token. Over-permissioned tokens produce over-permissioned credentials.
The agent owner owns this decision entirely.

#### 4.2 Revoking Credentials When Needed
When an agent is decommissioned, a key is compromised, or user consent is withdrawn,
the agent owner must revoke the credential. Helix ID has no way to know when
revocation is warranted — only the agent owner does.

#### 4.3 Protecting the Admin Key
The admin API key controls enrollment token creation and credential revocation.
A compromised admin key allows an attacker to enroll arbitrary agents or revoke
legitimate ones. This key must be treated as a root credential.

#### 4.4 Setting Delegation Boundaries
If delegation is needed, the agent owner must explicitly set `maxDelegationDepth`
greater than 0 at enrollment token creation. The default is 0 — delegation is
off unless explicitly enabled.

### 5. What the Agent Is Responsible For

#### 5.1 Protecting the Private Key
The private key never leaves the agent. If it is extracted or copied, an attacker
can sign VPs on behalf of the agent until the credential is revoked. Wallet
encryption is the agent's responsibility to maintain.

#### 5.2 Not Sharing the Wallet
The wallet file contains the private key in encrypted form. Sharing it, backing
it up to an insecure location, or logging its contents compromises the agent's
identity.

#### 5.3 Requesting VPs Only for Intended Services
The VP template includes a target service. An agent that requests a VP for
service A and presents it to service B will be rejected at the target service
check. This is a safety property, not a usability limitation.

### 6. What the Verifier Is Responsible For

#### 6.1 Calling Verification on Every Request (API Path)
A VP verified once is not valid for subsequent requests. The verifier must call
the verification API on every VP it receives. Caching a VP verification result
is a security mistake.

#### 6.2 Scope Checking After Verification
Verification confirms the VP is cryptographically valid and the credential is
active. It does not confirm the agent is permitted to perform the specific action.
The verifier owns the scope-to-action mapping.

#### 6.3 Implementing Its Own vpId Store (Self-Verify Path)
A verifier that self-verifies has no access to Helix ID's replay store. It must
implement its own vpId store, recording each consumed vpId with a TTL of at
least the VC expiry. Skipping this is a replay vulnerability.

#### 6.4 Not Caching VP Verification Results (API Path)
Do not store "this agent was verified at time T, trust it until time T+N." The
VP model is per-request stateless by design. The Session JWT path is the
supported mechanism for reducing per-request Helix ID calls — not ad-hoc caching.

### 7. Threat Model

#### 7.1 Compromised Agent Private Key
What an attacker can do: sign arbitrary VPs for any service the agent's VC permits,
for as long as the VC is valid. Mitigation: agent owner revokes the credential
immediately. Detection: anomalous VP presentations in the audit log.

#### 7.2 Compromised Helix ID VC Signing Key (HELIX_SIGNING_KEY)
What an attacker can do: issue forged VCs with arbitrary scopes and subjects.
This is a catastrophic failure mode. Mitigation: key rotation — verifiers must
re-establish trust against the new issuer public key after rotation. Key protection
is the most critical operational concern for a Helix ID operator.

#### 7.3 Compromised Helix ID JWT Signing Key (HELIX_JWT_SIGNING_KEY)
What an attacker can do: forge Session JWTs that verifiers accept as valid for
up to 10 minutes per token. Because Session JWTs are verified locally without
calling Helix ID, revocation of a forged token requires rotating the key and
invalidating all verifiers' cached public keys. Mitigation: rotate the key,
redistribute the new public key endpoint response.

#### 7.4 VP Replay Attack
What an attacker can do: intercept a valid signed VP and re-present it to the
same verifier. Mitigation (API path): the vpId is consumed on first verification.
Subsequent presentations of the same VP are rejected. Mitigation (self-verify path):
the verifier must implement its own vpId store. A self-verifier without a vpId
store is fully vulnerable to replay.

#### 7.5 Scope Escalation Attempt
What an attacker can do: present a VP and claim additional scopes not in the VC.
Why this fails: scopes are in `credentialSubject.privilegeScopes`, which is signed
by Helix ID. The verifier checks the VC signature before reading any claims.
A modified VC fails signature verification.

#### 7.6 Revocation Bypass Attempt
What an attacker can do: present a VP from a revoked credential, hoping the
verifier does not check revocation. A verifier that skips the StatusList check
is choosing to be vulnerable. This is a verifier implementation failure.

#### 7.7 DID Document Tampering
What an attacker would need: write access to the Hedera HCS topic admin key.
If tampered, DID resolution produces an incorrect public key and VP signature
verification fails.

#### 7.8 Delegation Chain Attack
What an attacker can do: present a VP with a delegated VC whose parent VC has
been revoked. Why this fails: a revoked intermediary VC blocks the entire chain.
Verifiers checking a delegated VP must verify the full chain, not just the
leaf VC.

### 8. What Helix ID Does Not Protect Against

A direct, honest list. No hedging:
- An agent owner who grants excessive scopes at enrollment
- A verifier that does not check scopes after verification
- A verifier that caches VP verification results instead of using the Session JWT path
- A self-verifier that skips the revocation check
- A self-verifier that skips vpId tracking
- Physical or OS-level access to the agent's wallet file
- A compromised `HELIX_SIGNING_KEY` if the operator does not rotate it promptly
- A compromised `HELIX_JWT_SIGNING_KEY` if the operator does not rotate it promptly
- Network-level attacks between the agent and the verifier

### 9. Security Assumptions
The explicit assumptions the trust model depends on:
- The Hedera HCS topic admin key is not compromised
- `HELIX_SIGNING_KEY` and `HELIX_JWT_SIGNING_KEY` are not compromised
- `HELIX_SIGNING_KEY` and `HELIX_JWT_SIGNING_KEY` are different values
- The agent owner admin key is not compromised
- The agent wallet file is stored on a system the agent process controls
- The verifier calls verification on every request without ad-hoc caching
  (or uses the Session JWT path for high-frequency calls)
- The StatusList endpoint is available when verifiers need it
- Self-verifiers implement their own vpId store

## Constraints

- Do not include code, API calls, or configuration.
- Do not describe how to call the revocation API. Link to handle-revocation guide.
- Do not describe how to implement scope checking. Link to verify-a-vp guide.
- This document makes security claims. Every claim must be accurate against
  the actual implementation. Read helix-api and helix-core before writing.
