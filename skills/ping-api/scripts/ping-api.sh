#!/bin/bash
# Usage: ping-api.sh [--raw] <METHOD> <API_PATH> [JSON_BODY]
# Reads credentials from ~/.ping/ping.yaml so secrets never appear in shell arguments.
# Obtains and caches a bearer token via client_credentials grant.
#
# Default mode: API_PATH is relative to /v1/environments/{environmentId}
#   ping-api.sh GET /users
#   ping-api.sh GET /users/abc-123
#   ping-api.sh POST /users '{"email":"user@example.com",...}'
#   ping-api.sh DELETE /users/abc-123
#
# Raw mode (--raw): API_PATH is relative to /v1 (no environment prefix)
#   ping-api.sh --raw GET /organizations
#   ping-api.sh --raw GET /environments

set -euo pipefail

RAW_MODE=false
if [ "${1:-}" = "--raw" ]; then
  RAW_MODE=true
  shift
fi

METHOD="${1:-GET}"
API_PATH="${2:-/users}"
BODY="${3:-}"

CONFIG="$HOME/.ping/ping.yaml"

if [ ! -f "$CONFIG" ]; then
  echo "Error: PingOne config not found at $CONFIG. See setup.md for instructions." >&2
  exit 1
fi

ENV_ID=$(grep 'environment_id:' "$CONFIG" | awk '{print $2}' | tr -d '"')
CLIENT_ID=$(grep 'client_id:' "$CONFIG" | awk '{print $2}' | tr -d '"')
CLIENT_SECRET=$(grep 'client_secret:' "$CONFIG" | awk '{print $2}' | tr -d '"')
REGION=$(grep 'region:' "$CONFIG" | awk '{print $2}' | tr -d '"')
REGION="${REGION:-NA}"

if [ -z "$ENV_ID" ] || [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "Error: Could not parse environment_id, client_id, or client_secret from $CONFIG" >&2
  exit 1
fi

# Map region to domains
case "$REGION" in
  EU) DOMAIN="pingone.eu" ;;
  CA) DOMAIN="pingone.ca" ;;
  AP) DOMAIN="pingone.asia" ;;
  AU) DOMAIN="pingone.com.au" ;;
  *)  DOMAIN="pingone.com" ;;
esac

AUTH_URL="https://auth.${DOMAIN}/${ENV_ID}/as/token"
API_BASE="https://api.${DOMAIN}/v1"

# --- Token caching ---
TOKEN_CACHE="$HOME/.ping/token-cache.json"

get_cached_token() {
  if [ ! -f "$TOKEN_CACHE" ]; then
    return 1
  fi
  EXPIRES_AT=$(jq -r '.expires_at // 0' "$TOKEN_CACHE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  if [ "$NOW" -lt "$EXPIRES_AT" ]; then
    jq -r '.access_token' "$TOKEN_CACHE"
    return 0
  fi
  return 1
}

fetch_new_token() {
  RESPONSE=$(curl -s -X POST "$AUTH_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -u "${CLIENT_ID}:${CLIENT_SECRET}" \
    -d "grant_type=client_credentials")

  ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token // empty')
  EXPIRES_IN=$(echo "$RESPONSE" | jq -r '.expires_in // 3600')

  if [ -z "$ACCESS_TOKEN" ]; then
    echo "Error: Failed to obtain access token. Response:" >&2
    echo "$RESPONSE" >&2
    exit 1
  fi

  NOW=$(date +%s)
  EXPIRES_AT=$((NOW + EXPIRES_IN - 60))  # 60s buffer

  jq -n --arg token "$ACCESS_TOKEN" --argjson expires "$EXPIRES_AT" \
    '{"access_token": $token, "expires_at": $expires}' > "$TOKEN_CACHE"

  echo "$ACCESS_TOKEN"
}

TOKEN=$(get_cached_token || fetch_new_token)

# --- Build URL ---
if [ "$RAW_MODE" = true ]; then
  URL="${API_BASE}${API_PATH}"
else
  URL="${API_BASE}/environments/${ENV_ID}${API_PATH}"
fi

# --- Make API call ---
CURL_ARGS=(
  -s
  -X "$METHOD"
  -H "Authorization: Bearer $TOKEN"
  -H "Accept: application/json"
  -H "Content-Type: application/json"
)

if [ -n "$BODY" ]; then
  CURL_ARGS+=(-d "$BODY")
fi

curl "${CURL_ARGS[@]}" "$URL"
