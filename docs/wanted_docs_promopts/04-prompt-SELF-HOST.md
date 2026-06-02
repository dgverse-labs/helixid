# Prompt — SELF-HOST.md

You have full context of the Helix ID codebase including helix-api, helix-core,
helix-sdk-js, and any existing docs/. Write docs/SELF-HOST.md for the Helix ID
repository.

## What this document is

A complete operational guide for running Helix ID yourself. Written for an operator
who is comfortable with Node, Postgres, and environment configuration but has never
set up a Hedera-connected service before. A reader who follows this document should
arrive at a running Helix ID instance they fully understand and control.

## Tone and style

- Task-oriented. Every section moves the reader forward.
- Be explicit about why each configuration decision exists, not just what to set.
- Do not assume Hedera knowledge. Explain every Hedera concept as it appears.
- Use code blocks for every command, environment variable, and file path.
- Where a decision has security implications, say so inline — do not defer to
  a separate security section.

## Sections to write

### 1. Prerequisites

#### 1.1 Node Version
The exact Node version required. How to verify. Why this version.

#### 1.2 Postgres
The minimum Postgres version. What Helix ID uses it for at a high level.
No schema detail here — that belongs in section 4.

#### 1.3 Hedera Account and Credentials
What a Hedera account is, why it is needed, how to create one on testnet.
Link to the Hedera portal. Explain operator account ID and private key
without assuming the reader has used Hedera before.

#### 1.4 Environment Overview
A one-paragraph summary of what environment configuration controls.
Tell the reader they will fill in a .env file and explain what
happens if a required value is missing.

### 2. Hedera Setup

#### 2.1 Creating a Hedera Account
Step by step. Testnet account creation via the Hedera portal. What the reader
receives: an account ID (format: 0.0.XXXXX) and a private key.

#### 2.2 Getting Testnet Credentials
Where to find the account ID and private key after creation. How to fund a
testnet account with test HBAR. Why test HBAR is needed (HCS message fees).

#### 2.3 Creating an HCS Topic
What an HCS topic is: an ordered, append-only log on Hedera that Helix ID writes
DID operations to. How to create one using the Hedera CLI or SDK. What the topic
ID looks like (format: 0.0.XXXXX). Why Helix ID needs its own dedicated topic.

#### 2.4 Testnet vs Mainnet Decision
When to use testnet: development, evaluation, running examples.
When to move to mainnet: production deployments with real agents.
What changes between them: network name in config, real HBAR costs,
finality guarantees. What does not change: the code, the API, the behavior.

### 3. Environment Configuration

#### 3.1 Full Variable Reference

##### 3.1.1 Database
DATABASE_URL: format, example, what Prisma does with it.

##### 3.1.2 Hedera Operator
HEDERA_OPERATOR_ID: the account ID that pays for HCS transactions.
HEDERA_OPERATOR_KEY: the private key for that account.
HEDERA_NETWORK: testnet or mainnet.

##### 3.1.3 HCS Topic
HEDERA_TOPIC_ID: the topic Helix ID writes DID operations to.
What happens if this topic already has messages from a previous deployment.

##### 3.1.4 Helix VC Signing Key
HELIX_SIGNING_KEY: the Ed25519 private key Helix ID uses to sign every VC it issues.
HELIX_ISSUER_DID: the DID Helix ID presents as the VC issuer.
Why these are separate from the Hedera operator credentials.
Security note: this key signs every VC in the system. A compromised
HELIX_SIGNING_KEY means an attacker can forge credentials for any agent.
Treat it as the most sensitive credential in the entire deployment.

##### 3.1.5 Helix JWT Signing Key
HELIX_JWT_SIGNING_KEY: the Ed25519 private key Helix ID uses to sign Session JWTs.
This key is always a different value from HELIX_SIGNING_KEY — they sign different
artifacts and must never share the same key material. Explain what a Session JWT
is in one sentence and why a separate key is required: a compromised JWT key
allows forging session tokens; a compromised VC signing key allows forging
credentials. Rotating one should not require rotating the other.
Security note: treat this key with the same care as HELIX_SIGNING_KEY.

##### 3.1.6 Admin API Key
HELIX_ADMIN_KEY: the bearer token for admin endpoints (enrollment token creation,
revocation). How to generate a secure random value. What an attacker can do with
this key: enroll rogue agents, revoke legitimate credentials.

