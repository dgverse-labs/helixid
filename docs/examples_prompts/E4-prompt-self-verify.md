# Prompt — examples/self-verify.ts

You have full context of the Helix ID codebase including helix-api, helix-core,
and helix-sdk-js. Build a single standalone file: examples/self-verify.ts

## What this file demonstrates

Path 3 — self-verification. A verifier that checks a VP entirely on its own,
with no call to the Helix ID verification API. This matters for air-gapped
environments, high-throughput systems where an API call per request is too
expensive, or verifiers who want to minimise external trust dependencies.

This file shows exactly what the Helix ID verification API does internally —
step by step — so a developer can make an informed decision about whether to
delegate to the API or own the verification logic themselves.

## What to build

A single TypeScript file that takes the fixture VP from
`examples/e2e-travel-concierge/fixtures/vp.json` and verifies it end to end
without calling `POST /v1/vp/verify`. It must perform every check manually,
in order, logging each step and its outcome.

### Steps to implement in order

**Step 1 — Parse the VP**
Read and parse the fixture VP JSON. Extract the agent DID, the embedded VC,
the `proof.jws`, the `vpId`, the `delegatedBy` field (userDID), the `nonce`,
and `expiresAt`. Log each extracted field.

**Step 2 — Check VP expiry**
Compare `expiresAt` against current time. If expired, log NOT TRUSTED and exit.
Note in a comment: VPs have a short expiry (minutes). The fixture may be expired
if significant time has passed since it was generated.

**Step 3 — Resolve the DID document from Hedera**
Call `sdk.resolveDID(did)` for the agent's `did:hedera:testnet:...` DID.
This is the only step that calls Helix ID as a convenience resolver — note in
a comment that it ultimately reads from Hedera HCS, not from Helix ID's database.
Log the resolved public key from the DID document.

**Step 4 — Verify the VP signature**
Verify the `proof.jws` against the public key from the DID document using
Ed25519 via `@noble/curves`. Log: PASS or FAIL with reason.
If FAIL: log NOT TRUSTED and exit. Do not proceed to further checks.

**Step 5 — Verify the VC signature against the Helix ID issuer key**
Extract the embedded VC from the VP. Verify the VC's proof against the Helix ID
issuer public key. The issuer public key comes from the `HELIX_ISSUER_PUBLIC_KEY`
environment variable — never fetched at runtime from Helix ID. Log: PASS or FAIL.
If FAIL: log NOT TRUSTED and exit.

**Step 6 — Check VC expiry**
Read `validUntil` from the VC. Compare against current time. Log: PASS or FAIL.
If FAIL: log NOT TRUSTED and exit.

**Step 7 — Check `delegatedBy` field**
Read `delegatedBy` from the VP. This is the userDID of the user on whose behalf
the agent is acting. In a real system the verifier would verify this user DID is
who they expect. Log the value and note what a real system would do here.

**Step 8 — Check Bitstring Status List revocation**
Fetch the StatusList credential from the URL in the VC at
`GET /v1/status-list/:listId`. Decode the compressed bitstring. Check the bit
at the credential's `statusListIndex`. 0 = active, 1 = revoked. Log: PASS or FAIL.
If FAIL: log NOT TRUSTED with reason "credential revoked" and exit.

**Step 9 — vpId replay protection (obligation)**
Read the `vpId` from the VP. Do NOT implement a real store in this example —
that would require a database. Instead: log the vpId value, log "OBLIGATION: this
vpId must be recorded in your store and rejected if seen again", and show a
pseudocode comment of what a real implementation looks like. Log: CHECK REQUIRED.

**Step 10 — Final verdict**
If all steps passed: log TRUSTED with agent DID, userDID (`delegatedBy`),
scopes from `credentialSubject.privilegeScopes`, expiry, and the vpId obligation
reminder. If any step failed: log NOT TRUSTED with the specific failing step.

## Comments the file must contain

1. **At the top**: when to use self-verification vs API verification. The tradeoff:
   no runtime Helix ID dependency on the verification call itself, but the verifier
   now owns every check. Missing one check is a security gap. List all checks
   the verifier is responsible for.

2. **Before Step 3**: what a DID document contains and why the public key lives
   there rather than in the VC itself. `sdk.resolveDID()` resolves `did:hedera:`
   format by reading from Hedera HCS via the Helix ID API as a convenience layer.

3. **Before Step 4**: the trust chain being validated — the agent signed the VP
   (Ed25519, @noble/curves), Helix ID signed the VC (Ed25519, HELIX_SIGNING_KEY),
   Hedera anchored the DID. Three independent trust anchors.

4. **Before Step 5**: why the issuer public key comes from env, not fetched
   at runtime. If you fetch it from Helix ID at verification time you have
   reintroduced the network dependency you were trying to avoid.

5. **Before Step 7**: explain `delegatedBy` — this is the userDID of the user
   who delegated to the agent. A real verifier should verify this user identity
   against its own user records.

6. **Before Step 8**: the one remaining network dependency. The StatusList URL
   is embedded in the VC and points to whoever issued it — in the fixture case,
   the local Helix ID instance. In production it points to the operator's hosted
   Helix ID instance. This step cannot be skipped — a valid VP from a revoked
   credential is still invalid.

7. **Before Step 9**: replay tracking is the verifier's sole responsibility when
   self-verifying. Helix ID's vpId consumption only happens when you call
   `POST /v1/vp/verify`. When self-verifying, you must track vpIds yourself.
   Minimum TTL for your store: the VC expiry. This is not optional — without it,
   an intercepted VP can be re-presented indefinitely.

8. **At the bottom**: this file is the foundation for a verification library with
   no Helix ID runtime dependency. The next step would be caching the DID document
   and StatusList with appropriate TTLs. Link to the W3C Bitstring Status List spec.

## Constraints

- Single file.
- The crypto library for all signature verification is `@noble/curves` (Ed25519).
  Do not use any other crypto library.
- `sdk.resolveDID(did)` is the correct method for DID resolution for
  `did:hedera:` format.
- The issuer public key must come from `HELIX_ISSUER_PUBLIC_KEY` env variable.
  Never fetch it from Helix ID at runtime.
- The scope field is `credentialSubject.privilegeScopes`.
- `delegatedBy` is a required field in the VP and must be checked in Step 7.
- Do not call `POST /v1/vp/verify` at any point. If the implementation is
  tempted to call it, that is wrong.
- vpId replay protection must be documented as an obligation with a pseudocode
  example, even though a real store is not implemented in this file.

## How to test

```bash
HELIX_ISSUER_PUBLIC_KEY=<key> npx tsx self-verify.ts
```

**Test 1 — All checks pass**: run against the valid fixture. Every step logs PASS.
Final verdict: TRUSTED.

**Test 2 — VP signature tamper**: change one character in `proof.jws` in the
fixture. Step 4 should fail. NOT TRUSTED. Should not proceed to Step 5.

**Test 3 — VC signature tamper**: change one character in the VC's proof but
not the VP's proof. Step 4 passes, Step 5 fails. NOT TRUSTED. The log must
distinguish this from Test 2 — two different keys, two different failure modes.

**Test 4 — Expired VP**: temporarily set `expiresAt` to a past timestamp. Step 2
should fail before any network calls are made.

**Test 5 — Revoked credential**: revoke the VC via the admin API, then run.
Step 8 should fail with "credential revoked." All steps before it should pass.

**Test 6 — Wrong issuer key**: pass a wrong public key via `HELIX_ISSUER_PUBLIC_KEY`.
Step 5 should fail with "VC signature invalid." The log must distinguish this
from Step 4 failing (VP signature vs VC signature — different keys, different checks).
