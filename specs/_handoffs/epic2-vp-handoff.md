# Epic 2 Handoff — VP Build & Verify

**Branch:** `feature/epics-1-5-consent-and-vp`, on top of Epics 1+3 (commit `63cf76e`). **No commits made** — the engineer reviews and commits at the epic boundary.

**Scope implemented:** §3 (VP generation), §4 (verification), §8 (repo cleanup). §5 (grant schema) was delivered by Epic 3 and is consumed here, not rebuilt — the spec states this itself. §9.1–§9.7 test matrix run; §9.8 skipped (Epic 5).

---

## READ FIRST — two findings that change what you thought was true

### 1. The committed baseline was unusable; I built a real one

Your prompt says *"specs/_baselines/ holds the pre-change verifyVP() results captured before this branch existed."* It does not. `specs/_baselines/verifyvp-baseline-2026-07-29.txt` is an 88-byte file whose entire content is the string `No projects matched the filters in "/Users/jazeerr/..."` — a failed pnpm command's stdout, committed by mistake. This was flagged as item 1 of the Epic 1/3 handoff's NEEDS VERIFYING list.

So there was nothing to diff against. I built a real, re-runnable harness and captured the baseline **from `HEAD` (Epics 1+3 complete) before making any Epic 2 edit**:

```bash
node specs/_baselines/verifyvp-baseline-harness.mjs capture   # writes fixtures + results-pre
node specs/_baselines/verifyvp-baseline-harness.mjs compare   # re-runs frozen fixtures, diffs
```

