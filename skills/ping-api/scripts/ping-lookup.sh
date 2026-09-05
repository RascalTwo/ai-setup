#!/bin/bash
# Usage: ping-lookup.sh <keyword>
# Fetches (and caches) the PingOne Platform API OpenAPI spec and greps it for the given keyword.
# Useful for discovering API paths, request bodies, and response schemas.
#
# Examples:
#   ping-lookup.sh users
#   ping-lookup.sh "/environments"
#   ping-lookup.sh Application
#   ping-lookup.sh signOnPolicies

set -euo pipefail

KEYWORD="${1:-}"
if [ -z "$KEYWORD" ]; then
  echo "Usage: ping-lookup.sh <keyword>" >&2
  exit 1
fi

CACHE_DIR="${HOME}/.ping/spec-cache"
SPEC_FILE="${CACHE_DIR}/pingone-platform.yaml"
SPEC_URL="https://raw.githubusercontent.com/pingidentity/pingone-api-specs/main/pingone-platform.yaml"
# Fallback URL if primary doesn't exist
SPEC_URL_ALT="https://raw.githubusercontent.com/patrickcping/pingone-go-sdk-v2/main/management/api/openapi.yaml"

mkdir -p "$CACHE_DIR"

# Refresh if missing or older than 7 days
if [ ! -f "$SPEC_FILE" ] || find "$SPEC_FILE" -mtime +7 | grep -q .; then
  echo "Fetching PingOne API spec..." >&2
  if ! curl -sf "$SPEC_URL" -o "$SPEC_FILE" 2>/dev/null; then
    echo "Primary spec URL unavailable, trying alternative..." >&2
    if ! curl -sf "$SPEC_URL_ALT" -o "$SPEC_FILE" 2>/dev/null; then
      echo "Error: Could not fetch PingOne API spec from either source." >&2
      echo "You can manually place an OpenAPI spec at $SPEC_FILE" >&2
      exit 1
    fi
  fi
fi

grep -n "$KEYWORD" "$SPEC_FILE"
