Add a CLI package @helix-id/cli to the HelixID monorepo at packages/cli/. Use TypeScript and commander.js. The CLI binary is named helix. Read passphrase from HELIX_WALLET_PASSPHRASE env var always — never prompt interactively. Use existing @helix-id/sdk-js and @helix-id/core packages for all crypto — no new crypto code.
Implement these commands:
helix did create --method web --domain example.com --wallet issuer.enc

Generates Ed25519 keypair locally via SDK. Derives did:web:example.com. Constructs a valid W3C DID document with JsonWebKey2020 verification method. Saves encrypted issuer wallet to issuer.enc. Prints the did.json content and instructs operator to serve it at https://example.com/.well-known/did.json.

helix did create --method key --wallet agent.enc

Generates Ed25519 keypair. Derives did:key. Saves to wallet. Prints DID. For agent use, not operator.
helix issuer init --wallet issuer.enc

Loads existing issuer wallet. Prints issuer DID, public key hex, and verification method ID. Confirms issuer is ready to issue VCs.
helix status-list create --length 131072 --output ./public/status/1.json --wallet issuer.enc

Creates a BitstringStatusList VC with all bits zero. Signs with issuer key from wallet. Writes signed VC JSON to output path. Prints the URL it should be served at based on --base-url flag or prompts operator to configure it.
helix vc issue --agent-did <did> --scopes read:orders,write:bookings --expires 90d --status-list ./public/status/1.json --wallet issuer.enc

Loads issuer wallet. Issues a HelixAgentCredential VC to --agent-did. Sets credentialSubject.privilegeScopes to provided scopes. Sets validUntil based on --expires. Assigns next available bit index in the StatusList file. Updates and re-signs the StatusList file. Outputs signed VC JSON to stdout or --output file. Operator sends this file to the agent out of band.
helix vc self-issue --scopes read:orders --expires 24h --wallet agent.enc

Loads agent wallet. Issues a self-signed VC where issuer DID = agent DID. Adds evidence: [{ type: 'SelfSignedDevCredential' }] to the VC. Adds VC to wallet. Prints warning: 'Self-signed VC is for local development only. Not trusted in production.' For dev/testing only.
helix revoke --vc-id <vcId> --status-list ./public/status/1.json --wallet issuer.enc

Loads issuer wallet. Finds the statusListIndex for the given vcId in the StatusList file. Flips that bit to 1. Re-signs the StatusList VC. Writes updated file. Prints confirmation with bit index and VC ID.
helix wallet inspect --wallet agent.enc

Loads wallet. Prints DID, public key, number of credentials, credential IDs, scopes, expiry dates. Never prints private key.
Add packages/cli/ to the pnpm workspace. Add a helix bin entry in package.json. Add a cli:dev script to root package.json. Write a packages/cli/README.md with install and usage instructions for each command.
