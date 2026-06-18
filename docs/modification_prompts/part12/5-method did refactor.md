Refactor HelixID to make did:web the default issuer DID method, did:key the standard agent DID method, and did:hedera an optional opt-in for issuers only.
1. DID resolver in @helix-id/core
Create packages/core/src/did-resolver.ts with a single exported function resolveDID(did: string): Promise<DIDDocument>. Handle three methods:
did:key — resolve locally using the @digitalbazaar/did-method-key package or equivalent. No network call. Must work offline.
did:web — fetch https://{domain}/.well-known/did.json for root DIDs or https://{domain}/{path}/did.json for path DIDs. Validate response is a valid DID document. Cache result in memory with 5 minute TTL.
did:hedera — fetch from Hedera mirror node REST API. Only available if @helix-id/did-hedera is installed. If not installed, throw DID_METHOD_NOT_AVAILABLE: did:hedera requires @helix-id/did-hedera package. Cache result with 15 minute TTL.
Throw UNSUPPORTED_DID_METHOD for any other method.
2. Split Hedera into optional package
Create packages/did-hedera/ with its own package.json. Move all Hedera-specific code from helix-api and helix-core into this package. Export resolveDidHedera(did) and anchorDidHedera(didDocument, operatorId, operatorKey, network). This package has @hashgraph/sdk as a dependency. @helix-id/core and @helix-id/sdk-js must have zero @hashgraph/sdk dependency.
3. AgentWallet.create() always uses did:key
AgentWallet.create(walletPath, passphrase) generates Ed25519 keypair, derives did:key, saves wallet. No options needed. No DID method parameter. Agent DID is always did:key.
4. CLI issuer DID creation
helix did create --method web --domain example.com --wallet issuer.enc — default path, no Hedera needed.
helix did create --method hedera --network testnet --wallet issuer.enc — requires @helix-id/did-hedera installed. If not installed, print clear error: 'Hedera DID method requires: npm install @helix-id/did-hedera' and exit.
helix did create --method key --wallet agent.enc — for agent use, though agents typically get their DID via AgentWallet.create() in SDK.
5. Update verifyVP in SDK
verifyVP() calls resolveDID() for issuer DID resolution. Since issuer can be did:web or did:hedera, resolver handles both. Agent DID is always did:key — resolved locally. No change needed for agent DID resolution.
6. Update helix-api
Remove hardcoded Hedera dependency from helix-api core. Make Hedera anchoring conditional on DID_METHOD=hedera env var. Default to did:web mode where API serves GET /.well-known/did.json directly from issuer wallet config. Add env vars:
DID_METHOD=web          # default
DID_DOMAIN=example.com  # required for did:web
DID_METHOD=hedera       # opt-in
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=...
HEDERA_OPERATOR_KEY=...
7. Update all documentation and examples
Replace all did:hedera issuer DIDs in examples with did:web:localhost for local dev. Add a note in each example: 'For production with immutable on-chain anchoring, install @helix-id/did-hedera and set DID_METHOD=hedera'.
Write tests: did:key resolves offline, did:web resolves via HTTPS fetch with mocked response, did:hedera throws DID_METHOD_NOT_AVAILABLE when package not installed, verifyVP works with did:web issuer, AgentWallet.create() always produces did:key.