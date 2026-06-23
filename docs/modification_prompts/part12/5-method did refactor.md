1. DID resolver in @helix-id/core
Create packages/core/src/did-resolver.ts with a single exported function resolveDID(did: string): Promise<DIDDocument>. Handle three methods:
did:key — resolve locally using the @digitalbazaar/did-method-key package or equivalent. No network call. Must work offline.
did:web — fetch https://{domain}/.well-known/did.json for root DIDs or https://{domain}/{path}/did.json for path DIDs. Validate response is a valid DID document. Cache result in memory with 5 minute TTL.
Throw UNSUPPORTED_DID_METHOD for any other method.
3. AgentWallet.create() always uses did:key
AgentWallet.create(walletPath, passphrase) generates Ed25519 keypair, derives did:key, saves wallet. No options needed. No DID method parameter. Agent DID is always did:key.
4. CLI issuer DID creation
helix did create --method key --wallet agent.enc — for agent use, though agents typically get their DID via AgentWallet.create() in SDK.
5. Update verifyVP in SDK
6. Update helix-api
DID_METHOD=web          # default
DID_DOMAIN=example.com  # required for did:web
7. Update all documentation and examples
