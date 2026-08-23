# Proposal: HelixID-hosted default instance (Item #1)

Status: **Proposal — not yet decided/approved.** Written to unblock discussion,
not to lock in an architecture.

## The model, in one sentence

HelixID (the company) runs and operates one public instance of `helix-server`
that anyone can use for free by default, exactly the same way anyone can
self-host their own instance — the hosted instance is not a separate product
with its own control plane, licensing, or tenant-authorization layer. It is
"self-hosted, except we did the hosting for you."

This replaces an earlier framing (server/console enrolling against a
licensed control plane) that turned out to be solving a problem that doesn't
exist yet — there's no multi-tenant SaaS product being proposed here, just a
shared, open, hosted endpoint.

## What this means concretely

- **Default API base URL.** When `API_BASE_URL` / `VITE_API_BASE_URL` is not
  configured, console/SDK/CLI point at HelixID's hosted instance instead of
  failing to boot or requiring local setup. (Item #2, already in
  [PR #28](../../pull/28), ships the config-level placeholder for this —
  `DEFAULT_HOSTED_API_BASE_URL` — pending the real hosted URL.)
- **Enrollment stays exactly as it is today.** The existing bootstrap-token
  agent-enrollment flow (`helix-api/src/services/agent/agent.service.ts`) is
  reused unmodified — a bootstrap token is generated (currently via the admin
  API / CLI) and consumed to onboard an agent. The only difference on the
  hosted instance is that these calls hit HelixID's servers instead of a
  self-hosted one. **No new server-to-server trust, licensing, or
  control-plane authorization model needs to be built.**
- **Console** works the same way against the hosted instance as it does
  self-hosted — same admin API key model, same enrollment UI, just pointed
  at a different `API_BASE_URL`. It gets a "use HelixID hosted" option that
  sets `apiBaseUrl` to the hosted default instead of requiring
  `VITE_API_BASE_URL` to be set.

## Decided: accounts, login, and DID/key custody

The hosted instance needs a real account system (self-hosted deployments
don't, since `HELIX_ADMIN_API_KEY` covers a single operator). Decided
approach — deliberately kept as a regular app login rather than anything
DID-specific, since there's no W3C standard for accounts/sessions and
inventing one adds complexity for no benefit here:

**Account model.** Plain `Account` table: `id`, `email` (unique),
`passwordHash` (nullable — null if Google-only), `googleId` (nullable),
`createdAt`. Password hashing via argon2id.

**Google login.** Standard OAuth2/OIDC. Match an incoming Google sign-in to
an existing account by `googleId` first, falling back to a match on
(Google-verified) email. A user who registered with a password and later
uses "Sign in with Google" on the same email lands on the same account —
no separate confirmation step required, since Google guarantees the email
is verified.

**DID auto-provisioning.** On first account creation (whichever path —
password or Google), auto-provision one issuer DID server-side:
- `did:web:hosted.helixid.io:accounts:<accountId>` (Option B from the
  earlier discussion — per-account path-based DID under HelixID's own
  domain, no setup required from the user).
- Keypair generated server-side; the user never sees or handles it.
- **The DID Document lives in the hosted database**, served dynamically at
  `GET /accounts/:accountId/did.json` — this matches the `did:web` spec
  directly (a DID with path segments resolves straight to that path).

**Private key storage (interim, pre-KMS).** New `IssuerKeyRecord` table:
`accountId`, `did`, `encryptedPrivateKey`, `iv`, `authTag`, `algorithm`,
`createdAt`. AES-256-GCM, one master key from an env var (same pattern as
today's `HELIX_SIGNING_KEY`) encrypting every row. This is explicitly an
**interim, single-shared-key model** — anyone with that one env var can
decrypt every account's key. Accepted trade-off for now, not a hidden gap.

To avoid this being a bigger lift later: all encrypt/decrypt/sign
operations go through a small internal interface
(`encrypt` / `decrypt` / `sign`) rather than being called directly at each
call site. Swapping in real KMS + per-tenant envelope encryption and key
rotation later becomes a one-file change instead of a hunt-and-replace
across the codebase. **KMS-backed custody and key rotation are explicitly
deferred, not designed here — marked as a fast-follow.**

**Sessions: access + refresh tokens.**
- **Access token** — short-lived JWT (~15 min), signed with a server
  secret, carries `accountId` + scope. Sent as `Authorization: Bearer
  <token>`. Stateless — verified per-request, nothing stored server-side.
- **Refresh token** — long-lived (~30 days), an opaque random string
  (not a JWT), stored **hashed** in a `RefreshToken` table: `id`,
  `accountId`, `tokenHash`, `expiresAt`, `revokedAt`,
  `replacedByTokenId`, `createdAt`. Mirrors the existing
  `hashToken`-style pattern already used for enrollment tokens in
  `agent.service.ts`.
- `POST /v1/auth/refresh` validates the refresh token hash, issues a new
  access token, and **rotates** the refresh token (old one marked
  `revokedAt`, pointing at the new one via `replacedByTokenId`).
- **Reuse detection**: if an already-revoked refresh token is presented
  again, treat it as a compromise signal — revoke all refresh tokens for
  that account, forcing re-login everywhere.
- Logout revokes the current refresh token.

**Rough endpoint list:**
- `POST /v1/auth/register` — email + password → creates `Account`, then
  auto-provisions DID/key → returns access + refresh tokens
- `POST /v1/auth/login` — email + password → access + refresh tokens
- `GET /v1/auth/google` / `GET /v1/auth/google/callback` — OAuth flow →
  find-or-create `Account` → access + refresh tokens
- `POST /v1/auth/refresh` — rotate refresh token, issue new access token
- `GET /accounts/:accountId/did.json` — public DID Document resolution

**Still explicitly open before implementation:**
1. **Abuse / rate limiting** — see
   [`proposal-hosted-rate-limiting.md`](./proposal-hosted-rate-limiting.md).
2. **KMS-backed key custody and rotation** — deferred by design, see above.

## Decided: data retention & ownership

- **Ownership.** The account holder owns their data; HelixID custodies it
  (same framing as private key custody above) — not "HelixID owns
  everything created on the hosted instance."
- **Default on account deletion.** Personal account fields (`email`,
  `passwordHash`, `googleId`) are cleared. DIDs, issued VCs, and status
  lists are **not** purged by default and VCs remain active/verifiable —
  deleting these would break the core promise that a VC stays resolvable
  and checkable by third parties long after issuance, regardless of what
  the issuing account later does.
- **User-initiated full purge is a separate, explicit action.** Clearing
  personal fields is the default outcome of "delete my account." Beyond
  that, the account holder can separately request either:
  - full deletion of their data from the hosted database, or
  - revocation of all VCs they've issued (via the existing status-list
    revocation mechanism, not deletion — a revoked VC is still resolvable,
    it just verifies as revoked)

  These are opt-in, user-initiated actions, not something triggered
  automatically by account deletion.

