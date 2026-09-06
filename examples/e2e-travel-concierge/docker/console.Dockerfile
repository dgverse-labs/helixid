# Console image for the demo. Same build as helix-console's own Dockerfile,
# but bakes in this example's nginx config (which same-origin-proxies /v1 to
# helix-api so the browser can read the audit log without CORS). Baking it in —
# rather than bind-mounting — means `docker compose up` works regardless of the
# host's Docker Desktop file-sharing settings.
#
# Build context: the parent directory containing all four split repos (see
# docker-compose.yml's `context: ../../..`). helix-console is a standalone
# repo now — no @helixid/sdk-js/core dependency (its admin-API types are
# local, see helix-console/src/api/types.ts) — so unlike node.Dockerfile,
# nothing needs vendoring here.
FROM node:24.15.0-alpine AS build
RUN corepack enable
ENV NODE_OPTIONS=--dns-result-order=ipv4first
WORKDIR /repo
COPY helix-console .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/node \
    pnpm install --frozen-lockfile
RUN pnpm run build

FROM nginx:1.27-alpine
# Runtime env → env-config.js (unchanged from the repo image).
COPY helix-console/docker/40-env-config.sh /docker-entrypoint.d/40-env-config.sh
RUN chmod +x /docker-entrypoint.d/40-env-config.sh
COPY --from=build /repo/dist /usr/share/nginx/html
# This example's server block (serves the SPA + proxies /v1 and /health to helix-api).
COPY helix-server/examples/e2e-travel-concierge/docker/console-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
