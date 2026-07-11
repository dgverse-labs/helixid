# Shared image for the three Node services (helixid-setup, mcp-server, agent).
# They live in one workspace package and differ only by which entrypoint runs,
# so compose overrides the command per service. Build context: repo root.
#
#   docker build -f examples/e2e-travel-concierge/docker/node.Dockerfile -t helixid-v2-node .
FROM node:24.15.0-alpine
RUN corepack enable
# Prefer IPv4 for package downloads (some Docker VM networks have flaky IPv6).
ENV NODE_OPTIONS=--dns-result-order=ipv4first
WORKDIR /repo

# Manifests first for layer caching, then the sources this example builds against.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY helix-core helix-core
COPY helix-sdk-js helix-sdk-js
COPY packages/mcp packages/mcp
COPY examples/e2e-travel-concierge examples/e2e-travel-concierge

# Select the packages we build explicitly (not just example...) so their
# devDependencies — notably @types/node for the tsc builds below — are installed.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/node \
    pnpm install --frozen-lockfile \
  --filter @helixid/core \
  --filter @helixid/sdk-js \
  --filter @helixid/mcp \
  --filter @helixid/example-e2e-travel-concierge

# Build the local HelixID packages this example imports (@helixid/mcp pulls in
# @helixid/core and @helixid/sdk-js).
RUN pnpm --filter @helixid/core build \
  && pnpm --filter @helixid/sdk-js build \
  && pnpm --filter @helixid/mcp build

WORKDIR /repo/examples/e2e-travel-concierge
# Default command; docker-compose overrides it with `pnpm setup|mcp|agent`.
CMD ["pnpm", "run", "agent"]
