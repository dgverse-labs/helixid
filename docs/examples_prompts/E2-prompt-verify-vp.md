# Prompt — examples/verify-vp.ts

You have full context of the Helix ID codebase including helix-api, helix-core,
and helix-sdk-js. Build a single standalone file: examples/verify-vp.ts

## What this file demonstrates

The most fundamental operation a verifier needs to do: receive a VP from an agent
and decide whether to trust it — by delegating all checks to the Helix ID
verification API. This is Path 1 (API Verification) from the verify-a-vp guide.
The file shows the complete API verification path including correct error handling,
correct external error codes, and vpId consumption behaviour.

## What to build

A single TypeScript file that:

1. Reads the fixture VP from `examples/e2e-travel-concierge/fixtures/vp.json`

2. Calls `POST /v1/vp/verify` on the Helix ID instance with `{ signedVP }`

3. On success, logs:
   - `[Verifier] GRANTED`
   - Agent DID (`agentDid` from response)
   - User DID (`userDid` from response — the `delegatedBy` field)
   - Scopes from `credentialSubject.privilegeScopes`
   - Credential expiry
   - `verifiedAt` timestamp

4. On any failure, logs:
   - `[Verifier] DENIED — VP_VERIFICATION_FAILED`
   - The internal reason (for the developer reading the log — not what would
     be returned to a real caller)
   - What a real verifier should return to its caller: `{ error: 'VP_VERIFICATION_FAILED' }`

5. Exits with code 0 on success, code 1 on any failure

### Internal failure reasons to handle and log distinctly (for developer understanding)
- Invalid VP signature
- Invalid VC signature
- Expired credential
- Revoked credential
- Replay detected — vpId already consumed by a previous verification call
- Target service mismatch
- Malformed VP

For each: log the internal reason clearly, then log what the external response
to a real caller would be (`VP_VERIFICATION_FAILED` in all cases). Make clear
in a comment that a real verifier never exposes the internal reason externally.

## Comments the file must contain

1. **At the top**: what this file is, what role the reader plays (they are the
   verifier), what needs to be running (Helix ID instance serving the StatusList
   URL embedded in the fixture VP's VC), and that this is Path 1 — API
   verification — which means Helix ID handles all checks including vpId replay
   tracking.

2. **Before reading the fixture**: in a real system this VP arrives in an
   Authorization header or request body — not a file. Show the pattern:
   `const signedVP = req.headers.authorization?.replace('Bearer ', '')`.

3. **Before the API call**: enumerate what Helix ID checks on the verifier's
   behalf: VP signature (Ed25519), VC signature (Ed25519, HELIX_SIGNING_KEY),
   credential expiry, Bitstring Status List revocation bit, target service binding,
   and vpId consumption (single-use — Helix ID marks it consumed on this call).

4. **After the success path**: note that the vpId is now consumed. Presenting
   the same signed VP again will result in `VP_VERIFICATION_FAILED` with internal
   reason "replay detected." This is by design.

5. **After each failure case**: what the verifier should return to its caller
   (always `{ error: 'VP_VERIFICATION_FAILED' }`) and what it should log
   internally (the specific reason).

6. **At the bottom**: pointer to self-verify.ts for readers who want to see
   what Helix ID does internally during this call.

## Constraints

- Single file. No imports beyond Node stdlib, `dotenv`, and `node-fetch` or
  built-in `fetch`. No SDK dependency — this is the verifier path making a
  direct HTTP call.
- The external error code is always `VP_VERIFICATION_FAILED`. Never use any
  other string for the external-facing error. Internal log messages can be
  descriptive.
- The fixture VP must include `delegatedBy: userDID` and a `vpId`. If the
  fixture from the E2E example does not have these fields, note in a comment
  that it should and explain where they come from.
- Do not use try/catch to silently swallow errors. Every failure path must log
  the reason explicitly.
- The VP response on success returns `{ valid, agentDid, userDid, targetService, verifiedAt }`.
  Use these exact field names from the actual API response.

## How to test

```bash
# from examples/
npx tsx verify-vp.ts
```

**Test 1 — Valid VP**: run as-is. Should log GRANTED with agent DID, userDid,
scopes, and expiry.

**Test 2 — Replay detection**: run the same command twice back to back without
waiting. Second run should log internally "replay detected — vpId already consumed"
and externally `VP_VERIFICATION_FAILED`. This works because Helix ID consumed
the vpId on the first call.

**Test 3 — Revoked credential**: revoke the VC that generated the fixture VP:
```bash
curl -X POST http://localhost:3000/v1/vcs/{vcId}/revoke \
  -H "Authorization: Bearer $HELIX_ADMIN_API_KEY"
```
Then run the file. Should log internally "credential revoked" and externally
`VP_VERIFICATION_FAILED`.

**Test 4 — Tampered VP**: open `fixtures/vp.json`, change one character in the
`proof.jws` field, run again. Should log internally "invalid VP signature" and
externally `VP_VERIFICATION_FAILED`. Different internal reason from Test 3 —
the logs must distinguish them even though the external code is the same.
