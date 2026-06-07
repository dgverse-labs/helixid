# Prompt — CONCEPTS.md

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, and docs/. Write docs/CONCEPTS.md for the Helix ID repository.

## What this document is

The mental model document. Written for a developer who knows software well but
has never worked with DIDs, VCs, or VPs. It explains why Helix ID works the way
it does — not how to use it. A reader who finishes this document should be able
to explain the trust model to a colleague and read any other Helix ID doc
without getting lost.

## Tone and style

- Teach, do not document. Every concept is introduced with a problem it solves,
  not a definition.
- Analogies are welcome where they genuinely clarify. Drop them when they stretch.
- No code blocks. This is a concepts document, not a guide.
- Short paragraphs. One idea per paragraph.
- Where a concept has a common misconception, name it directly.

## Sections to write

### 1. The Identity Problem for AI Agents
Two paragraphs. An agent calling an external service today has no portable,
verifiable identity. It might use an API key, but that key does not say who the
agent is, what it is allowed to do, or who authorized it. This section frames
the problem Helix ID solves before introducing any solution.

### 2. Decentralized Identifiers (DIDs)

#### 2.1 What a DID Is
A DID is a unique identifier that an agent controls, tied to a cryptographic
key pair. Unlike a username or API key, it does not depend on a central registry
to be valid. Explain this in plain English. Include the DID format used in Helix ID:
`did:hedera:testnet:z6Mk...` for production and `did:hedera:mainnet:z6Mk...`
for mainnet deployments.

#### 2.2 What a DID Document Contains
The public key and service endpoints associated with the DID. Explain what each
of these is and why it matters for an agent identity. Emphasise: the DID document
never contains a private key — the private key stays exclusively on the agent.

#### 2.3 Why Hedera for Anchoring
What anchoring means — writing the DID document to an immutable, public ledger
so anyone can resolve it without asking Helix ID. Why Hedera Consensus Service
specifically: ordered, timestamped, tamper-evident, public.

#### 2.4 How DID Resolution Works
What happens when a verifier resolves a DID: it reads the HCS topic, replays
the messages, and arrives at the current DID document. No central server needed.
Explain this without assuming Hedera knowledge.

### 3. Verifiable Credentials (VCs)

#### 3.1 What a VC Is
A signed statement from an issuer about a subject. In Helix ID, the issuer is
Helix ID itself and the subject is the agent. The statement says: this agent has
these privilege scopes, this expiry, and this revocation metadata. The VC is
signed by Helix ID using its `HELIX_SIGNING_KEY` — an Ed25519 key. Verifiers can
check this signature without contacting Helix ID at verification time.

#### 3.2 What Helix ID Puts in a VC

##### 3.2.1 Subject DID
The agent's DID. Links the credential to the agent's cryptographic identity.

##### 3.2.2 Privilege Scopes
The field is `credentialSubject.privilegeScopes`. It contains the list of actions
the agent is permitted to perform. Scopes are defined by the agent owner at
enrollment token creation and cannot be changed without issuing a new credential.
Explain why this immutability is a feature, not a limitation.

##### 3.2.3 Expiry
The credential has a defined lifetime. After expiry it is invalid even if never
revoked. The agent owner sets the expiry when creating the enrollment token.

##### 3.2.4 Revocation Metadata
A pointer to the StatusList entry for this credential — an index and a URL.
Explain that this is how a verifier checks whether the credential has been
revoked without asking Helix ID directly for a yes/no answer.

#### 3.3 Who Signs the VC and Why It Matters
Helix ID signs the VC with its `HELIX_SIGNING_KEY`. This is distinct from the
startup-ephemeral keypair used for Session JWTs — VC signing key material is
configured, while JWT session key material lives only in API memory. A verifier can check the VC signature against the
issuer public key without contacting Helix ID at verification time. Explain why
this matters for offline and self-verification scenarios.

### 4. Verifiable Presentations (VPs)

#### 4.1 What a VP Is
A VP is a signed wrapper the agent creates per request. It contains the VC,
`delegatedBy: userDID` (the user on whose behalf the agent is acting), a unique
`vpId`, a `nonce`, a short `expiresAt`, and the target service. The agent signs it
locally with its private key. Helix ID never signs VPs — that is exclusively
the agent's job.

#### 4.2 Why VPs Exist Separately From VCs
The VC is long-lived. The VP is single-use and short-lived. The agent does not
hand the VC to every verifier directly — it creates a fresh, purpose-specific
presentation each time. Explain why this is a security property: the VC never
travels directly; only a time-bound, purpose-bound wrapper does.

#### 4.3 What Makes a VP Single-Use
The `vpId` field — a unique identifier issued by Helix ID in the unsigned VP
template. Helix ID records it on first verification and rejects it on any
subsequent attempt. Explain this as replay protection without using the phrase
"replay attack" before the reader knows what that means in this context.

#### 4.4 The vpId and Replay Protection
What replay means in this context: an intercepted VP being re-presented by a
malicious party. How the vpId prevents this. What the reader should understand
about the single-use property when designing their system. Important nuance:
this protection is provided automatically when using the Helix ID verification
API. Verifiers who self-verify must implement their own vpId store.

### 5. The Trust Chain

#### 5.1 Hedera Anchors the DID
The foundation. Anyone can verify the DID document without trusting Helix ID
by reading Hedera directly.

#### 5.2 Helix ID Signs the VC
The second layer. Helix ID's signature on the VC means a verifier can confirm
the credential was issued legitimately by checking the issuer key.

