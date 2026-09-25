#!/bin/bash
# Usage: okta-api.sh <METHOD> <API_PATH> [JSON_BODY]
# Reads credentials from ~/.okta/okta.yaml so the token never appears in shell arguments.
#
# Examples:
#   okta-api.sh GET /idps
#   okta-api.sh GET /users/me
#   okta-api.sh DELETE /idps/0oa123abc
#   okta-api.sh POST /idps '{"type":"OIDC","name":"My IDP",...}'
#   okta-api.sh PUT /idps/0oa123abc "$(cat body.json)"

set -euo pipefail

METHOD="${1:-GET}"
API_PATH="${2:-/users/me}"
BODY="${3:-}"

CONFIG="$HOME/.okta/okta.yaml"

if [ ! -f "$CONFIG" ]; then
  echo "Error: Okta config not found at $CONFIG. Run 'okta login' or set up ~/.okta/okta.yaml." >&2
  exit 1
fi

ORG_URL=$(grep 'orgUrl:' "$CONFIG" | awk '{print $2}' | tr -d '"')
TOKEN=$(grep 'token:' "$CONFIG" | awk '{print $2}' | tr -d '"')

if [ -z "$ORG_URL" ] || [ -z "$TOKEN" ]; then
  echo "Error: Could not parse orgUrl or token from $CONFIG" >&2
  exit 1
fi

CURL_ARGS=(
  -s
  -X "$METHOD"
  -H "Authorization: SSWS $TOKEN"
  -H "Accept: application/json"
  -H "Content-Type: application/json"
)

if [ -n "$BODY" ]; then
  CURL_ARGS+=(-d "$BODY")
fi

curl "${CURL_ARGS[@]}" "${ORG_URL}/api/v1${API_PATH}"
