# Working HelixID API image for the demo.
#
# Why this exists instead of the repo-root Dockerfile: two pre-existing problems
# in helix-api make the shipped path unusable as-is —
#   1. the repo-root Dockerfile runs `pnpm deploy --prod`, which prunes the
#      generated Prisma client, so the API crash-loops on `import { PrismaClient }`;
#   2. `pnpm --filter @helixid/api build` (tsc) currently fails to compile on main
#      (e.g. src/services/vc/vc.service.ts duplicate `listVCs` / `ListVCsFilters`
#      typo, src/routes/audit/index.ts `findMany`), so there is no clean `dist/`.
# So this image runs the API from source with tsx (transpile-only) — the same way
# the repo's own `dev` script runs it — after generating the Prisma client in
# place. helix-api itself is not modified. Build context: repo root.
#
#   docker build -f examples/e2e-travel-concierge/docker/api.Dockerfile -t helixid-api-demo .
FROM node:24.15.0-alpine

# better-sqlite3 (native) and Prisma need these on musl.
RUN apk add --no-cache python3 make g++ openssl libc6-compat
RUN corepack enable
# Prefer IPv4 for package downloads (some Docker VM networks have flaky IPv6).
ENV NODE_OPTIONS=--dns-result-order=ipv4first

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY helix-api/package.json ./helix-api/
COPY helix-core/package.json ./helix-core/
COPY helix-sdk-js/package.json ./helix-sdk-js/
COPY packages/did-hedera/package.json ./packages/did-hedera/

# Select each package we build explicitly so their devDependencies (e.g.
# @types/node for the tsc builds) are installed, not just @helixid/api's runtime deps.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/node \
    pnpm install --frozen-lockfile \
  --filter @helixid/core \
  --filter @helixid/did-hedera \
  --filter @helixid/sdk-js \
  --filter @helixid/api

COPY helix-core ./helix-core
COPY helix-sdk-js ./helix-sdk-js
COPY packages/did-hedera ./packages/did-hedera
RUN pnpm --filter @helixid/core build \
  && pnpm --filter @helixid/did-hedera build \
  && pnpm --filter @helixid/sdk-js build

COPY helix-api ./helix-api
# Generate the Prisma client in place (kept in node_modules; not pruned). We do
# NOT run tsc — the API is started from source with tsx below.
RUN pnpm --filter @helixid/api exec prisma generate

EXPOSE 3000
WORKDIR /app/helix-api
# tsx transpiles TS on the fly (no type-check), which is how the repo runs the
# API in dev. Sidesteps the broken tsc build while staying 100% the real API.
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
