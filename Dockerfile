FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY helix-api/package.json ./helix-api/
COPY helix-core/package.json ./helix-core/
COPY helix-sdk-js/package.json ./helix-sdk-js/
COPY e2e/package.json ./e2e/
COPY examples/package.json ./examples/
COPY examples/framework-middleware/package.json ./examples/framework-middleware/
COPY packages/cli/package.json ./packages/cli/
COPY packages/did-hedera/package.json ./packages/did-hedera/
COPY packages/langchain/package.json ./packages/langchain/
COPY packages/mcp/package.json ./packages/mcp/

RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.base.json ./

COPY helix-core ./helix-core
COPY helix-sdk-js ./helix-sdk-js
COPY packages/did-hedera ./packages/did-hedera

RUN pnpm --filter @helixid/core build
RUN pnpm --filter @helixid/did-hedera build
RUN pnpm --filter @helixid/sdk-js build

COPY helix-api ./helix-api

RUN pnpm --filter @helixid/api build

# Create a self-contained deployment with all production deps resolved (no workspace symlinks)
RUN pnpm --filter @helixid/api deploy --prod /app/deploy

# `pnpm deploy` re-resolves dependencies from the store rather than copying node_modules,
# so it drops the .prisma/client output that `prisma generate` wrote during the build step
# above. Regenerate it directly into the deploy output using the still-present dev CLI
# (helix-api/node_modules is discarded when only /app/deploy is copied into the runner stage).
RUN cd /app/deploy && /app/helix-api/node_modules/.bin/prisma generate


FROM node:24-alpine AS runner

WORKDIR /app

COPY --from=builder /app/deploy ./helix-api

EXPOSE 3000

CMD ["node", "helix-api/dist/server.js"]