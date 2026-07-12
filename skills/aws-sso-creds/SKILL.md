---
name: aws-sso-creds
description: Obtain short-lived AWS credentials from any IAM Identity Center (SSO) portal via Chrome, into a shell-sourced dotenv. Use when the user asks for AWS credentials, to log into AWS, names an account or org, or a task needs AWS CLI access to an unauthenticated account. Also proactively when an aws CLI call fails with ExpiredToken, InvalidClientTokenId, UnrecognizedClientException, or Unable to locate credentials.
---

# AWS SSO credentials (any portal)

Fetches short-lived credentials from an IAM Identity Center portal and makes them
usable from the shell. Portal-agnostic: every portal-specific fact lives outside
this file, nothing is hardcoded here.

## Resolve the portal first

Portal facts — start URL, IdP, account IDs, cache prefix — come from one of two
places:

- **A per-org wrapper skill** invoked this one (e.g. a private `<org>-aws` skill
  that pins one portal and its accounts). If so, use the facts it handed you.
- **`portals.md`** in this directory, for portals registered directly here.

`portals.md` ships as a **template**. Keep real org data either in it (private
checkout) or in a dedicated wrapper skill — never commit real orgs to a public
copy of this skill.

Map what the user said — an org name, an account name, a bare "dev" — onto a
portal and an account. If the request is ambiguous, or names an account that
isn't listed, **ask**. Don't guess which AWS account to touch.

If the user names a portal you have no facts for, ask for its start URL, do the
run, then record it (in `portals.md` or the wrapper skill) so the next run is one
step shorter.

## Output contract

On success:

1. Credentials written to `~/.cache/aws-sso-creds/<portal>-<account>.env`, mode `600`.
2. Print the **path**, the **account ID from `sts get-caller-identity`**, and the
   expiry (~1 hour). Never the secrets.
3. Callers consume it by sourcing:

```bash
set -a && source ~/.cache/aws-sso-creds/<portal>-<account>.env && set +a && aws sts get-caller-identity
```

The Bash tool does not persist env between invocations, so either prefix every
`aws` call with that `source`, or put everything needing AWS in one bash block.

Print raw `export` lines only if the user explicitly asks for them.

## Workflow

### Step 0 — Load Chrome tools

One call, batched:

```
ToolSearch query: "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__find,mcp__claude-in-chrome__computer"
```

### Step 1 — Reach the portal, logged in

`tabs_context_mcp`, then navigate to the portal's start URL. Screenshot to see
where you landed.

- **On the IdP** (`login.microsoftonline.com`, Okta, etc.) → this is an SSO
  redirect, not fresh credential entry, so completing it is in scope. `find` the
  row for the user's account and click it. If it asks for a **password**, stop:
  the browser session expired and the user must sign in manually. Never type a
  password.
- **On the portal showing account tiles** → continue.

### Step 2 — Expand the account, open the credentials modal

Account rows are collapsed by default and the expand chevron is a small target;
clicking the account **name** is more reliable than the arrow. Then `find` the
`Access keys` link within that row.

**Verify you opened the right account before copying anything.** The modal states
the account name and ID:

```javascript
(() => {
  const dlgs = Array.from(document.querySelectorAll('[role="dialog"]'));
  for (const d of dlgs) {
    const m = d.textContent.match(/Create access for the account\s+(\S+?)\s*\((\d+)\)/);
    if (m) return `account=${m[1]} id=${m[2]}`;
  }
  return 'NO_CRED_DIALOG';
})();
```

If that returns the wrong account, close and re-open the correct tile. Portals
render several modals; a stale one can still be in the DOM.

### Step 3 — Copy, don't read

`find` the copy button for **Option 1: Set AWS environment variables** and click
it. This puts the three `export` lines on the clipboard, so the secrets never
enter the transcript.

Do **not** extract the values via `javascript_tool` and paste them into a bash
command — that round-trips live credentials through chat.

### Step 4 — Write the dotenv, then verify

One bash block. Two non-obvious bugs are handled here; both are real, both bite:

```bash
set -e
PORTAL=<portal>; ACCOUNT=<account>; EXPECT=<account-id>   # from portals.md / wrapper skill
OUT="$HOME/.cache/aws-sso-creds/${PORTAL}-${ACCOUNT}.env"

mkdir -p ~/.cache/aws-sso-creds && chmod 700 ~/.cache/aws-sso-creds
umask 077
# 1. The portal's code block is CRLF; a stray \r corrupts the Authorization
#    header and yields "Invalid header value".
# 2. The block has NO trailing newline, so appending AWS_REGION lands on the end
#    of AWS_SESSION_TOKEN and silently corrupts it -> InvalidClientTokenId.
#    The bare `echo` supplies the missing newline.
{ pbpaste | tr -d '\r' | sed -E 's/^export //; s/"//g'; echo; echo "AWS_REGION=us-east-1"; } > "$OUT"
chmod 600 "$OUT"

set -a; source "$OUT"; set +a
ACCT=$(aws sts get-caller-identity --query Account --output text)
[ "$ACCT" = "$EXPECT" ] || { echo "WRONG ACCOUNT: got $ACCT, expected $EXPECT"; exit 1; }
echo "ok: $ACCT -> $OUT (valid ~1 hour)"
```

On Linux, replace `pbpaste` with `xclip -o -selection clipboard` (or `wl-paste`).

If something looks wrong, inspect **lengths, never values**:

```bash
awk -F= 'NF{printf "%s len=%d\n", $1, length($0)-length($1)-1}' "$OUT"
# expect: AWS_ACCESS_KEY_ID len=20, AWS_SECRET_ACCESS_KEY len=40,
#         AWS_SESSION_TOKEN len~1000, AWS_REGION len=9
```

A session token ending in `-east-1` means bug #2 bit you.

### Step 5 — Hand off

Tell the caller: prefix each `aws` call with
`set -a && source ~/.cache/aws-sso-creds/<portal>-<account>.env && set +a && ...`,
or wrap the dependent chain in one bash block that sources once at the top.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Invalid header value ... \r` | CRLF in the pasted block. `tr -d '\r'`. |
| `InvalidClientTokenId` right after writing | Missing trailing newline merged `AWS_REGION` into the session token. |
| `ExpiredToken` / `UnrecognizedClientException` later | ~1 hour TTL. Re-run this skill. |
| `get-caller-identity` returns a different account | Wrong tile, or a stale modal in the DOM. Verify with the Step 2 snippet. |
| Password prompt on the IdP | Session expired. User signs in manually; never type a password. |
| Can't find `Access keys` | Portal renamed elements. `read_page` with `filter: "interactive"`, look for "access"/"key". Ask if ambiguous. |

## Safety

- Never paste credentials into chat unless the user explicitly asks.
- Never commit `~/.cache/aws-sso-creds/*.env` or include them in diffs.
- If the tab dies or the portal shows signed-out, restart from Step 1. Don't try
  to recover a dead session.
- Read-only by default. These creds often carry write permissions — do not run
  mutating `aws` commands unless the user asked for that specific change.
