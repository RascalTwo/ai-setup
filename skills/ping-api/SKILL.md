---
name: ping-api
description: Call the PingOne Management API to inspect or manage PingOne resources (users, populations, applications, groups, sign-on policies, resources, scopes, etc.). Use when the user asks to list, get, create, update, or delete anything in their PingOne environment via the API.
---

Call the PingOne Management API using scripts in this skill directory. Credentials are read from `~/.ping/ping.yaml` — secrets never appear in tool calls.

See `setup.md` in this skill directory if credentials are not configured.

## Making API Calls

Always use `scripts/ping-api.sh` — never inline credentials in a curl command:

```bash
scripts/ping-api.sh <METHOD> <API_PATH> [JSON_BODY] | jq '.'

# API_PATH is relative to /v1/environments/{environmentId}
# Examples:
scripts/ping-api.sh GET /users | jq '.'
scripts/ping-api.sh GET /users/abc-123-def
scripts/ping-api.sh GET /populations | jq '.'
scripts/ping-api.sh GET /applications | jq '.'
scripts/ping-api.sh GET /resources | jq '.'
scripts/ping-api.sh GET /signOnPolicies | jq '.'
scripts/ping-api.sh POST /users '{"email":"user@example.com","username":"jdoe","population":{"id":"pop-id"}}'
scripts/ping-api.sh PUT /users/abc-123-def '{"name":{"given":"Jane","family":"Doe"}}'
scripts/ping-api.sh DELETE /users/abc-123-def
```

For **non-environment** paths (org-level, schema, etc.), prefix the path with `--raw`:

```bash
# Raw mode: API_PATH is relative to /v1 (no environment prefix)
scripts/ping-api.sh --raw GET /organizations | jq '.'
scripts/ping-api.sh --raw GET /environments | jq '.'
```

## Looking Up API Documentation

Use `scripts/ping-lookup.sh` to search a cached copy of the PingOne Platform API spec:

```bash
# Find paths and schemas for a resource
scripts/ping-lookup.sh "users" | head -30
scripts/ping-lookup.sh "signOnPolicies" | head -40
scripts/ping-lookup.sh "Application" | head -40

# Read the spec around a specific line for full context
# (use Read tool with offset/limit on ~/.ping/spec-cache/pingone-platform.yaml)
```

The spec is cached at `~/.ping/spec-cache/pingone-platform.yaml` and auto-refreshed after 7 days.

## Pagination

PingOne paginates via `_links.next` in response bodies and supports `limit` and `cursor` params:

```bash
scripts/ping-api.sh GET '/users?limit=100' | jq '._embedded.users[].username'
```

## Token Caching

The script obtains a bearer token via client_credentials grant and caches it at `~/.ping/token-cache.json`. Tokens are reused until they expire (typically 1 hour). Delete the cache file to force a fresh token.

## Common Endpoints

| Resource | Path |
|---|---|
| Users | `/users` |
| Populations | `/populations` |
| Applications | `/applications` |
| Groups | `/groups` |
| Resources (APIs) | `/resources` |
| Resource Scopes | `/resources/{resId}/scopes` |
| Sign-on Policies | `/signOnPolicies` |
| Policy Actions | `/signOnPolicies/{policyId}/actions` |
| Identity Providers | `/identityProviders` |
| Schemas | `/schemas` |
| Branding Themes | `/brandingThemes` |
| Certificates | `/certificates` |
| Keys | `/keys` |
| Grants (per user) | `/users/{userId}/grants` |
| Role Assignments | `/users/{userId}/roleAssignments` |
