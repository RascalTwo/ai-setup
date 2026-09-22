#!/usr/bin/env bash
# ONE JOB: print this container's deployed base URL on stdout.
#
# THE CONTRACT (consumers rely on exactly this — see reference/publishing.md):
#   exit 0  → stdout's first line is the base URL, no trailing slash. Nothing else on stdout.
#   exit !0 → this container has no determinable deployed URL. stdout is ignored.
#   absent  → same user-visible result as exit !0: "no deployed URL". Not an error.
#
# Consumers MUST validate the output starts with http:// or https:// and reject anything
# else, so a script that prints a diagnostic instead of a URL fails closed rather than
# producing a link to nowhere. Never print progress or warnings to stdout — use stderr.
#
# WHY A SCRIPT AND NOT A STATIC FILE: the URL has to follow the repo. Move the remote to a
# new owner or rename it and the next call reports the new URL with nothing to update. A
# container that genuinely has a fixed host should replace this whole file with one line:
#
#     echo "https://example.com/my-site"
#
# That is a legitimate implementation of this contract, not a workaround.
#
# WHY PER CONTAINER: a repo can hold more than one viz-pages container, and only one of them
# is the deployed one. Deriving centrally from `git remote` would hand a non-deploying sibling
# its neighbour's URL — confidently wrong. Only the container knows whether it ships.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# No git, no remote, no derivation — a valid "I don't deploy" answer, not a failure to report.
REMOTE="$(git -C "$HERE" remote get-url origin 2>/dev/null)" || exit 1
[ -n "$REMOTE" ] || exit 1

case "$REMOTE" in
  *github.com*)
    slug="${REMOTE#*github.com[:/]}"; slug="${slug%.git}"
    # Pages lowercases the owner in the hostname but keeps the repo's case in the path.
    owner="$(echo "${slug%%/*}" | tr '[:upper:]' '[:lower:]')"; repo="${slug#*/}"
    echo "https://${owner}.github.io/${repo}"
    ;;
  *gitlab.com*)
    slug="${REMOTE#*gitlab.com[:/]}"; slug="${slug%.git}"
    # `##*/` not `#*/`: GitLab nests subgroups, and only the last segment is the project.
    group="$(echo "${slug%%/*}" | tr '[:upper:]' '[:lower:]')"; repo="${slug##*/}"
    echo "https://${group}.gitlab.io/${repo}"
    ;;
  *)
    echo "base-url.sh: unrecognized origin host: $REMOTE" >&2
    exit 1
    ;;
esac
