---
name: analyze-github-workflow-failure
description: Analyze the failure logs of a GitHub Actions workflow run to identify the root cause. Use when the user asks "why did my workflow/CI/Actions run fail", "analyze run <id>", or says "the deploy/build failed, what broke".
---

Analyze the failure logs of a GitHub Actions workflow run to identify the root cause.

## Usage
Provide a run ID, or say "latest" to analyze the most recent failed run.

## Approach

Start with the quick initial pass described in `quick-analysis.md` in this skill directory. This is lightweight and token-efficient.

If the quick pass is insufficient (output truncated, error unclear, or more context needed), proceed to the deep analysis described in `deep-analysis.md` in this skill directory.

