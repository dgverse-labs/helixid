# Helix ID — Project Constitution
This document is the single source of truth for all architectural, structural, security, and engineering decisions in the Helix ID project. Every user story, pull request, and design decision contracts against this file. If something is not covered here, raise it for constitution amendment — do not make ad hoc decisions.

Table of Contents
1. Project Overview
2. Monorepo Structure
3. Folder Structure Per Package
4. Technology Stack
5. Security Axioms
6. API Contract Rules
7. Inter-Boundary Contracts
8. helix-core Communication Model
9. Error Handling Philosophy
10. Environment Variables
11. Database
12. Hedera Interaction Rules
13. Audit Log Contract
14. Dependency Policy
15. Testing Constraints and Coverage
16. Definition of Done
17. Boundaries Reference

## Project Overview
Helix ID is an agent identity and trust infrastructure platform. It issues cryptographically verifiable identities (DIDs) and credentials (VCs) to agents and users, anchors them on the Hedera network, and enables external services to verify agent actions without depending on Helix ID as a single point of trust.
Open core model. The core platform is Apache 2.0 licensed and self-hostable. SaaS and Enterprise tiers extend it with managed infrastructure, advanced policy engines, and compliance tooling.
Four boundaries govern all scope decisions:
Boundary	Responsibility

B1 — DID & Hedera Integration	DID lifecycle, Hedera anchoring, DID resolution

B2 — VC Issuance & Management	VC schema, issuance, revocation, renewal, status list

B3 — VP Creation & Verification	VP template, signing, verification, replay protection

B4 — Agent & User Flows	Onboarding, user DID, challenge-response, service registry

## Monorepo Structure
helix-id/
├── helix-core/          # Shared primitives — VC schema, crypto, OpenAPI spec, config, error types
├── helix-api/           # Fastify HTTP API — self-hostable, stateful operations
├── helix-sdk-js/        # TypeScript/JS SDK — HelixClient, local signing, wallet management
├── helix-sdk-py/  (Future)       # Python SDK — mirrors JS SDK, OpenAPI spec as shared truth
├── helix-contracts/     # (future) HCS message schemas
├── e2e/                 # End-to-end tests — full flow tests against live Docker Compose stack
├── docker-compose.yml   # Local development stack — API + PostgreSQL + mock HCS
├── docker-compose.test.yml  # CI test stack
├── .env.example         # Environment variable template — all variables documented here
├── decisions.md         # Append-only log of architectural decisions and dependency additions
├── CONSTITUTION.md      # This file
└── package.json         # Workspace root — scripts only, no application code
Rules:
* No application logic lives at the workspace root
* helix-core has no monorepo siblings as dependencies — it is a pure library
* helix-contracts is scaffolded but empty until HCS schema work begins
* turbo.json lives at the workspace root and is the task graph definition — no application logic
* Each package has its own package.json, tsconfig.json, and README.md

