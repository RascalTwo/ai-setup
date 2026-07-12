# Deep Analysis (Full Log Investigation)

Use this when the quick pass was insufficient — output was truncated, the error was ambiguous, or you need the full HTTP request/response.

## Step 1 — Download the full log zip
```bash
gh api repos/<owner>/<repo>/actions/runs/<run-id>/logs > /tmp/run-logs.zip
```

## Step 2 — Choose the right extraction strategy based on error type

**Terraform errors** — look for the formatted error block:
```bash
unzip -p /tmp/run-logs.zip | grep -a "│" | grep -v "─\|╷\|╵" | head -30
```

**Provider crashes / panics** — look for stack traces:
```bash
unzip -p /tmp/run-logs.zip | grep -a -E "(panic|goroutine|SIGSEGV)" | head -20
```

**HTTP API errors** — look for response status and body:
```bash
unzip -p /tmp/run-logs.zip | grep -a -E "(HTTP/[0-9]\.[0-9] [4-5][0-9][0-9]|Www-Authenticate|errorCode|errorSummary)" | head -20
```

**Missing scopes / 403** — check WWW-Authenticate header:
```bash
unzip -p /tmp/run-logs.zip | grep -a "Www-Authenticate\|insufficient_scope" | head -10
```

**General keyword search** — when error type is unknown:
```bash
unzip -p /tmp/run-logs.zip | grep -a -E "(Error:|error|panic|failed|Fatal)" | grep -v "azure\|microsoft\|github\.com\|blob\|management\|login\|storage" | head -40
```

## Step 3 — Report findings
For each issue found:
- Which job/step failed
- The exact error message
- The likely root cause
- Suggested fix
