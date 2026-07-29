# Epic 1 + Epic 3 Handoff — SP Identity & Revocation Infra, Consent Package

**Branch:** `feature/epics-1-5-consent-and-vp` (single branch per register D12; no commits made — engineer commits at the epic boundary).
**Scope boundary respected:** stops at "the agent holds a signed grant credential in its wallet." No VP composition or verification code was written or modified beyond A3's status-list validation inside the existing revocation check.

---

## What shipped, per task ID

### A1 — `VCBaseSchema` export
`helix-core/src/schemas/vc.ts`: `VCBaseSchema` is now `export const`. Nothing else in the file's base schema changed.

### A2 — Status-list `@context` uses `VC_CONTEXTS`
`helix-core/src/status-list/index.ts`: `buildStatusListCredential()` now emits `[...VC_CONTEXTS]` instead of the hardcoded pair.

> **Real shape change, not cosmetic (call out in PR):** every served status list's `@context` changes from `["…/credentials/v2", "…/credentials/status/v1"]` to `["…/credentials/v2", "https://helixid.io/contexts/v1"]`. Nothing is in production, but any fixture or verifier asserting the old `status/v1` URL must change. One existing test asserted the old URL and was updated to assert the exact new array (`helix-core/tests/unit/status-list.test.ts`).

### A3 — Runtime schema validation for fetched status lists
- New `helix-core/src/status-list/schema.ts` with `StatusListCredentialSchema` (exact shape from the epic doc). Re-exported through the status-list module and the core barrel.
- `helix-core/src/vp-verifier.ts` `verifyRevocation()`: the fetched body is now `safeParse`d before `getBit()`. Parse failure → `VCRevokedError` (fail closed, same error class the revocation path already throws). A response body that isn't JSON at all is also caught and mapped to `VCRevokedError` rather than escaping as an unhandled `SyntaxError` — the epic's "do not throw an unhandled cast error" requirement covers this case too.
- One shared path for `helix-api`-hosted and SP-hosted lists; no host special-casing.
- Test fixtures in `core-local-flows.test.ts` that served a bare `{credentialSubject:{encodedList}}` body were upgraded to full schema-valid credentials via a `statusListBody()` helper (that old shape is exactly what validation now rejects).

### A4 — Service registry removal (full checklist)
Code, all four packages:
- `helix-api/src/routes/agent/index.ts` — the three `/services` route handlers deleted; the six unrelated routes untouched.
- `helix-api/src/services/agent/agent.service.ts` — `listServices()`, `getService()`, `createService()` removed; `ServiceNotFoundError`/`ServiceAlreadyExistsError` imports removed; local `ensureServiceName()` helper deleted. `ensureHttps()` kept (still used by the onboarding path). `VALIDATION_ERROR` path untouched.
- `helix-api/src/services/agent/IAgentService.ts` — three method signatures and the `ServiceEntry` interface removed.
- OpenAPI — the three `/v1/services` paths removed. **Location differs from spec:** the file is `helix-core/src/openapi/openapi.yaml`, not `helix-api/src/openapi/openapi.yaml`; there is no other OpenAPI file.
- `helix-sdk-js/src/client/HelixClient.ts` — `registerService()`, `listServices()`, `getService()` and `RegisterServiceOptions` removed; `src/index.ts` type re-export updated. Generated in-src `.js`/`.d.ts` copies regenerated via `tsc` (see "Generated artifacts" below).
- Console — `src/pages/ServicesPage.tsx` deleted; its page-only subcomponents `src/components/services/ServiceForm.tsx` and `ServiceList.tsx` deleted with it (nothing else referenced them); route removed from `App.tsx`; nav entry removed from `AppLayout.tsx` (nav is now 3 items); `listServices`/`registerService` removed from `src/api/client.ts`; `ServiceRecord` interface and `ServiceInput` re-export removed from `src/api/types.ts`.

