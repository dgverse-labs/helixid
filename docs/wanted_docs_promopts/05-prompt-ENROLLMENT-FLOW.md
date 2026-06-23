# Prompt — ENROLLMENT-FLOW.md

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, and docs/. Write docs/ENROLLMENT-FLOW.md for the Helix ID repository.

## What this document is

A precise walkthrough of every step from enrollment token creation to a fully
operational agent wallet. Written for both agent owners (who create tokens) and
agent developers (who consume them). A reader who finishes this document understands
exactly what each step produces, who performs it, and what can go wrong at each stage.

## Tone and style

- Sequential and precise. Steps are numbered exactly as they occur.
- For each step: who performs it, what input it takes, what output it produces.
- Where the SDK handles a step automatically, say so and name the exact SDK method.
- Where an API call is involved, name the endpoint but do not reproduce
  the full request/response — link to the OpenAPI spec.
- Short paragraphs. One action per paragraph.

## Sections to write

### 1. Overview of the Enrollment Flow

Write a diagram in Mermaid or ASCII showing all 13 steps in the correct sequence
and which party performs each one. The exact 13-step sequence is:

1. Agent owner generates enrollment token — `POST /v1/enrollment-tokens`
2. Agent owner configures token into the agent (env var or secret)
3. Agent calls `sdk.generateKeypair()` — local, no network
4. Agent calls `POST /v1/enroll` with `{ enrollmentToken, publicKeyHex, domains }`
5. Helix ID validates token (must be unused and not expired), burns it immediately
7. Helix ID returns a challenge nonce to the agent
8. Agent signs the nonce with its private key — local, no network
9. Agent calls `POST /v1/enroll/verify` via `sdk.completeEnrollment({ signature })`
10. Helix ID verifies signature using the submitted public key
11. Helix ID issues VC, assigns StatusList index
12. Agent stores `{ did, privateKeyHex, publicKeyHex, vcJson }` in local encrypted wallet
13. Enrollment token is permanently burned — the keypair is now the sole auth mechanism

Below the diagram, write one sentence per step describing what happens.
Do not compress or skip any step.

### 2. Step 1 — Agent Owner Generates Enrollment Token

#### 2.1 What the Token Contains
The scopes the agent will be permitted to hold (`credentialSubject.privilegeScopes`).
The token expiry (15-minute TTL from creation). The `maxDelegationDepth` if delegation
will be needed (defaults to 0 — delegation is off unless explicitly set above 0).
Any domain restrictions. What the token does not contain: the agent's identity
(that does not exist yet).

#### 2.2 Scope Definition
How scopes are structured. The agent owner's responsibility to define them correctly.
The consequence of over-permissioning: the agent carries those scopes in its VC
and cannot be narrowed without revoking and reissuing.

#### 2.3 Token TTL
The enrollment token has a 15-minute TTL from the moment it is created.
If the agent does not complete enrollment within that window, the token expires
and a new one must be issued. Explain why the short TTL exists: a leaked token
is only useful for 15 minutes.

#### 2.4 Delegation Boundary at Token Creation
`maxDelegationDepth` defaults to 0 — delegation is disabled. If the agent owner
wants this agent to be able to delegate to sub-agents, they must set
`maxDelegationDepth` to a positive integer at this step. It cannot be changed
later without revoking and re-enrolling.

### 3. Step 2 — Agent Owner Configures Token Into the Agent
The enrollment token is a secret. It should be passed to the agent via an
environment variable or a secrets manager — never hardcoded. This step is
an operational handoff between the agent owner and the running agent process.
Explain what the agent does with it in the next step.

### 4. Step 3 — Agent Generates Local Keypair

#### 4.1 The SDK Method
The agent calls `sdk.generateKeypair()`. This is a purely local operation — it
makes no network call. It generates an Ed25519 keypair using `@noble/curves`.
The private key is generated in memory and never transmitted anywhere.

#### 4.2 What Is Produced
A `{ privateKeyHex, publicKeyHex }` pair. The private key stays in memory until
it is written to the encrypted wallet in step 12. The public key is what gets
submitted to Helix ID in step 4.

#### 4.3 Why the Agent Generates the Keypair (Not Helix ID)
If Helix ID generated the keypair, it would briefly hold the private key — and
a compromise of Helix ID would compromise every agent. By generating locally,
each agent's identity is cryptographically independent of Helix ID's security.

### 5. Step 4 — Agent Submits Public Key

#### 5.1 The API Call
Agent calls `POST /v1/enroll` with `{ enrollmentToken, publicKeyHex, domains }`.
The SDK method is `sdk.enroll({ enrollmentToken, publicKeyHex, domains })`.
Only the public key is submitted — the private key never leaves the agent.

#### 5.2 What Helix ID Does on Receipt
Validates the enrollment token: is it unused? Is it not expired? If either check
fails, the call is rejected. If both pass, Helix ID burns the token immediately
(step 5) — it cannot be used again even if this enrollment fails later.

### 6. Step 5 — Enrollment Token Is Burned
The token is marked as consumed the moment Helix ID validates it in step 4.
This happens before DID anchoring, before VC issuance, before anything else.
A token that has been burned cannot be reused — not even if the enrollment
fails at a later step. If enrollment fails after this point, the agent owner
must generate a new token.

#### 7.1 Who Does This
Helix ID performs DID anchoring internally — the agent does not trigger this
directly. After validating the enrollment token, Helix ID calls its internal