#### 5.3 The Agent Signs the VP
The third layer. The agent's signature on the VP proves the VC holder created
this specific presentation, binding it to this request and this target.
The signing algorithm is Ed25519 throughout.

#### 5.4 The Verifier Checks All Three
What a full verification looks like in terms of the three trust anchors.
A verifier that checks only one or two is making a weaker trust decision.
Explain concretely what each layer catches.

### 6. StatusList2021

#### 6.1 What It Is
A revocation mechanism based on a compressed bitstring. Each bit corresponds
to one credential. 0 means active, 1 means revoked. Served by Helix ID at
`GET /v1/status-list/:listId`.

#### 6.2 How the Bitstring Works
The VC contains a StatusList index and a URL. The verifier fetches the StatusList
at the URL and checks the bit at the index. No credential IDs are exposed in
the list — only positions.

#### 6.3 Why This Is More Private Than a Revocation List
A traditional revocation list contains the IDs of revoked credentials. Anyone
who reads it knows which credentials were revoked. The StatusList bitstring
reveals nothing about which positions are revoked beyond what the holder
already knows about their own credential. Explain this clearly.

### 7. The Agent Wallet

#### 7.1 What Lives in the Wallet
Four things: `privateKeyHex`, `publicKeyHex`, `did`, and `vcJson`. This is the
complete set of materials the agent needs to operate. Explain what each is for.

#### 7.2 What Never Leaves the Agent
The private key. Explain this as a design decision with security consequences:
Helix ID cannot impersonate the agent because it never held the key. VP signing
happens locally inside the SDK — no network call is made during signing.

#### 7.3 Why Helix ID Never Holds the Private Key
The threat model reasoning. If Helix ID held private keys, a compromise of
Helix ID would compromise every agent. By generating keys locally, each agent's
identity is independent.

### 8. Scopes

#### 8.1 What Scopes Are
Strings in `credentialSubject.privilegeScopes` that describe permitted actions.
They are defined by the agent owner, embedded in the VC by Helix ID, and checked
by the verifier after the VP is validated. Helix ID stores and returns them but
does not enforce what they mean — that is the verifier's responsibility.

#### 8.2 How They Are Defined at Enrollment
The agent owner specifies them when creating the enrollment token. They cannot
be added or changed without issuing a new credential. Explain why this is
intentional.

#### 8.3 How a Verifier Uses Them
Verification confirms the VP is valid. Scope checking confirms the VP permits
this specific action. These are two separate steps and both are required.
Explain the distinction between authentication and authorization in this context.

### 9. Session JWT

#### 9.1 What It Is and When to Use It
After a VP is successfully verified, a verifier can request a short-lived JWT
by passing `session: true` with the VP. Helix ID issues a 10-minute JWT signed
with the current API startup-ephemeral session key. The verifier then verifies subsequent calls from
the agent locally without calling Helix ID again until the JWT expires.

#### 9.2 What Makes It Different From VP Verification
VP verification is stateless and per-request. The Session JWT is a short-lived
session layer on top of that — it reduces the number of Helix ID calls for
high-frequency interactions without permanently caching trust. When the JWT
expires, the agent presents its VP again and a new JWT is issued. There are
no refresh tokens.

#### 9.3 The Public Key Endpoint
The verifier fetches the JWT public key once from `GET /v1/sessions/public-key`
and caches it. All JWT verification happens locally against this cached key.
Explain why this is different from caching a VP verification result — the
public key is stable, a VP result is not.

### 10. Delegation

#### 10.1 What Delegation Is
An agent can delegate a subset of its own scopes to another agent using
`POST /v1/vcs/delegate`. Helix ID issues a child VC to the delegatee agent.
The child VC carries `delegatedFrom`, `delegationDepth`, `maxDelegationDepth`,
and `parentVcId`. Helix ID remains the sole VC signer — the parent agent does
not sign the child VC.

#### 10.2 Key Constraints
Delegation is off by default. The agent owner must explicitly set
`maxDelegationDepth` greater than 0 at enrollment token creation to enable it.
A child VC cannot hold more scopes than the parent — scope escalation is blocked
at issuance. If an intermediary VC in a chain is revoked, the entire chain
below it is invalid.

### 11. Concepts That Are Not Yet Implemented
A short list with one-line explanations of why each is deferred. Use only items
from this list — do not add others:
- `did:key` local mode — planned for local development with zero infrastructure,
  not yet implemented
- Python SDK — planned, not yet shipped
- Auto VC renewal — future scope
- OPA/Rego policy engine — parked
- ZKP selective disclosure — SaaS future scope
- HSM/KMS/hardware wallet integration — future scope
- UI dashboard — separate repo, not yet available

Frame each as a planned direction, not a missing feature. Do not list delegation,
Session JWT, or service registry — these are implemented open-core features.

## Constraints

- Do not include code, API calls, or configuration.
- Do not repeat step-by-step flow. That belongs in ENROLLMENT-FLOW.md.
- Do not write about the SDK methods in detail. That belongs in the SDK README.
- The VC field for scopes must be referred to as `credentialSubject.privilegeScopes`
  — not "roles", not "scopes" as a standalone word.
- The signing algorithm is Ed25519 using `@noble/curves`. Do not name any other
  crypto library.
- Link to TRUST-MODEL.md at the end of Section 5 for readers who want
  the security architecture in detail.
- Link to the relevant guide at the end of Section 8.3 for readers
  ready to implement scope checking.
