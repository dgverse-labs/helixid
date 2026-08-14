# Shared image for the consent demo's seed, service providers, and agent.
# Build context: repository root.
FROM node:24.15.0-alpine

RUN corepack enable
ENV NODE_OPTIONS=--dns-result-order=ipv4first

WORKDIR /repo

# Copy the workspace metadata and only the packages used by this demo.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY helix-core helix-core
COPY helix-sdk-js helix-sdk-js
COPY packages/widget packages/widget
COPY examples/e2e-consent-demo examples/e2e-consent-demo

# Include each buildable workspace package explicitly so its devDependencies
# (notably TypeScript and Node types) are installed in the image.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/node \
    pnpm install --frozen-lockfile \
  --filter @helixid/core \
  --filter @helixid/sdk-js \
  --filter @helixid/widget \
  --filter @helixid/example-e2e-consent-demo

# Workspace packages expose their compiled dist output to consumers.
RUN pnpm --filter @helixid/core build \
  && pnpm --filter @helixid/sdk-js build \
  && pnpm --filter @helixid/widget build

WORKDIR /repo/examples/e2e-consent-demo
CMD ["pnpm", "run", "agent"]
