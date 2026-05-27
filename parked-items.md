# Parked Items

These are valid product or engineering items that are intentionally deferred from the current story scope.

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