## Folder Structure Per Package
helix-core
helix-core/
├── src/
│   ├── config/          # Env variable schema and validated config module
│   ├── crypto/          # DID generation, VP signing, signature verification, key utils
│   ├── schemas/         # VC schema definitions (agent VC, user VC, privilege scopes)
│   ├── errors/          # Shared error types and error codes
│   ├── audit/           # Audit log interface (contract only — implementations elsewhere)
│   ├── status-list/     # W3C StatusList2021 bitstring logic
│   └── openapi/         # OpenAPI spec — single source of truth for all API contracts
├── tests/
│   └── unit/
├── package.json
├── tsconfig.json
└── README.md
helix-api
helix-api/
├── src/
│   ├── routes/          # Fastify route handlers — one file per boundary
│   │   ├── did/
│   │   ├── vc/
│   │   ├── vp/
│   │   └── agent/
│   ├── services/        # Business logic — called by routes, calls repositories
│   │   ├── did/
│   │   ├── vc/
│   │   ├── vp/
│   │   └── agent/
│   ├── repositories/    # Database access — Prisma queries, no business logic
│   ├── hedera/          # IHederaClient interface + HCS implementation
│   ├── middleware/       # Auth, error handling, request logging
│   ├── audit/           # Audit log implementation for API
│   └── server.ts        # Fastify instance setup and plugin registration
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── package.json
├── tsconfig.json
└── README.md
helix-sdk-js
helix-sdk-js/
├── src/
│   ├── client/          # HelixClient — public surface, single entry point
│   ├── wallet/          # Agent wallet — encrypted local storage of key, DID, VC
│   ├── vp/              # VP builder and local signing (calls helix-core crypto)
│   ├── http/            # Internal HTTP adapter — all API calls go through here
│   ├── audit/           # Audit log implementation for SDK
│   └── index.ts         # Public exports — HelixClient and types only
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── package.json
├── tsconfig.json
└── README.md
helix-sdk-py (Future)
helix-sdk-py/ (Future)
├── helix_sdk/
│   ├── client.py        # HelixClient
│   ├── wallet.py        # Agent wallet
│   ├── vp.py            # VP builder and signing
│   ├── http.py          # Internal HTTP adapter
│   ├── schemas.py       # Python-native type definitions (OpenAPI spec as truth)
│   ├── audit.py         # Audit log implementation
│   └── errors.py        # Error types mirroring helix-core error codes
├── tests/
│   ├── unit/
│   ├── integration/
│   └── security/
├── pyproject.toml
└── README.md
e2e
e2e/
├── tests/
│   ├── agent-onboarding.test.ts
│   ├── user-did-flow.test.ts
│   ├── vp-lifecycle.test.ts
│   ├── vp-replay-attack.test.ts
│   └── vc-revocation-flow.test.ts
├── helpers/             # Stack setup, client factories, test data builders
├── package.json
└── tsconfig.json

## Technology Stack
### Languages and Runtimes
#### Component	Language	Version
- helix-api	TypeScript	Node.js >= 20 LTS
- helix-sdk-js	TypeScript	Node.js >= 18 LTS
- helix-sdk-py (Future)	Python	>= 3.11
- helix-core	TypeScript	Node.js >= 20 LTS

### API Layer
#### Decision	Choice	Rationale
- HTTP framework	Fastify	Schema-first, JSON Schema on every route, aligns with OpenAPI contract rule, native TS support
- Schema validation	Fastify JSON Schema + Zod	Route validation via JSON Schema; business logic validation via Zod
- ORM	Prisma	Type-safe queries, migration management, schema as code
- Database	PostgreSQL	ACID guarantees required for vpId consumption and token burning (security operations)
- Cache	None in core	Not needed at open core scale; Redis is a SaaS-tier concern for multi-instance deployments

### Cryptography Purpose	Library
- Elliptic curve signing	@noble/curves
- Hashing	@noble/hashes
	
No other crypto libraries are permitted without a documented decision in decisions.md. No thin wrappers around wrappers. No unmaintained libraries.

### Testing
#### Scope	Framework
JS/TS unit + integration	Vitest
JS/TS HTTP testing	Supertest
JS/TS coverage	@vitest/coverage-v8
	
E2E	Vitest driving SDK against live stack
Tooling
Purpose	Tool
Monorepo workspace	npm workspaces + Turborepo
Remote cache	turborepo-remote-cache (self-hosted)
Linting	ESLint (TS)
Formatting	Prettier (TS), Black (Python)
CI	GitHub Actions
Containerisation	Docker + Docker Compose
## Security Axioms
These rules are non-negotiable. No user story, no implementation shortcut, no external request overrides them. Any PR that violates an axiom is rejected without exception.
SA-1 — Private key never leaves the agent. The agent's private key is generated locally and stored in the agent wallet. It is never transmitted to Helix ID, never passed to the API, and never logged. buildAndSignVP executes entirely client-side.
SA-2 — Helix ID never sees the agent's private key. The onboarding flow binds a keypair via challenge-response. Helix ID receives the public key and a signature. Never the private key.
SA-3 — Enrollment token is single-use. Every enrollment token is burned on first use. A second attempt with the same token is rejected regardless of validity. Token expiry is 15–30 minutes.
SA-4 — vpId is consumed on first verification. Every VP carries a unique vpId issued by Helix ID. The verify API marks it consumed on first call. Any subsequent call with the same vpId is rejected. This is Helix ID's responsibility — self-verifying services must implement equivalent nonce checking per the documented obligation.
SA-5 — VP expiry is enforced. Every VP has a short expiry timestamp. Expired VPs are rejected at verification regardless of signature validity.
SA-6 — VC revocation is checked at verification. Verifiers must check the W3C StatusList2021 status list at the index embedded in the VC. A revoked VC (bit flipped to 1) invalidates any VP built from it.
SA-7 — Challenge-response is the universal verification mechanism. No user or agent identity claim is accepted without a challenge-response proof of private key ownership. There is no password-based or OTP-based fallback in core.
SA-8 — Nothing sensitive appears in logs. Private keys, raw VCs in plaintext, and raw VP payloads before verification must never appear in any log output, error message, or audit entry. See Audit Log Contract.
SA-9 — Testnet only for Hedera in all non-production environments. No test, CI pipeline, or development environment writes to Hedera mainnet under any circumstances.
SA-10 — No security test may be skipped. Security tests in tests/security/ may not be marked skip, todo, or xit. CI enforces this via grep. A skipped security test is a build failure.

