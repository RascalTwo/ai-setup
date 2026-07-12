---
name: reorder-github-project-board-by-depth
description: Reorder issues in a GitHub Projects board column by longest-path dependency depth from blocking/blocked-by relationships. Use whenever the user asks to sort, order, prioritize, or organize a project board column by dependencies, blocking depth, readiness, or pickup order — e.g. order the board by what can be picked up first, sort by dependency depth, put the most blocked items at the bottom, or prioritize the backlog by readiness.
---

# Reorder GitHub Project Board by Dependency Depth

Reorder issues within a single column of a GitHub Projects (v2) board so that items with
fewer layers of blocking dependencies appear at the top, and deeply blocked items sink to
the bottom. Within the same depth, items are sorted alphabetically by title.

This gives a natural "pick up from the top" workflow — the top of the column is always the
most actionable work.

## How depth is computed

Depth = the longest path from any root node (an issue with zero blockers) to this issue,
following blocking relationships. A root issue has depth 0. An issue blocked only by root
issues has depth 1. And so on.

This is more useful than counting direct blockers because it captures transitive depth.
An issue blocked by one thing that's itself blocked by five things is deeper than an issue
blocked by three independent root-level items.

## Arguments

Parse these from the user's message. Prompt for any required values not provided.

| Argument | Required | Default | Description |
|---|---|---|---|
| `org` | yes | — | GitHub org or user that owns the project |
| `project` | yes | — | Project number (the number in the URL, e.g., `118`) |
| `column` | no | `"Parking Lot"` | The status column to reorder |
| `view` | no | `1` | Project view number (rarely needed) |
| `repo` | no | auto-detect | Repository for fetching issue details. If all issues are from one repo, auto-detect from the first issue. If mixed, prompt. |

## Execution

Run `scripts/reorder.py` with the appropriate arguments:

```bash
python3 SKILL_DIR/scripts/reorder.py \
  --org <org> \
  --project <project> \
  --column "<column>" \
  --repo "<owner/repo>"
```

The script handles everything: fetching project data, computing depth, and applying the
reorder via the GitHub API. It prints a summary table showing the final order with depth
numbers.

If the script encounters auth issues, tell the user to run:
```
! gh auth refresh -s project
```

## What the script does (for transparency)

1. Fetches the project's node ID via `gh api graphql`
2. Fetches all project items with their status, issue number, title, and project item ID
3. Filters to items in the target column
4. For each issue, fetches `issue_dependencies_summary` from the REST API to find blocker counts
5. For issues with blockers, fetches the actual blocking issue numbers from the issue timeline
6. Builds the dependency graph and computes longest-path depth via memoized DFS
7. Sorts by (depth ascending, title alphabetical)
8. Applies the ordering via `updateProjectV2ItemPosition` GraphQL mutations with afterId chaining
9. Reports the final order

## Limitations

- Only reorders within a single column — doesn't move items between columns
- Requires `gh` CLI authenticated with the `project` scope
- Rate-limited to ~3 API calls/second to stay within GitHub's limits
- Only considers blocking/blocked-by relationships, not sub-issues or tracked-by
