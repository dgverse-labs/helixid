# Proposal: SDKs depend on the API, not on `@helixid/core`, for anything that isn't private-key signing (Item #4 prerequisite)

Status: **Decided.** Written to record the reasoning before implementation,
not to reopen the discussion.

## The problem this solves

`helix-sdk-js` currently imports `@helixid/core` directly and re-exports
several of its functions unchanged — `verify.ts` and `vp-builder.ts` are one
line each (`export { verifyVP } from '@helixid/core'`). This works today
because both packages are TypeScript in the same monorepo.

It stops working once a second-language SDK exists. `helix-sdk-py` (Item
#4) cannot import `@helixid/core` — it has to reimplement whatever logic it
needs. Two categories of logic behave very differently under
reimplementation:

- **Crypto primitives** (Ed25519 sign/verify, keypair generation, multibase
  encoding) — small, standard, low risk. Any mature crypto library
  (`PyNaCl`, `cryptography`) implements the primitive correctly; porting
  this is mechanical.
- **Payload construction and business logic** (canonical JSON encoding
  before hashing, VC/VP JSON shape, delegation-chain assembly, bootstrap
  proof payloads) — homegrown, not backed by a library, and only correct if
  it matches `helix-core`'s output byte-for-byte. `hashCanonicalPayload()`
  (`helix-core/src/crypto/vp.ts`) uses a custom recursive key-sort +
  `JSON.stringify`, not a standard like RFC 8785 JCS. Reimplementing this
  from a description, in a second language, is exactly the kind of thing
  that produces silent verification bugs.

Rather than accept that risk for every future SDK language, the API becomes
the single implementation of everything except the parts that must stay on
the client for private-key custody reasons. This applies to `helix-sdk-js`
too, even though it has no drift risk today — for consistency across all
SDKs, and because most of what it currently does locally has no local-only
requirement.

## Decided: what stays local vs. moves to the API

**Stays local, in every SDK, every language.** Anything that requires the
holder's private key never leaves the client:

- Keypair generation, `signData`/`signBytes`, multibase encoding
  (`helix-core/src/crypto/keys.ts`)
- Canonical-JSON hashing before signing (`hashCanonicalPayload`,
  `helix-core/src/crypto/vp.ts`)
- `VPBuilder.sign()` — signing a VP against a target service using an
  already-held VC. This runs on every agent tool call
  (`HelixIDMiddleware`, MCP tool wrappers) and must stay a zero-network-call,
  local operation. Its JSON shape is small and stable (holder, embedded VC,
  target service, timestamp) — low drift risk, covered by golden vectors
  (see below) rather than an API round-trip.
- Onboarding challenge-response signing (nonce signing in
  `HelixClient.completeOnboarding()`) — already API-driven for everything
  except the signature itself; no change needed here, just confirms the
  pattern this proposal generalizes.

**Moves to the API — payload constructed server-side, client only signs
opaque bytes:**

- **Delegation VC construction.** New endpoint, e.g.
  `POST /v1/vcs/delegation/prepare`, returns the unsigned VC skeleton and
  its canonical hash. The SDK signs the hash locally and submits the
  signature to finalize. Removes `delegation.ts`'s local
  `buildDelegationVC()` call from the client entirely — this was the
  highest-drift-risk payload (nested `credentialSubject`, delegation chain
  fields, scope encoding).
- **VC issuance / renewal payload construction** — same pattern, same
  reasoning.

**Moves to the API — no local implementation needed in any SDK, ever:**

- `verifyVP()` — signature check, delegation-chain walk, expiry, target
  service, revocation. `helix-api`'s `POST /v1/vp/verify` already does
  this exact logic today, since `vp.service.ts` calls `verifyVPCore()` from
  `@helixid/core` internally — this proposal removes the duplicate
  in-process copy from `helix-sdk-js`, not the API's copy.
- DID resolution, status-list fetch/revocation-bit check, sessions, audit
  logging — already API calls today in every SDK; no change.

## Why `VPBuilder.sign()` is the one exception, not a hole in the policy

Routing VP-signing through a "prepare, then sign" API round-trip like
delegation was considered and rejected:

- It is the hottest path in the system — it runs on every tool
  invocation, not once per delegation grant. Doubling round-trips here has
  a real latency and API-load cost at scale.
- Self-hosted deployments currently verify and build VPs without a live
  API connection between the wallet and the moment of use; forcing a
  network call here is an availability regression and works against
  self-hosted being a first-class deployment mode, not a lesser one.
- Its payload is small and stable compared to delegation VCs — cheap to
  cover with golden vectors, without the round-trip cost.

This is a deliberate, named trade-off (see "Accepted trade-offs" below),
not an oversight in an otherwise-uniform "SDKs never construct payloads"
rule.

## Decided: how payload/encoding parity is guaranteed for what stays local

OpenAPI does not help here — it describes JSON *shapes* for HTTP bodies,
not canonicalization order, hashing, or what bytes get signed before a
request is ever sent. The mechanisms that do help:

1. **Port `toCanonicalJson`/`hashCanonicalPayload` and the VP-signing
   payload builder line-for-line** from `helix-core`, not re-derived from a
   written spec.
2. **Golden test vectors generated from `helix-core`'s own code**, not
   hand-written per language. A fixture file of
   `{payload, canonical_string, hash_hex, signature_hex, full_signed_vp}`
   covering representative and edge-case inputs (nested objects, arrays,
   unicode, numbers). Every SDK's test suite asserts byte-for-byte equality
   against this fixture, not against a description of the algorithm.
3. **CI wiring**: regenerate the fixture whenever `helix-core` changes;
   fail any SDK's CI if its canonical/signed output diverges from the
   fixture. This is a cross-repo contract test, not a one-time check.

## Accepted trade-offs

- **`helix-sdk-js` gains a network dependency it didn't have for
  `verifyVP()`.** Previously zero-cost (same-language, in-process); now a
  call to `/v1/vp/verify`. Accepted for consistency across all SDKs and
  because it removes a second, unaudited copy of `helix-core`'s
  verification logic from ever existing in the JS SDK.
- **Blind-signing on the delegation/issuance path.** Once the API
  constructs the unsigned payload, the SDK trusts the server not to embed
  anything beyond what was requested before signing it. Acceptable for
  HelixID's own `helix-api`; self-hosted operators run their own instance
  and are trusting their own server, not a third party — but this is a
  property being accepted, not a non-issue, and should be named as such if
  it comes up again (e.g. audit tooling that diffs the requested vs.
  returned unsigned payload before signing).
- **`VPBuilder.sign()` payload construction remains duplicated per SDK
  language**, same risk category as delegation would have been, mitigated
  by golden vectors instead of eliminated by API round-trip. Chosen
  deliberately for latency/availability reasons — see above.

## Scope note

This proposal does not change persistence, tenancy, or custody design —
see [`proposal-hosted-instance.md`](./proposal-hosted-instance.md) for
that. It is a prerequisite for Item #4 (`helix-sdk-py`) and applies
retroactively to `helix-sdk-js` for consistency, but is independent of the
hosted-instance work and can land on its own schedule.
