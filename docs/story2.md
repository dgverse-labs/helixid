STORY 2 — Boundary 2: VC Issuance & Management
What to Mock So This Story Can Start
B2 depends on B1's resolveDID. Mock it as a simple function that accepts any DID string and returns a hardcoded valid DID document containing a known test public key. The mock does not need to hit a database or Hedera. A factory function returning a fixed structure is sufficient. The real DIDService gets injected in production; the mock gets injected in B2 tests.

Overview
B2 owns the full lifecycle of Verifiable Credentials. It issues agent VCs and user VCs, maintains the W3C StatusList2021 bitstring for revocation, handles expiry, and provides renewal. External verifiers use the status list URL embedded in each VC to check revocation without calling Helix ID per-verification.

2.1 — Database Schema
New tables to add to schema.prisma:
vcs — one row per issued VC

id — cuid primary key
vcId — unique string, the credential's id field in the VC JSON (format: vc:helix:<cuid>)
subjectDid — the DID this VC was issued to
subjectType — agent or user
vcJson — full VC JSON as string
privilegeScopes — array stored as JSON string (e.g. ["read:orders","write:orders"])
statusListIndex — integer, the bit position in the status list assigned to this VC
expiresAt — DateTime
revokedAt — DateTime nullable
renewedByVcId — String nullable, points to the new VC that replaced this one on renewal
createdAt — DateTime

status_list_entries — one row per status list. In open core there is one global status list. Enterprise may have per-org lists.

id — cuid primary key
listId — unique string (e.g. helix-status-list-1)
encodedList — the base64url-encoded gzip-compressed bitstring (W3C StatusList2021 format)
nextIndex — integer, the next unassigned index
updatedAt — DateTime


2.2 — helix-core Additions
VC Schema — helix-core/src/schemas/vc.ts
Define the TypeScript types and Zod validators for both agent VC and user VC. These types are used by both the API (issuance) and SDK (parsing/validation).
AgentVC structure:
{
  "@context": ["https://www.w3.org/2018/credentials/v1", "https://helix-id.io/contexts/v1"],
  "id": "vc:helix:<cuid>",
  "type": ["VerifiableCredential", "HelixAgentCredential"],
  "issuer": "did:helix:<helix-id-did>",
  "issuanceDate": "<ISO 8601>",
  "expirationDate": "<ISO 8601>",
  "credentialStatus": {
    "id": "<API_BASE_URL>/v1/status-list/<listId>#<index>",
    "type": "StatusList2021Entry",
    "statusPurpose": "revocation",
    "statusListIndex": "<index as string>",
    "statusListCredential": "<API_BASE_URL>/v1/status-list/<listId>"
  },
  "credentialSubject": {
    "id": "<agentDID>",
    "type": "HelixAgent",
    "privilegeScopes": ["read:orders", "write:orders"],
    "agentName": "My Agent"
  }
}
UserVC structure: Same envelope, type is ["VerifiableCredential", "HelixUserCredential"], credentialSubject.type is "HelixUser", no privilegeScopes field, has "userId" string instead.
Define Zod schemas for both. Export the inferred TypeScript types. Export a SignedVC type that wraps either with a proof field:
proof: {
  type: "Ed25519Signature2020",
  created: "<ISO 8601>",
  verificationMethod: "<helix-id-did>#key-1",
  proofPurpose: "assertionMethod",
  proofValue: "<base58btc-encoded signature>"
}
Status List Logic — helix-core/src/status-list/index.ts
The status list is a bitstring, gzip-compressed, base64url-encoded. Each VC gets an index. Bit 0 = valid, bit 1 = revoked.
Functions needed:

createStatusList(size: number): string — creates a zeroed bitstring of size bits, compresses, base64url encodes. Default size: 131072 (16KB uncompressed, covers ~131k VCs per list)
setBit(encodedList: string, index: number, value: 0 | 1): string — decompresses, flips the bit, recompresses, returns new encoded string
getBit(encodedList: string, index: number): 0 | 1 — decompresses, reads the bit
buildStatusListCredential(listId: string, encodedList: string, issuerDid: string, apiBaseUrl: string): object — builds the W3C StatusList2021 credential JSON that gets served at the public URL

