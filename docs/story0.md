Project Bootstrap & Setup
Overview
Initialize the Helix ID monorepo. After this story is complete, every package exists with correct structure, TypeScript compiles, linting passes, tests run (with nothing to test yet), and the Docker Compose stack starts cleanly. No application logic is written in this story. This is purely scaffolding, tooling, and skeleton code.
Definition of Done for Story 0:

npm install at root succeeds
`npm run build` compiles all packages without errors (Turborepo ensures helix-core builds before dependents)
npm run lint passes across all packages
npm run test runs and exits cleanly (zero tests = zero failures)
docker-compose up starts PostgreSQL and the API container without errors
.env.example is complete and accurate
decisions.md has its first entry (project initialization)


0.1 — Root Monorepo Scaffold
What to create
/package.json (workspace root)
json{
  "name": "helix-id",
  "private": true,
  "workspaces": ["helix-core", "helix-api", "helix-sdk-js", "e2e"],
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "test:e2e": "turbo run test --filter=e2e",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write \"**/*.{ts,json,md}\" --ignore-path .gitignore",
    "dev": "turbo run dev --parallel"
  },
  "devDependencies": {
    "prettier": "^3.x",
    "turbo": "^2.x"
  }
}
**`/turbo.json`**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "env": ["DATABASE_URL", "NODE_ENV", "HEDERA_NETWORK"]
    },
    "lint": {
      "dependsOn": [],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    }
  },
  "remoteCache": {
    "enabled": true
  }
}
```
No application code lives here. Scripts only.
/.prettierrc
json{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
/.gitignore
node_modules/
dist/
build/
.env
.env.local
.env.production
.env.test
*.env
coverage/
*.log
.DS_Store
.turbo/
prisma/generated/
/.env.example — complete, every variable documented
bash# ─── Hedera ───────────────────────────────────────────────────────────────────
# Network to connect to. Allowed values: testnet, previewnet
# mainnet is only permitted when NODE_ENV=production
HEDERA_NETWORK=testnet

# Hedera operator account ID (format: 0.0.XXXXXX)
HEDERA_OPERATOR_ID=0.0.123456

# Hedera operator private key (ED25519 or ECDSA — hex or DER encoded)
# This key pays for all HCS transactions. Never share or commit this value.
HEDERA_OPERATOR_KEY=302e...

# Hedera HCS topic ID used to anchor DID documents (format: 0.0.XXXXXX)
# Create this topic manually on testnet before first run
HEDERA_TOPIC_ID=0.0.654321

# ─── Database ─────────────────────────────────────────────────────────────────
# PostgreSQL connection string
DATABASE_URL=postgresql://helixid:helixid@localhost:5432/helixid

# ─── Helix ID Signing ─────────────────────────────────────────────────────────
# Private key used by Helix ID to sign VCs (hex-encoded Ed25519 private key)
# Generate with: node -e "const {generateKeyPair} = require('./helix-core'); console.log(generateKeyPair())"
HELIX_SIGNING_KEY=abc123...

# ─── API ──────────────────────────────────────────────────────────────────────
PORT=3000
API_BASE_URL=http://localhost:3000

# ─── Token / TTL Settings ─────────────────────────────────────────────────────
# Enrollment token validity window in seconds (default: 900 = 15 minutes)
ENROLLMENT_TOKEN_TTL_SECONDS=900

# Challenge nonce validity window in seconds (default: 300 = 5 minutes)
CHALLENGE_TTL_SECONDS=300

# VP expiry in seconds from time of template generation (default: 300 = 5 minutes)
VP_TTL_SECONDS=300

# ─── Audit Log ────────────────────────────────────────────────────────────────
# Where to write audit events. Allowed values: stdout, file, both
AUDIT_LOG_DESTINATION=stdout

# Required only when AUDIT_LOG_DESTINATION is file or both
AUDIT_LOG_PATH=./logs/audit.log

# ─── Environment ──────────────────────────────────────────────────────────────
NODE_ENV=development

# ─── E2E / Testing only ───────────────────────────────────────────────────────
# Set to true to allow E2E tests to write to Hedera testnet
# Never true in standard CI pipelines
HEDERA_E2E_TESTNET=false
/decisions.md
markdown# Helix ID — Architectural Decisions Log

This file is append-only. Every new dependency, every significant architectural decision,
and every deviation from the constitution is recorded here.

---

## 2025-XX-XX — Project initialization

**Decision:** Monorepo structure with npm workspaces.
**Reason:** Shared helix-core primitives needed by both API and SDK without publishing to npm registry during early development.
**Alternatives considered:** Separate repos with local npm link — rejected due to synchronisation overhead.
**Approved by:** [founder]

---

## 2025-XX-XX — Fastify chosen as HTTP framework

**Decision:** helix-api uses Fastify.
**Reason:** Schema-first, native TypeScript, JSON Schema on every route aligns with AC-4.
**Alternatives considered:** Express — rejected due to lack of built-in schema validation; Hono — rejected, less mature ecosystem for this use case.
**Approved by:** [founder]

---

## 2025-XX-XX — Turborepo for task orchestration

**Decision:** Turborepo added at project init for task graph caching and parallel execution.
**Reason:** helix-core is a shared dependency — Turborepo ensures build order is correct (helix-core builds before helix-api and helix-sdk-js). Remote cache via self-hosted turborepo-remote-cache prevents redundant CI builds.
**Alternatives considered:** Plain npm workspaces scripts — rejected because build order and cache invalidation must be managed manually as package count grows.
**Approved by:** [founder]

---

## 2025-XX-XX — @noble/curves and @noble/hashes for cryptography
**Decision:** Only @noble/curves and @noble/hashes are permitted for cryptographic operations in JS/TS packages.
**Reason:** Audited, maintained, no native dependencies, tree-shakeable.
**Alternatives considered:** node:crypto built-ins — insufficient for Ed25519 VP signing in browser-compatible SDK; tweetnacl — unmaintained.
**Approved by:** [founder]

0.2 — helix-core Package Scaffold
Install
bashcd helix-core
npm init -y
npm install --save-dev typescript @types/node vitest @vitest/coverage-v8 eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install zod
helix-core/tsconfig.json
json{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
helix-core/package.json
json{
  "name": "@helix-id/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit"
  }
}
Folder structure to create (empty files / placeholder exports)
helix-core/src/
├── config/
│   └── index.ts          # placeholder: export const config = {}
├── crypto/
│   └── index.ts          # placeholder: export {}
├── schemas/
│   └── index.ts          # placeholder: export {}
├── errors/
│   └── index.ts          # placeholder: export {}
├── audit/
│   └── index.ts          # placeholder: export {}
├── status-list/
│   └── index.ts          # placeholder: export {}
├── openapi/
│   └── openapi.yaml      # placeholder: openapi: "3.1.0" info: title: Helix ID
└── index.ts              # re-exports from all modules
helix-core/src/index.ts — barrel export:
typescriptexport * from './config/index.js';
export * from './crypto/index.js';
export * from './schemas/index.js';
export * from './errors/index.js';
export * from './audit/index.js';
export * from './status-list/index.js';

0.3 — helix-api Package Scaffold
Install
bashcd helix-api
npm install fastify @fastify/sensible zod @prisma/client
npm install --save-dev typescript @types/node vitest @vitest/coverage-v8 supertest @types/supertest prisma eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser ts-node
npm install @helix-id/core  # workspace reference
helix-api/tsconfig.json — same strict options as helix-core, rootDir ./src.
helix-api/package.json scripts:
json{
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node --esm src/server.ts",
    "test": "vitest run --coverage",
    "test:security": "vitest run tests/security",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:reset": "prisma migrate reset --force"
  }
}
Folder structure
helix-api/src/
├── routes/
│   ├── did/
│   │   └── index.ts      # placeholder: empty Fastify plugin
│   ├── vc/
│   │   └── index.ts
│   ├── vp/
│   │   └── index.ts
│   └── agent/
│       └── index.ts
├── services/
│   ├── did/
│   │   └── index.ts
│   ├── vc/
│   │   └── index.ts
│   ├── vp/
│   │   └── index.ts
│   └── agent/
│       └── index.ts
├── repositories/
│   └── index.ts
├── hedera/
│   ├── IHederaClient.ts  # interface only — see Story 1
│   └── mock/
│       └── MockHederaClient.ts
├── middleware/
│   ├── errorHandler.ts
│   └── requestLogger.ts
├── audit/
│   └── index.ts
└── server.ts
helix-api/src/server.ts — bare minimum Fastify server:
typescriptimport Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
Prisma setup
helix-api/prisma/schema.prisma — skeleton only (full schema defined in Story 1):
prismagenerator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

0.4 — helix-sdk-js Package Scaffold
Install
bashcd helix-sdk-js
npm install @helix-id/core
npm install --save-dev typescript @types/node vitest @vitest/coverage-v8 eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
Folder structure
helix-sdk-js/src/
├── client/
│   └── HelixClient.ts    # placeholder class with constructor
├── wallet/
│   └── AgentWallet.ts    # placeholder class
├── vp/
│   └── VPBuilder.ts      # placeholder
├── http/
│   └── HttpAdapter.ts    # placeholder
├── audit/
│   └── index.ts          # placeholder
└── index.ts              # export { HelixClient } from './client/HelixClient.js'

0.5 — e2e Package Scaffold
e2e/
├── tests/
│   ├── agent-onboarding.test.ts       # describe block only, no tests yet
│   ├── user-did-flow.test.ts
│   ├── vp-lifecycle.test.ts
│   ├── vp-replay-attack.test.ts
│   └── vc-revocation-flow.test.ts
├── helpers/
│   └── index.ts
├── package.json
└── tsconfig.json

0.6 — Docker Compose
/docker-compose.yml
yamlversion: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: helixid
      POSTGRES_PASSWORD: helixid
      POSTGRES_DB: helixid
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U helixid"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: helix-api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://helixid:helixid@postgres:5432/helixid
      HEDERA_NETWORK: testnet
      PORT: 3000
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env

volumes:
  postgres_data:
/docker-compose.test.yml — for CI:
yamlversion: '3.9'

services:
  postgres_test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: helixid_test
      POSTGRES_PASSWORD: helixid_test
      POSTGRES_DB: helixid_test
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data  # in-memory for speed
helix-api/Dockerfile
dockerfileFROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY helix-core/package*.json ./helix-core/
COPY helix-api/package*.json ./helix-api/
RUN npm ci
COPY helix-core ./helix-core
COPY helix-api ./helix-api
RUN npm run build --workspace=helix-core
RUN npm run build --workspace=helix-api
RUN cd helix-api && npx prisma generate

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/helix-core/dist ./helix-core/dist
COPY --from=builder /app/helix-api/dist ./helix-api/dist
COPY --from=builder /app/helix-api/prisma ./helix-api/prisma
EXPOSE 3000
CMD ["node", "helix-api/dist/server.js"]

0.7 — ESLint Setup (shared config)
/.eslintrc.base.json — root level, inherited by packages:
json{
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "rules": {
    "no-console": "warn",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "no-restricted-syntax": [
      "error",
      {
        "selector": "CallExpression[callee.object.name='process'][callee.property.name='env']",
        "message": "Do not access process.env directly. Use the config module from helix-core."
      }
    ]
  }
}
Note the no-restricted-syntax rule enforcing EV-1 — no direct process.env access.
CI grep rule for security tests — add to /.github/workflows/ci.yml:
yaml- name: Check no security tests are skipped
  run: |
    if grep -r "test\.skip\|xit\|it\.todo\|describe\.skip" \
      helix-api/tests/security \
      helix-sdk-js/tests/security 2>/dev/null; then
      echo "ERROR: Skipped tests found in security test directories"
      exit 1
    fi

Story 0 Acceptance Criteria

 npm install from root installs all workspaces cleanly
 npm run build from root compiles all packages — zero TypeScript errors
 npm run lint from root — zero errors
 npm run test from root — exits 0 (empty test suites are fine)
 docker-compose up — postgres and api containers start, /health returns {"status":"ok"}
 .env.example has every variable listed with a description
 decisions.md has initial entries for monorepo, Fastify, crypto library choices
 CONSTITUTION.md is present at root (copy from design document)
 No application logic exists anywhere — only structure, config, and placeholder exports
 ESLint no-restricted-syntax rule blocks direct process.env access