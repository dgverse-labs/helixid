# Parked Items

These are valid product or engineering items that are intentionally deferred from the current story scope.

## Very Important — Host Helix VC JSON-LD Context

Status: Parked, very important

Issued Helix VCs currently include:

- `https://www.w3.org/ns/credentials/v2`
- `https://helixid.io/contexts/v1`

The W3C context is hosted, but `https://helixid.io/contexts/v1` is Helix ID's custom JSON-LD context and is not currently hosted. Today the API/SDK verification path uses local canonical JSON signing and does not fetch this context, so local demos can still work. For production-facing VC 2.0 interoperability, the custom context must either be hosted or replaced with an explicit inline/context strategy.

- Host `https://helixid.io/contexts/v1` before claiming full public JSON-LD/VC ecosystem interoperability.
- Define Helix-specific terms such as `HelixAgentCredential`, `HelixUserCredential`, `privilegeScopes`, `agentName`, `delegatedFrom`, `delegationDepth`, `maxDelegationDepth`, and `parentVcId`.
- Document clearly whether Helix verification fetches remote contexts or only uses local canonical JSON signing.
- Add tests or docs proving issued VC context URLs are resolvable when public interoperability is in scope.

Status: Parked

Story 5 setup work no longer generates persisted JWT session signing keys. Session JWTs are signed with an API startup-ephemeral keypair, and the public key is served at `/v1/sessions/public-key`.

- `HELIX_ISSUER_DID`

Notes:

- The issuer DID public key must correspond to the configured signing key used for VC issuance.
- This should be live-testable but must not run in standard CI.

## CrewAI Framework Adapter

Status: Parked

CrewAI is a valid framework adapter target, but it is parked until `helix-sdk-py` exists.

- Package location: `packages/crewai/`
- Python package name: `helix-crewai`, imported as `helix_crewai`
- The adapter must use `helix-sdk-py` for wallet loading, VP template retrieval, and local signing
- The adapter must not hand-roll VP canonicalization, base58/base64url encoding, Ed25519 signing, or verification semantics
- Compatibility tests must prove CrewAI-generated VPs verify through the same Helix ID API path as JS SDK VPs

This is parked because building CrewAI now would either require a temporary Python signing path or duplicate SDK behavior. Both are unnecessary until the Python SDK story is active.

## Python SDK

Status: Parked

The Python SDK remains parked until the JS/TS SDK surface is stable enough to mirror without creating divergent crypto behavior.

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

- OPA must run only after Helix ID cryptographic verification succeeds.
- OPA must never replace signature, expiry, revocation, replay, DID resolution, or delegation-chain checks.
- Policy inputs must be structured and schema-validated.
- `OPA_ENABLED=false` must cleanly bypass policy checks for local/self-hosted development.
- Default tests should not require an OPA sidecar unless explicitly running OPA integration tests.

## Story 10 — `did:key` Local Mode

Status: Parked

Story 10 is valid developer-experience scope, but it is parked for now.

Reason:

- `did:key` would introduce a second DID mode with different trust properties, unsupported update semantics, and extra resolver dispatch logic.

- `did:key` must be development-only and clearly marked as not suitable for production cross-org trust.
- DID updates and service endpoint mutations should be blocked or explicitly constrained in `did:key` mode.
- Tests must prove `did:key` flows do not bypass existing VC, VP, revocation, replay, or delegation checks.

## Modify readme to reduce the importance of performance when DLT is added

# Add 5 minute working demo inreadme