Use Node.js zlib for gzip. No additional dependencies.
Error Codes to add to helix-core/src/errors/codes.ts
VC_NOT_FOUND
VC_ALREADY_REVOKED
VC_EXPIRED
VC_SUBJECT_DID_NOT_FOUND       // subjectDid does not exist in B1
VC_INVALID_PRIVILEGE_SCOPE     // scope string doesn't match allowed pattern
STATUS_LIST_INDEX_EXHAUSTED    // all 131072 bits used — needs new list
Audit Events to add to helix-core/src/audit/events.ts
VC_ISSUED
VC_ISSUANCE_FAILED
VC_REVOKED
VC_REVOCATION_FAILED
VC_RENEWED
VC_RENEWAL_FAILED
VC_STATUS_CHECKED
STATUS_LIST_UPDATED
Each VC_ISSUED event must include: vcId, subjectDid, subjectType, privilegeScopes, expiresAt, statusListIndex. Must NOT include the VC JSON or the signed proof value.

2.3 — API Endpoints
POST /v1/vcs — Issue a VC
Request:
json{
  "subjectDid": "did:helix:<32 hex chars>",
  "subjectType": "agent" | "user",
  "privilegeScopes": ["read:orders", "write:orders"],  // agent only, omit for user
  "agentName": "My Shopping Agent",                   // agent only
  "userId": "user_abc123",                            // user only
  "expiresInSeconds": 7776000                         // e.g. 90 days; min 3600, max 31536000
}
Response 201:
json{
  "vcId": "vc:helix:abc123",
  "vc": { /* full signed VC JSON */ },
  "statusListIndex": 42,
  "expiresAt": "2025-09-01T00:00:00Z"
}
Error cases: 400 VALIDATION_ERROR, 400 VC_INVALID_PRIVILEGE_SCOPE, 404 VC_SUBJECT_DID_NOT_FOUND, 503 STATUS_LIST_INDEX_EXHAUSTED
Signing: Helix ID signs the VC using HELIX_SIGNING_KEY (Ed25519). The signature is computed over the canonical JSON of the credential (without the proof field), following the Linked Data Proof spec. In practice: JSON.stringify the credential without proof, compute SHA-256, sign with Ed25519, base58btc-encode the signature bytes.
GET /v1/vcs/:vcId — Get VC details
Returns the stored VC JSON plus metadata (revokedAt, renewedByVcId, expiresAt). Does not re-sign. Used by the SDK and dashboard.
Response 200:
json{
  "vcId": "vc:helix:abc123",
  "vc": { /* signed VC */ },
  "status": "active" | "revoked" | "expired",
  "expiresAt": "...",
  "revokedAt": null | "...",
  "renewedByVcId": null | "vc:helix:newid"
}
Error cases: 404 VC_NOT_FOUND
POST /v1/vcs/:vcId/revoke — Revoke a VC
No request body needed. Flips the bit at the VC's statusListIndex from 0 to 1. Updates the status list record. Marks the VC row as revoked.
Response 200:
json{
  "vcId": "vc:helix:abc123",
  "revoked": true,
  "revokedAt": "2025-06-01T00:00:00Z"
}
Error cases: 404 VC_NOT_FOUND, 409 VC_ALREADY_REVOKED
POST /v1/vcs/:vcId/renew — Renew a VC
Issues a new VC to the same subject with the same scopes (or optionally updated scopes and expiry). The old VC is NOT revoked on renewal — it expires naturally or is revoked separately. The new VC gets a new vcId and a new statusListIndex. The old VC row gets renewedByVcId set to the new vcId.
Request (all fields optional — defaults to same as original VC):
json{
  "privilegeScopes": ["read:orders"],       // optional override
  "expiresInSeconds": 7776000               // optional override
}
Response 201:
json{
  "vcId": "vc:helix:newid",
  "vc": { /* new signed VC */ },
  "previousVcId": "vc:helix:oldid",
  "expiresAt": "..."
}
Error cases: 404 VC_NOT_FOUND, 409 VC_ALREADY_REVOKED (cannot renew a revoked VC)
GET /v1/status-list/:listId — Serve the Status List Credential
Public endpoint. No auth. Returns the W3C StatusList2021 credential JSON. Verifiers fetch this to check revocation status without calling Helix ID per-VC. Cache-friendly — set Cache-Control: public, max-age=300.
Response 200: The status list credential JSON (not wrapped in an envelope — it IS the credential).
Error cases: 404 if listId not found.