Tests:
- `helix-api/tests/integration/agent.integration.test.ts` — three `/services` route tests removed.
- `helix-api/tests/unit/services/agent.service.test.ts` — `getService`/`createService` describes and the error-class imports removed.
- `helix-api/tests/unit/services/agent.service.complex.test.ts` — `createService branches` describe removed (this file was not on the spec's list; caught by running the suite).
- `helix-sdk-js/tests/unit/client/HelixClient.full.test.ts` — services tests removed; the status-list half of the combined test kept as its own test.
- Console — `ServicesPage.test.tsx` and `ServiceList.test.tsx` deleted; mocks and the four-item-nav assertion in `App.test.tsx`, `auth/login.test.tsx`, `api/client.test.ts` updated.
- Repository layer (`agent.repository`) and its mock stubs left alone per the spec's fixture-helper carve-out.

Docs:
- `docs/major-flows.md` — §7 "Service Registry" deleted; following sections renumbered 8→7, 9→8, 10→9 (no cross-references to those numbers exist outside `specs/`).
- `docs/public-surfaces.md` — three HTTP rows and three SDK rows removed.
- `README.md` — "Register your service" section and its curl example removed. `orders-service` `targetService` references elsewhere kept, per spec.
- `helix-api/README.md` — the "intentionally unauthenticated `POST /v1/services`" note and the route-table mention removed (documents a now-nonexistent endpoint).

**DIVERGED — grep is not literally zero.** Remaining `/v1/services`-family hits are confined to two historical documents left unedited on purpose: `docs/helixid-decision-log-updated.md` (superseded decision log per register O3 — rewriting history would falsify the paper trail) and `console/DEV_SPEC.md` (the console's original v1 design spec, same reasoning). All live code, live docs, and OpenAPI are clean.

**Seeder note:** the spec predicted `helixid-setup` seeder breakage because it "currently calls `POST /v1/services`". The current seeder (`examples/e2e-travel-concierge/helixid-setup/seed.ts`) contains no such call — nothing broke, nothing was fixed. The Epic 5 task to move it to `POST /v1/dids` may already be moot; verify when Epic 5 starts.

### A5 — `did:web` + status list as one onboarding command
`packages/cli/src/commands/did.ts`: the `--method web` branch now runs status-list creation by default after the existing steps, by calling `runStatusListCreate()` (exact reuse of the `status-list create` path: `loadIssuerKeyMaterial` → `buildCliStatusListPayload` → `signCredential` — which post-B5 delegates to `createEd25519Proof`).
- **Opt-out flag: `--no-status-list`** (commander's native boolean negation; the repo had no existing `--no-*`/`--skip-*` precedent, so the commander-idiomatic form was chosen).
- New optional flags: `--status-list-length <bits>` (default 131072), `--status-list-output <path>` (default `status-list.json` next to the wallet file), `--status-list-base-url <url>` (default `https://<domain>/.well-known/helix-status-list.json`).
- Printed operator instructions now list both artifacts and where each must be hosted.
- Docs updated: `docs/public-surfaces.md` CLI table row, `packages/cli/README.md` `did create` section (including the "pick a generous length, indices are random" guidance from B3). **The root `README.md` has no SP identity/onboarding section** — the spec's "if one exists" condition was false; nothing added there.

### B1 — `DelegationGrantCredential` schema
New `helix-core/src/schemas/delegation-grant.ts`: `DelegationGrantVCSchema` = `VCBaseSchema.extend` with the spec's `superRefine` type check and `credentialSubject` shape (also exported separately as `DelegationGrantSubjectSchema`). Exported via the schemas barrel.
- `HelixVC` in `vc.ts` widened to `AgentVC | UserVC | DelegationGrantVC` via a type-only import (no runtime cycle). This automatically widens `SignedVC`'s default parameter, which is what `AgentWallet.credentials` uses — the "generic any-VC" surface from the spec. `validateScopeSubset()`/`validateChainIntegrity()` untouched, still `AgentVC[]`-typed.

### B2 — `issueGrant()`
New `helix-core/src/grant.ts` (sibling convention of `delegation.ts`), exported from the core barrel.
- Signature matches the spec. Builds the grant payload (`@context` = `[...VC_CONTEXTS]`, id `vc:helix:grant:<uuid>`, `credentialStatus` per `VCCredentialStatusSchema` pointing at `statusListCredentialUrl` + chosen index), validates it against `DelegationGrantVCSchema` (failure → `ValidationError`), signs via `createEd25519Proof()`, returns `{ grantVC, updatedStatusList }`.
- **No `delegationChain` field, ever** — explicit test asserts absence.
- Issuance sets no bits; `updatedStatusList` is the input list returned unchanged (per the spec's step 5), for the SP's backend to persist alongside the grant.
- No file I/O, no DB writes.

**DIVERGED (judgment calls, flagged):**
- `IssuerKeyMaterial` is defined locally in `grant.ts` as `{ did, privateKeyHex }` — the CLI's identically-named interface can't be imported (core must not depend on cli), and `publicKeyHex` isn't needed to sign. Structurally compatible with the CLI's.
- `validUntil` defaults: `standing` → now + ~10 years (spec-sanctioned judgment); `session` → **now + 24 hours**. The spec gives no session duration and no expiry input in `IssueGrantOptions`; 24h is a placeholder for "expires with the agent session" until real session semantics exist (widget/Epic 3b territory). If a different default or an explicit option is wanted, it's a one-line change.
- B7's "grant issuance throws the shared scope-escalation error" item has **no applicable throw site**: `IssueGrantOptions` carries no representation of what the issuing SP is itself authorized for, so there is nothing to check escalation against. No check was invented. If SP-side scope policy arrives later, use `ScopeEscalationDeniedError`.
- Added `getStatusListLength(encodedList)` to `helix-core/src/status-list/index.ts` (mirrors the CLI helper) — needed to bound the random index; core couldn't reach the CLI's copy.

### B3 — Random index allocation
Inside `issueGrant()`: `Math.floor(Math.random() * listLength)` — exactly that, nothing more. `findNextAvailableIndex()` untouched and not used. **Part E / O4 stays OPEN per register D9 — nothing built toward collision detection or an allocator.** Test samples 25 issuances and asserts every index is within the list's bit length.

### B4 — `revokeGrant()`
In `grant.ts` alongside issuance. Matches the decided input shape exactly: `{ vc }` reads `credentialStatus.statusListIndex` off the VC (no side-registry, no `helixIndexRegistry`); `{ statusListIndex }` used as-is; neither/invalid → `ValidationError` (consolidated taxonomy) with the spec's message. Object-in/object-out: flips the bit via `setBit`, re-signs via `createEd25519Proof()`, returns the updated credential (`SignedStatusListCredential` = `StatusListCredential & { proof }`); caller persists.
- **Deliberate difference from the CLI `revoke` path:** a stale `proof` on the input list is stripped before hashing/re-signing, so the new signature covers only the payload. (The CLI's `revokeCredentialInStatusList` hashes over the previous proof object; that quirk was not reproduced in the new function. CLI behavior itself untouched.)

### B5 — Signer merge
`packages/cli/src/lib/issuer-ops.ts` `signCredential()` internals replaced with a call to `createEd25519Proof()` from `@helixid/core`; external signature and all call sites unchanged.
- **Core barrel change required:** `createEd25519Proof`, `verifyEd25519Proof`, and `LinkedDataProof` were not previously exported from `@helixid/core`'s index; they now are (the CLI can only import via the barrel).
- Regression test `packages/cli/tests/issuer-ops.signCredential.test.ts`: frozen copy of the pre-merge implementation lives in the test; clock frozen with fake timers; asserts full-object and `proofValue` byte-identity between old and new. Passes.

### B6 — `AgentWallet.selectGrant()`
`helix-sdk-js/src/wallet/AgentWallet.ts`: new synchronous `selectGrant(issuerDid, userDid): WalletCredential | undefined` filtering the in-memory credential store by `type` includes `DelegationGrantCredential`, `issuer === issuerDid`, parsed `credentialSubject.userDid === userDid`; most-recent match by `addedAt` (mirrors `getLatestCredential`'s sort). `addCredential()` unchanged — its ownership check already works for grants (`credentialSubject.id` is the agent DID).
- Note for Epic 2: it returns the wallet's metadata row (`WalletCredential`), not a parsed VC — callers composing a VP need `JSON.parse(item.vcJson)`.

### B7 — Error taxonomy consolidation
Ground truth differed from the spec's framing: all four classes already lived in `helix-core/src/errors/HelixError.ts`; the two source files merely threw them. The actual overlap and the decided mapping:
- `DelegationScopeEscalationError` (code `DELEGATION_SCOPE_ESCALATION`) duplicated `ScopeEscalationDeniedError` (code `SCOPE_ESCALATION_DENIED`) with an identical message → **consolidated into `ScopeEscalationDeniedError`**; the old name remains exported as a const+type alias so all imports (sdk-js error mapper, tests, examples) keep compiling.
- `DelegationDepthExceededError` (code `DELEGATION_DEPTH_EXCEEDED`, thrown nowhere in the codebase) duplicated `MaxDelegationDepthExceededError` → **alias, same pattern**.
- `DelegationChainInvalidError` has no twin — untouched. `ConsentGrantSubjectMismatchError`/`ConsentGrantInvalidError` do not exist in the current codebase (they belong to the VP doc's future work) — nothing to avoid touching.
- `schemas/vc.ts` `validateScopeSubset()` now throws `ScopeEscalationDeniedError`. **Observable change:** that throw site's error code becomes `SCOPE_ESCALATION_DENIED` (was `DELEGATION_SCOPE_ESCALATION`). No test asserted the old code (tests assert messages/instanceof, all still pass), and no live code path branches on it, but API consumers matching that code string over the wire would notice — see NEEDS VERIFYING.
- Wire codes `DELEGATION_SCOPE_ESCALATION`/`DELEGATION_DEPTH_EXCEEDED` intentionally remain in `codes.ts`: `helix-sdk-js/src/errors/index.ts` still maps them from API responses.
- `delegation.ts` already threw the canonical classes — no change. Grant code (B2/B4) throws `ValidationError` from the same shared file.

---

## Generated artifacts (regenerated, not hand-edited)

`helix-sdk-js` and `packages/cli` have **git-tracked compiled copies** (`.js`/`.js.map`/`.d.ts`/`.d.ts.map`) sitting next to the TypeScript sources — for `src/` *and* for `tests/` — left over from an era when `tsc` emitted in-place (both packages now build to `dist/`). Vitest resolves the literal `.js` specifiers in test imports to these files, so stale copies actually execute. After the source changes they were regenerated with a temporary tsconfig (`rootDir: "."`, `outDir: "."`, include `src` + `tests`), then the scratch config was deleted. My new test files therefore also have compiled twins, consistent with the existing pattern. **Repo-hygiene candidate for a future ticket: stop tracking in-src build output entirely** — but not this epic's call.

---

## Test coverage added

| Suite | Covers |
|---|---|
| `helix-core/tests/unit/grant.test.ts` (12 tests) | A1 import row; B1 accept/reject (missing scopes, bad durability, missing type strings, missing userDid, optional serviceDid/extra types); B2 no-`delegationChain`, schema+signature validity; B3 index within bit length ×25, list unmodified at issuance; standing vs session `validUntil`; B4 revoke-by-VC (exact bit, all others untouched), revoke-by-index, double-revoke with proof-stripping + signature verification, error rows |
| `helix-core/tests/unit/status-list.test.ts` (updated) | A2 exact `@context` array |
| `helix-core/tests/unit/core-local-flows.test.ts` (updated + 1 new test) | A3 happy path (valid list parses, `getBit` proceeds), fail-closed on: pre-validation bare shape, wrong `statusPurpose`, non-JSON body; existing non-200→`VC_REVOKED` test still passing |
| `packages/cli/tests/issuer-ops.signCredential.test.ts` (new) | B5 byte-identical regression |
| `packages/cli/tests/cli.test.ts` (2 new tests) | A5 default produces both artifacts; `--no-status-list` produces only the DID doc |
| `helix-sdk-js/tests/unit/wallet/AgentWallet.test.ts` (3 new tests) | B6 mixed-type wallet with other-SP and other-user grants, recency selection, empty-wallet cases |
| Existing suites (regression) | B7: `core-local-flows` (SCOPE_ESCALATION_DENIED / MAX_DELEGATION_DEPTH_EXCEEDED assertions), `schemas/delegation.test.ts` (message assertions), `errors.test.ts` (all classes incl. aliases) — all pass unmodified |
| A4 | Post-removal grep verified; full api/sdk/console test suites re-run |

## Regression run (Part C last row) — honest status

- **Automated:** full CI-equivalent `pnpm test:non-live` run (Node 24, Postgres 16 on :5433 like CI). Final failure set is **byte-identical to the pre-change baseline captured before any edit**: the same 13 pre-existing failures in 4 `helix-api` files (`vp.integration`, `vp.security`, `audit-log.repository` — tests call a `findMany()` the repository doesn't have — and `vp.service` unit tests). Every other package green: core 135, sdk-js 166, cli 28, mcp 8, langchain 7, did-hedera pass. **Zero failures introduced or fixed by this epic.**
- **The four `e2e-travel-concierge` demo scenarios were NOT executed live.** They are a Docker-compose + LLM-key demo app with no automated harness (`e2e/tests/*` are all `it.todo` stubs). Two mitigating facts: (1) the demo pins **published npm versions** of `@helixid/*` (`^0.1.5` etc.), so local source changes cannot alter its behavior at all until a release is cut; (2) its `typecheck` passes. Anyone wanting the literal live run needs Docker + provider API keys.
- Pre-existing breakage inherited from `main`, untouched per scope rules: the `@helixid/console` build fails on type imports sdk-js never exported (CI already excludes console from the build; its `AuditPage` tests also fail pre-existing — verified by stashing this epic's edits and re-running).

## NEEDS VERIFYING before Epic 2

1. **`specs/_baselines/verifyvp-baseline-2026-07-29.txt` is garbage.** Its entire content is the string `No projects matched the filters in "/Users/jazeerr/…"` — a failed pnpm command's output committed as the baseline. Epic 2's §2.9 byte-identical regression contract has **no valid baseline to diff against**. Regenerate it (and record the exact command that produces it) before starting the core-consolidation half.
2. **A2's `@context` change** — any Epic 2 fixture or golden file for status lists must expect `VC_CONTEXTS`, not `…/credentials/status/v1`.
3. **B7's code change at `validateScopeSubset()`** (`DELEGATION_SCOPE_ESCALATION` → `SCOPE_ESCALATION_DENIED`). `helix-api`'s DB-walk verification (`vp.service.ts` → `validateChainIntegrity`) can now surface the new code over the wire. Epic 2 retires that DB-walk anyway; just don't write Epic 2 assertions against the old code.
4. **Session-grant `validUntil` = 24h** is my placeholder — confirm or replace when real session semantics land (widget epic).
5. **`selectGrant()` returns a `WalletCredential` row**, not a parsed VC — Epic 2's VP composition must `JSON.parse(vcJson)`.
6. **Core barrel now exports `createEd25519Proof`/`verifyEd25519Proof`** — Epic 2 should use these, not reintroduce a local signer.
7. **13 pre-existing api test failures + broken console build** predate this epic (identical on `main`) and were left per the "don't revise earlier work" rule — but they will muddy Epic 2's own regression runs unless fixed or explicitly carried forward the same way. The audit-log `findMany` mismatch in particular looks like tests written against unshipped code.
8. **Seeder**: contains no `POST /v1/services` call today — re-check Epic 5's "switch seeder to `POST /v1/dids`" task against the actual file before doing it.

## Open items deliberately not solved (per register)
- **Part E / O4** — index-allocation uniqueness: OPEN (D9). Random index shipped; no collision detection, no allocator.
- **Epic 4 audit routing** — PARKED (D2). All existing audit call sites untouched; no routing module, no stubs.
- Historical-doc registry mentions (`docs/helixid-decision-log-updated.md`, `console/DEV_SPEC.md`) — left as historical record; see A4 DIVERGED note.
