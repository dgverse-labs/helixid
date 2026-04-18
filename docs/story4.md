STORY 4 — Boundary 4: Agent & User Flows
What to Mock So This Story Can Start
B4 is the consumer of B1, B2, and B3. To develop B4 in parallel:

Mock DIDService.createDID → returns { did: 'did:helix:<fixed-test-id>', hederaTransactionId: 'mock-tx-1' }
Mock VCService.issueVC → returns a hardcoded signed VC
Mock VPService.generateVPTemplate → returns a hardcoded unsigned VP
Mock DIDService.resolveDID → returns a fixed DID document with a known test keypair
Mock VCService.getVCStatus → returns 'active'

All mocks are injected via constructor — B4's service constructors accept interfaces, not concrete classes.

Overview
B4 is the orchestration boundary. It does not own any primitives — it calls B1, B2, and B3 to implement the human-facing flows: agent onboarding, user DID verification, and the service registry.

4.1 — Database Schema
New tables:
enrollment_tokens

id — cuid
tokenId — unique string (format: enroll:<cuid>) — this is what gets given to the agent owner
tokenHash — string — SHA-256 hash of tokenId. Only the hash is stored. The raw token is shown once and never stored in plaintext. Lookup is by hash.
agentName — string
requestedScopes — JSON string array
requestedDomains — JSON string array
expiresAt — DateTime
usedAt — DateTime nullable
createdAt — DateTime
@@unique([tokenHash])

challenges

id — cuid
challengeId — unique string
nonce — 32-byte random hex string (what gets signed)
did — the DID this challenge was issued for
purpose — 'agent_onboarding' | 'user_verification'
expiresAt — DateTime
verifiedAt — DateTime nullable
createdAt — DateTime

service_registry

