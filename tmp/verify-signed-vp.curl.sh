API_BASE_URL="http://localhost:3000"
SIGNED_VP_REQUEST_FILE="$(cd "$(dirname "$0")" && pwd)/signed-vp-request.json"

curl -X POST "$API_BASE_URL/v1/vp/verify" \
  -H "content-type: application/json" \
  --data-binary @"$SIGNED_VP_REQUEST_FILE"
