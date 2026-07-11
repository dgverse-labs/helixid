# Console image for the demo. Same build as the repo's console/Dockerfile, but
# bakes in this example's nginx config (which same-origin-proxies /v1 to
# helix-api so the browser can read the audit log without CORS). Baking it in —
# rather than bind-mounting — means `docker compose up` works regardless of the
# host's Docker Desktop file-sharing settings. Build context: repo root.
FROM node:24.15.0-alpine AS build
RUN corepack enable
ENV NODE_OPTIONS=--dns-result-order=ipv4first
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY helix-core helix-core
COPY helix-sdk-js helix-sdk-js
COPY console console
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/node \
    pnpm install --frozen-lockfile --filter @helixid/console...
RUN pnpm --filter @helixid/core build \
  && pnpm --filter @helixid/sdk-js build \
  && pnpm --filter @helixid/console exec vite build

FROM nginx:1.27-alpine
# Runtime env → env-config.js (unchanged from the repo image).
COPY console/docker/40-env-config.sh /docker-entrypoint.d/40-env-config.sh
RUN chmod +x /docker-entrypoint.d/40-env-config.sh
COPY --from=build /repo/console/dist /usr/share/nginx/html
# This example's server block (serves the SPA + proxies /v1 and /health to helix-api).
COPY examples/e2e-travel-concierge/docker/console-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
