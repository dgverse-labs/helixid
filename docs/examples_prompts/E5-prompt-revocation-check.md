# Prompt — examples/revocation-check.ts

You have full context of the Helix ID codebase including helix-api, helix-core,
and helix-sdk-js. Build a single standalone file: examples/revocation-check.ts

## What this file demonstrates

Revocation is the mechanism that makes trust dynamic. A credential valid yesterday
may not be valid today. This file isolates that single concern — not full
verification, not scope checking, just: is this credential still active right now?

It shows four things: how to check revocation status, what triggers a revocation,
how a running system should respond when revocation is detected mid-session, and
how the agent owner can restore access after revocation by re-enrollment.

## What to build

A single TypeScript file that runs four scenarios in sequence against a live
Helix ID instance.

---

### Scenario 1 — Active credential

Check the Bitstring Status List for the fixture VC from
`examples/e2e-travel-concierge/fixtures/vp.json`.

Steps:
1. Extract the StatusList URL and the `statusListIndex` from the VC
2. Fetch the StatusList credential from `GET /v1/status-list/:listId`
3. Decode the compressed bitstring
4. Read the bit at `statusListIndex`

Log:
- `[Verifier] Credential status: ACTIVE`
- Credential ID (vcId)
- StatusList index checked
- Bit value: 0 (active)
- Credential issued at
- Credential expires at

---

### Scenario 2 — Revoke the credential and re-check

**Step 1 — Revoke**
Call `POST /v1/vcs/:vcId/revoke` using the admin API key. This represents the
agent owner revoking the credential — log with `[Agent Owner]` prefix.

Comment before this call: in a real system this call is made by the agent owner,
not the verifier. The verifier only reads status from the StatusList — it never
writes to it. The agent owner calls the revocation API when: a user withdraws
consent, a private key is compromised, scopes were issued incorrectly, or the
agent behaves anomalously.

**Step 2 — Re-check immediately**
Fetch the StatusList again for the same VC. Check the same bit.

Log:
- `[Agent Owner] Revoking credential: {vcId}`
- `[Helix ID] Credential revoked. StatusList bit set to 1.`
- `[Verifier] Credential status: REVOKED`
- Bit value: 1 (revoked)
- What a verifier should return to the agent: `{ error: 'VP_VERIFICATION_FAILED' }`
  — the same opaque error code used for all verification failures

Comment after the re-check: the revocation took effect immediately. The same VC
checked twice — first active, now revoked — within a single script run. This is
the core promise of the StatusList mechanism.

**Important note on Session JWT path**: add a comment explaining that if the
verifier is using the Session JWT path (Path 2), a Session JWT issued before
revocation remains valid for up to 10 minutes. The StatusList check only catches
revocation for verifiers using Path 1 (API verify) or Path 3 (self-verify).
For systems requiring immediate revocation detection, always use Path 1.

---

### Scenario 3 — Revocation detection mid-session

Simulate an agent that has been granted access and is mid-session. It has made
three successful VP presentations. On the fourth, the credential has been revoked
(already done in Scenario 2 — the credential is still revoked).

Implementation: simulate the session in memory. No real HTTP calls needed for
the session flow itself — just log the pattern. The revocation check for the
fourth presentation should call the real StatusList endpoint.

Log:
```
[Verifier] Session — Presentation 1:  checking... GRANTED
[Verifier] Session — Presentation 2:  checking... GRANTED
[Verifier] Session — Presentation 3:  checking... GRANTED
[Verifier] Session — Presentation 4:  checking... DENIED
           Internal reason: credential revoked (StatusList bit = 1)
           External response to agent: { error: 'VP_VERIFICATION_FAILED' }
           Session terminated.
```

Comment before this scenario: why per-request revocation checking matters.
A session token model would cache the first successful verification result
and trust the agent for the duration of the session. A VP model checks on
every presentation. This is not inefficiency — it is the security property.
The verifier cannot know when a credential will be revoked mid-session.

Comment about the Session JWT path: if using Session JWTs, the verifier verifies
the JWT locally on presentations 2, 3, and 4 — without fetching the StatusList.
Revocation would not be detected until the JWT expires (up to 10 minutes) and
the agent presents a new VP. Weigh this tradeoff when choosing a verification path.

