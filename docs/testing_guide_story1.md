# Helix ID - Story 1 Testing Guide

This document provides comprehensive instructions for setting up, running, and testing the Helix ID Boundary 1 (DID Lifecycle & Infrastructure) modules.

## 1. Prerequisites

Before starting, ensure you have the following installed:
- **Node.js**: v20.0.0 or higher
- **pnpm**: v9.x or higher

## 2. Environment Setup

### 2.1. Installation
From the root directory, install all dependencies:
```bash
pnpm install
```

### 2.2. Configuration

```env
# .env
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000

# Security
HELIX_SIGNING_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### 2.3. Database Initialization
Generate the Prisma client and run migrations:
```bash
cd helix-api
npx prisma generate
npx prisma migrate dev --name init
```

## 3. Starting the Services

Start the API in development mode:
```bash
pnpm --filter @helix-id/api run dev
```
The server will be available at `http://localhost:3000`. 
Interactive API documentation can be found at `http://localhost:3000/docs`.

---

## 4. End-to-End Testing Workflow

### 4.1. Create a Helix DID

- **URL**: `POST /v1/dids`
- **Headers**: `Content-Type: application/json`
- **Payload**:
```json
{
  "publicKeyHex": "4164629471f54929a008ce981c201c2461d3341abbffb2c071956b3ab01c2461",
  "subjectType": "agent"
}
```
- **Validation**:
  - Status Code: `201 Created`
  - Response must contain `id` matching `did:helix:[0-9a-f]{32}`.

### 4.2. Resolve a DID (Cache)
Resolves the DID using the local database cache for high performance.

- **URL**: `GET /v1/dids/:did`
- **Validation**:
  - Status Code: `200 OK`
  - Response matches the W3C DID Document specification.
  - Contains `authentication` and `assertionMethod` arrays.

### 4.3. Resolve a DID (Live)

- **URL**: `GET /v1/dids/:did?live=true`
- **Validation**:
  - Status Code: `200 OK`
  - Response reflects the state currently on-chain.

### 4.4. Add a Service Endpoint

- **URL**: `POST /v1/dids/:did/services`
- **Payload**:
```json
{
  "id": "#service-1",
  "type": "LinkedDomains",
  "serviceEndpoint": "https://identity.dgverse.com"
}
```
- **Validation**:
  - Status Code: `200 OK`
  - `service` array in response now contains the new endpoint.

### 4.5. Deactivate a DID
Permanently deactivates the DID. All subsequent operations on this DID will return `410 Gone`.

- **URL**: `POST /v1/dids/:did/deactivate`
- **Validation**:
  - Status Code: `204 No Content`
  - Subsequent GET requests to this DID return `410 Gone`.

---

## 5. Automated Verification

To run the full suite of automated integration and security tests:

```bash
pnpm run test
```

### Critical Security Checks
1. **Deduplication**: Attempting to create a DID for a public key that already has one should return `409 Conflict`.
2. **Log Sanitization**: Verify that `helix-api` logs (Stdout and DB Audit logs) do not contain raw private keys or sensitive payloads.
3. **HTTPS Enforcement**: Service endpoints must use `https://`. Attempting to add an `http://` endpoint will result in `400 Bad Request`.