6. API Contract Rules
AC-1 — OpenAPI spec is the source of truth. The spec lives in helix-core/src/openapi/. Every endpoint must have a spec entry before implementation begins. The spec is the design artifact — not documentation generated after the fact.
AC-2 — No endpoint exists without a spec entry. A route handler with no corresponding OpenAPI definition is a build failure. Enforced by a validation script in CI that diffs registered routes against the spec.
AC-3 — Breaking changes require a version bump. Any change that modifies request or response shape in a non-additive way requires an API version increment. Additive changes (new optional fields) do not.
AC-4 — Fastify JSON Schema on every route. Every route defines schema.body, schema.querystring, schema.params, and schema.response where applicable. No unvalidated input reaches a service layer.
AC-5 — The SDK is the intended client. The API is designed for HelixClient as its primary consumer. Raw HTTP access is supported and documented but not the primary design target. This means the API can assume well-formed requests matching the SDK's behavior — it does not need to defend against arbitrary malformed input beyond standard validation.

7. Inter-Boundary Contracts
Boundaries are not isolated microservices — they are logical separations within a single API process. They communicate through internal service interfaces, not HTTP. The contracts below define what each boundary exposes internally.
B1 exposes to B2 and B4:
* resolveDID(did: string) → DIDDocument
* anchorDID(document: DIDDocument) → HederaTransactionId
* updateDID(did: string, update: DIDUpdate) → HederaTransactionId
B2 exposes to B3 and B4:
* issueVC(subject: VCSubject) → SignedVC
* getVCStatus(vcId: string) → VCStatus
* revokeVC(vcId: string) → void
* renewVC(vcId: string) → SignedVC
B3 exposes to B4:
* generateVPTemplate(request: VPRequest) → UnsignedVP
* consumeVpId(vpId: string) → void
* verifyVP(signedVP: SignedVP) → VerificationResult
B4 owns no shared internal surface. It is the consumer of B1, B2, and B3. Its outputs are HTTP responses to the SDK.
Rule: A boundary may not import directly from another boundary's implementation files. It may only call the interface methods listed above. This is enforced by ESLint import rules.

8. helix-core Communication Model
helix-core is a pure library package. The dependency graph has exactly one direction.
helix-api     →  helix-core
helix-sdk-js  →  helix-core
helix-sdk-py (Future)  →  (mirrors helix-core types natively — no cross-language import)
helix-core    →  (no monorepo imports)
helix-core never imports from helix-api, helix-sdk-js, or helix-sdk-py. Ever.
What lives in helix-core and why it must be there:
Module	Reason it must be in core
VC schema + Zod validators	Both API (issuance) and SDK (parsing) must validate against the same schema
Crypto primitives	SDK signs locally; API verifies. Both must use identical algorithms
OpenAPI spec	API implements it; SDK calls it. Single definition prevents drift
Config module + Zod env validation	API uses config at runtime; env shape must be validated before anything starts
Shared error types and codes	API returns errors; SDK parses them. Same codes on both sides
Audit log interface	API and SDK have separate implementations but must log the same event types
StatusList2021 bitstring logic	API writes the list; SDK and external verifiers read it
helix-sdk-py (Future) does not import from helix-core. It maintains its own Python-native type definitions in helix_sdk/schemas.py. The OpenAPI spec in helix-core is the truth that both the JS and Python SDKs are validated against in CI — not a shared import.

