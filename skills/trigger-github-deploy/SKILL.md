---
name: trigger-github-deploy
description: Trigger a deployment via GitHub Actions workflow run against the current branch and monitor it. Use when the user asks to "kick off the deploy", "re-run the deploy workflow", or "deploy the current branch".
---

Trigger a GitHub Actions workflow run against the current branch and monitor it.

## Usage
Provide:
- The workflow to trigger — if not clear from context, list available workflows and ask the user

List available workflows if needed:
```bash
ls .github/workflows/
```

## Steps

### 1. Get current branch
```bash
git branch --show-current
```

### 2. Check for push trigger (REQUIRED — prevents double triggers)

Before dispatching manually, check whether the workflow file already triggers on `push` for the current branch. Read the workflow YAML and inspect the `on.push.branches` list.

```bash
# Extract push-trigger branches from the workflow file
grep -A 20 '^on:' .github/workflows/<workflow-file> | sed -n '/push:/,/^  [a-z]/p' | grep '^\s*-' | sed 's/.*- //'
```

Compare the current branch against that list. A branch matches if:
- It appears literally (e.g. `main`, `fix-bravo`)
- It matches a glob pattern (e.g. `feature/*` matches `feature/foo`)
- The list includes `'**'` (all branches)

### 3. Decide: push-triggered or manual dispatch

**If the workflow has a push trigger for the current branch:**

Check whether there are unpushed commits or if we just pushed:

```bash
git log @{u}.. --oneline 2>/dev/null
```

- **If there are unpushed commits:** Push them. The push itself triggers the workflow — do NOT also run `gh workflow run`.
  ```bash
  git push
  ```
- **If there are no unpushed commits** (branch is already up-to-date with remote): The push trigger won't fire, so fall through to manual dispatch below.

**If the workflow does NOT have a push trigger for the current branch (or we fell through):**

Dispatch manually:
```bash
gh workflow run <workflow-file> --ref <current-branch>
```

### 4. Get the run ID
```bash
sleep 15 && gh run list --limit 1 --workflow <workflow-file> --json databaseId -q '.[0].databaseId'
```

Report the run ID, then use `/github-workflow-wait <run-id>` to monitor it.
