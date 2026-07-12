---
name: okta-api
description: Call the Okta REST API to inspect or manage Okta resources (identity providers, users, groups, apps, policies, etc.). Use when the user asks to list, get, create, update, or delete anything in their Okta org via the API.
---

Call the Okta REST API using scripts in this skill directory. Credentials are read from `~/.okta/okta.yaml` — the token never appears in tool calls.

See `setup.md` in this skill directory if credentials are not configured.

## Making API Calls

Always use `scripts/okta-api.sh` — never inline the token in a curl command:

```bash
scripts/okta-api.sh <METHOD> <API_PATH> [JSON_BODY] | jq '.'

# Examples:
scripts/okta-api.sh GET /users/me | jq '.'
scripts/okta-api.sh DELETE /idps/0oa123abc
scripts/okta-api.sh POST /groups '{"profile":{"name":"My Group","description":""}}'
scripts/okta-api.sh PUT /idps/0oa123abc "$(cat body.json)"
```

## Looking Up API Documentation

Okta publishes an official OpenAPI spec on GitHub (`okta/okta-management-openapi-spec`). Use `scripts/okta-lookup.sh` to search it without loading the full 80k-line spec into context:

```bash
# Find paths and schemas for a resource
scripts/okta-lookup.sh "/api/v1/idps" | head -30
scripts/okta-lookup.sh "IdentityProvider" | head -40

# Read the spec around a specific line for full context
# (use Read tool with offset/limit on ~/.okta/spec-cache/management-minimal.yaml)
```

The spec is cached at `~/.okta/spec-cache/management-minimal.yaml` and auto-refreshed after 7 days.

## Pagination

Okta paginates large result sets via `Link` response headers. Add a `limit` param to control page size:

```bash
scripts/okta-api.sh GET /users?limit=200 | jq '.[].profile.login'
```