9. Error Handling Philosophy
EH-1 — Error code with structured error body. Every error response from the API returns a structured JSON body. HTTP status codes convey category; the body conveys specifics.
{
  "error": {
    "code": "ENROLLMENT_TOKEN_EXPIRED",
    "message": "The enrollment token has expired. Tokens are valid for 15 minutes.",
    "requestId": "req_01j..."
  }
}
EH-2 — Error codes are defined in helix-core. The full enumeration of error codes lives in helix-core/src/errors/. The SDK maps these codes to typed error classes. New codes require a helix-core change — they cannot be invented ad hoc in helix-api.
EH-3 — Never leak internal state in error responses. Database errors, Hedera transaction details, internal stack traces, and key material never appear in error responses returned to callers. Log the detail internally; return only the structured error body.
EH-4 — Security errors are indistinguishable where appropriate. Invalid signature and invalid DID return the same error code (VP_VERIFICATION_FAILED) to prevent oracle attacks. The internal log records the specific reason; the external response does not.
EH-5 — All errors are logged before being returned. The middleware logs every error with its requestId, error code, and internal detail before serialising the response. This ensures audit coverage without leaking to callers.
EH-6 — SDK throws typed errors. HelixClient never rejects with a raw HTTP error or a string. Every failure throws an instance of a typed error class (e.g. HelixEnrollmentTokenExpiredError) that exposes code, message, and optionally retryable.

10. Environment Variables
EV-1 — Config module in helix-core is the single entry point. No package reads process.env directly. Every package imports the validated config object from helix-core/src/config/. If a variable is missing or malformed, the process exits at startup with a clear error — not at runtime three calls deep.
EV-2 — All variables are validated with Zod at startup. The config module defines a Zod schema for the full environment. Validation runs before the server binds to a port or the SDK initialises a wallet.
EV-3 — .env.example is the canonical list of all variables. Every environment variable that exists in the system must have an entry in .env.example with a description and example value. No undocumented variables.
EV-4 — .env files with real credentials are never committed. .env, .env.local, .env.production are gitignored. CI uses GitHub Actions secrets. Local development uses .env.test (gitignored) populated from .env.example.
Variable Categories
Category	Variables
Hedera	HEDERA_NETWORK, HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY
Database	DATABASE_URL
Helix ID signing	HELIX_SIGNING_KEY (private key for VC issuance)
API	API_PORT, API_BASE_URL
Token expiry	ENROLLMENT_TOKEN_TTL_SECONDS, CHALLENGE_TTL_SECONDS, VP_TTL_SECONDS
Audit	AUDIT_LOG_DESTINATION (stdout | file), AUDIT_LOG_PATH
11. Database
DB-1 — PostgreSQL is the only supported database. SQLite is not supported. Concurrent write safety is required for vpId consumption and enrollment token burning. These are security operations that require ACID guarantees.
DB-2 — Prisma is the ORM. All database access goes through Prisma. Raw SQL queries are not permitted except in migration files. No other ORM or query builder is introduced.
DB-3 — Schema migrations are code-reviewed like application code. Migration files live in helix-api/prisma/migrations/. Destructive migrations (dropping columns, tables) require explicit approval note in the PR description.
DB-4 — No business logic in repositories. Repository files contain Prisma queries only. Business logic lives in service files. Services call repositories; routes call services.
Core Tables
Table	Purpose
dids	DID records, public keys, Hedera transaction IDs
vcs	Issued VCs, status list index, expiry, revocation state
enrollment_tokens	One-time tokens, used_at timestamp, expiry
vp_ids	Issued vpIds, consumed_at timestamp
challenges	Active challenge nonces, expiry, DID association
status_list_entries	Bitstring entries per VC
service_registry	Verified service endpoints and metadata
audit_log	Append-only audit event log
12. Hedera Interaction Rules
HR-1 — Testnet by default. All development, testing, and CI environments use Hedera testnet. HEDERA_NETWORK defaults to testnet. The config module rejects mainnet unless NODE_ENV=production is explicitly set.
HR-2 — All Hedera calls go through IHederaClient. A TypeScript interface IHederaClient defines the contract for all HCS operations. The production implementation calls the real Hedera SDK. Tests use a test double that records calls without writing to the network.
interface IHederaClient {
  anchorDocument(payload: string): Promise<HederaTransactionId>
  resolveDocument(topicId: string, sequenceNumber: number): Promise<string>
}
HR-3 — No test writes to Hedera testnet in CI. Integration and unit tests use the IHederaClient test double. E2E tests may write to testnet but this is opt-in, controlled by HEDERA_E2E_TESTNET=true, and never runs in standard CI pipelines.
HR-4 — Hedera operator credentials are never hardcoded. Operator account ID and private key come from environment variables only. No test fixture, seed file, or code comment contains real Hedera credentials.
HR-5 — HBAR costs are the API's responsibility. The SDK never holds Hedera credentials or pays for transactions. The API operator account pays for all HCS writes. This is by design — the agent's private key and the Hedera operator key are entirely separate concerns.