2.4 — Service Layer Behaviour
VCService key methods
issueVC(params, requestId):

Validate subjectDid exists by calling B1's DIDService.resolveDID. Throw VC_SUBJECT_DID_NOT_FOUND if 404.
Validate privilege scopes against allowed pattern: each scope must match ^[a-z]+:[a-z_]+$ and be in the system's known scope list (define a constant array in helix-core schemas/privilegeScopes.ts).
Claim the next available statusListIndex from status_list_entries. This must be an atomic DB operation — use a Prisma transaction with SELECT FOR UPDATE or an atomic increment to prevent two concurrent issuances getting the same index.
Build the unsigned VC JSON.
Sign: SHA-256 hash of canonical VC JSON (without proof), sign hash with HELIX_SIGNING_KEY, base58btc-encode signature, attach as proof.proofValue.
Persist to vcs table.
Emit VC_ISSUED audit event.

revokeVC(vcId, requestId):

Fetch VC record. Throw 404 if missing.
Throw 409 if already revoked.
Fetch status list. Call setBit(encodedList, statusListIndex, 1).
Update status list record and VC record in a single Prisma transaction.
Emit VC_REVOKED audit event.

renewVC(vcId, overrides, requestId):

Fetch original VC. Throw 404 if missing.
Throw 409 if revoked.
Call issueVC with same subject, same scopes (or overrides), updating renewedByVcId on the old record.
Emit VC_RENEWED audit event referencing both old and new vcId.


2.5 — SDK Methods
Add to HelixClient:
getVC(vcId: string): Promise<VCDetails> — calls GET /v1/vcs/:vcId
revokeVC(vcId: string): Promise<{revoked: true, revokedAt: string}> — calls POST /v1/vcs/:vcId/revoke
renewVC(vcId: string, options?: RenewVCOptions): Promise<RenewVCResult> — calls POST /v1/vcs/:vcId/renew
getStatusList(listId: string): Promise<StatusListCredential> — calls GET /v1/status-list/:listId. Used by verifiers doing self-verification.
checkVCStatus(vc: SignedVC): Promise<'active' | 'revoked' | 'expired'> — client-side helper. Extracts statusListIndex and statusListCredential URL from the VC, fetches the status list, calls getBit. No API call to Helix ID verify endpoint — pure self-verification.

2.6 — Tests
Unit tests (helix-core)

createStatusList produces a non-empty base64url string
setBit(list, 5, 1) then getBit(list, 5) returns 1
getBit on a freshly created list always returns 0
setBit does not mutate other bits — set bit 5, check bits 4 and 6 are still 0
Roundtrip: create → set multiple bits → read them all back correctly
buildStatusListCredential includes correct @context and type

Integration tests (helix-api)

Issue an agent VC — 201, VC JSON contains correct subject DID and scopes
Issue a user VC — no privilegeScopes field present
Issue VC for unknown DID — 404
Issue VC with invalid scope format — 400
Revoke a VC — 200, DB record updated
Revoke already-revoked VC — 409
Renew a VC — 201, old VC has renewedByVcId set, new VC has new index
Get status list — 200, parseable JSON, correct type
Concurrent issuance test: two simultaneous VC issuances must get different statusListIndex values — use Promise.all with two calls in the test

Security tests

Issued VC proof value verifies against HELIX_SIGNING_KEY public key
Tampered VC (flip one char in credentialSubject) fails signature verification
Revoked VC: after revoking, checkVCStatus returns 'revoked' — bit is set in status list
Expired VC: create VC with expiresInSeconds: 1, wait 2 seconds, verify status returns 'expired'
Status list audit entry is written on every revocation