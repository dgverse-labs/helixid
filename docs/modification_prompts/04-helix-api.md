# Prompt 04 — `helix-api` Modifications

## Dependency prerequisite

## Context
`helix-api` lives at `helix-api/`. It is a Fastify API. After this prompt, the API is scoped to enrollment, VC issuance at scale, revocation at scale, StatusList hosting, and `did:web` document hosting. VP creation, VP verification (except session JWT path), and delegation are removed — those are now SDK-only operations.

---

## Changes required

### 1. Remove these endpoints entirely

| Endpoint | Reason |
|---|---|
| `POST /v1/vp/template` (createVPTemplate) | VPBuilder now constructs VP locally in SDK |
| `POST /v1/delegate` | Delegation is now SDK-side Option A self-signed |

**Keep but review:**
- `POST /v1/vp/verify` — keep only for session JWT bridge path (`session: true` flag). If `session: false` or flag absent, return `410 Gone` with message: 'VP verification is now handled by the SDK. Use verifyVP() from @helix-id/sdk-js. Pass session: true to this endpoint only if you need a session JWT.'

---

### 2. Endpoints to keep unchanged

```
POST /v1/enrollment-tokens          — operator creates enrollment token
POST /v1/onboarding/challenge       — agent requests challenge
POST /v1/onboarding/complete        — agent completes enrollment, receives VC
POST /v1/vc/issue                   — operator issues VC (large scale / automated)
POST /v1/vc/revoke                  — operator revokes VC
GET  /v1/status/:listId             — StatusList VC hosting
```

---

### 3. Add `did:web` document hosting

Add new endpoint:

```
GET /.well-known/did.json
```

Rules:
- Read issuer DID document from config or database
- Return as `application/json` with correct `Content-Type`
- Cache-Control: `public, max-age=3600`
- This makes `helix-api` itself a valid `did:web` host when deployed at a domain
- Example: API deployed at `https://api.example.com` → DID is `did:web:api.example.com`

Add env var `DID_DOMAIN` — the domain the API is served at. Used to construct the `did:web` DID on issuer init.

---

**DID_METHOD=web (default):**
- Issuer DID is `did:web:{DID_DOMAIN}`
- DID document served from `GET /.well-known/did.json`

- If package not installed, fail fast on startup with clear error

Implement this as a DID provider factory:

```typescript
// helix-api/src/did-provider.ts
export async function createDIDProvider(): Promise<DIDProvider> {
  const method = process.env.DID_METHOD ?? 'web'
  }
  return new WebDIDProvider()
}
```

---

### 5. Update `.env.example`

```bash
# Required always
HELIX_ADMIN_API_KEY=your-admin-key
HELIX_SIGNING_KEY=your-issuer-signing-key
HELIX_JWT_SIGNING_KEY=your-jwt-signing-key

# DID method — default is web
DID_METHOD=web
DID_DOMAIN=localhost:3000      # domain API is served at for did:web

```

---

### 6. Update docker-compose.yml

```yaml
services:
    environment:

  api:
    build: ./helix-api
    environment:
      DID_METHOD: web
      DID_DOMAIN: localhost:3000
      HELIX_ADMIN_API_KEY: dev-admin-key
      HELIX_SIGNING_KEY: dev-signing-key
      HELIX_JWT_SIGNING_KEY: dev-jwt-key
```

---

### 7. Startup validation

On API startup, validate:
- Always: check `DATABASE_URL`, `HELIX_ADMIN_API_KEY`, `HELIX_SIGNING_KEY`, `HELIX_JWT_SIGNING_KEY` present.

---

## Test coverage required

| Test | What to verify |
|---|---|
| `GET /.well-known/did.json` | Returns valid DID document with correct content-type |
| `POST /v1/vp/verify` without session | Returns 410 Gone with SDK redirect message |
| `POST /v1/vp/verify` with `session: true` | Returns session JWT as before |
| Enrollment flow | Full onboarding still works end to end |
| `POST /v1/vc/revoke` | Revokes VC, updates StatusList file |
| Removed endpoints | `POST /v1/vp/template` returns 404 |
| Removed endpoints | `POST /v1/delegate` returns 404 |
