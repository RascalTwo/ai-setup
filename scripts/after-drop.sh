#!/usr/bin/env bash
# Runs after squash-to-main.sh pushes a public drop. ai-setup's only post-publish step: release
# whatever skill has a new version. release.ts is a no-op (or a loud warning) when nothing is due.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/skills/viz"
bun maintainer/release.ts