#### 3.2 Generating the Issuer DID and Signing Keys
Step-by-step commands to generate:
1. The issuer keypair and DID (HELIX_SIGNING_KEY and HELIX_ISSUER_DID)
2. The JWT signing keypair (HELIX_JWT_SIGNING_KEY) — a separate generation step

Use tools available in helix-core or helix-sdk-js. What each output value maps
to in the environment configuration. Where to store these values securely.
Emphasise: run the generation command twice to produce two independent keypairs.
Never reuse the same key for both variables.

#### 3.3 Secrets Management Recommendations
Do not commit .env to version control. Use a secrets manager in production.
Which variables are safe to log (HEDERA_NETWORK, HELIX_ISSUER_DID) and which
are never logged (HELIX_SIGNING_KEY, HELIX_JWT_SIGNING_KEY, HELIX_ADMIN_KEY,
HEDERA_OPERATOR_KEY). Rotation procedure overview for each sensitive key.

### 4. Database Setup

#### 4.1 Running Migrations
The exact command. What Prisma does during migration. How to verify migration success.
What to do if a migration fails partway through.

#### 4.2 What Each Table Stores
A plain English description of each table's purpose. Not the schema — just what
the data represents and why it exists. Cover: enrollment tokens, DIDs, issued VCs,
StatusList entries, service registry records, VP replay records (consumed vpIds),
challenge nonces, and audit logs.

### 5. Running the API

#### 5.1 Development Mode
The command. What development mode enables that production mode does not:
verbose logging, auto-reload. When to use it.

#### 5.2 Production Mode
The command. What to set differently from development. Process management
recommendation (pm2, systemd, or Docker). Why a raw Node process is not
appropriate for production.

#### 5.3 Health Check Endpoint
The URL. What it returns. How to use it to verify the instance is running
and connected to both Postgres and Hedera.

### 6. First Boot Checklist
A numbered checklist the reader can follow to verify a fresh installation
is working correctly before enrolling any agents. Each item is a concrete
action with an expected outcome.

### 7. Docker Compose Setup
Note that this is planned but not yet available in the current release.
Describe what it will provide when available: single command to bring up
Helix ID, Postgres, and all dependencies. Link to the GitHub issue or
roadmap if one exists. Do not fabricate a docker-compose.yml that does
not exist in the repo.

### 8. Verifying the Installation

#### 8.1 Resolving the Issuer DID
The API call to make. The expected response shape. What a failure means.

#### 8.2 Creating a Test Enrollment Token
The API call to make using the HELIX_ADMIN_KEY. The expected response.
How to use the token in the next step.

#### 8.3 Running the Live Tests
The command to run the live test suite in helix-api/tests/live.
What credentials are needed. What the tests cover. Expected output on success.
Note that these tests spend testnet HBAR.

### 9. Upgrading
How to upgrade to a new version: pull latest, run migrations, restart.
What to check in the changelog before upgrading. How to roll back if
a migration causes problems.

### 10. Troubleshooting

#### 10.1 Hedera Connection Failures
Symptoms. Likely causes: wrong network, wrong operator key, insufficient HBAR.
How to diagnose each.

#### 10.2 DID Anchoring Timeout
Why it happens: HCS message propagation delay. How long to wait.
How to check if the message was received on Hedera.

#### 10.3 Database Migration Errors
Common causes. How to inspect the Prisma migration state.
How to reset the database in a development environment.

#### 10.4 StatusList Endpoint Not Reachable
Why verifiers need this endpoint to be publicly reachable if they are not
on the same network as Helix ID. What to check: firewall rules, reverse proxy
configuration, the URL embedded in issued VCs.

#### 10.5 Session JWT Verification Failures
Why a verifier might get JWT verification failures after a key rotation.
How to instruct verifiers to re-fetch the public key from
`GET /v1/sessions/public-key` after a HELIX_JWT_SIGNING_KEY rotation.

## Constraints

- Read the actual package.json scripts, prisma schema, and .env.example
  before writing. Do not invent command names or variable names.
- Every command must be accurate against the actual repo.
- HELIX_SIGNING_KEY and HELIX_JWT_SIGNING_KEY must both be documented as
  separate, required variables. Never suggest they can be the same value.
- Do not describe API endpoints in detail. Link to the OpenAPI spec.
- Where Docker Compose is mentioned, be honest that it does not exist yet.
  Do not write a placeholder compose file.