---

### Scenario 4 — Renewal after revocation — new VC, same agent

Show that revocation is a credential lifecycle event, not a permanent ban.
The agent owner issues a new enrollment token and the agent re-enrolls.

Implementation:
1. Create a new enrollment token via `POST /v1/enrollment-tokens` with the same
   scopes as before — log with `[Agent Owner]` prefix
2. Run a simplified re-enrollment (can reuse `sdk.generateKeypair()`, `sdk.enroll()`,
   `sdk.completeEnrollment()` from helix-sdk-js) — log with `[Agent]` prefix
3. Check the old VC's StatusList bit — still 1 (revoked)
4. Check the new VC's StatusList bit — 0 (active)

Log both checks side by side:
```
[Verifier] Old VC ({old_vcId}):  StatusList index {n}  bit = 1  REVOKED
[Verifier] New VC ({new_vcId}):  StatusList index {m}  bit = 0  ACTIVE
[Verifier] Agent DID: did:hedera:testnet:z6Mk...  (same DID — identity persists)
```

Comment before this scenario: the difference between revoking a credential and
revoking an agent. The agent's DID and identity on Hedera persist. Only the VC
was revoked. The agent owner issued a new VC against the same DID. The old VC
remains permanently revoked. The new VC has a fresh StatusList index.

---

## Comments the file must contain

1. **At the top**: why revocation exists separately from expiry. Expiry is planned
   and known in advance. Revocation is immediate and triggered by an event the
   agent owner controls. An agent that misbehaves, loses its key, or exceeds its
   authorisation needs to be stopped before its credential naturally expires.

2. **Before Scenario 1's Bitstring Status List fetch**: explain the Bitstring Status List format —
   a compressed bitstring where each bit corresponds to one credential. The VC
   carries an index and a URL. The verifier fetches the URL and checks the bit.
   No credential IDs are exposed in the bitstring — only positions. This is more
   privacy-preserving than a traditional revocation list.

3. **Before Scenario 2's revocation call**: the four conditions that warrant
   immediate revocation: user withdraws consent, private key compromised, scopes
   issued incorrectly, anomalous agent behaviour. And the correct party: the
   agent owner, via `POST /v1/vcs/:vcId/revoke` with the admin API key.

4. **Before Scenario 3**: per-request checking vs session caching. Also the
   Session JWT caveat (up to 10-minute lag for Session JWT path verifiers).

5. **Before Scenario 4**: the DID is not the credential. Revoking a credential
   does not revoke the agent's identity. The same DID can hold a new credential
   after re-enrollment.

6. **At the bottom**: link to the W3C Bitstring Status List spec for readers who want
   to implement status checking in environments not covered by Helix ID's SDK.

## Constraints

- Single file.
- The admin API call in Scenario 2 must be labelled `[Agent Owner]` — it is
  not the verifier's action.
- The external response to the agent is always `{ error: 'VP_VERIFICATION_FAILED' }`.
  Use this exact string in log output. Never use a descriptive string as the
  external-facing error.
- Do NOT use the raw `crypto` module, `tweetnacl`, `libsodium`, or any other
  crypto library. If crypto operations are needed, use `@noble/curves`.
- Scenario 3 simulates a session in memory. No real session infrastructure needed.
  The fourth presentation's revocation check must be a real Bitstring Status List fetch.
- The Session JWT revocation lag must be called out explicitly in Scenario 2 and
  Scenario 3 comments. It is a known tradeoff, not a bug.

## How to test

```bash
npx tsx revocation-check.ts
```

**Scenario 1**: bit must be 0 and StatusList index must be logged (not just "active").

**Scenario 2 timing**: the revocation call and the re-check must both happen within
the same script run. The reader sees active → revoked in one terminal session
with no manual step between them.

**Scenario 3 session log**: presentations 1–3 GRANTED, presentation 4 DENIED
with `VP_VERIFICATION_FAILED`. The four calls must feel like a real session.

**Scenario 4 side by side**: old VC revoked, new VC active, same agent DID shown
for both. Makes the DID-vs-credential distinction unmistakable in the output.