13. Audit Log Contract
Every security-relevant event must produce an audit log entry. This is not optional — it is a correctness requirement on par with tests.
AL-1 — These events must always be logged:
Event	Required Fields
Enrollment token generated	tokenId, agentName, requestedScopes, expiresAt
Enrollment token consumed	tokenId, agentDID, timestamp
Enrollment token rejected	tokenId, reason, timestamp
DID created	did, agentId, hederaTransactionId
DID updated	did, updateType, hederaTransactionId
VC issued	vcId, subject, scopes, expiresAt
VC revoked	vcId, revokedBy, timestamp
VC renewed	oldVcId, newVcId, timestamp
Challenge issued	challengeId, did, expiresAt
Challenge verified	challengeId, did, success
VP template issued	vpId, agentDID, userDID, targetService
VP verified	vpId, result, timestamp
VP rejected	vpId, reason, timestamp
AL-2 — These fields must never appear in audit logs:
* Private keys (agent or Helix ID)
* Raw VC payloads in plaintext
* Raw VP payloads before verification
* Database connection strings
* Enrollment token raw values after generation (log the tokenId hash only)
AL-3 — Audit log is append-only. No audit log entry is ever deleted or updated. In core, audit log is written to PostgreSQL audit_log table and optionally to stdout as structured JSON.
AL-4 — Audit log format is structured JSON. Every entry is a single-line JSON object with timestamp (ISO 8601), event, requestId, and event-specific fields.
AL-5 — Missing audit log entries are a bug. If a security event listed in AL-1 occurs and no audit log entry is produced, that is treated as a bug with the same priority as a failing security test.

14. Dependency Policy
Dependencies are not prohibited, but every addition is a decision that must be documented.
DP-1 — Before adding a dependency, check:
1. Is it actively maintained? (last commit, issue response rate)
2. Does it have known CVEs? (check npm audit or pip-audit)
3. Can an existing dependency already in the project achieve this?
4. For crypto libraries specifically: is it a well-known audited library? (see approved list in stack section)
DP-2 — Every new dependency is recorded in decisions.md. Format: date, package name, version, reason added, alternatives considered, who approved.
DP-3 — Crypto libraries have a stricter gate. Only @noble/curves, @noble/hashes (JS) and cryptography PyCA (Python) are approved for cryptographic operations. Any addition to this list requires explicit amendment to this constitution, not just a decisions.md entry.
DP-4 — Dev dependencies are not exempt. A malicious build tool is as dangerous as a malicious runtime dependency. The same checks apply.
DP-5 — npm audit and pip-audit run in CI on every PR. High or critical severity findings block merge. Exceptions require a documented reason and a filed issue for remediation.

