# Prompt — guides/issue-credentials.md

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, and docs/. Write docs/guides/issue-credentials.md for the Helix ID
repository.

## What this document is

A task-oriented guide for agent owners who control the credential lifecycle.
It covers scope design, enrollment token creation, expiry configuration,
credential renewal, scope updates, and delegation setup. A reader who finishes
this document can confidently design their own scope taxonomy, enroll agents
correctly, and manage credentials over their lifetime — including deciding
whether and how to enable delegation.

## Tone and style

- Agent-owner-first. The reader controls the system. Speak to that authority.
- Decisions have consequences. State them plainly when they matter.
- Code blocks for every API call, with curl examples.
- Where a decision is hard to reverse, say so before the reader makes it.
- Short paragraphs. One concept per paragraph.

## Sections to write

### 1. Designing Your Scope Taxonomy

#### 1.1 Scope Naming Conventions
Scopes are strings stored in `credentialSubject.privilegeScopes`. There is no
enforced format but consistency matters across your system. Recommend a
`namespace:action` pattern — for example `flights:search`, `flights:book`,
`hotels:search`. Explain that the verifier is responsible for interpreting
these strings. Helix ID stores and returns them but does not enforce what
they mean.

#### 1.2 Granularity Tradeoffs
Fine-grained scopes (`flights:search:domestic` vs `flights:search:international`)
give verifiers more control but increase the scope set an agent owner must manage.
Coarse scopes (`flights:all`) are simpler but give the verifier less information.
Explain the tradeoff and give examples of when each makes sense.

#### 1.3 Scope Immutability After Issuance
Scopes are embedded in the VC at issuance and signed by Helix ID with
`HELIX_SIGNING_KEY`. They cannot be changed without revoking the credential and
issuing a new one. State this as a hard constraint: over-permissioning at
enrollment means the agent carries those permissions for the lifetime of the
credential. Recommend erring toward narrow scopes with planned renewal cycles.

#### 1.4 Examples From the Travel Concierge Example
Use the E2E example as a concrete illustration. The travel agent was granted
`flights:search`, `flights:book`, `hotels:search` but not `hotels:book`.
Walk through why that boundary was drawn and what the agent owner was expressing
with that scope set.

### 2. Creating an Enrollment Token

#### 2.1 The Endpoint
`POST /v1/enrollment-tokens`. Requires the admin API key in the Authorization
header. A complete curl example.

#### 2.2 Required Fields
The exact fields the endpoint requires. For each field: what it is, what value
to provide, and what happens if it is wrong or missing. Must include:
`privilegeScopes` (array of scope strings), `expiresAt` (credential expiry,
not token TTL).

#### 2.3 Optional Fields
`maxDelegationDepth` (integer, defaults to 0 — delegation disabled),
`domains` (allowed domains for the agent). What each controls.
When to use them.

#### 2.4 Token TTL — 15 Minutes
The enrollment token has a fixed 15-minute TTL from creation. This is not
configurable. After 15 minutes the token expires and cannot be used. A new
token must be created. Explain why: a short TTL limits the damage if a token
is leaked before use.

#### 2.5 Single-Use Enforcement
An enrollment token is single-use. It is burned immediately when the agent
submits its public key at `POST /v1/enroll` — before DID anchoring, before
VC issuance. Attempting to use a burned token fails. One token per agent.
Why this is a security property: a reused or intercepted token cannot enroll
a second agent.

#### 2.6 What Happens After the Token Is Created
Hand the token to the agent securely (env var, secrets manager — never hardcoded).
The agent has 15 minutes to complete enrollment. After that, the token is useless.

### 3. Setting Credential Expiry

#### 3.1 What Credential Expiry Controls
The `expiresAt` field in the enrollment token sets when the resulting VC expires.
After this date the VC is invalid even if never revoked. Distinguish this clearly
from the 15-minute enrollment token TTL — they are separate values with separate
purposes.

#### 3.2 Short-Lived vs Long-Lived Credentials
Short-lived credentials (hours to days) reduce the window of exposure if
a credential is compromised but require more frequent renewal. Long-lived
credentials (weeks to months) are operationally simpler but carry more risk
if the agent's key is compromised. Give concrete guidance: for agents with
sensitive scopes (e.g. `payments:execute`), prefer short expiry with planned
renewal. For read-only agents, longer expiry is more practical.

#### 3.3 Planning for Renewal
Set expiry with a renewal plan in mind. If the agent will be long-running,
either set a long expiry or build a renewal trigger into the agent's operations.
Unplanned expiry causes the agent to stop functioning until re-enrolled.

### 4. Credential Renewal

