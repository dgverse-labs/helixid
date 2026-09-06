# Shared image for the four Python services (seed, sp-airline, sp-hotel,
# agent). They differ only by which module's __main__ runs, so compose
# overrides the command per service.
#
# Build context: the parent directory containing all four split repos (see
# docker-compose.yml's `context: ../../..`) -- helix-sdk-py is a sibling
# repo, installed locally (editable) rather than from PyPI (not published
# yet). Unlike the JS examples' node.Dockerfile, there's no private-repo
# git-dependency problem here: it's a plain local `pip install -e`.
FROM python:3.11-slim

WORKDIR /repo

# better-sqlite3-equivalent native deps aren't needed here -- pynacl and
# cryptography (helix-sdk-py's crypto deps) ship manylinux wheels.
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching.
COPY helix-server/examples/e2e-consent-demo-py/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# helix-sdk-py, editable install.
COPY helix-sdk-py helix-sdk-py
RUN pip install --no-cache-dir -e "./helix-sdk-py[dev]"

# @helixid/widget has no Python port -- its pre-built browser bundle is
# static assets, vendored the same way the JS examples' node.Dockerfile
# does (see sp_shared/serve.py's widget_dist_path).
COPY helix-sdk-js/widget/dist helix-sdk-js/widget/dist

# The demo itself.
COPY helix-server/examples/e2e-consent-demo-py helix-server/examples/e2e-consent-demo-py

WORKDIR /repo/helix-server/examples/e2e-consent-demo-py
# Default command; docker-compose overrides it per service.
CMD ["python", "-m", "agent.server"]
