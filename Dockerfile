# helixid production image — self-hosted HelixID server. Fully standalone:
# `docker build .` from this repo alone, no sibling-repo checkout needed.
#
#   docker build -t helixid .

FROM node:24.15.0-alpine AS builder

WORKDIR /app
RUN corepack enable
# better-sqlite3 has a native (node-gyp) build step; git is needed because
# @helixid/core, @helixid/sdk-js, and @helixid/did-hedera are pnpm git
# dependencies (all public repos under github.com/helixid, so no
# credentials are needed to fetch them).
RUN apk add --no-cache python3 make g++ git

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY e2e/package.json ./e2e/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

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
