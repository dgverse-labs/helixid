# Prompt — examples/e2e-travel-concierge/

You have full context of the Helix ID codebase including helix-api, helix-core,
and helix-sdk-js. Build the e2e-travel-concierge example under
examples/e2e-travel-concierge/.

## What to build

Three runnable TypeScript files that together demonstrate a complete agent identity
lifecycle across three parties. No UI, no LLM, no external frameworks beyond what
Helix ID already uses. The example must be correct against the Helix ID platform —
every SDK method call, every API endpoint, every field name must match the actual
implementation.

---

## operator/enroll-agent.ts

This script runs once. It represents the agent owner onboarding an agent into
Helix ID. It must follow the correct 13-step enrollment sequence exactly.

### What it must do

1. Call `POST /v1/enrollment-tokens` with the admin API key to create an
   enrollment token. Scopes: `flights:search`, `flights:book`, `hotels:search`
   (intentionally no `hotels:book`). Set a reasonable credential expiry.
   `maxDelegationDepth` should be 0 (default — delegation not needed here).

2. Simulate handing the token to the agent (in this example, write it to a
   temp file or env — make this explicit in a comment).

3. Call `sdk.generateKeypair()` — local operation, no network call. Log clearly
   that the private key was generated locally and will never be transmitted.

4. Call `sdk.enroll({ enrollmentToken, publicKeyHex, domains })` which calls
   `POST /v1/enroll`. Log that only the public key is being submitted.

5. Log that Helix ID has burned the enrollment token and is anchoring the DID
   on Hedera HCS.

6. Receive the challenge nonce from Helix ID.

7. Sign the challenge nonce locally with the private key using Ed25519 via
   `@noble/curves`. Log: local operation, private key not transmitted.

8. Call `sdk.completeEnrollment({ signature })` which calls `POST /v1/enroll/verify`.

9. Receive the issued VC from Helix ID.

10. Save the wallet using `AgentWallet.save(wallet, passphrase, filePath)` to
    `agent/wallet.enc`. The wallet contains exactly:
    `{ did, privateKeyHex, publicKeyHex, vcJson }`.

11. Log the agent's DID, the scopes in `credentialSubject.privilegeScopes`,
    and the credential expiry.

### Log format
Every log line must have a clear actor prefix:
- `[Agent Owner]` — token creation, token handoff
- `[Helix ID]` — DID anchoring, VC issuance, token burn confirmation
- `[Agent]` — keypair generation, challenge signing, wallet save

### Comments required
- Before `sdk.generateKeypair()`: why the agent generates the keypair, not Helix ID
- Before the challenge signing: what this step proves (key ownership)
- Before `AgentWallet.save()`: what the wallet contains and why the private key
  never left the agent process

---

## platform/booking-platform.ts

A Fastify server on port 3001. It represents an external service that agents call.
It verifies VPs before serving any route.

### Routes to expose
- `POST /flights/search` — requires scope `flights:search`
- `POST /flights/book` — requires scope `flights:book`
- `POST /hotels/search` — requires scope `hotels:search`
- `POST /hotels/book` — requires scope `hotels:book`

### What each route must do
1. Read the signed VP from the `Authorization` header
2. Call `POST /v1/vp/verify` on the Helix ID instance with `{ signedVP }`
3. On failure: return 401 with `{ error: 'VP_VERIFICATION_FAILED' }` — this is
   the only error response regardless of the internal reason. Log the internal
   reason. Never expose it externally.
4. On success: check that `credentialSubject.privilegeScopes` in the verified
   response contains the required scope for this route
5. On scope mismatch: return 403 with `{ error: 'INSUFFICIENT_SCOPE' }`
6. On success with correct scope: log the grant and return mock data

### Log format
Every decision must be logged with:
`[timestamp] [Platform] [scope_attempted] VP verified ✓/✗  did:hedera:...  GRANTED/DENIED  reason`

### Comments required
- At the top: the platform is a verifier, not an SDK user — it calls the Helix ID
  API directly, no SDK dependency
- Before the verify call: what Helix ID checks on the platform's behalf (VP
  signature, VC signature, expiry, StatusList revocation, vpId replay, target service)
- Before the scope check: verification is authentication, scope checking is
  authorization — both are required
- After the DENIED log: why the external error is always VP_VERIFICATION_FAILED
  and the internal reason stays in the log

---

## agent/agent.ts

A script that simulates a user asking an agent to plan a trip. It runs the full
VP request-sign-present cycle for each action.

### What it must do on startup
1. Load the wallet using `AgentWallet.load(passphrase, filePath)` from `agent/wallet.enc`
2. Log the agent's DID and credential expiry from `wallet.vcJson`
3. Simulate a user authenticating — log a hardcoded `userDID` representing the
   user who has delegated to this agent. In a real system this would come from
   the user DID verification flow. Add a comment explaining this.

### For each of five actions (in order)

