#!/bin/sh
# Generates env-config.js from the container's environment at startup so a
# single pre-built Console image can run against any stack (dev spec §6).
# The official nginx image runs every /docker-entrypoint.d/*.sh script
# before starting nginx.
#
# API_BASE_URL must be reachable from the operator's browser (e.g.
# http://localhost:4000), NOT the internal Docker DNS name — the browser,
# not this container, makes the API calls.
set -eu

: "${API_BASE_URL:?API_BASE_URL is required (host-reachable helix-api URL)}"
: "${ADMIN_API_KEY:?ADMIN_API_KEY is required}"

# CONSOLE_USERNAME / CONSOLE_PASSWORD gate the client-side login (default
# admin / admin). This is an access gate, not a security boundary — the
# ADMIN_API_KEY above still ships to the browser.
CONSOLE_USERNAME="${CONSOLE_USERNAME:-admin}"
CONSOLE_PASSWORD="${CONSOLE_PASSWORD:-admin}"

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__HELIXID_CONFIG__ = {
  API_BASE_URL: "${API_BASE_URL}",
  ADMIN_API_KEY: "${ADMIN_API_KEY}",
  CONSOLE_USERNAME: "${CONSOLE_USERNAME}",
  CONSOLE_PASSWORD: "${CONSOLE_PASSWORD}"
};
EOF
