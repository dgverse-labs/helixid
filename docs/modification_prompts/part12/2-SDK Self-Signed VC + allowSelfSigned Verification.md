Add self-signed VC support to @helix-id/sdk-js.
Add method sdk.selfIssueVC(options, wallet) to HelixClient:

options: { scopes: string[], expiresIn?: string, maxDelegationDepth?: number }
Sets issuer and credentialSubject.id both to wallet.did
Adds evidence: [{ type: 'SelfSignedDevCredential', warning: 'Not for production use' }]
Signs with wallet.privateKeyHex
Returns signed VC
Does not require API URL — works with new HelixClient() (no args)

Add method wallet.addCredential(vc) to AgentWallet:

Appends VC to wallet.credentials[]
Re-encrypts and saves wallet file

Modify sdk.verifyVP(vp, options?):

Add options.allowSelfSigned: boolean (default false)
If VP contains a VC where issuer === credentialSubject.id, it is self-signed
If allowSelfSigned is false, throw SELF_SIGNED_VC_NOT_ALLOWED
If allowSelfSigned is true, proceed with verification but add warning: 'self-signed credential, not trusted in production' to result

Add HelixClient constructor overload that accepts no arguments for SDK-only mode:
typescript// API mode
const sdk = new HelixClient('http://localhost:3000')
// SDK-only mode
const sdk = new HelixClient()
In SDK-only mode, methods that require API (createVPTemplate, verifyVP with session, delegate via API) throw SDK_ONLY_MODE_NO_API with a clear message explaining what is needed.
Add AgentWallet.create(walletPath, passphrase) static method that generates a fresh Ed25519 keypair, derives did:key, creates and saves a new wallet file. Returns loaded wallet instance.
Write unit tests for self-signed issuance, self-signed verification with and without allowSelfSigned, and AgentWallet.create.