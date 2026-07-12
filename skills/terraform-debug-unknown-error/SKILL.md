---
name: terraform-debug-unknown-error
description: Investigate a Terraform provider "unknown error" or opaque API error by adding temporary debug logging to the failing workflow step, triggering a run, and extracting the actual HTTP request/response.
---

Investigate a Terraform provider "unknown error" or opaque API error by adding temporary debug logging to the failing workflow step, triggering a run, and extracting the actual HTTP request/response.

## Usage
Provide:
- The workflow file to modify (e.g. `deploy.yml`)
- The step name that is failing (e.g. `Terraform Apply`)
- The working directory of that step (e.g. `ci/terraform`)

## Steps

### 1. Add TF_LOG=DEBUG to the failing step
Read the workflow file and modify the failing step to add debug logging with proper exit code capture:

```yaml
- name: <step-name>
  working-directory: <working-dir>
  env:
    TF_LOG: DEBUG
  run: |
    <original-command> 2>&1 | tee /tmp/tf-debug.log; RESULT=${PIPESTATUS[0]}
    exit $RESULT
```

IMPORTANT: Use `tee` + `${PIPESTATUS[0]}` pattern to preserve the exit code. Never pipe through grep at apply time — it masks the exit code.

### 2. Commit and push the change
Commit the modified workflow file with a message like "Temporarily add TF_LOG=DEBUG to diagnose <step-name> error" and push to the remote.

### 3. Trigger the workflow and wait for the run to complete
Trigger the workflow and wait for it to finish.

### 4. Download and analyze the full debug logs
```bash
gh api repos/<owner>/<repo>/actions/runs/<run-id>/logs > /tmp/run-logs.zip
```

Extract the HTTP request body sent to the failing API:
```bash
unzip -p /tmp/run-logs.zip | grep -a -A 40 "performing request.*<endpoint>" | head -60
```

Extract the HTTP response:
```bash
unzip -p /tmp/run-logs.zip | grep -a -A 15 "HTTP/[0-9]\.[0-9] [4-5][0-9][0-9]" | grep -v "azure\|microsoft\|storage" | head -40
```

For 403 errors, check the `Www-Authenticate` header — it will name the required scope.
For 500 errors, check the response body for an error code or look at the request body for missing/null fields.

### 5. Fix, remove debug logging, redeploy
After identifying the issue, revert the TF_LOG=DEBUG change and apply the actual fix in the same commit. Then commit, push, and trigger a new workflow run to verify.

Never leave TF_LOG=DEBUG in the workflow — it exposes secrets (API keys, tokens, client secrets) in plain text in the logs.

## See also

- To kick off the workflow run (steps 2–3), use the `trigger-github-deploy` skill.
- To wait for the run to finish before pulling logs, use the `github-workflow-wait` skill.
