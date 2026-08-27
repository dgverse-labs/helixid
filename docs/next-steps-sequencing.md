# Next steps — suggested order

Status: **Proposal**, for sequencing only. Doesn't reopen any decision
already made in `proposal-hosted-instance.md` or `proposal-sdk-api-only.md`.

1. **Golden vector fixture tooling** (from `proposal-sdk-api-only.md`).
   No API or SDK changes needed yet — just generate
   `{payload, canonical_string, hash_hex, signature_hex, full_signed_vp}`
   fixtures from `helix-core` and wire CI to check them. Do this first: it's
   the safety net every later step depends on, and it's independent of
   everything else below.

2. **API: add "prepare" endpoints.**
   `POST /v1/vcs/delegation/prepare` and the equivalent for VC
   issuance/renewal — server builds the unsigned payload + canonical hash,
   client signs and finalizes. Needed before `helix-sdk-js` can be pointed
   at them.

3. **Refactor `helix-sdk-js`.**
   Drop the direct `@helixid/core` imports for `verifyVP()` and delegation
   construction; call the API instead (`/v1/vp/verify`, the new `/prepare`
   endpoints). Keep `VPBuilder.sign()` local, per the accepted exception.
   Can land endpoint-by-endpoint rather than as one big change.

4. **Implement Item #1 (hosted instance)** per `proposal-hosted-instance.md`
   — accounts, DID auto-provisioning, interim key storage, sessions, rate
   limiting. Design's already settled; this is a build task. Sequenced
   before #4 per the original stakeholder priority (#1 and #2 together
   before Python SDK) — #2 is merged, this is the remaining piece.

5. **Start Item #4 (`helix-sdk-py`).**
   Thin client first, hitting the now-stabilized API surface from steps
   2–4 (`verify`, `resolve`, `delegation/prepare`, `issuance/prepare`).
   Reuse the golden vectors from step 1 for its own signing tests. Doing
   this after steps 2–3 means Python is never built against an API shape
   that's about to change out from under it.

6. **Item #3 (monorepo split) stays parked.** Revisit once 1–5 settle.
   `helix-sdk-py` should still be created as its own new repo when it
   starts (see prior discussion), independent of when the rest of the
   split executes.