#### 7.2 What the DID Document Contains at This Stage
The agent's public key and the Helix ID service endpoint. The agent's VC does
not exist yet — it is issued in step 11.

#### 7.3 What the HCS Message Looks Like
A DID document operation signed by the appropriate key and written to the
by anyone reading the topic.

#### 7.4 Anchoring Latency
HCS message propagation takes a few seconds. Helix ID waits for confirmation
before proceeding. If the timeout is exceeded, the enrollment fails with an
anchoring error and the agent owner must start again with a new token.

### 8. Step 7 — Helix ID Issues Challenge Nonce
After DID anchoring succeeds, Helix ID generates a short-lived challenge nonce
and returns it to the agent. This nonce has a TTL. If the agent does not respond
before the nonce expires, enrollment fails and a new token is required.
the agent controls the corresponding private key.

### 9. Step 8 — Agent Signs the Challenge

#### 9.1 Local Operation
The agent signs the challenge nonce with its private key. This is a local
operation — no network call. The signing algorithm is Ed25519 via `@noble/curves`.
The private key never leaves the agent process during this step.

#### 9.2 What the Signature Proves
That the entity submitting the public key in step 4 is the same entity that
controls the corresponding private key. Without this step, anyone who intercepted
the public key could claim ownership of the resulting DID.

### 10. Steps 9 and 10 — Agent Submits Signature and Helix ID Verifies

#### 10.1 The SDK Method
Agent calls `sdk.completeEnrollment({ signature })` which submits to
`POST /v1/enroll/verify`. The signature is the only payload — the private
key is never sent.

#### 10.2 What Helix ID Verifies
The signature against the public key already recorded in step 4. If verification
passes, Helix ID proceeds to VC issuance. If it fails: the enrollment fails,
and the agent owner must issue a new token.

### 11. Step 11 — VC Issuance

#### 11.1 What the VC Contains
Subject DID, `credentialSubject.privilegeScopes` from the enrollment token,
expiry, issuer DID, issuance date, StatusList index and URL. Walk through each
field and explain its role.

#### 11.2 How the StatusList Entry Is Created
Helix ID allocates an index in the StatusList bitstring for this credential.
The bit is set to 0 (active). The URL pointing to the StatusList is embedded
in the VC at `GET /v1/status-list/:listId`. This is how verifiers will check
revocation for the lifetime of this credential.

#### 11.3 Who Signs the VC
Helix ID signs the VC with `HELIX_SIGNING_KEY`. The agent does not sign the VC.

### 12. Step 12 — Wallet Storage

#### 12.1 What the Wallet Contains
Exactly four fields: `did`, `privateKeyHex`, `publicKeyHex`, `vcJson`.
This is the complete set of materials the agent needs to operate indefinitely
without contacting Helix ID again (until renewal or re-enrollment).

#### 12.2 How the Wallet Is Encrypted
The encryption algorithm used by the SDK. What the encryption passphrase is
and how the developer provides it. What a developer must ensure about the
environment where the wallet file is stored.

#### 12.3 SDK Methods for Wallet Operations
`AgentWallet.save(wallet, passphrase, filePath)` — writes the encrypted wallet.
`AgentWallet.load(passphrase, filePath)` — reads and decrypts it. These are the
only two ways to interact with the wallet file. The developer should never read
or write the wallet file directly.

### 13. Step 13 — Enrollment Complete
The enrollment token is permanently burned. The keypair is now the sole
authentication mechanism for this agent. The agent can now request VP templates,
sign VPs locally, and present them to external services.

### 14. Re-enrollment

#### 14.1 When Re-enrollment Is Needed
The credential expired and renewal was not used. The credential was revoked.
The agent's private key was compromised. The agent owner wants to change scopes
or delegation depth.

#### 14.2 What Happens to the Old DID
is permanent. A new enrollment may create a new DID or update the existing one
depending on operator policy.

#### 14.3 What Happens to the Old VC
It remains in Helix ID's records. If not already revoked, the agent owner should
revoke it before or immediately after re-enrollment to prevent the old credential
from being presented during the window before its natural expiry.

### 15. Error States

#### 15.1 Token Already Used
An enrollment token is single-use. Burned immediately on step 4. Attempting to
use a burned token returns an error. A new token must be generated.

#### 15.2 Token Expired
The 15-minute TTL passed before the agent submitted its public key. A new token
is required. No partial state is left in Helix ID from an expired token.

#### 15.3 Challenge Timeout
The agent did not respond to the nonce within the challenge TTL. What the agent
should do: obtain a new enrollment token and start again.

congestion, insufficient HBAR, wrong topic ID. The enrollment fails. The agent
owner must issue a new token and retry.

## Constraints

- The 13-step sequence in section 1 is authoritative. Do not compress, reorder,
  or skip any step. Every step must appear in the document.
- The keypair is always generated by the agent using `sdk.generateKeypair()`.
  Never describe Helix ID generating the keypair.
- The private key never leaves the agent at any step. Flag this explicitly
  at steps 3, 4, 8, and 9.
- Helix ID anchors the DID internally after receiving the public key — the agent
  does not call a DID anchoring endpoint directly.
- The enrollment token TTL is 15 minutes. Use this specific value.
- The signing algorithm is Ed25519 via `@noble/curves`. Name it at step 8.
- Do not reproduce full request/response bodies. Link to the OpenAPI spec.
- Link to SELF-HOST.md for operators who need to configure Helix ID first.
- Link to the SDK README for agent developers who need the full method reference.
