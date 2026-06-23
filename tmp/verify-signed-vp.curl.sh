#!/usr/bin/env sh
API_BASE_URL="${HELIX_API_URL:-http://localhost:3000}"
SIGNED_VP_FILE="$(cd "$(dirname "$0")" && pwd)/signed-vp.json"

# Always request session bridge mode from API.
# API /v1/vp/verify returns 410 unless "session": true is provided.

SIGNED_VP_JSON="$(cat "$SIGNED_VP_FILE")"

curl -X POST "$API_BASE_URL/v1/vp/verify" \
  -H "content-type: application/json" \
  --data-binary "{\"signedVP\":${SIGNED_VP_JSON},\"session\":true}"
