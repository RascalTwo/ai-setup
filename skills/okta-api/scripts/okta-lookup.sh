#!/bin/bash
# Usage: okta-lookup.sh <keyword>
# Fetches (and caches) the Okta Management OpenAPI spec and greps it for the given keyword.
# Useful for discovering API paths, request bodies, and response schemas.
#
# Examples:
#   okta-lookup.sh idp
#   okta-lookup.sh "/api/v1/groups"
#   okta-lookup.sh IdentityProvider

set -euo pipefail

KEYWORD="${1:-}"
if [ -z "$KEYWORD" ]; then
  echo "Usage: okta-lookup.sh <keyword>" >&2
  exit 1
fi

CACHE_DIR="${HOME}/.okta/spec-cache"
SPEC_FILE="${CACHE_DIR}/management-minimal.yaml"
SPEC_URL="https://raw.githubusercontent.com/okta/okta-management-openapi-spec/master/dist/current/management-minimal.yaml"

mkdir -p "$CACHE_DIR"

# Refresh if missing or older than 7 days
if [ ! -f "$SPEC_FILE" ] || find "$SPEC_FILE" -mtime +7 | grep -q .; then
  echo "Fetching Okta OpenAPI spec..." >&2
  curl -sf "$SPEC_URL" -o "$SPEC_FILE"
fi

grep -n "$KEYWORD" "$SPEC_FILE"
