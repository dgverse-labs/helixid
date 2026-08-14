# HelixID — Cross-Epic Test Suite (Epics 1–5)

**Purpose of this doc:** a single consolidated test plan spanning all five
epics, organized by risk area rather than by epic. Each of the 12
categories below first states **what's already specified** in the epic
handover docs (so nothing gets duplicated), then gives an **expanded
matrix** — existing cases restated for completeness, plus **[NEW]** cases
that close gaps no existing doc covers.

**Source docs referenced by short name:**
- `E1E3` = `epic1-epic3-implementation-handover.md`
- `VP` = `helixid-vp-generation-verification-dev-design.md`
- `WIDGET` = `helixid-widget-handover.md`
- `E5` = `epic5-seeder-consent-demo-handover.md`
- `LOG` = `helixid-consolidated-decision-log.md`

**Status key for cases below:** `[existing]` — already specified
verbatim in a source doc, restated here for a complete single view.
`[NEW]` — not specified anywhere, added to close a gap found while
building this doc.

---

## 1. Schema & Validation Correctness

**Existing coverage:** `E1E3` A1 (`VCBaseSchema` export), B1
(`DelegationGrantVCSchema`), Part C table rows A1/B1. `VP` §1 (schema
facts), §9.5 S1–S5 (`StatusListCredentialSchema`). `VP` §9.1 B4–B7
(`unsignedVPSchema`/`signedVPSchema` array-length constraint, exercised
indirectly through `VPBuilder`, not as a standalone schema test).

**Gap found:** `AgentVCSchema` itself and `VCCredentialStatusSchema` have
no dedicated positive/negative test anywhere — every doc assumes they're
pre-existing and stable. Worth a baseline confirmation since Epic 1/3
touches adjacent code (A2, A3) without re-touching this schema directly.

| # | Case | Expected | Status |
|---|---|---|---|
| SCH1 | `VCBaseSchema` importable from a file other than `vc.ts` | import succeeds | `[existing]` E1E3 A1 |
| SCH2 | `DelegationGrantVCSchema.parse()` — well-formed grant | accepts | `[existing]` E1E3 B1 |
| SCH3 | `DelegationGrantVCSchema.parse()` — missing `scopes` | rejects | `[existing]` E1E3 B1 |
| SCH4 | `DelegationGrantVCSchema.parse()` — invalid `durability` enum value | rejects | `[existing]` E1E3 B1 |
| SCH5 | `DelegationGrantVCSchema.parse()` — `type` missing `DelegationGrantCredential` | rejects | `[NEW]` — implied by `superRefine` logic but not explicitly listed |
| SCH6 | `StatusListCredentialSchema.safeParse()` — well-formed list | succeeds | `[existing]` VP S1 |
| SCH7 | `StatusListCredentialSchema.safeParse()` — missing required field | fails | `[existing]` VP S2 |
| SCH8 | `StatusListCredentialSchema.safeParse()` — invalid `encodedList` content | fails cleanly, no crash in `getBit()` | `[existing]` VP S3 |
| SCH9 | `unsignedVPSchema` — `verifiableCredential` array length 0 | rejects | `[NEW]` — implied by `.min(1)` but not a listed case |
| SCH10 | `unsignedVPSchema` — `verifiableCredential` array length 3 | rejects | `[NEW]` — implied by `.max(2)`, overlaps with VP B5 but at schema level not builder level |
| SCH11 | `AgentVCSchema.parse()` — well-formed agent VC | accepts | `[NEW]` — baseline, no existing doc covers this schema directly |
| SCH12 | `AgentVCSchema.parse()` — `type` missing `HelixAgentCredential` | rejects | `[NEW]` — baseline |
| SCH13 | `VCCredentialStatusSchema.parse()` — well-formed entry pointer | accepts | `[NEW]` — baseline |
| SCH14 | `VC_CONTEXTS` spread (`[...VC_CONTEXTS]`) produces a mutable array equal to the readonly tuple's contents | equal, no shared reference mutation | `[NEW]` — trivial but worth locking given how many builders depend on this convention |

---

## 2. Issuance Correctness