id — cuid
serviceName — unique string (e.g. "amazon", "shopify")
displayName — string (e.g. "Amazon")
verifiedDomain — string (e.g. "https://amazon.com")
publicKeyMultibase — string (service's own public key for mutual auth — future use)
apiEndpoint — string — the endpoint agents call to deliver VPs
metadata — JSON string (arbitrary key-value for SDK display)
active — boolean
createdAt — DateTime
updatedAt — DateTime


4.2 — helix-core Additions
Error codes to add
ENROLLMENT_TOKEN_NOT_FOUND
ENROLLMENT_TOKEN_EXPIRED
ENROLLMENT_TOKEN_ALREADY_USED
CHALLENGE_NOT_FOUND
CHALLENGE_EXPIRED
CHALLENGE_ALREADY_VERIFIED
CHALLENGE_SIGNATURE_INVALID     // same note as VP: externally opaque per EH-4
AGENT_ALREADY_ONBOARDED         // DID_ALREADY_EXISTS bubbled up as this in B4 context
SERVICE_NOT_FOUND               // service name not in registry
SERVICE_ALREADY_EXISTS
Audit events to add
ENROLLMENT_TOKEN_GENERATED      // fields: tokenId (hashed — never raw), agentName, requestedScopes, expiresAt
ENROLLMENT_TOKEN_CONSUMED       // fields: tokenId (hashed), agentDid, timestamp
ENROLLMENT_TOKEN_REJECTED       // fields: tokenId (hashed), reason, timestamp
CHALLENGE_ISSUED                // fields: challengeId, did, purpose, expiresAt
CHALLENGE_VERIFIED              // fields: challengeId, did, purpose, success: true
CHALLENGE_REJECTED              // fields: challengeId, reason, timestamp
AGENT_ONBOARDED                 // fields: agentDid, agentName, hederaTransactionId
USER_DID_VERIFIED               // fields: userDid, timestamp
Note on token security in audit log: The raw enrollment token is shown to the agent owner exactly once (in the POST /v1/enrollment-tokens response). After that, only the SHA-256 hash is stored and logged. Audit entries reference tokenIdHash, never the raw tokenId.

4.3 — API Endpoints
POST /v1/enrollment-tokens — Generate Enrollment Token
Called by agent owner via dashboard or API.
Request:
json{
  "agentName": "My Shopping Agent",
  "requestedScopes": ["read:orders", "write:orders"],
  "requestedDomains": ["https://myagent.example.com"]
}
Response 201:
json{
  "token": "enroll:abc123xyz...",    // shown ONCE, never stored in plaintext
  "tokenId": "enroll:abc123xyz...", // same as token in this context — full value
  "expiresAt": "2025-06-01T12:15:00Z"
}
Service behaviour: Generate tokenId as enroll:<cuid>. Hash it with SHA-256 (tokenHash). Store only tokenHash, agentName, requestedScopes, requestedDomains, expiresAt. Return raw tokenId in response. Emit ENROLLMENT_TOKEN_GENERATED with tokenHash only.
POST /v1/onboard — Agent Onboarding Step 1
Agent calls this with enrollment token and public key.
Request:
json{
  "enrollmentToken": "enroll:abc123xyz...",
  "publicKeyHex": "<64 hex chars>",
  "domains": ["https://myagent.example.com"]
}
Response 200:
json{
  "challengeId": "chal:abc123",
  "nonce": "<32-byte hex>",
  "expiresAt": "2025-06-01T12:05:00Z"
}
Service behaviour:

Hash the submitted enrollmentToken → look up by tokenHash
If not found → ENROLLMENT_TOKEN_NOT_FOUND
If usedAt is not null → ENROLLMENT_TOKEN_ALREADY_USED (SA-3: burned on first use)
If expiresAt is past → ENROLLMENT_TOKEN_EXPIRED
Validate publicKeyHex format (64 hex chars)
Generate challenge: challengeId = chal:<cuid>, nonce = crypto.randomBytes(32).toString('hex')
Store challenge with the submitted publicKeyHex (needed to verify the signature in step 2)
Do NOT create DID yet — wait for challenge response
Mark token usedAt = now() (burned — SA-3)
Emit ENROLLMENT_TOKEN_CONSUMED
Return challengeId + nonce

Pending state: At this point the public key and pending domains are stored alongside the challenge. Add a pendingPublicKeyHex and pendingDomains JSON field to the challenges table for onboarding challenges.
POST /v1/onboard/verify — Agent Onboarding Step 2
Agent signs the nonce and submits the signature.
Request:
json{
  "challengeId": "chal:abc123",
  "signature": "<hex-encoded Ed25519 signature>"
}
Response 201:
json{
  "agentDid": "did:helix:...",
  "vc": { /* signed agent VC */ },
  "hederaTransactionId": "...",
  "vcId": "vc:helix:..."
}
Service behaviour:

Look up challenge by challengeId
If not found → CHALLENGE_NOT_FOUND
If expiresAt past → CHALLENGE_EXPIRED
If verifiedAt not null → CHALLENGE_ALREADY_VERIFIED
Verify signature: verifySignature(hexToBytes(nonce), signature, pendingPublicKeyHex) → false: CHALLENGE_SIGNATURE_INVALID
Call B1 DIDService.createDID(publicKeyHex, 'agent', domains) → 409 means AGENT_ALREADY_ONBOARDED
Call B2 VCService.issueVC(agentDid, 'agent', requestedScopes, agentName, expiresIn)
Mark challenge verifiedAt = now()
Emit AGENT_ONBOARDED
Return agentDid + signed VC + hederaTransactionId

The requestedScopes and agentName come from the enrollment token record (retrieved via challenge → token relationship). Add enrollmentTokenId FK to challenges table.
POST /v1/challenges — Issue a Challenge (User Verification)
Used to verify a user's ownership of a DID.
Request:
json{
  "did": "did:helix:...",
  "purpose": "user_verification"
}
Response 201:
json{
  "challengeId": "chal:xyz",
  "nonce": "<32-byte hex>",
  "expiresAt": "..."
}
Service behaviour: Validate DID exists via B1. Generate and store challenge. Emit CHALLENGE_ISSUED.
POST /v1/challenges/:challengeId/verify — Verify a Challenge
Request:
json{
  "signature": "<hex-encoded signature of the nonce>"
}
Response 200:
json{
  "did": "did:helix:...",
  "verified": true,
  "vc": { /* user VC — only present if purpose was user_verification */ }
}
Service behaviour:

Look up challenge → 404, 410 (expired), 409 (already verified)
Resolve DID from B1, extract public key
Verify verifySignature(hexToBytes(nonce), signature, publicKey) → false: CHALLENGE_SIGNATURE_INVALID
Mark verifiedAt = now()
If purpose is user_verification: fetch user's VC from B2, return it alongside the result. If user has no VC yet, call B2 issueVC for the user DID.
Emit CHALLENGE_VERIFIED

GET /v1/services — List Service Registry
Response 200:
json{
  "services": [
    {
      "serviceName": "amazon",
      "displayName": "Amazon",
      "verifiedDomain": "https://amazon.com",
      "apiEndpoint": "https://api.amazon.com/helix/verify",
      "metadata": {}
    }
  ]
}
GET /v1/services/:serviceName — Get Service Details
Response 200: Single service entry. 404 SERVICE_NOT_FOUND if not found.
POST /v1/services — Register a Service (Admin)
Note: In open core this endpoint is not auth-protected (auth is a SaaS-tier feature). Document this limitation clearly. The service registry is operated manually by the Helix ID operator.
Request:
json{
  "serviceName": "amazon",
  "displayName": "Amazon",
  "verifiedDomain": "https://amazon.com",
  "apiEndpoint": "https://api.amazon.com/helix/verify",
  "publicKeyMultibase": "z...",
  "metadata": {}
}
Response 201: The created service entry. 409 SERVICE_ALREADY_EXISTS if serviceName is taken.

4.4 — SDK Methods
enrollmentTokenToChallenge(token: string, publicKeyHex: string, domains: string[]): Promise<{challengeId, nonce, expiresAt}> — calls POST /v1/onboard
completeOnboarding(challengeId: string, nonce: string, privateKeyHex: string): Promise<OnboardingResult> — signs the nonce locally (signBytes(hexToBytes(nonce), privateKeyHex)), calls POST /v1/onboard/verify, returns result including VC. Stores DID, VC, publicKey in AgentWallet.
requestUserChallenge(userDid: string): Promise<{challengeId, nonce, expiresAt}> — calls POST /v1/challenges
verifyUserChallenge(challengeId: string, signature: string): Promise<{did, verified, vc?}> — calls POST /v1/challenges/:challengeId/verify
listServices(): Promise<ServiceEntry[]> — calls GET /v1/services
getService(serviceName: string): Promise<ServiceEntry> — calls GET /v1/services/:serviceName
AgentWallet — helix-sdk-js/src/wallet/AgentWallet.ts
The wallet stores the agent's identity locally. In open core it is a local encrypted JSON file. The encryption key is derived from a passphrase using PBKDF2 (Node.js crypto.pbkdf2, no new dependency).
Wallet file structure (encrypted at rest):
json{
  "version": 1,
  "did": "did:helix:...",
  "publicKeyHex": "...",
  "encryptedPrivateKey": "<AES-256-GCM encrypted hex>",
  "vcId": "vc:helix:...",
  "vc": { /* current active VC */ },
  "createdAt": "...",
  "updatedAt": "..."
}
Methods:

save(data: WalletData, passphrase: string, filePath: string): Promise<void> — encrypts private key, writes JSON file
load(passphrase: string, filePath: string): Promise<WalletData> — reads file, decrypts private key
getPrivateKey(passphrase: string, filePath: string): Promise<string> — convenience: load + return private key hex
updateVC(newVC: SignedVC, filePath: string, passphrase: string): Promise<void> — used after VC renewal

Private key encryption: AES-256-GCM. Key derived via PBKDF2 (100,000 iterations, SHA-256, 32-byte output, 16-byte random salt stored in file). IV is 12 bytes random, stored in file. Use Node.js crypto module — no new dependency.

4.5 — Tests
Unit tests

completeOnboarding signs the nonce with the private key and the produced signature verifies against the public key
AgentWallet.save then AgentWallet.load with correct passphrase returns original data
AgentWallet.load with wrong passphrase throws
AgentWallet.getPrivateKey returns the original private key after roundtrip

Integration tests

Full onboarding flow: generate token → POST /v1/onboard → POST /v1/onboard/verify → agent DID exists in DB, agent VC issued and returned
User verification flow: POST /v1/challenges → sign nonce → POST /v1/challenges/:id/verify → 200 with verified: true
GET /v1/services returns seeded registry entries
Onboarding with expired token → 400 ENROLLMENT_TOKEN_EXPIRED
Onboarding with already-used token → 400 ENROLLMENT_TOKEN_ALREADY_USED

Security tests

Enrollment token single use (SA-3): Use same token twice → second call returns ENROLLMENT_TOKEN_ALREADY_USED. DB record shows usedAt is set.
Enrollment token expiry (SA-3): Manually set expiresAt to past in DB, attempt use → ENROLLMENT_TOKEN_EXPIRED
Challenge expiry: Manually set expiresAt to past in DB, submit signature → CHALLENGE_EXPIRED
Wrong signature on onboarding challenge: Submit a signature from a different keypair → CHALLENGE_SIGNATURE_INVALID; DID must NOT be created in B1; VC must NOT be issued in B2
Raw enrollment token never in audit log: After token generation, check all audit log entries — none should contain the raw token string. Only tokenHash appears.
Challenge replay: Verify a challenge, then submit the same challengeId again → CHALLENGE_ALREADY_VERIFIED