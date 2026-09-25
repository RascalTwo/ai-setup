# Quick Analysis (Initial Pass)

## Step 1 — Get the run ID if needed
If "latest" was requested, find the most recent failed run:
```bash
gh run list --limit 1 --json databaseId,conclusion -q '.[] | select(.conclusion=="failure") | .databaseId'
```

## Step 2 — Fetch the failed step logs
Pull the full logs for all failed steps in one shot:
```bash
gh run view <run-id> --log-failed 2>&1
```

Scan the output for:
- The job and step name that failed
- Any error message, exit code, or exception
- HTTP status codes (4xx, 5xx)
- Provider-specific error summaries

## Step 3 — Report
Summarize:
- Which job/step failed
- The exact error message
- The likely root cause
- Suggested next step

If the output was truncated or the root cause is still unclear, proceed to `deep-analysis.md`.