**Existing coverage:** `E1E3` B2 (issued grant has no `delegationChain`,
index within bit length), B5 (signer merge regression — byte-identical
old vs new signature). Agent VC issuance and `delegate()`/
`buildDelegationVC()` are explicitly **NO CHANGE** per `LOG` §6 item 4 —
not retested here, out of scope for regression beyond the existing
suite's own coverage.

**Gap found:** no test confirms `issueGrant()`'s two return values
(`grantVC`, `updatedStatusList`) are independently correct — existing
cases check the VC shape but not that the returned status list is
byte-identical to the input (issuance doesn't set bits, per B3).

| # | Case | Expected | Status |
|---|---|---|---|
| ISS1 | Issued grant VC has no `delegationChain` field | absent | `[existing]` E1E3 B2 |
| ISS2 | Issued grant VC's `credentialStatus.statusListIndex` within bit length | within range | `[existing]` E1E3 B2 |
| ISS3 | `signCredential()` old vs new implementation | byte-identical signature output | `[existing]` E1E3 B5 |
| ISS4 | `issueGrant()`'s returned `updatedStatusList` | identical to input `statusList` (issuance never sets bits) | `[NEW]` |
| ISS5 | `issueGrant()` with `durability: 'standing'` | `validUntil` is a concrete far-future value, not absent | `[NEW]` — locks the "no no-expiry value" rule from E1E3 B1 notes |
| ISS6 | `issueGrant()` with `durability: 'session'` | `validUntil` reflects session-scoped expiry, distinct from standing's far-future value | `[NEW]` |
| ISS7 | Two back-to-back `issueGrant()` calls against the same status list | different `statusListIndex` values with overwhelming probability (not asserted as guaranteed — see LOG Part E open item) | `[NEW]` — probabilistic, run with a fixed seed or large N to catch a broken RNG, not to prove uniqueness |
| ISS8 | `revokeGrant()` given a VC | correct index flipped | `[existing]` E1E3 B4 |
| ISS9 | `revokeGrant()` given a bare index | correct index flipped | `[existing]` E1E3 B4 |
| ISS10 | `revokeGrant()` given neither | throws clear error | `[existing]` E1E3 B4 |
| ISS11 | `revokeGrant()`'s returned `StatusListCredential` | re-signed (new/valid proof), caller-persistable | `[NEW]` — existing cases check the bit flip, not that the returned object is independently valid |

---

## 3. Verification — Single-Credential Path (Regression)

**Existing coverage:** `VP` §9.2 R1–R8 is a complete, already-thorough
regression matrix. Nothing to add here structurally — restated for
completeness since this is the single most important safety net in the
whole system (§2.9's non-negotiable byte-identical contract).

| # | Case | Expected | Status |
|---|---|---|---|
| REG1 | Root agent VC, 1-element array, valid | `valid: true`, `privilegeScopes == effectiveScopes`, `delegationChain.length === 1` | `[existing]` VP R1 |
| REG2 | Delegated child VC, 1-element array, valid chain | `valid: true`, correct chain depth | `[existing]` VP R2 |
| REG3 | Delegated child, tampered `delegationChain` (scope escalation) | throws `DelegationChainInvalidError` | `[existing]` VP R3 |
| REG4 | Root VC expired | throws `VCExpiredError` | `[existing]` VP R4 |
| REG5 | Root VC revoked | throws `VCRevokedError` | `[existing]` VP R5 |
| REG6 | VP itself expired | throws `VPExpiredError` | `[existing]` VP R6 |
| REG7 | VP signature invalid (wrong holder key) | throws `VPSignatureInvalidError` | `[existing]` VP R7 |
| REG8 | `vc.targetService` mismatch vs `vp.targetService` | throws `VPInvalidStructureError` | `[existing]` VP R8 |
| REG9 | All 4 existing `e2e-travel-concierge` scenarios | pass unmodified | `[existing]` VP §9.7, E1E3 Part C |

---

## 4. Verification — Grant-Array Path

**Existing coverage:** `VP` §9.3 G1–G12 is comprehensive — agent-match,
user-match (both forms), fail-closed on grant expiry/revocation/bad
signature, scope intersection direction (superset vs subset). Restated in
full; one gap identified below.

**Gap found:** no case exercises agent-match **and** user-match both
failing simultaneously (only each failing independently, G3/G4) — low
value but worth a single case to confirm the error path doesn't depend on
check ordering.

| # | Case | Expected | Status |
|---|---|---|---|
| GR1 | Root agent VC + grant, agent-match direct, user-match, all valid | `valid: true`, `effectiveScopes == intersect(...)` | `[existing]` VP G1 |
| GR2 | Delegated sub-agent + grant, agent-match via ancestor DID | `valid: true` | `[existing]` VP G2 |
| GR3 | Agent-match fails | throws `ConsentGrantSubjectMismatchError` | `[existing]` VP G3 |
| GR4 | Agent-match passes, user-match fails | throws `ConsentGrantSubjectMismatchError` | `[existing]` VP G4 |
| GR5 | User-match via email fallback, both sides | `valid: true` | `[existing]` VP G5 |
| GR6 | Grant present, `vp.delegatedBy` absent | rejected | `[existing]` VP G6 |
| GR7 | Grant expired, agent VC valid | whole VP rejected | `[existing]` VP G7 |
| GR8 | Grant revoked, agent VC valid | whole VP rejected | `[existing]` VP G8 |
| GR9 | Grant signature invalid | whole VP rejected | `[existing]` VP G9 |
| GR10 | Grant scopes superset of agent VC scopes | effective scope = agent VC's scopes only | `[existing]` VP G10 |
| GR11 | Grant scopes narrower subset | effective scope = grant's scopes only | `[existing]` VP G11 |
| GR12 | Grant malformed (`scopes` not an array) | throws `ConsentGrantInvalidError` before signature check | `[existing]` VP G12 |
| GR13 | Both agent-match and user-match fail simultaneously | throws `ConsentGrantSubjectMismatchError` (same class, not a different error for the double-failure case) | `[NEW]` |
| GR14 | Grant's `serviceDid` present but doesn't match `vp.targetService` | *(flag, not assert)* — confirm whether this is checked at all; `serviceDid` is documented as "redundant with issuer, useful for Console display" (LOG §4.4), i.e. **not** part of the verification rule | `[NEW]` — this is a spec-clarity case, not a behavior bug hunt; the point is confirming `serviceDid` is genuinely inert at verification time |

---

## 5. Revocation

**Existing coverage:** `E1E3` A3 (fetched status list happy/malformed/
non-200 path), `VP` §9.4 A3/A4 (local-repo fast path vs HTTP fetch),
§9.5 S1–S5 (schema validation on fetched lists, including the local-repo
path S5). Fairly complete; restated with two additions.

| # | Case | Expected | Status |
|---|---|---|---|
| REV1 | Fetched status list — valid JSON | parses, `getBit()` proceeds | `[existing]` E1E3 A3 |
| REV2 | Fetched status list — malformed JSON | rejected, treated as revoked (fail-closed) | `[existing]` E1E3 A3 |
| REV3 | Fetched status list — non-200/non-JSON response | existing revoked-error path fires, unaffected by schema validation | `[existing]` E1E3 A3 |
| REV4 | `helix-api`'s own agent VC revocation check | uses injected local-repo resolver, no HTTP round-trip | `[existing]` VP A3 |
| REV5 | SP-hosted grant status list revocation check | resolves via HTTP fetch, passes schema validation | `[existing]` VP A4 |
| REV6 | Local-repo fast path returns a malformed record | same fail-closed treatment as REV2 | `[existing]` VP S5 |
| REV7 | Revoke a grant, then attempt verification with the same grant in a fresh VP | verification fails with `VCRevokedError` for the grant entry specifically (not misattributed to the agent VC entry) | `[NEW]` — the existing matrix confirms revocation blocks verification but not that the error correctly identifies *which* array entry (agent VC vs grant) was revoked |
| REV8 | Two different SPs' status lists, one revoked entry each, verified in the same test run | each verification only sees its own SP's list — no cross-SP bleed in whatever caching layer sits in front of the resolver | `[NEW]` — new risk surface introduced by Epic 5's two-SP setup; overlaps with category 7 below but specifically at the resolver/cache layer |

---

## 6. Delegation Chains

**Existing coverage:** `VP` R2/R3 (valid chain, tampered chain), G2
(ancestor-DID grant inheritance). `E1E3` B6 (`selectGrant()` filtering
among mixed credential types).

| # | Case | Expected | Status |
|---|---|---|---|
| DEL1 | Valid 2-hop delegated chain | `verifyVP()` succeeds, correct `delegationChain.length` | `[existing]` VP R2 |
| DEL2 | Tampered chain (scope escalation attempt) | throws `DelegationChainInvalidError` | `[existing]` VP R3 |
| DEL3 | Grant inherited via ancestor DID, not leaf | `valid: true` | `[existing]` VP G2 |
| DEL4 | `selectGrant(issuerDid, userDid)` among mixed stored credentials (agent VC + grant for a different SP/user) | returns only the correct match | `[existing]` E1E3 B6 |
| DEL5 | Chain depth exceeding `maxDelegationDepth` | throws (consolidated depth error, per E1E3 B7) | `[NEW]` — depth-limit enforcement itself isn't explicitly re-listed in any test table, only the error-class consolidation is |
| DEL6 | Delegated (non-root) agent presenting a grant issued to a *different* ancestor than any in its own chain | agent-match fails → `ConsentGrantSubjectMismatchError` | `[NEW]` — near-miss case adjacent to GR3, specifically targeting the ancestor-list logic rather than the direct-match logic |

---

## 7. Cross-SP Isolation

**Existing coverage:** none. This category doesn't exist as a concern
until Epic 5 introduces two independent SPs sharing one demo/agent — no
prior epic doc has two SPs in the same test run to isolate against.

| # | Case | Expected | Status |
|---|---|---|---|
| ISO1 | Grant issued for (user, agent, Airline) presented in a VP targeting Hotel | `vp.targetService` mismatch → rejected, independent of grant validity | `[NEW]` |
| ISO2 | Airline's `resolveConsentScopes()` catalog | never includes Hotel-only scopes (`book:hotel`, etc.) | `[NEW]` |
| ISO3 | Revoking the Airline grant | has no effect on the independently-issued Hotel grant for the same (user, agent) pair | `[NEW]` — direct test of LOG §4.7 step 4's "separate consent, independent grant" |
| ISO4 | Both SPs' `did:web` DIDs and status lists, seeded in the same run (E5 Part A) | each resolves independently, no shared state, no ID collision | `[NEW]` |
| ISO5 | Agent's `selectGrant()` called with Airline's `issuerDid` while wallet holds both grants | returns only the Airline grant, never the Hotel one | `[NEW]` — extends DEL4 to the concrete two-SP demo case |
| ISO6 | Both SPs' grant-issuance routes (E5 Part C3) invoked concurrently for the same agent/user | no shared mutable state causes one SP's `issueGrant()` call to affect the other's status list | `[NEW]` |

---

## 8. Consent UX Contract

**Existing coverage:** `WIDGET` Part E is thorough for the widget's own
props/behavior. **Note:** two of `WIDGET`'s original rows (`requestedScopes`
filtering) are **obsolete** per `E5` Part E's amendment (dropping
`requestedScopes` entirely) — marked below as superseded, not restated as
active cases.

