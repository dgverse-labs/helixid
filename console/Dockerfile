# HelixID Console — pre-built static SPA served by nginx.
# Build from the repository root (the console depends on the workspace
# @helixid/sdk-js package):
#
#   docker build -f console/Dockerfile -t helixid-console .
#
# Run with runtime configuration (dev spec §6 — the same image works in any
# environment; nothing is baked in at build time):
#
#   docker run -p 8080:80 \
#     -e API_BASE_URL=http://localhost:4000 \
#     -e ADMIN_API_KEY=... \
#     helixid-console

FROM node:24.15.0-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY helix-core helix-core
COPY helix-sdk-js helix-sdk-js
COPY console console
RUN pnpm install --frozen-lockfile --filter @helixid/console...
RUN pnpm --filter @helixid/core build \
  && pnpm --filter @helixid/sdk-js build \
  && pnpm --filter @helixid/console exec vite build

FROM nginx:1.27-alpine
COPY console/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY console/docker/40-env-config.sh /docker-entrypoint.d/40-env-config.sh
RUN chmod +x /docker-entrypoint.d/40-env-config.sh
COPY --from=build /repo/console/dist /usr/share/nginx/html
