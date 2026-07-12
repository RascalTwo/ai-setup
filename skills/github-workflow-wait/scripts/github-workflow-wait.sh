#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <run-id | latest> [workflow-file] [--job <job-name>]"
  echo "  run-id        GitHub Actions run ID, or 'latest'"
  echo "  workflow-file  Optional workflow filename (used with 'latest')"
  echo "  --job <name>   Wait only until this specific job completes (substring match)"
  exit 1
}

[[ $# -lt 1 ]] && usage

RUN_ID="$1"; shift
WORKFLOW=""
TARGET_JOB=""

# Parse remaining args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --job)
      TARGET_JOB="$2"; shift 2 ;;
    *)
      WORKFLOW="$1"; shift ;;
  esac
done

if [[ "$RUN_ID" == "latest" ]]; then
  if [[ -n "$WORKFLOW" ]]; then
    RUN_ID=$(gh run list --limit 1 --workflow "$WORKFLOW" --json databaseId -q '.[0].databaseId')
  else
    RUN_ID=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
  fi
  if [[ -z "$RUN_ID" ]]; then
    echo "ERROR: Could not find a recent run."
    exit 1
  fi
  echo "Resolved latest run ID: $RUN_ID"
fi

if [[ -n "$TARGET_JOB" ]]; then
  echo "Waiting for job matching '$TARGET_JOB' in run $RUN_ID ..."

  while true; do
    # Get all jobs, find the one matching the target name (substring, case-insensitive).
    # Use [0] to take the first match when multiple jobs match the pattern.
    LOWER_TARGET=$(echo "$TARGET_JOB" | tr '[:upper:]' '[:lower:]')
    JOB_JSON=$(gh run view "$RUN_ID" --json jobs \
      -q "[.jobs[] | select(.name | ascii_downcase | endswith(\"$LOWER_TARGET\"))] | first // empty" 2>/dev/null || true)

    # Fall back to substring match if exact suffix match found nothing
    if [[ -z "$JOB_JSON" ]]; then
      JOB_JSON=$(gh run view "$RUN_ID" --json jobs \
        -q "[.jobs[] | select(.name | ascii_downcase | contains(\"$LOWER_TARGET\"))] | first // empty" 2>/dev/null || true)
    fi

    if [[ -z "$JOB_JSON" ]]; then
      # Job hasn't appeared yet (may not have started)
      RUN_STATUS=$(gh run view "$RUN_ID" --json status,conclusion -q '.status + ":" + (.conclusion // "")')
      echo "$(date +%H:%M:%S) run=$RUN_STATUS (job '$TARGET_JOB' not started yet)"
      if [[ "$RUN_STATUS" == completed:* ]]; then
        echo "ERROR: Run completed but job '$TARGET_JOB' was never found."
        echo "Available jobs:"
        gh run view "$RUN_ID" --json jobs -q '.jobs[].name'
        exit 1
      fi
    else
      JOB_STATUS=$(echo "$JOB_JSON" | jq -r '.status')
      JOB_CONCLUSION=$(echo "$JOB_JSON" | jq -r '.conclusion // ""')
      JOB_NAME=$(echo "$JOB_JSON" | jq -r '.name')
      echo "$(date +%H:%M:%S) ${JOB_NAME}: ${JOB_STATUS}${JOB_CONCLUSION:+ ($JOB_CONCLUSION)}"

      if [[ "$JOB_STATUS" == "completed" ]]; then
        echo ""
        URL=$(gh run view "$RUN_ID" --json url -q '.url')
        echo "Job '$JOB_NAME' completed: $JOB_CONCLUSION"
        echo "URL: $URL"
        if [[ "$JOB_CONCLUSION" != "success" ]]; then
          echo ""
          echo "Job did not succeed. Suggest: /github-workflow-analyze-failure $RUN_ID"
          exit 1
        fi
        exit 0
      fi
    fi
    sleep 20
  done
else
  echo "Waiting for run $RUN_ID ..."

  while true; do
    STATUS=$(gh run view "$RUN_ID" --json status,conclusion -q '.status + ":" + (.conclusion // "")')
    echo "$(date +%H:%M:%S) $STATUS"
    if [[ "$STATUS" == completed:* ]]; then
      break
    fi
    sleep 20
  done

  CONCLUSION="${STATUS#completed:}"
  URL=$(gh run view "$RUN_ID" --json url -q '.url')

  echo ""
  echo "Run completed: $CONCLUSION"
  echo "URL: $URL"

  if [[ "$CONCLUSION" != "success" ]]; then
    echo ""
    echo "Run did not succeed. Suggest: /github-workflow-analyze-failure $RUN_ID"
    exit 1
  fi
fi