| # | Case | Expected | Status |
|---|---|---|---|
| UX1 | `resolveConsentScopes()` with only `curatedFallback` | returns curated labels for the full catalog + `accept-terms` | `[existing, amended]` WIDGET Part E, wording updated per E5 Part E (no longer "every requested scope" — now "the full catalog") |
| UX2 | `resolveConsentScopes()` — curated and MCP both describe the same scope | MCP metadata wins | `[existing]` WIDGET Part E |
| UX3 | Scope with no curated entry and no matching MCP tool | falls back to `humanizeScope()` | `[existing]` WIDGET Part E |
| ~~UX4~~ | ~~Curated/MCP entry for a scope not in `requestedScopes` — excluded~~ | — | **superseded** by E5 Part E — no `requestedScopes` to exclude against |
| UX5 | `accept-terms` entry | always present, `required: true`, `defaultChecked: true` | `[existing]` WIDGET Part E |
| UX6 | Both `scopeOptions` and `scopesEndpoint` passed to widget | `scopeOptions` wins, no fetch | `[existing]` WIDGET Part E |
| UX7 | Neither passed | throws at mount | `[existing]` WIDGET Part E |
| UX8 | `required` scope entry | cannot be unchecked, present in every `onAccept` payload | `[existing]` WIDGET Part E |
| UX9 | Durability control | both options visibly rendered even with `defaultDurability` set; selection reflected in `onAccept` | `[existing]` WIDGET Part E |
| UX10 | Scope-resolution route returns full catalog regardless of `agentDid` value | full catalog every time, no filtering | `[existing]` E5 Part H (restated — this is the direct replacement for the superseded UX4) |
| UX11 | Scope-resolution route response shape | exactly `{ scopeOptions: ScopeOption[] }` | `[NEW]` — contract-shape check not explicitly listed as its own case anywhere |
| UX12 | Route called with missing/malformed session auth | rejected consistent with whatever the SP's existing page-auth middleware does — **not yet specified**, flagged as open in `WIDGET` Part F | `[NEW]` — still genuinely open, listed here so it isn't lost, not resolved by this doc |
| UX13 | `onAccept` fires with a scope selection that omits a `required` scope somehow (e.g. a caller bypassing the widget's own UI constraint and calling `onAccept` directly) | SP's grant-issuance route (E5 C3) independently rejects/ignores the omission — **required scopes must be enforced server-side too, not only via UI disabling** | `[NEW]` — closes a real gap: UX8 only tests the widget's UI constraint, nothing tests that the SP backend doesn't trust the client blindly |

---

## 9. Audit Trail Integrity

**Existing coverage:** thin. `LOG` §6 item 14's bullet for area #10 lists
three informal checks (declared-endpoint routing, local fallback, "SP DID
never used for routing") but no formal matrix exists anywhere. This is
the least-specified category of the twelve.

| # | Case | Expected | Status |
|---|---|---|---|
| AUD1 | Agent DID with a declared log-sink service endpoint | event POSTed to that endpoint | `[existing, informal]` LOG §6 item 14 — reformalized here |
| AUD2 | Agent DID with no declared endpoint | falls back to local stdout/file | `[existing, informal]` LOG §6 item 14 |
| AUD3 | Routing keyed by SP DID instead of agent DID | never happens — confirm call sites always pass the agent DID | `[existing, informal]` LOG §6 item 14 |
| AUD4 | Each of the 6 baseline event types (`did_created`, `did_deactivated`, `vc_issued`, `vc_renewed`, `vc_revoked`, `vp_verification`) | fires exactly once per triggering action, routed through the generic module | `[NEW]` — no doc lists all six as individually tested post-routing-module change |
| AUD5 | `consent_granted` event | fires exactly once on successful `issueGrant()` via the SP's route (E5 C3) | `[NEW]` |
| AUD6 | `consent_revoked` event | fires exactly once on successful `revokeGrant()` | `[NEW]` |
| AUD7 | Successful `POST /v1/vp/verify` | exactly one `VP_VERIFIED` audit event, logged after `verifyVP()` returns — no mid-verification chain-walk events | `[existing]` VP A5 |
| AUD8 | Rejected `POST /v1/vp/verify` | exactly one `VP_REJECTED` event with failure reason, after `verifyVP()` throws | `[existing]` VP A6 |
| AUD9 | `service_registered` event type | never fires anywhere in the system (dropped, not just unused) | `[NEW]` — direct test of the "dropped from the six, not replaced" decision (LOG §3) |
| AUD10 | Delegation visibility | delegation never appears as its own event type — only as `parentVcId` on a `vp_verification` entry | `[NEW]` — direct test of LOG §3's "delegation is not its own event" rule |
| AUD11 | Audit event POST to a declared endpoint that is unreachable/errors | local fallback still occurs (doesn't silently drop the event) — **behavior not explicitly specified anywhere**, flagged | `[NEW]` — genuinely open, same caveat as UX12 |
| AUD12 | Two SPs (Epic 5) each with their own declared log-sink | each SP's events route to its own sink, no cross-SP delivery | `[NEW]` — extends AUD1 into the two-SP world, same isolation concern as category 7 |

---

## 10. End-to-End Demo Scenarios

**Existing coverage:** `E1E3` Part C regression row, `VP` §9.7 (4 existing
scenarios) and §9.8 (5-step consent flow table), `E5` Part D/H (step 5
no-reprompt assertion). Comprehensive; restated for a single view plus
one addition.

| # | Case | Expected | Status |
|---|---|---|---|
| E2E1 | Search vs. Book | passes unmodified | `[existing]` VP §9.7 |
| E2E2 | Delegate to a Sub-Agent | passes unmodified | `[existing]` VP §9.7 |
| E2E3 | Revoke Mid-Flight | passes unmodified | `[existing]` VP §9.7 |
| E2E4 | Onboard a New Agent, Live | passes unmodified | `[existing]` VP §9.7 |
| E2E5 | Consent demo step 1 (login) | custodial identifier established, no VP involved | `[existing]` VP §9.8 |
| E2E6 | Consent demo step 2 (search) | read-only, scope check only, no consent prompt | `[existing]` VP §9.8 |
| E2E7 | Consent demo step 3 (book flight, first time) | consent shown, grant issued, `[agentVC, grantVC]` VP, `verifyVP()` passes | `[existing]` VP §9.8, E5 Part D |
| E2E8 | Consent demo step 4 (book hotel, different SP) | separate consent, independent grant | `[existing]` VP §9.8, E5 Part D |
| E2E9 | Consent demo step 5 (book return flight, same Airline SP) | **no consent prompt**, standing grant reused, `verifyVP()` passes | `[existing]` VP §9.8, E5 Part D — call-count assertion per E5 |
| E2E10 | Full demo run via `docker compose up` (Epic 5 folder) | all services start, seeder completes, all 5 steps executable end-to-end in one run | `[NEW]` — the individual steps are tested, but no case asserts the whole orchestrated stack boots cleanly from a cold start |

---

## 11. Error Taxonomy Consistency

**Existing coverage:** `E1E3` B7 (regression — existing callers of the
four consolidated classes still throw *an* error on the same bad inputs).
`VP` §4.4 defines two new classes (`ConsentGrantSubjectMismatchError`,
`ConsentGrantInvalidError`) and states they're excluded from B7's merge,
but no doc has a single matrix confirming *every* error class fires from
*every* intended call site — this is assembled by cross-referencing
scattered mentions.

| # | Case | Expected | Status |
|---|---|---|---|
| ERR1 | Existing callers of the four pre-consolidation classes (`MaxDelegationDepthExceededError`, `ScopeEscalationDeniedError`, `DelegationChainInvalidError`, `DelegationScopeEscalationError`) | still throw *an* error (via the consolidated class) on the same bad inputs | `[existing]` E1E3 B7 |
| ERR2 | New grant-issuance scope-escalation failure (grant requesting scopes beyond the issuing SP's own authority) | throws from the same consolidated scope-escalation class, not a fifth naming convention | `[existing, implied]` E1E3 B7 item 4 — not previously written as its own test row |
| ERR3 | `ConsentGrantSubjectMismatchError` | thrown for both agent-match and user-match failures (GR3, GR4, GR13) — never conflated with `VPInvalidStructureError` | `[existing]` VP G3/G4, restated as a taxonomy-level check |
| ERR4 | `ConsentGrantInvalidError` | thrown for grant structural failures (GR12), never falls through to a signature-check error first | `[existing]` VP G12 |
| ERR5 | `ConsentGrantSubjectMismatchError`/`ConsentGrantInvalidError` | **not** merged into the B7 consolidated set — confirm they remain distinct classes, not aliased | `[NEW]` — direct test of the explicit exclusion called out in both `E1E3` B7 and `VP` §4.4 |
| ERR6 | `VCRevokedError`, `VCExpiredError`, `VCSignatureInvalidError` reused for grant-specific failures | same classes fire for a revoked/expired/badly-signed grant as for an agent VC — no grant-specific variants introduced | `[NEW]` — confirms VP §4.4's "no need for grant-specific variants of these three" decision |
| ERR7 | `VPInvalidStructureError` | fires for all structural VP array violations (0 credentials, 3+, 2 agent-type, 2 grant-type) — one class, not per-shape variants | `[existing, implied]` VP B4–B7, restated at taxonomy level |
| ERR8 | Every error class has a corresponding audit-log reason string on `VP_REJECTED` | no error class produces an unlabeled/generic rejection reason | `[NEW]` — connects category 9 (audit) to category 11 (errors), not tested anywhere as a joint concern |

---

## 12. Removed-Surface Confirmation

**Existing coverage:** `E1E3` A4 (repo-wide grep for `listServices`,
`getService(`, `registerService`, `/v1/services`). Thin but directionally
correct — restated with concrete sub-checks per package, since A4's
checklist names the files explicitly and those make good individual
assertions rather than one grep.

| # | Case | Expected | Status |
|---|---|---|---|
| RM1 | Repo-wide grep for `listServices`, `getService(`, `registerService`, `/v1/services` | zero matches outside historical docs/changelogs | `[existing]` E1E3 A4 |
| RM2 | `helix-api`'s route table | no `GET /services`, `GET /services/:serviceName`, `POST /services` entries | `[existing, implied]` E1E3 A4 checklist |
| RM3 | `helix-sdk-js`'s public exports | no `listServices`, `getService`, `registerService` | `[existing, implied]` E1E3 A4 checklist |
| RM4 | `console/src/pages/ServicesPage.tsx` | file does not exist | `[existing, implied]` E1E3 A4 checklist |
| RM5 | Console nav/routing config | no entry linking to the removed Services page | `[existing, implied]` E1E3 A4 checklist |
| RM6 | `major-flows.md` | §7 ("Service Registry") absent | `[existing, implied]` E1E3 A4 checklist |
| RM7 | `public-surfaces.md` | no rows for the three removed HTTP routes or three removed SDK methods | `[existing, implied]` E1E3 A4 checklist |
| RM8 | `README.md` | no "Register your service" section, no `POST $API_BASE_URL/v1/services` example | `[existing, implied]` E1E3 A4 checklist — **note:** confirm this actually landed, since the `README.md` content provided in this project still shows the old "Register your service" section as of this doc's writing |
| RM9 | `helixid-setup` seeder | calls `POST /v1/dids`, never `POST /v1/services` | `[existing]` overlaps E5 Part H's seeder row |
| RM10 | `orders-service`-style `targetService` string references | still present where they represent a VP-target concept, **not** removed alongside the registry mechanism | `[NEW]` — direct test of E1E3 A4's explicit "don't remove those" caveat; easy to over-delete here |
| RM11 | `helix-sdk-js/src/vp/VPBuilder.ts` (orphaned file) | removed, or confirmed unreferenced by any import in the repo | `[existing]` VP §9.6 C2 |
| RM12 | `vp.service.ts`'s `generateVPTemplate()` | removed or explicitly deprecated, not silently still callable | `[existing]` VP §9.6 C3 |

---

## Summary — gap density by category

A rough read of where this doc found the thinnest prior coverage, in case
this should inform sequencing of who writes tests first:

| Category | Existing cases | New cases added | Notes |
|---|---|---|---|
| 1. Schema validation | 5 | 9 | baseline schemas (`AgentVCSchema` etc.) had no direct tests anywhere |
| 2. Issuance | 3 | 8 | `issueGrant()`'s status-list return value untested |
| 3. Single-credential verification | 9 | 0 | already complete |
| 4. Grant-array verification | 12 | 2 | already near-complete |
| 5. Revocation | 6 | 2 | cross-SP resolver caching untested |
| 6. Delegation chains | 4 | 2 | depth-limit enforcement not explicitly listed |
| 7. Cross-SP isolation | 0 | 6 | **entirely new risk surface from Epic 5** |
| 8. Consent UX | 9 (1 superseded) | 4 | server-side required-scope enforcement untested |
| 9. Audit trail | 3 (informal) | 9 | **least-specified category overall** |
| 10. E2E demo | 9 | 1 | already comprehensive |
| 11. Error taxonomy | 4 (2 implied) | 4 | no single cross-cutting matrix existed before this doc |
| 12. Removed surfaces | 1 (7 implied) | 2 | mostly a checklist-to-matrix conversion |

**Two categories worth flagging as priorities:** §7 (cross-SP isolation)
and §9 (audit trail) have the least existing coverage and are exactly the
kind of seam-level bugs that individual epic docs, written one epic at a
time, would structurally miss.
