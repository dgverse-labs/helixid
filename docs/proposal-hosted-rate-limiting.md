# Proposal: Rate limiting & abuse prevention for the hosted instance

Status: **Proposal — not yet decided/approved.**

Companion to [`proposal-hosted-instance.md`](./proposal-hosted-instance.md).
That doc covers accounts, login, and DID/key custody; this one covers
protecting the hosted instance from abuse once accounts exist. Only
applies when `HOSTED_MODE` is enabled — self-hosted operators should not
have hosted-tier limits forced on them.

Ordered by build priority (cheapest / highest-leverage first).

## 1. Per-IP rate limiting

First line of defense, doesn't depend on accounts existing yet.

- `@fastify/rate-limit` applied globally across the hosted API — a coarse
  ceiling (e.g. 100 req/min/IP) to blunt basic scripted abuse before it
  reaches auth or business logic.
- Tighter, endpoint-specific limits on the brute-force/credential-stuffing
  targets:
  - `POST /v1/auth/login` — e.g. 5/min/IP
  - `POST /v1/auth/register` — e.g. 3/hour/IP
  - `POST /v1/auth/refresh` — e.g. 20/min/IP

This is the cheapest control to ship and closes the worst brute-force risk
immediately, with no dependency on anything else in this doc.

## 3. Bot resistance on account creation

Highest-leverage control after per-IP limiting, since the account is the
unit abuse scales through — stopping cheap account creation stops most
downstream abuse before it starts.

- **CAPTCHA on `POST /v1/auth/register`** (Cloudflare Turnstile is a
  reasonable default — privacy-respecting, no Google dependency given
  Google OAuth is already a separate login path).
- **Email verification required before an account can issue its first
  VC or generate its first enrollment token.** Doesn't stop a determined
  attacker, but kills throwaway-email spam cheaply and is a normal
  expectation for any account-based product.

## 2. Per-account quotas

Addresses a different threat than the two controls above: not "a bot
hitting an endpoint," but "an authenticated, human-verified account
issuing VCs or enrollment tokens at abusive volume."

- Quotas tied to `accountId`, e.g.:
  - VC issuance: N/day on a free account
  - Enrollment token generation: N/day per account
- Enforced by counting existing audit log rows
  (`AuditEvents.ENROLLMENT_TOKEN_GENERATED`, VC-issuance events, etc.) in a
  rolling window. The audit log already records these events — this is a
  query against existing data, not new logging infrastructure.
- Because these events are already timestamped and account-scoped, the
  same data can later feed anomaly detection (flagging accounts with
  volume far outside the normal distribution for manual review) rather
  than only hard-capping. Not needed for v1, but worth keeping in mind so
  nothing here needs to change shape to support it later.

## Sequencing note

(1) requires no dependencies and should ship first. (3) requires the
account/registration flow from `proposal-hosted-instance.md` to exist.
(2) requires the audit-log query logic to be built out, which is more
work than (1) or (3) — hence last despite quotas being conceptually the
most direct protection against product-level abuse.
