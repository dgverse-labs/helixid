# Shared image for the consent demo's seed, service providers, and agent.
# Build context: the parent directory containing all four split repos
# (see docker-compose.yml's `context: ../../..`).
#
# @helixid/sdk-js and @helixid/widget are declared as git dependencies
# (github:helixid/helix-sdk-js, pinned via pnpm-workspace.yaml's allowBuilds)
# because helix-sdk-js isn't published to a registry yet. That repo is
# currently *private*, so a plain `pnpm install` can't clone it here -- there
# are no git credentials in this image, and baking a PAT into a layer isn't
# something we do for a local demo image.
#
# TODO(helixid/helix-sdk-js visibility): once helix-sdk-js is made public,
# delete the vendoring below, restore `context: ../..` /
# `dockerfile: examples/e2e-consent-demo/docker/node.Dockerfile` in
# docker-compose.yml, and go back to a plain `pnpm install`.
#
# Until then: vendor the already-built sibling packages in directly, the
# same way the pre-split monorepo Dockerfile did, and point this package's
# two SDK deps at those local copies for the duration of this build only.
FROM node:24.15.0-alpine

RUN corepack enable
ENV NODE_OPTIONS=--dns-result-order=ipv4first

WORKDIR /repo

# Copy the workspace metadata and only the packages used by this demo.
COPY helix-server/pnpm-workspace.yaml helix-server/package.json helix-server/pnpm-lock.yaml helix-server/tsconfig.base.json helix-server/
COPY helix-server/examples/e2e-consent-demo helix-server/examples/e2e-consent-demo

# Vendored, pre-built sibling packages (built via `pnpm --filter @helixid/sdk-js
# build` / `pnpm --filter @helixid/widget build` in the helix-sdk-js repo).
# Only dist/ + package.json are needed -- consumers resolve via "main"/"exports".
COPY helix-sdk-js/helix-sdk-js/dist helix-sdk-js/helix-sdk-js/dist
COPY helix-sdk-js/helix-sdk-js/package.json helix-sdk-js/helix-sdk-js/package.json
COPY helix-sdk-js/widget/dist helix-sdk-js/widget/dist
COPY helix-sdk-js/widget/package.json helix-sdk-js/widget/package.json

# Drop "scripts" (notably "prepare": "npm run build") from the vendored
# package.jsons -- dist/ is already built, and there's no src/ or
# devDependencies here for a rebuild to work against.
RUN node -e "for (const p of ['helix-sdk-js/helix-sdk-js', 'helix-sdk-js/widget']) { const f = p + '/package.json'; const j = require('./' + f); delete j.scripts; require('fs').writeFileSync(f, JSON.stringify(j, null, 2)); }"

# Point the demo's two SDK deps at the vendored local copies instead of the
# (currently unreachable) git spec, for this build only -- doesn't touch the
# committed package.json.
RUN cd helix-server/examples/e2e-consent-demo && \
    npm pkg set "dependencies.@helixid/sdk-js=file:../../../helix-sdk-js/helix-sdk-js" \
                "dependencies.@helixid/widget=file:../../../helix-sdk-js/widget"

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.cache/node \
    cd helix-server && pnpm install --no-frozen-lockfile \
  --filter @helixid/example-e2e-consent-demo

WORKDIR /repo/helix-server/examples/e2e-consent-demo
CMD ["pnpm", "run", "agent"]
