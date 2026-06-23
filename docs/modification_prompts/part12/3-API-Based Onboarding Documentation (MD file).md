Create docs/API-ONBOARDING.md in the HelixID monorepo. This document is for Platform Operators who need automated, scalable agent onboarding via the self-hosted helix-api. It covers when to use the API vs CLI, and the full API-based onboarding flow.
Structure the document as follows:
When to use the API vs CLI

A table comparing CLI and API across: volume (single agent vs bulk), automation (manual vs programmatic), audit trail, webhook support, revocation automation. Conclusion: CLI for getting started, API for production at scale.
Prerequisites

Running helix-api instance (link to SELF-HOST.md). Issuer DID created via helix did create. StatusList created via helix status-list create. HELIX_ADMIN_API_KEY configured.
Onboarding flow — step by step

Show the full 13-step enrollment sequence with actual HTTP requests and responses for each step:

Platform Operator creates enrollment token via POST /v1/enrollment-tokens
Enrollment token delivered to agent out of band
Agent SDK calls client.requestOnboardingChallenge(token, domains)
Agent SDK calls client.completeOnboarding(challengeId, nonce, passphrase, walletPath)
API anchors DID, issues VC, returns wallet-ready credential
Agent calls AgentWallet.load() — ready to present VPs

Show actual TypeScript code for the agent side using SDK. Show actual curl commands for the operator side. Show the VC structure that gets issued.
Revocation via API

POST /v1/vc/revoke with curl example. Explain that API updates StatusList file automatically. Compare to CLI revocation.
Bulk enrollment

Short section showing how to loop POST /v1/enrollment-tokens for multiple agents.
Replay protection integration

Deployment modes table

Keep all code samples TypeScript. All curl examples use localhost:3000. Link to relevant example files in examples/ where they exist.
