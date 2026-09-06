# Shared image for the two Python services (mcp-server, agent). They differ
# only by which entrypoint runs, so compose overrides the command per
# service. Python port of ../../e2e-travel-concierge/docker/node.Dockerfile.
#
# Build context: the parent directory containing all four split repos (see
# docker-compose.yml's `context: ../../..`) -- helix-sdk-py is a sibling
# repo, installed locally (editable) rather than from PyPI (not published
# yet). Unlike the JS example's node.Dockerfile, there's no private-repo
# git-dependency problem here: it's a plain local `pip install -e`.
FROM python:3.11-slim

WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching.
COPY helix-server/examples/e2e-travel-concierge-py/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# helix-sdk-py, editable install. The `mcp` extra pulls in the official MCP
# SDK the mcp_server package uses for the wire protocol.
COPY helix-sdk-py helix-sdk-py
RUN pip install --no-cache-dir -e "./helix-sdk-py[mcp-middleware]"

# The demo itself.
COPY helix-server/examples/e2e-travel-concierge-py helix-server/examples/e2e-travel-concierge-py

WORKDIR /repo/helix-server/examples/e2e-travel-concierge-py
# Default command; docker-compose overrides it per service.
CMD ["python", "-m", "agent.server"]