**Be precise about what this proves.** The baseline is anchored at *Epics 1+3 complete*, **not** "before this branch existed." That is the correct anchor for §2.9 — the contract says the new `verifyVP()` must match *current* behavior, and it isolates Epic 2's changes from Epic 1's deliberate ones (A2 changed every status list's `@context`; A3 added fail-closed validation — both would show up as diffs against a truly pre-branch baseline and both are intended). But if you specifically wanted a pre-branch anchor, this is not it, and A2/A3 mean such a diff would be non-empty by design.

The old garbage file is left in place — deleting it is your call, not mine.

### 2. `helix-api` was building against a *published* `@helixid/core`, not the workspace one

`helix-api/package.json` declared `"@helixid/core": "^0.1.0"`. The workspace core is `0.1.5`, but pnpm resolved that range to a **registry-downloaded `@helixid+core@0.1.0`**:

```
helix-api/node_modules/@helixid/core -> ../../../node_modules/.pnpm/@helixid+core@0.1.0/node_modules/@helixid/core
```

I found this when the API build failed with `Module '@helixid/core' has no exported member 'fetchStatusList'`. **Consequence: every `helix-api` build and test run — including Epic 1/3's — compiled against a stale published core, not the repo's.** Epic 1's A3 status-list validation and B7 error consolidation were never actually exercised through `helix-api`.

Fixed by changing the dep to `workspace:^` (matching how `sdk-js`, `mcp`, and `langchain` already declare it). This is an Epic 1/3-adjacent change I had to make to do Epic 2 at all; calling it out per the "don't revise Epic 1/3 code unless required" constraint. It touches `helix-api/package.json` and `pnpm-lock.yaml` only.

**Still resolving to published packages, deliberately untouched:** `examples/` (`core@0.1.0`, `sdk-js@0.1.1`) and `examples/e2e-travel-concierge/` (`core@0.1.5`, `mcp@0.1.2`). See DIVERGED and §9.7 below.

---

## §2.9 baseline comparison — the actual result

Harness: 8 deterministic cases (R1–R8) with fixed keys, fixed validity windows, `did:key` identities (offline resolution), and a `fetch` stub serving frozen status lists. Fixtures are frozen to JSON at capture time and **not rebuilt** on compare, so inputs are byte-identical across runs.

Captured pre-change, re-run post-change:

```
IDENTICAL  R1_root_valid          (effectiveScopes: equals privilegeScopes)
IDENTICAL  R2_delegated_valid     (effectiveScopes: equals privilegeScopes)
IDENTICAL  R3_chain_escalation    (effectiveScopes: n/a)
IDENTICAL  R4_vc_expired          (effectiveScopes: n/a)
IDENTICAL  R5_vc_revoked          (effectiveScopes: n/a)
IDENTICAL  R6_vp_expired          (effectiveScopes: n/a)
IDENTICAL  R7_vp_bad_signature    (effectiveScopes: n/a)
IDENTICAL  R8_target_mismatch     (effectiveScopes: n/a)
BASELINE MATCH: all cases byte-identical
```

Pre-change outcomes recorded, for the record: R1/R2 valid; R3 `DELEGATION_CHAIN_INVALID`; R4 `VC_EXPIRED`; R5 `VC_REVOKED`; R6 `VP_EXPIRED`; R7 `VP_SIGNATURE_INVALID`; R8 `VP_INVALID_STRUCTURE`.

**How the comparison treats `effectiveScopes`:** it is an additive field, so a naive object diff would flag every success case. The harness strips it, diffs everything else for byte-identity, and *separately* asserts `effectiveScopes` deep-equals `privilegeScopes` on each success — which is exactly what §2.9 requires ("`effectiveScopes` trivially equal to it"). Both checks pass on both success cases. No other field differs anywhere. Error cases are compared on `{name, code, httpStatus, message}`.

Artifacts committed for re-running: `verifyvp-baseline-harness.mjs`, `verifyvp-fixtures.json`, `verifyvp-results-pre.json`, `verifyvp-results-post.json`.

---

## What shipped

### §3.1 — `VPBuilder`
`helix-core/src/vp-builder.ts` rewritten to `{ credentials: SignedVC[], holderDid, targetService, userDid? }`.
- Structural validation runs **in the constructor**, so B4–B7 throw before any signing work (spec: "fail fast, before signing"): 1–2 entries, exactly one `HelixAgentCredential`, at most one `DelegationGrantCredential`, nothing else.
- `userDid` optional: when absent the `delegatedBy` key is **omitted entirely** from the payload before hashing/signing — not `null`, not `undefined`. Asserted by B2 (`'delegatedBy' in signedVP === false`).
- Wire field name `verifiableCredential` unchanged.

`helix-core/src/schemas/vp.ts`: `verifiableCredential` → `.min(1).max(2)`; `delegatedBy` → `.optional()`. One edit covers `signedVPSchema` via `extend`. **The `delegatedBy` optionality is a wire-contract change the spec implies but never spells out** — §3.1 mandates omitting the key, and the schema previously required it, so a no-user VP would have failed `signedVPSchema.safeParse()` at the API boundary. See DIVERGED.

### §4.1 — core `verifyVP()`
Array handling, grant verification, and `effectiveScopes` per the spec's control flow. Notable implementation choices:
- **`assertGrantVC()` runs before `verifyCredential()`** on the grant. G12 requires a malformed grant to throw `ConsentGrantInvalidError` and "never fall through to signature check"; the spec's own pseudocode has the two in the opposite order. Test asserts `fetch` is never called in that case.
- `intersect()` preserves agent-VC scope order, so `effectiveScopes` is a stable, deterministic array.
- Agent-match accepts `vp.holder` **or** any `delegationChain` subject (G2 ancestor case). User-match is plain string equality against `vp.delegatedBy`; a VP with no `delegatedBy` can never satisfy it (G6 rejects, since `undefined !== <string>`).
- The 1-element path is untouched: no array/grant branch executes when `grantEntries.length === 0`.

### §4.3/§7.2 — injectable status-list resolver
`VerifyVPOptions.statusListResolver?: (url) => Promise<StatusListCredential>`, defaulting to the HTTP path. `fetchStatusList` is exported so injected resolvers can delegate for URLs they don't own.

**Fail-closed applies identically to both paths** (§2.4, and §4.3's explicit note): whatever the resolver returns is `safeParse`d against `StatusListCredentialSchema` before `getBit()`. Additionally hardened while I was in there — a resolver that *throws* is coerced to `VCRevokedError`, and `getBit()` is wrapped so an unreadable `encodedList` (bad base64/gzip, out-of-bounds index) becomes `VCRevokedError` rather than an uncaught `Error` escaping `verifyVP()`. S3 covers that last one; it was reachable before this epic.

`helix-api` injects a resolver that reads its own `${API_BASE_URL}/v1/status-list/<id>` URLs straight from `vcService.getStatusList()` and falls back to HTTP for everything else. A3 asserts the local read happens with **zero** `fetch` calls.

### §4.4 — error taxonomy
`ConsentGrantSubjectMismatchError` (`CONSENT_GRANT_SUBJECT_MISMATCH`) and `ConsentGrantInvalidError` (`CONSENT_GRANT_INVALID`) added to `HelixError.ts` + `codes.ts`, with a comment recording that they are deliberately **outside** the B7 consolidation. Existing `VCRevokedError`/`VCExpiredError`/`VCSignatureInvalidError` reused for grant-side failures of those kinds, as specified.

### §2.7 — enforcement reads `effectiveScopes`
`helix-sdk-js/src/scope.ts`: `checkScope()` now reads `result.effectiveScopes`. `requireScope()` inherits it. Test added proving a narrowed `effectiveScopes` gates a scope that `privilegeScopes` still contains — without that, the grant intersection would be inert metadata.

### §4.2/§7.3 — `helix-api` as a thin wrapper
`VPService` reduced from ~540 lines to ~170. It now: `signedVPSchema.safeParse` → `verifyVPCore(vp, { statusListResolver })` → one audit event → optional JWT.
- **Retired entirely:** `reconstructDelegationChain()`, the service's own `verifyDelegationChain()`, `verifyVCSignedByIssuer()`, `extractStatusListId()` + local-repo revocation lookup, `extractPublicKeyHex()`, `summarizeDelegationChain()`, `credentialExpiryMs()`, `extractScopes()`, `decodeBase58ProofValue()`, `resolveDIDDocument()`, and `generateVPTemplate()`.
- **§7.3 implemented as resolved:** exactly one `VP_VERIFIED` after the core call returns, or exactly one `VP_REJECTED` (with `internalReason`) after it throws. No `CHAIN_VERIFIED`/`CHAIN_REJECTED` anywhere. **No logging callback was added to core's `verifyVP()`.** Nothing built toward the parked audit-routing module (D2) — the two existing call sites are plain `auditLogger.log()` exactly as before.
- JWT `scopes` claim = `result.effectiveScopes` (§9.4 A2).
- Constructor is now `(vcService, auditLogger, apiBaseUrl, jwtSessionOptions?)` — `vpRepository`, `didService`, `serviceRegistry`, and `vpTtlSeconds` are gone. `server.ts` updated.

### §8 — cleanup checklist
- [x] DB-walk removed (verified by grep, §9.6 C1 — zero hits for `reconstructDelegationChain`/`CHAIN_VERIFIED`/`CHAIN_REJECTED` in `helix-api/src`).
- [x] Orphaned `helix-sdk-js/src/vp/VPBuilder.ts` deleted with its test (C2 — zero resolving imports repo-wide).
- [x] `generateVPTemplate()` **removed**, not deprecated. Justification: it was not wired to any live route, and `tests/integration/vp.integration.test.ts` already contained a test asserting `POST /v1/vp/template` returns 404 — the endpoint was retired earlier; only the dead service method remained. `VPTemplateParams`/`VPTemplateResult` removed from `IVPService` too. (C3)
- [x] New code uses `VC_CONTEXTS`; no new hardcoded context URLs.
- [x] README (3 examples) and `public-surfaces.md` updated to the `{ credentials: [...] }` shape (C4). README's verifier example also switched to `result.effectiveScopes` for its scope check and session issuance, since showing `privilegeScopes` there would document the exact bug §2.7 warns about.

### In-repo caller migration
`packages/langchain/src/middleware.ts` (2 sites), `packages/mcp/src/attach.ts`, `examples/verifier-example-utils.ts`, and all 21 `VPBuilder` sites across core/sdk test files.

---

## Test results

| Suite | Result |
|---|---|
| `helix-core` | **17 files, 160 tests, all pass** (was 16/135 — new `vp-grant.test.ts` adds 25) |
| `helix-sdk-js` | **18 files, 156 tests, all pass** |
| `helix-api` | 37 files, 215 tests — **210 pass, 5 fail** (all pre-existing audit-log, see below) |
| `packages/cli` | 6 files, 28 tests, pass |
| `packages/mcp` | 8 tests, pass · `packages/langchain` 7 tests, pass · `did-hedera` pass |
| §2.9 baseline harness | **8/8 IDENTICAL** |

New coverage: `helix-core/tests/unit/vp-grant.test.ts` (B1–B9, G1–G12, S1–S5 + a healthy-local-resolver case, 25 tests); `helix-api/tests/utils/vp-fixtures.ts` (§9.9 fixture set); the three `helix-api` VP suites rewritten (26 tests) covering §9.4 A1–A6.

**§9.9 fixtures are real, not stubs**: root agent VC, 2-hop delegated chain (via `buildDelegationVC`), signed grants in both durabilities and both DID- and email-valued `userDid` forms, a revoked-grant fixture produced by Epic 3's actual `revokeGrant()`, and **three distinct malformed status-list variants** — missing-fields (S2), schema-valid-but-unreadable-`encodedList` (S3), and non-200 (S4). The `fetch` path is exercised through a `fetch` stub that returns real `Response`-shaped objects; it is never bypassed, and A4 asserts `fetch` was actually called with the SP URL.

### The `helix-api` failure count went 13 → 5. Here is exactly why.

Epic 1/3 ended with 13 failures across 4 files. Now 5, across 1 file:

- **5 × `audit-log.repository.test.ts` — unchanged, still failing, byte-identical to the Epic 1/3 baseline.** Tests call `repository.findMany()`; the repository only has `list()`. Pre-existing on `main`, untouched, not mine to fix.
- **8 × `vp.integration` / `vp.security` / `vp.service` — gone because I deleted and rewrote those three files.** Those tests exercised the DB-walk verifier, `generateVPTemplate`, and server-side `vpId` replay records — all code §8/§4.2 retires. They could not be patched into the new architecture; several were *already failing* before I touched them (`rejects unknown vpId`, `bubbles up ServiceNotFoundError`, etc.). **Their disappearance is not a fix** — I removed the tests along with the code they tested, and wrote the §9.4 matrix in their place. If you want the old expectations preserved somewhere, that is a conversation to have at review.

### §9.7 — the four demo scenarios were NOT run. Same honest status as Epic 1/3.
There is still no automated harness: all five `e2e/tests/*.ts` are single `it.todo` stubs, and the demo is a Docker-compose + LLM-API-key app. Two mitigating facts, both verified: the demo pins **published** `@helixid/*` versions, so local source changes cannot affect it until a release is cut; and its `typecheck` passes. **A real §9.7 run needs Docker + provider keys and a human.** I did not run it and am not claiming it passes.

---

## DIVERGED

1. **`delegatedBy` made optional in `signedVPSchema`.** Forced by §3.1's optional `userDid` — the API parses every inbound VP with this schema, so a legitimately user-less VP would have been rejected at the boundary. Spec mandates the omission but never mentions the schema consequence.
2. **JWT `userDid` falls back to the agent DID when `delegatedBy` is absent.** `HelixJWTPayloadSchema` requires `userDid: z.string().min(1)`, but a VP may now legitimately have no user identifier. I chose `parsed.data.delegatedBy ?? result.agentDid` to keep the JWT schema untouched. **This is a semantic judgment call in a security-adjacent field and I am not confident it is the right one** — the alternatives are refusing session issuance for user-less VPs, or relaxing the JWT schema to make `userDid` optional. Flagging rather than deciding. Note a grant can never be involved here (G6 rejects grants without `delegatedBy`), so this only affects plain agent-VP sessions.
3. **`assertGrantVC()` ordered before `verifyCredential()`**, inverting the spec's pseudocode, because G12 requires structural rejection to pre-empt signature work.
4. **`generateVPTemplate()` removed rather than deprecated** — §8 allows either; removal chosen because it was already unreachable (a test asserting the route 404s predates this epic).
5. **`helix-api`'s `@helixid/core` dep changed to `workspace:^`.** An Epic 1/3-adjacent edit, required to compile Epic 2 at all. See finding 2 above.
6. **Three `helix-api` VP test files rewritten wholesale** rather than incrementally edited, for the reason given above.
7. **`VPRepository` is now referenced only by its own unit test.** Its last production consumer was the vestigial `vpId` record path in `VPService` (already dead — the old code carried the comment *"Skipping server-side vpId record checks and consumption"*). I left the file and its passing test alone: deleting it is outside §8's checklist. Repo-hygiene candidate.
8. **`examples/verifier-example-utils.ts` migrated to the new shape, but `examples/` pins published packages** (`sdk-js@0.1.1`), so the file is now correct against the *next release* and inconsistent with its *currently-pinned* dependency. It has no build, test, or typecheck script and is not in CI, so nothing fails today. §8 explicitly required updating examples showing the old shape, so I migrated it; pointing `examples/` at `workspace:^` would make it verifiable but is scope I did not take.
9. **`packages/mcp` test mocks** needed `effectiveScopes` added to their mocked `VerifyVPResult` objects — behavioral consequence of §2.7, not a spec deviation, but it is a change to an Epic-1/3-era test file.

---

## NEEDS VERIFYING

1. **Decide the JWT `userDid` fallback** (DIVERGED 2). This is the one item I would want a second opinion on before it ships.
2. **Delete or regenerate `specs/_baselines/verifyvp-baseline-2026-07-29.txt`.** It is still garbage and still sitting next to the real harness; leaving both invites someone to trust the wrong one.
3. **Audit the remaining published-vs-workspace dependency drift.** `helix-api` was the dangerous one and is fixed, but `examples/` and `examples/e2e-travel-concierge/` still resolve to registry packages. Anything that "passes" in those directories is testing published code, not this branch — which also means the §9.7 demo scenarios cannot regress from source changes until a release is cut, and equally cannot *validate* them.
4. **The 5 audit-log repository failures** (`findMany` vs `list`) are now the *only* red in the workspace. They have survived two epics untouched. Worth fixing before Epic 5 so the suite is green enough to detect real regressions.
5. **`VPRepository` and `ServiceRegistryRepository`** — the former is now test-only; the latter is still seeded in `server.ts` but the service registry was removed in Epic 1's A4. Both look like leftovers worth a hygiene pass.
6. **Live tests reference the removed template endpoint.** `helix-api/tests/live/{vp,jwt-session,vc-expiry,vc-revocation}.live.integration.test.ts` all `POST /v1/vp/template` then feed the response into `new VPBuilder(...)`. They are excluded from `test:non-live` (they need real Hedera), so they did not run here — **they will fail when someone runs the live suite.** They need rewriting to build VPs client-side per §2.3. I did not touch them; that is arguably in-scope cleanup I am flagging rather than doing blind, since I cannot execute them to confirm the fix.
7. **`effectiveScopes` is now required on `VerifyVPResult`.** Any external consumer constructing that object literal (as two in-repo tests did) breaks until updated. Worth a release note.

## Parked / not built (per register)
- **Epic 4 audit routing — PARKED (D2).** §7.3's resolution implemented as the *absence* of mid-verification logging; no routing module, no callback parameter, no stubs.
- **§9.8 consent-demo 5-step flow** — Epic 5, skipped as instructed.
- **Index-allocation uniqueness (O4/D9)** — untouched, still open.