**Action 1 — Search flights**
**Action 2 — Search hotels**
**Action 3 — Book a flight**
**Action 4 — Book a hotel (will be denied — scope not granted)**
**Action 5 — Book a flight again (will be denied — credential revoked)**

For each action:
1. Call `POST /v1/vp/template` to request an unsigned VP template with the
   `delegatedBy: userDID` field set to the user's DID
2. Log the `vpId` received in the template — note it is single-use
3. Sign the VP locally using `sdk.buildAndSignVP(unsignedVP, privateKeyHex)` —
   log: local operation, private key not transmitted
4. Call the booking platform with the signed VP in the Authorization header
5. Log the outcome in plain English

Between Action 4 and Action 5, the script must pause and wait (use setTimeout
or a prompt) to allow the agent owner to revoke the credential. Log clearly:
"Waiting for agent owner to revoke credential. Run the revocation curl command,
then press Enter."

Print the exact curl command for revocation:
```
curl -X POST http://localhost:3000/v1/vcs/{vcId}/revoke \
  -H "Authorization: Bearer $HELIX_ADMIN_API_KEY"
```
Where `{vcId}` is logged from the wallet's `vcJson`.

### Log format
```
[Agent] Searching flights to London...
        → Requesting VP template (vpId will be single-use)
        → Signing VP locally with Ed25519 — private key not transmitted
        → Presenting to booking platform
        ← GRANTED. Found 12 flights.

[Agent] Booking hotel — The Langham...
        → Requesting VP template
        → Signing VP locally
        → Presenting to booking platform
        ← DENIED (VP_VERIFICATION_FAILED / INSUFFICIENT_SCOPE)
        I can search hotels but I am not authorised to book them.
```

### Comments required
- Before wallet load: what the wallet contains
- Before VP template request: why a fresh VP template is needed per action
  (single-use vpId, fresh nonce, correct target service binding)
- Before `sdk.buildAndSignVP()`: local operation, Ed25519 via @noble/curves,
  private key never leaves the agent
- At the revocation pause: what the agent owner does in a real system and why
  revocation takes effect immediately on the next VP verification

---

## Supporting files

### package.json
Scripts:
- `enroll` → `tsx operator/enroll-agent.ts`
- `platform` → `tsx platform/booking-platform.ts`
- `agent` → `tsx agent/agent.ts`

Dependencies: `@helixid/sdk`, `fastify`, `tsx`, `dotenv`
Dev dependencies: TypeScript types

### .env.example
```
HELIX_API_URL=http://localhost:3000
HELIX_ADMIN_API_KEY=your-admin-key-here
HEDERA_NETWORK=testnet
WALLET_PASSPHRASE=change-this-passphrase
```

### fixtures/vp.json
After `npm run enroll` completes successfully, copy one of the real signed VPs
produced during the agent's run into this file and commit it. Add a comment at
the top of the file explaining: this is a real VP generated from a real Helix ID
instance. The StatusList URL inside it points to that instance. To verify it,
the same instance must be running.

### README.md
Structure:
1. Narrative first: the user, the agent owner, the agent, the booking platform,
   and what Helix ID does in between. Explain why without Helix ID the platform
   has no way to trust the agent.
2. Prerequisites: a running Helix ID instance pointed to by HELIX_API_URL
3. Three commands — one per terminal — with what to watch for in each
4. The revocation moment: what to do between Action 4 and Action 5
5. What each file demonstrates

---

## Hard constraints

- Use `@helixid/sdk` for all agent-side operations. The platform makes direct
  HTTP calls — it does not use the SDK.
- The crypto library is `@noble/curves` (Ed25519). Do not use any other crypto
  library anywhere.
- `sdk.generateKeypair()`, `sdk.buildAndSignVP()`, and the challenge nonce
  signing are all local operations with no network calls. State this explicitly
  in comments at each location.
- The wallet stores exactly `{ did, privateKeyHex, publicKeyHex, vcJson }`.
- The VP must include `delegatedBy: userDID` and a `vpId`.
- The scope field in the VC is `credentialSubject.privilegeScopes`.
- External error responses from the platform are always
  `{ error: 'VP_VERIFICATION_FAILED' }` or `{ error: 'INSUFFICIENT_SCOPE' }`.
  Never expose internal failure reasons externally.
- No build step. Everything runs with `tsx` directly.
- Comments in code explain WHY not WHAT.
- Do not use `did:key:` format — it is not yet implemented. Use `did:hedera:testnet:...`

## How to test

Run in order:
1. `npm run enroll` — wallet.enc must exist after, vcId logged to console
2. `npm run platform` — must start on 3001 and log "Listening"
3. `npm run agent` — watch all five actions

Actions 1–3 must be GRANTED. Action 4 must be DENIED with INSUFFICIENT_SCOPE.
Between 4 and 5, run the revocation curl command. Action 5 must be DENIED with
VP_VERIFICATION_FAILED — not INSUFFICIENT_SCOPE. These are two different denial
reasons and the logs must make this distinction clear.