15. Testing Constraints and Coverage
Philosophy
Tests in Helix ID are security proofs as much as correctness proofs. A passing test suite means the trust model holds, not just that the code runs.
Test Types
Unit tests
* Pure logic, no I/O, no network, no database, no Hedera
* helix-core is almost entirely unit tested
* Mocking crypto primitives is forbidden — if a unit test needs to mock signVP, the code is structured wrong
* Framework: Vitest (JS/TS), Pytest (Python)
Integration tests
* One boundary end-to-end against real dependencies
* helix-api integration tests run against real PostgreSQL (Docker Compose) and IHederaClient test double
* SDK integration tests run against a locally running helix-api instance
* Framework: Vitest + Supertest (JS/TS), Pytest (Python)
Security tests
* Separate category in tests/security/ — not folded into integration
* Every named attack vector in the design has a corresponding test
* Framework: Vitest (JS/TS), Pytest (Python)
* May never be skipped. CI enforces via grep on tests/security/ for skip, xit, todo.
End-to-end tests
* Full flows against Docker Compose stack (API + PostgreSQL + mock HCS)
* Run on merge to main only — not on every PR
* Framework: Vitest driving the JS SDK against the live stack
Required Security Tests
Every item on this list must have a corresponding test. This is a checklist, not a coverage percentage.
* [ ] Present same vpId twice — second must be rejected
* [ ] Present VP past expiry — must be rejected
* [ ] Use enrollment token twice — second must be rejected
* [ ] Use enrollment token past 15-minute TTL — must be rejected
* [ ] Tamper one field in VP after signing — verification must fail
* [ ] Verify VP with revoked VC — must be rejected
* [ ] Sign VP with wrong private key — must fail verification
* [ ] Issue challenge, let it expire, submit signature — must be rejected
* [ ] Attempt DID update with wrong keypair — must be rejected
Coverage Minimums
Package	Unit coverage	Integration	Notes
helix-core	95%	N/A	Pure logic — no excuse for gaps
helix-api	80%	All happy paths + all security cases	Security tests tracked separately via checklist
helix-sdk-js	85%	All SDK methods against live API	
helix-sdk-py	85%	Same as JS SDK	
e2e	Not line-measured	All named flows must have a test	
Forbidden Practices
* Mocking crypto primitives in any test
* Shared mutable state between tests — integration tests truncate tables in beforeEach
* Writing to Hedera mainnet in any test or CI pipeline
* Committing .env files with real credentials
* console.log debugging left in test files (ESLint rule)
* test.skip, xit, or it.todo in tests/security/ (CI grep blocks merge)

16. Definition of Done
A user story is done when all of the following are true:
* [ ] OpenAPI spec updated in helix-core/src/openapi/ before or alongside implementation
* [ ] Implementation matches the spec exactly — no undocumented fields, no missing fields
* [ ] Unit tests written and passing
* [ ] Integration tests written and passing (where applicable to the story's boundary)
* [ ] Security tests written if the story touches any item in the security test checklist
* [ ] Audit log entries defined and verified to be emitted for all events in AL-1 that the story triggers
* [ ] Error cases documented — every non-2xx response the story can produce has an error code in helix-core
* [ ] No new dependency added without a decisions.md entry
* [ ] npm audit / pip-audit clean
* [ ] Coverage minimums met for affected packages
* [ ] PR description notes any database migrations and whether they are destructive
* [ ] README.md updated in the affected package if public-facing behaviour changed

17. Boundaries Reference
Quick reference for scope decisions. If a piece of work touches something in a boundary's scope, it belongs to that boundary's routes, services, and tests.
Boundary 1 — DID & Hedera Integration
DID document creation (agent + user), Hedera HCS anchoring, DID resolution from Hedera, DID update (domains, service endpoints), public key management in DID document.
Boundary 2 — VC Issuance & Management
VC schema design (agent VC, user VC, privilege scopes), VC issuance API, VC storage, StatusList2021 generation and management, VC revocation, VC renewal, expiry validation.
Boundary 3 — VP Creation & Verification
VP template generation API (unsigned VP with vpId, nonce, expiry), SDK signing logic (buildAndSignVP), VP verification API (signature check, DID resolution, vpId consumption), vpId lifecycle, nonce generation and validation, self-verify specification documentation.
Boundary 4 — Agent & User Flows
Agent onboarding API (enrollment token generation, keypair binding, challenge-response), user DID creation API, user verification API (challenge-response), agent wallet schema, service registry (add/remove/query), user confirmation flow integration.

Constitution version 1.0 — amendments require a PR touching this file with explicit note in the PR description that the constitution is being amended.
