# helixid production image — self-hosted HelixID server. Fully standalone:
# `docker build .` from this repo alone, no sibling-repo checkout needed.
#
# @helixid/did-hedera is declared as a pnpm git dependency
# (github:helixid/helix-sdk-js#path:did-hedera, see pnpm-workspace.yaml's
# allowBuilds), but that repo is currently *private* -- a plain `docker
# build` has no git credentials for it. Pass one via the
# HELIXID_CROSS_REPO_TOKEN build secret (same PAT used by CI, see
# .github/workflows/ci.yml):
#
#   docker build --secret id=cross_repo_token,env=HELIXID_CROSS_REPO_TOKEN -t helixid .
#
# Once helix-sdk-js is public, or these packages are published to a
# registry, the --mount=type=secret step below can be dropped.

FROM node:24.15.0-alpine AS builder

WORKDIR /app
RUN corepack enable
# better-sqlite3 has a native (node-gyp) build step.
RUN apk add --no-cache python3 make g++ git

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY e2e/package.json ./e2e/

RUN --mount=type=secret,id=cross_repo_token \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    sh -c '\
      if [ -f /run/secrets/cross_repo_token ]; then \
        TOKEN=$(cat /run/secrets/cross_repo_token); \
        git config --global --add url."https://${TOKEN}@github.com/".insteadOf "https://github.com/"; \
      fi; \
      pnpm install --frozen-lockfile \
    '

COPY src src
COPY tests tests
COPY prisma prisma
COPY tsconfig.json tsconfig.build.json vitest.config.ts prisma.config.ts ./

RUN pnpm run build

FROM node:24.15.0-alpine AS runner

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/server.js"]
