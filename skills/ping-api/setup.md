# PingOne Credential Setup

Credentials are read from `~/.ping/ping.yaml`. Create it manually:

```yaml
ping:
  environment_id: <your-pingone-environment-id>
  client_id: <your-worker-app-client-id>
  client_secret: <your-worker-app-client-secret>
  region: NA
```

**Region codes:** `NA` (default), `EU`, `CA`, `AP`, `AU`

These map to API domains:
| Region | Auth Domain | API Domain |
|--------|-------------|------------|
| NA | auth.pingone.com | api.pingone.com |
| EU | auth.pingone.eu | api.pingone.eu |
| CA | auth.pingone.ca | api.pingone.ca |
| AP | auth.pingone.asia | api.pingone.asia |
| AU | auth.pingone.com.au | api.pingone.com.au |

## Getting Credentials

1. Log in to the **PingOne Admin Console**
2. Go to **Applications > Applications**
3. Create a **Worker** application (or use an existing one):
   - Grant type: `client_credentials`
   - Enable it
4. Copy the **Client ID**, **Client Secret**, and **Environment ID** into the config above

The Worker app needs appropriate admin roles assigned (e.g., Environment Admin, Identity Data Admin) depending on what APIs you need to call.

## Verifying Setup

```bash
scripts/ping-api.sh GET /users?limit=1 | jq '.'
```

If you see a JSON response with `_embedded.users`, credentials are working.
