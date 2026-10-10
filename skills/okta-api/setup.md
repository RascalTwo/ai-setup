# Okta Credential Setup

Credentials are read from `~/.okta/okta.yaml`. Create it manually:

```yaml
okta:
  client:
    orgUrl: https://<your-org>.okta.com
    token: <your-api-token>
```

To get an API token:
1. Go to your Okta Admin Console → **Security → API → Tokens**
2. Click **Create Token**, give it a name
3. Copy the token value into the config above

Or run `okta login` if the Okta CLI is installed — it will write the config automatically.
