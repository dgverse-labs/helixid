# Prompt — examples/scope-check.ts

You have full context of the Helix ID codebase including helix-api, helix-core,
and helix-sdk-js. Build a single standalone file: examples/scope-check.ts

## What this file demonstrates

Verification confirms a VP is valid. Scope checking is the next layer: even a
fully valid credential may not authorise a specific action. This file shows how
a verifier makes granular access decisions after verification passes — using the
actual field names and response shapes from the Helix ID verification API.

No running Helix ID instance needed. No network calls. Pure authorization logic.

## What to build

A single TypeScript file that:

1. Defines a `requiresScope(verifiedPayload, requiredScope)` function that:
   - Takes the payload returned by `POST /v1/vp/verify` on success:
     `{ valid, agentDid, userDid, targetService, verifiedAt }` plus the
     agent's `credentialSubject.privilegeScopes` array
   - Takes a required scope string
   - Returns `{ granted: boolean, reason: string }`
   - The function must be self-contained — a developer should be able to lift
     it into their own middleware with no modification

2. Runs five scenarios in sequence using hardcoded verified payloads.
   These are NOT raw VPs — they are the decoded payload shapes that a verifier
   receives AFTER Helix ID verification has already passed.

### The five scenarios

**Scenario 1 — Granted, simple match**
Agent holds `credentialSubject.privilegeScopes: ['flights:search']`.
Action requires `flights:search`. Should be GRANTED.

**Scenario 2 — Denied, missing scope**
Agent holds `credentialSubject.privilegeScopes: ['flights:search']`.
Action requires `flights:book`. Should be DENIED.
Reason must be specific: "Agent holds [flights:search], flights:book is required."
Not just "denied."

**Scenario 3 — Granted, agent holds multiple scopes**
Agent holds `credentialSubject.privilegeScopes: ['flights:search', 'flights:book', 'hotels:search']`.
Action requires `hotels:search`. Should be GRANTED.
Shows that scopes are additive — holding more scopes than required is fine.

**Scenario 4 — Denied, no scope implies another**
Same agent as Scenario 3.
Action requires `hotels:book`. Should be DENIED.
Reason: "Agent holds [flights:search, flights:book, hotels:search],
hotels:book is required." Makes clear that holding `hotels:search` does not
imply `hotels:book`.

**Scenario 5 — Denied, target service mismatch**
Agent holds `credentialSubject.privilegeScopes: ['flights:search']`.
Action requires `flights:search` (scope matches).
BUT: the `targetService` in the verified payload is `booking-platform-staging`,
while the service doing the check identifies itself as `booking-platform-prod`.
Should be DENIED with reason: "VP was issued for booking-platform-staging,
not booking-platform-prod."

### After all scenarios
Print a summary table:
```
Scenario | Agent Scopes         | Required          | Target Match | Result
---------|---------------------|-------------------|--------------|-------
1        | flights:search       | flights:search    | ✓            | GRANTED
2        | flights:search       | flights:book      | ✓            | DENIED
3        | flights:search,...   | hotels:search     | ✓            | GRANTED
4        | flights:search,...   | hotels:book       | ✓            | DENIED
5        | flights:search       | flights:search    | ✗            | DENIED
```

## Comments the file must contain

1. **At the top**: the distinction between authentication (is this VP valid —
   Helix ID's job) and authorisation (does this VP allow this action — the
   verifier's job). Both steps are required. This file covers only the second.

2. **Before `requiresScope`**: what a real implementation receives here — the
   `{ valid, agentDid, userDid, targetService, verifiedAt }` payload from
   `POST /v1/vp/verify`, not the raw VP. The scopes come from
   `credentialSubject.privilegeScopes` in the VC embedded in the verification
   response. Show how to extract them.

3. **Before Scenario 5**: why target service binding is a security property.
   A VP is bound to a specific target service in its template. If the VP is
   accepted by a different service, an agent credentialed for service A can
   act on service B. The verifier must check that `targetService` in the
   verified payload matches its own identity.

4. **At the bottom**: where to go next — if scope strings are not granular enough
   for your policy needs, Helix ID's roadmap includes an OPA/Rego policy engine
   (not yet implemented). For now, the `requiresScope` pattern covers the majority
   of use cases.

## Constraints

- Single file. No network calls. No running instance needed.
- No SDK dependency.
- The scope field is `credentialSubject.privilegeScopes` — use this exact name
  throughout. Never use "scopes" or "roles" as standalone terms.
- Hardcoded payloads must reflect the actual shape of the `POST /v1/vp/verify`
  success response: `{ valid: true, agentDid, userDid, targetService, verifiedAt }`
  with `credentialSubject.privilegeScopes` as the scope array. Read the actual
  API response shape before writing these objects.
- The `requiresScope` function must accept the verified payload shape and a scope
  string. It must also check `targetService`. A developer should be able to copy
  this function directly into a Fastify or Express route handler.
- Scenario 2 and Scenario 5 are both DENIED but for different reasons. The log
  output must make this distinction clear.

## How to test

```bash
# from examples/
npx tsx scope-check.ts
```

No running instance needed. Pure logic.

Verify:
- All five scenarios log without throwing
- Scenario 2 denial reason names the scope held and the scope required
- Scenario 5 denial reason names the target service mismatch — not a scope error
- The summary table prints correctly
- Copy only the `requiresScope` function into a blank file, give it a hardcoded
  payload and scope string, and it runs with zero modification. If it needs
  anything else from the file to run, it is not self-contained enough.
