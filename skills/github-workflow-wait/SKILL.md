---
name: github-workflow-wait
description: Wait for a GitHub Actions workflow run to complete by polling its status. Use when the user asks to "wait for the run to finish" or "poll until the Actions run completes".
---

Wait for a GitHub Actions workflow run (or a specific job within it) to complete by polling its status.

## Usage
Provide either:
- A run ID (e.g. `22379581209`)
- Or say "latest" and optionally a workflow filename (e.g. `deploy_bravo.yml`) to auto-detect the most recent run
- Optionally add `--job <name>` to wait only for a specific job (substring match, case-insensitive)

## Steps

Run the polling script (single Bash call, timeout 600000ms):

```bash
.claude/skills/github-workflow-wait/scripts/github-workflow-wait.sh <run-id-or-latest> [workflow-file] [--job <job-name>]
```

Examples:
- `.claude/skills/github-workflow-wait/scripts/github-workflow-wait.sh 22379581209`
- `.claude/skills/github-workflow-wait/scripts/github-workflow-wait.sh latest deploy_bravo.yml`
- `.claude/skills/github-workflow-wait/scripts/github-workflow-wait.sh latest deploy_bravo.yml --job ldap`
- `.claude/skills/github-workflow-wait/scripts/github-workflow-wait.sh latest deploy_bravo.yml --job "e2e-test"`

The script handles resolving "latest", polling every 20 seconds, and reporting the final result.

When `--job` is used, the script returns as soon as that job completes (success or failure) without waiting for the full run. The job name is matched as a case-insensitive substring.

If the run/job failed, suggest running `/github-workflow-analyze-failure <run-id>` to investigate.