#### 4.1 When Renewal Is Appropriate
The credential is approaching expiry, the agent should continue operating with
the same scopes, and no key compromise has occurred. Renewal is lighter-weight
than full re-enrollment: the agent keeps its DID and private key.

#### 4.2 How Renewal Differs From Re-enrollment
Renewal: agent keeps existing DID and private key. New VC issued against the
same DID with a new expiry. Old VC superseded.
Re-enrollment: new keypair may be generated, new DID may be created, new VC
issued. Old identity may be deactivated.
Renewal is only appropriate when the underlying identity is still trustworthy.

#### 4.3 The Renewal API Call
The endpoint: `POST /v1/vcs/:vcId/renew`. A complete curl example. What the
agent owner must provide. What the response contains. How the old VC's StatusList
entry is handled after renewal.

#### 4.4 What Changes and What Stays the Same
Stays the same: agent DID, private key, wallet file structure.
Changes: the VC (`vcJson` in the wallet), expiry, StatusList index (a new entry
is created for the new VC).

### 5. Listing and Inspecting Issued Credentials

#### 5.1 Listing Credentials
The endpoint: `GET /v1/vcs/:vcId` for a specific VC. How to find the vcId:
from the enrollment log or the audit log. A curl example.

#### 5.2 Inspecting a Single Credential
What the response contains. How to read the StatusList index and URL.
How to read the current status (active, expired, revoked).

#### 5.3 Using the Audit Log
Where security-relevant events are recorded. What events appear: enrollment,
VC issuance, VC revocation, VC renewal, VP verification outcomes.
How to use the audit log to find a vcId or investigate anomalous behavior.

### 6. Scope Updates

#### 6.1 Adding Scopes
You cannot add scopes to an existing credential. Revoke the current credential
and issue a new enrollment token with the expanded scope set. Walk through the
steps. Note the operational gap between revocation and re-enrollment during
which the agent cannot act.

#### 6.2 Removing Scopes
Same process as adding. The existing credential must be revoked. A new
credential with the narrower scope set is the only safe path.

#### 6.3 Why Scope Changes Require a New Credential
The VC is a signed attestation. Its integrity depends on immutability after
signing with `HELIX_SIGNING_KEY`. Any modification would require Helix ID
to re-sign — which is equivalent to issuing a new credential. This is not a
limitation. It is the mechanism that makes the trust model sound.

### 7. Delegation

#### 7.1 What Delegation Enables
An agent can delegate a subset of its own scopes to another agent via
`POST /v1/vcs/delegate`. Helix ID issues a child VC to the delegatee agent.
The agent owner does not need to issue a new enrollment token for the delegatee
— the parent agent handles this via the SDK.

#### 7.2 Enabling Delegation at Enrollment
Delegation is disabled by default. `maxDelegationDepth` defaults to 0.
To enable it, the agent owner must set `maxDelegationDepth` to a positive
integer in the enrollment token. This cannot be changed later without
revoking and re-enrolling the parent agent. State this as a decision point:
if there is any chance this agent will need to delegate, set it now.

#### 7.3 Delegation Constraints
A child VC cannot hold more scopes than the parent — Helix ID blocks scope
escalation at issuance. A child VC cannot have a longer expiry than the parent.
If an intermediary VC in a chain is revoked, all child VCs below it are
invalid. Helix ID remains the sole VC signer — the parent agent does not
sign the child VC.

#### 7.4 The Delegation API Call
The SDK method: `sdk.delegate({ delegateeAgentDid, requestedScopes, ... })`.
What it does: the SDK signs a VP locally, then calls `POST /v1/vcs/delegate`.
Helix ID verifies the parent agent's VP and issues the child VC. A complete
TypeScript code example.

#### 7.5 Revoking a Delegated Credential
Revoking the parent VC invalidates all child VCs in the chain. To revoke only
a specific child VC, use `POST /v1/vcs/:vcId/revoke` with the child's vcId.
Link to handle-revocation guide.

## Constraints

- Read the actual enrollment token and VC management API endpoints in helix-api
  before writing. All endpoint paths, field names, and response shapes must
  match the actual implementation.
- The scope field name is `credentialSubject.privilegeScopes` — use this
  exact name throughout, not "roles", not "scopes" as a standalone term.
- The enrollment token TTL is always 15 minutes — use this specific value.
- `maxDelegationDepth` defaults to 0. State this explicitly in sections 2.3
  and 7.2.
- Every API call section must include a complete curl example.
- Do not describe verification. Link to guides/verify-a-vp.md.
- Do not describe revocation in detail. Link to guides/handle-revocation.md.
- Link to ENROLLMENT-FLOW.md for readers who want to understand what happens
  after the agent owner creates a token.
- Link to the E2E example for readers who want to see scope design in a
  working system.
