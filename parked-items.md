# Parked Items

These are valid product or engineering items that are intentionally deferred from the current story scope.

## Very Important — Host Helix VC JSON-LD Context

Status: Parked, very important

Issued Helix VCs currently include:

- `https://www.w3.org/ns/credentials/v2`
- `https://helix-id.io/contexts/v1`

The W3C context is hosted, but `https://helix-id.io/contexts/v1` is Helix ID's custom JSON-LD context and is not currently hosted. Today the API/SDK verification path uses local canonical JSON signing and does not fetch this context, so local demos can still work. For production-facing VC 2.0 interoperability, the custom context must either be hosted or replaced with an explicit inline/context strategy.

Future rules:

- Host `https://helix-id.io/contexts/v1` before claiming full public JSON-LD/VC ecosystem interoperability.
- Define Helix-specific terms such as `HelixAgentCredential`, `HelixUserCredential`, `privilegeScopes`, `agentName`, `delegatedFrom`, `delegationDepth`, `maxDelegationDepth`, and `parentVcId`.
- Keep the context stable once published; version future breaking changes under a new URL.
- Document clearly whether Helix verification fetches remote contexts or only uses local canonical JSON signing.
- Add tests or docs proving issued VC context URLs are resolvable when public interoperability is in scope.

## Script for Creating a Hedera DID

Status: Parked

Story 5 setup work generates only:

- `HELIX_JWT_SIGNING_KEY`
- `HELIX_JWT_PUBLIC_KEY`

A future setup story should create a real Hedera-backed issuer DID and write or update:

- `HELIX_ISSUER_DID`
- any associated Hedera operator or topic metadata needed by the API

Notes:

- Do not fake a Hedera DID locally.
- DID creation must use the existing Hiero/Hedera client path.
- The issuer DID public key must correspond to the configured signing key used for VC issuance.
- This should be live-testable but must not run in standard CI.
- This is parked because live Hedera DID creation has network, operator credential, and testnet cost prerequisites.

## CrewAI Framework Adapter

Status: Parked

CrewAI is a valid framework adapter target, but it is parked until `helix-sdk-py` exists.

Future rules:

- Package location: `packages/crewai/`
- Python package name: `helix-crewai`, imported as `helix_crewai`
- The adapter must use `helix-sdk-py` for wallet loading, VP template retrieval, and local signing
- The adapter must not hand-roll VP canonicalization, base58/base64url encoding, Ed25519 signing, or verification semantics
- Compatibility tests must prove CrewAI-generated VPs verify through the same Helix ID API path as JS SDK VPs

This is parked because building CrewAI now would either require a temporary Python signing path or duplicate SDK behavior. Both are unnecessary until the Python SDK story is active.

## Python SDK

Status: Parked

The Python SDK remains parked until the JS/TS SDK surface is stable enough to mirror without creating divergent crypto behavior.

Future rules:

- Package location: `helix-sdk-py/`
- Must share Helix ID semantics with `helix-sdk-js`
- Must not hand-roll alternative VP, VC, DID, or delegation semantics
- Compatibility tests must prove Python-generated VPs verify through the same API path as JS-generated VPs

## Story 9 — OPA Policy Engine

Status: Parked

Story 9 is valid product scope, but it is parked for now.

Reason:

- The core trust path is already enforced in code: VP signature, VC signature, expiry, revocation, vpId replay protection, and delegation constraints.
- OPA is a business-policy layer, not a crypto/trust layer, so it can safely wait until we have clearer service-owner policy requirements.
- Adding OPA now would introduce sidecar operations, policy authoring, deployment docs, and failure-mode design before we need them.

Future rules:

- OPA must run only after Helix ID cryptographic verification succeeds.
- OPA must never replace signature, expiry, revocation, replay, DID resolution, or delegation-chain checks.
- Policy inputs must be structured and schema-validated.
- `OPA_ENABLED=false` must cleanly bypass policy checks for local/self-hosted development.
- Default tests should not require an OPA sidecar unless explicitly running OPA integration tests.

## Story 10 — `did:key` Local Mode

Status: Parked

Story 10 is valid developer-experience scope, but it is parked for now.

Reason:

- Current completed flows are intentionally Hedera-backed and live-testable.
- `did:key` would introduce a second DID mode with different trust properties, unsupported update semantics, and extra resolver dispatch logic.
- It is useful for zero-infrastructure local development, but it should not dilute the anchored Hedera behavior while the product trust model is still being hardened.

Future rules:

- `did:key` must be development-only and clearly marked as not suitable for production cross-org trust.
- `did:key` must not fake Hedera anchoring or pretend to have HCS-backed update history.
- DID updates and service endpoint mutations should be blocked or explicitly constrained in `did:key` mode.
- The SDK may locally resolve `did:key`, but anchored `did:hedera` behavior remains the default.
- Tests must prove `did:key` flows do not bypass existing VC, VP, revocation, replay, or delegation checks.
