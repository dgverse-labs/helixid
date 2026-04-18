# STORY 0 — Project Bootstrap & Setup

## Overview

Initialize the Helix ID monorepo. After this story is complete, every package exists with correct structure, TypeScript compiles, linting passes, tests run (with nothing to test yet), and the Docker Compose stack starts cleanly. No application logic is written in this story. This is purely scaffolding, tooling, and skeleton code.

**Definition of Done for Story 0:**

- `npm install` at root succeeds
- `npm run build` compiles all packages without errors (Turborepo ensures helix-core builds before dependents)
- `npm run lint` passes across all packages
- `npm run test` runs and exits cleanly (zero tests = zero failures)
- `docker-compose up` starts PostgreSQL and the API container without errors
- `.env.example` is complete and accurate
- `decisions.md` has its first entries (project initialization, Turborepo, Fastify, crypto library choices)
- `turbo.json` is present at root and task graph is correct

---

## 0.1 — Root Monorepo Scaffold

### `/package.json`

```json
{
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
```

No application code lives here. Scripts only.

### `/turbo.json`

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

`dependsOn: ["^build"]` means: before running `build` for this package, run `build` for all packages it depends on. This guarantees helix-core is built before helix-api and helix-sdk-js.

### `/.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### `/.gitignore`

```
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
```

### `/.env.example`

```bash
# ─── Hedera ───────────────────────────────────────────────────────────────────
# Network to connect to. Allowed values: testnet, previewnet
# mainnet is only permitted when NODE_ENV=production
HEDERA_NETWORK=testnet

# Hedera operator account ID (format: 0.0.XXXXXX)
HEDERA_OPERATOR_ID=0.0.123456

# Hedera operator private key (ED25519 or ECDSA — hex or DER encoded)
# This key pays for all HCS transactions. Never share or commit this value.
HEDERA_OPERATOR_KEY=302e...

# Hedera HCS topic ID used to anchor DID documents (format: 0.0.XXXXXX)
# Create this topic manually on testnet before first run.
# With Hiero DID SDK this may be managed automatically — see Story 1.
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
```

---

## 0.2 — helix-core Package Scaffold

### Install

```bash
cd helix-core
npm init -y
npm install --save-dev typescript @types/node vitest @vitest/coverage-v8 eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install zod
```

### `helix-core/tsconfig.json`

```json
{
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
```

### `helix-core/package.json`

```json
{
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
```

### Folder structure to create (empty files / placeholder exports)

```
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
```

`helix-core/src/index.ts` — barrel export:

```typescript
export * from './config/index.js';
export * from './crypto/index.js';
export * from './schemas/index.js';
export * from './errors/index.js';
export * from './audit/index.js';
export * from './status-list/index.js';
```

---

## 0.3 — helix-api Package Scaffold

### Install

```bash
cd helix-api
npm install fastify @fastify/sensible zod @prisma/client
npm install --save-dev typescript @types/node vitest @vitest/coverage-v8 supertest @types/supertest prisma eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser ts-node
npm install @helix-id/core  # workspace reference
```

### `helix-api/tsconfig.json`

Same strict options as helix-core, rootDir `./src`.

### `helix-api/package.json` scripts

```json
{
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
```

### Folder structure

```
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
```

### `helix-api/src/server.ts` — bare minimum Fastify server

```typescript
import Fastify from 'fastify';

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
```

### Prisma setup

`helix-api/prisma/schema.prisma` — skeleton only (full schema defined per story):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

---

## 0.4 — helix-sdk-js Package Scaffold

### Install

```bash
cd helix-sdk-js
npm install @helix-id/core
npm install --save-dev typescript @types/node vitest @vitest/coverage-v8 eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

### Folder structure

```
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
```

---

## 0.5 — e2e Package Scaffold

```
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
```

---

## 0.6 — Docker Compose

### `/docker-compose.yml`

```yaml
version: '3.9'

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
```

### `/docker-compose.test.yml`

```yaml
version: '3.9'

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
      - /var/lib/postgresql/data
```

### `helix-api/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY turbo.json ./
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
```

---

## 0.7 — ESLint Setup

### `/.eslintrc.base.json`

```json
{
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
```

The `no-restricted-syntax` rule enforces EV-1 — no direct `process.env` access outside the config module.

---

## 0.8 — GitHub Actions CI

### `/.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: helixid_test
          POSTGRES_PASSWORD: helixid_test
          POSTGRES_DB: helixid_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Check no security tests are skipped
        run: |
          if grep -r "test\.skip\|xit\|it\.todo\|describe\.skip" \
            helix-api/tests/security \
            helix-sdk-js/tests/security 2>/dev/null; then
            echo "ERROR: Skipped tests found in security test directories"
            exit 1
          fi

      - name: Test
        run: npm run test
        env:
          DATABASE_URL: postgresql://helixid_test:helixid_test@localhost:5433/helixid_test
          NODE_ENV: test
          HEDERA_NETWORK: testnet
          HEDERA_OPERATOR_ID: ${{ secrets.HEDERA_OPERATOR_ID }}
          HEDERA_OPERATOR_KEY: ${{ secrets.HEDERA_OPERATOR_KEY }}
          HEDERA_TOPIC_ID: ${{ secrets.HEDERA_TOPIC_ID }}
          HELIX_SIGNING_KEY: ${{ secrets.HELIX_SIGNING_KEY }}
          API_BASE_URL: http://localhost:3000
          ENROLLMENT_TOKEN_TTL_SECONDS: 900
          CHALLENGE_TTL_SECONDS: 300
          VP_TTL_SECONDS: 300
          AUDIT_LOG_DESTINATION: stdout

      - name: Audit dependencies
        run: npm audit --audit-level=high
```

---

## Story 0 Acceptance Criteria

- [ ] `npm install` from root installs all workspaces cleanly
- [ ] `npm run build` from root compiles all packages — zero TypeScript errors — Turborepo task graph ensures helix-core builds first
- [ ] `npm run lint` from root — zero errors
- [ ] `npm run test` from root — exits 0 (empty test suites are fine)
- [ ] `docker-compose up` — postgres and api containers start, `/health` returns `{"status":"ok"}`
- [ ] `.env.example` has every variable listed with a description
- [ ] `turbo.json` is present with correct task graph
- [ ] `decisions.md` has initial entries for monorepo + Turborepo, Fastify, crypto library choices, Hiero DID SDK
- [ ] `CONSTITUTION.md` is present at root
- [ ] No application logic exists anywhere — only structure, config, and placeholder exports
- [ ] ESLint `no-restricted-syntax` rule blocks direct `process.env` access
- [ ] `.turbo/` is in `.gitignore`
- [ ] GitHub Actions CI workflow is present and runs cleanly
