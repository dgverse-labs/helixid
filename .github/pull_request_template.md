## Summary

<!-- One or two sentences: what does this PR do and why? -->

Closes #<!-- issue number -->

---

## Type of Change

<!-- Check all that apply -->

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that changes existing behavior)
- [ ] 🔐 Security fix / hardening
- [ ] 🏗️ Refactor / architecture change
- [ ] 📝 Documentation update
- [ ] 🧪 Tests only
- [ ] 🔧 DevOps / infra / CI change

---

## Context & Motivation

<!-- Why is this change needed? Link to specs, issues, design docs, or ADRs if available.
     For identity/agent-related changes, briefly describe the trust or credential flow impacted. -->

---

## Changes Made

<!-- Bullet list of what changed. Be specific — files, modules, interfaces, schemas. -->

- 
- 
- 

---

## Identity & Security Checklist

<!-- HelixID-specific. Check all that apply, or mark N/A. -->

- [ ] DID/VC schema changes are backward-compatible or versioned
- [ ] Credential issuance / verification logic reviewed for correctness
- [ ] No private keys, seeds, or secrets introduced in code or config
- [ ] Agent identity scopes / delegation rules are not unintentionally widened
- [ ] Auth flows (token, VP, API key replacement) are not regressed
- [ ] Audit log / telemetry events added or updated where relevant
- [ ] Rate limits or abuse vectors considered for any new endpoints

---

## Testing

<!-- Describe how you tested this. Include commands if non-obvious. -->

**Test coverage:**
- [ ] Unit tests added / updated
- [ ] Integration tests added / updated
- [ ] Manual testing performed (describe below)

**Manual test steps:**
1. 
2. 
3. 

**Edge cases considered:**
<!-- e.g., expired VCs, revoked DIDs, malformed JWTs, offline resolver, agent acting outside scope -->

---

## Breaking Changes & Migration

<!-- If this is a breaking change, describe what downstream consumers (agents, issuers, verifiers, SDKs) need to do. -->

N/A

---

## Deployment Notes

<!-- Any infra, config, env var, or DB migration steps needed before/after merge. -->

- [ ] No deployment changes required
- [ ] Env var(s) added: `<!-- VAR_NAME -->`
- [ ] DB / schema migration required: <!-- describe -->
- [ ] Infra / Helm / Terraform change required: <!-- describe -->

---

## Documentation

- [ ] README updated
- [ ] API / OpenAPI spec updated
- [ ] Credential schema / context file updated
- [ ] Changelog entry added
- [ ] No docs needed

---

## Reviewer Notes

<!-- Anything specific you want reviewers to focus on, concerns, known trade-offs, or areas of uncertainty. -->

---

## Screenshots / Diagrams (if applicable)

<!-- For flows, agent handshakes, or UI changes — paste a sequence diagram, screenshot, or flow sketch. -->
