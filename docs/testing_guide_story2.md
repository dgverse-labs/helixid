# Helix ID - Story 2 Testing Guide (VC Issuance & Management)

This document provides instructions for testing the Boundary 2 modules (Verifiable Credentials and Status Lists).

## 1. Setup

### 1.1. Database Migration
Update the database schema to include VC tables:
```bash
cd helix-api
npx prisma migrate dev --name story2-vc
```

### 1.2. Server Configuration
Ensure `HELIX_SIGNING_KEY` is set in your `.env` (it was part of Story 1 remediation).

## 2. End-to-End VC Workflow

### 2.1. Prerequisite: Create a DID
(Refer to Story 1 Guide if you don't have a test DID ready).
```bash
export SUBJECT_DID="did:helix:..."
```

### 2.2. Issue an Agent VC
- **URL**: `POST /v1/vcs`
- **Payload**:
```json
{
  "subjectDid": "did:helix:...",
  "subjectType": "agent",
  "privilegeScopes": ["read:orders", "write:orders"],
  "agentName": "Inventory Agent",
  "expiresInSeconds": 86400
}
```
- **Validation**:
  - Status: `201 Created`
  - Response contains `vc` with a `proof` field.
  - `statusListIndex` is returned.

### 2.3. Serve the Status List
- **URL**: `GET /v1/status-list/helix-status-list-1`
- **Validation**:
  - Returns a W3C StatusList2021 Credential.
  - `credentialSubject.encodedList` contains the compressed bitstring.

### 2.4. Revoke the VC
- **URL**: `POST /v1/vcs/:vcId/revoke`
- **Validation**:
  - Status: `200 OK`
  - Subsequent calls to the Status List (Step 2.3) should show the bit flipped (requires decoding the bitstring, or use the SDK's `checkVCStatus`).

### 2.5. Renew the VC
- **URL**: `POST /v1/vcs/:vcId/renew`
- **Payload**: (Optional overrides)
```json
{
  "expiresInSeconds": 3600
}
```
- **Validation**:
  - Status: `201 Created`
  - Response contains new `vcId`.
  - The old VC record's `renewedByVcId` field is updated.

---

## 3. Automated Verification

Run all tests including the new VC suites:

```bash
pnpm run test
```

### New Security Checks
1. **Signature Integrity**: Attempt to modify any field in the issued `vc` JSON (e.g., change `agentName`) and verify that `checkVCStatus` (or manual crypto verify) fails.
2. **Atomic Indexing**: Rapidly issue multiple VCs and verify no two credentials share the same `statusListIndex`.
3. **Revocation Enforcement**: Verify that `checkVCStatus` returns `revoked` immediately after the `revoke` API call completes.
