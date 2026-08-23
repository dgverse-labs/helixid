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
  at a different `API_BASE_URL`.

## Open questions (need real answers before implementation)

1. **Multi-tenancy / isolation.** Today's data model (DIDs, VCs, enrollment
   tokens, audit log) has no tenant/owner boundary — it assumes one operator
   per deployment. A shared public instance means many unrelated
   users/agents landing in the same database. Do we need:
   - a `tenantId`/`ownerId` column across the relevant tables, or
   - full logical isolation per account (separate DB or schema per tenant)?
2. **Admin API key model doesn't scale to "available for all."**
   `HELIX_ADMIN_API_KEY` is currently a single shared secret per deployment.
   A public hosted instance needs per-user/per-account credentials instead.
   This likely means a real user/account system, which doesn't exist yet.
3. **Abuse / rate limiting.** A free public instance is a target for abuse
   (spam enrollment, VC issuance at volume, etc.). Needs a rate-limiting and
   quota story before going live.
4. **Issuer DID.** Self-hosted deployments each mint their own issuer DID
   (`did:web:<their-domain>`). On a shared hosted instance, whose DID signs
   issued VCs — HelixID's, or does each account get its own issuer DID
   namespaced under the hosted domain (e.g. `did:web:hosted.helixid.io:<accountId>`)?
5. **Data retention / ownership.** Who owns data created via the free hosted
   instance, and what are the retention/deletion guarantees?

## Recommended next step

(1)–(4) above are the real blockers, and they're product/business decisions
as much as engineering ones (in particular #2 and #4 imply a minimal account
system needs to exist before "available for all" is safe to ship). Suggest
resolving those before writing enrollment or console code specifically for
the hosted case — until then, item #2's config-level fallback is the safe,
buildable slice, and this doc's job is to make sure item #1 doesn't get
implemented against a stale ("licensed control plane") mental model.
