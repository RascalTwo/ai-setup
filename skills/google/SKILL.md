---
name: google
description: "Gmail, Google Calendar, Drive, Docs and Sheets across all of the user's Google accounts via the gws CLI. Use for any email, calendar, or Drive task, \"my inbox\", \"check my personal email\", or when an account is named."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    google: gmail, calendar, drive, docs and sheets apis
  requires:
    commands: [gws]
    manual: ["A Desktop-app OAuth client per Google Cloud project your accounts can use (see Adding an account in SKILL.md)"]
---

# Google via gws

Every Google task runs through the `gws` CLI, one config dir per account. The claude.ai Google connectors are single-account, so this skill replaces them.

## Accounts

Read [`accounts.json`](accounts.json) first: it maps each alias to an email, the words the user says for it (`heard_as`), and per-account `notes`. Missing? Copy [`accounts.example.json`](accounts.example.json) and fill it in with the user (see **Adding an account**).

Pick the account:

- **Named** (any `heard_as` word, alias, or email) → that account.
- **Unnamed read** (search, "did I get…", agenda) → query every account and label each result with its alias.
- **Unnamed write** (send, reply, create, edit, delete, accept) → ask which account first.

## Running

```bash
GOOGLE_APPLICATION_CREDENTIALS=/dev/null/none GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-<alias> gws <service> ...
```

Both vars, every call. The first stops gws borrowing a quota project from gcloud's ADC file, which 403s ("Caller does not have required permission to use project") for accounts outside that project.

Learn commands from `gws <service> --help`; reach for the `+` helpers first (`gws gmail +triage`, `+read`, `+send`, `+reply`). Raw API calls pass path params as JSON, never positionally: `--params '{"userId":"me","id":"<msgId>"}'`, body via `--json '{...}'`.

## Login

On `invalid_grant` / 401, or for a new account, run in the background, `open` the printed URL, and have the user approve:

```bash
G=https://www.googleapis.com/auth; GOOGLE_APPLICATION_CREDENTIALS=/dev/null/none GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-<alias> gws auth login --scopes $G/gmail.modify,$G/calendar,$G/drive,$G/documents,$G/spreadsheets
```

Scopes must be full URLs; bare names like `gmail` get rejected by Google.

## Adding an account

1. `mkdir -m 700 ~/.config/gws-<alias>` and put a Desktop-app OAuth `client_secret.json` in it.
   - The client's Google Cloud project must allow the account: an org-internal project rejects outside accounts with `org_internal`. Personal Gmail accounts need an external project; in production (unverified) avoids the 7-day refresh-token expiry of testing mode.
   - If the account isn't a member of that project, delete `project_id` from its `client_secret.json`, or calls 403 on quota.
   - Enable each API (Gmail, Calendar, Drive, Docs, Sheets) in that project.
2. Run **Login**, then verify with `gws gmail users getProfile --params '{"userId":"me"}'`.
3. Add the alias to `accounts.json`, recording the client and any quirks in `notes`.

## Gotchas

- **One account per dir is the only multi-account mechanism.** gws 0.22 removed `--account`, `auth list` and `GOOGLE_WORKSPACE_CLI_ACCOUNT`; docs online still show them.
- **Install via Homebrew** (`brew install googleworkspace-cli`); an nvm-scoped npm install vanishes on Node switches.
