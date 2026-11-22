#!/usr/bin/env python3
"""Reorder a GitHub Projects board column by longest-path dependency depth."""

import argparse
import json
import subprocess
import sys
import time
from collections import defaultdict


def gh(*args, parse_json=True):
    """Run a gh CLI command and return the result."""
    cmd = ["gh"] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERROR: gh {' '.join(args[:3])}...", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    if parse_json and result.stdout.strip():
        return json.loads(result.stdout)
    return result.stdout.strip()


def gh_graphql(query):
    """Run a GraphQL query via gh api graphql."""
    result = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={query}"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"ERROR: GraphQL query failed", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    data = json.loads(result.stdout)
    if "errors" in data:
        print(f"GraphQL errors: {data['errors']}", file=sys.stderr)
        sys.exit(1)
    return data


def get_project_node_id(org, project_number):
    """Get the project's GraphQL node ID."""
    data = gh_graphql(f'''{{
        organization(login: "{org}") {{
            projectV2(number: {project_number}) {{
                id
                title
            }}
        }}
    }}''')
    project = data["data"]["organization"]["projectV2"]
    print(f"Project: {project['title']}")
    return project["id"]


def fetch_project_items(project_node_id):
    """Fetch all project items with status, issue number, title, item ID."""
    items = []
    has_next = True
    cursor = None

    while has_next:
        after_clause = f', after: "{cursor}"' if cursor else ""
        data = gh_graphql(f'''{{
            node(id: "{project_node_id}") {{
                ... on ProjectV2 {{
                    items(first: 100{after_clause}) {{
                        pageInfo {{ hasNextPage endCursor }}
                        nodes {{
                            id
                            content {{
                                ... on Issue {{
                                    number
                                    title
                                    repository {{ nameWithOwner }}
                                }}
                                ... on DraftIssue {{
                                    title
                                }}
                            }}
                            fieldValueByName(name: "Status") {{
                                ... on ProjectV2ItemFieldSingleSelectValue {{ name }}
                            }}
                        }}
                    }}
                }}
            }}
        }}''')

        page = data["data"]["node"]["items"]
        for node in page["nodes"]:
            content = node["content"]
            # Skip draft issues (no number)
            if "number" not in content:
                continue
            status_field = node.get("fieldValueByName") or {}
            items.append({
                "item_id": node["id"],
                "number": content["number"],
                "title": content["title"],
                "repo": content.get("repository", {}).get("nameWithOwner", ""),
                "status": status_field.get("name", ""),
            })

        has_next = page["pageInfo"]["hasNextPage"]
        cursor = page["pageInfo"]["endCursor"]

    return items


def fetch_blockers_for_all(repo, issue_numbers):
    """Fetch blocking relationships for all issues using the GraphQL blockedBy field."""
    blockers_map = defaultdict(set)
    owner, name = repo.split("/")

    # Process in batches of 10 to stay within GraphQL complexity limits
    numbers = sorted(issue_numbers)
    for batch_start in range(0, len(numbers), 10):
        batch = numbers[batch_start:batch_start + 10]

        fragments = []
        for num in batch:
            fragments.append(f'''
                issue_{num}: issue(number: {num}) {{
                    number
                    blockedBy(first: 50) {{ nodes {{ number }} }}
                }}
            ''')

        query = f'''{{
            repository(owner: "{owner}", name: "{name}") {{
                {''.join(fragments)}
            }}
        }}'''

        data = gh_graphql(query)
        repo_data = data.get("data", {}).get("repository", {})

        for num in batch:
            issue_data = repo_data.get(f"issue_{num}", {})
            blocked_by = issue_data.get("blockedBy", {}).get("nodes", [])
            for b in blocked_by:
                if b.get("number") and b["number"] in issue_numbers:
                    blockers_map[num].add(b["number"])

        time.sleep(0.5)
        print(f"  Fetched batch {batch_start + 1}-{min(batch_start + len(batch), len(numbers))} of {len(numbers)}")

    return blockers_map


def compute_depths(items, blockers_of):
    """Compute longest-path depth for each issue via memoized DFS with cycle detection."""
    all_numbers = {item["number"] for item in items}
    cache = {}
    in_progress = set()  # cycle detection

    def max_depth(num):
        if num in cache:
            return cache[num]
        if num in in_progress:
            # Cycle detected — treat as depth 0 to break the loop
            return 0
        in_progress.add(num)
        deps = blockers_of.get(num, set()) & all_numbers
        if not deps:
            cache[num] = 0
        else:
            cache[num] = 1 + max(max_depth(dep) for dep in deps)
        in_progress.discard(num)
        return cache[num]

    for item in items:
        max_depth(item["number"])

    return cache


def reorder_column(project_node_id, items_in_column, depths):
    """Apply the depth-based ordering to the project board."""
    # Sort: depth ascending, then title alphabetical
    ordered = sorted(
        items_in_column,
        key=lambda item: (depths.get(item["number"], 0), item["title"]),
    )

    prev_item_id = None
    for i, item in enumerate(ordered):
        if prev_item_id is None:
            gh_graphql(f'''mutation {{
                updateProjectV2ItemPosition(input: {{
                    projectId: "{project_node_id}",
                    itemId: "{item['item_id']}"
                }}) {{ clientMutationId }}
            }}''')
        else:
            gh_graphql(f'''mutation {{
                updateProjectV2ItemPosition(input: {{
                    projectId: "{project_node_id}",
                    itemId: "{item['item_id']}",
                    afterId: "{prev_item_id}"
                }}) {{ clientMutationId }}
            }}''')

        prev_item_id = item["item_id"]
        time.sleep(0.2)

    return ordered


def main():
    parser = argparse.ArgumentParser(description="Reorder GitHub project column by dependency depth")
    parser.add_argument("--org", required=True, help="GitHub org or user")
    parser.add_argument("--project", required=True, type=int, help="Project number")
    parser.add_argument("--column", default="Parking Lot", help="Column name to reorder")
    parser.add_argument("--repo", required=True, help="Repository (owner/name) for issue details")
    parser.add_argument("--dry-run", action="store_true", help="Compute and print order without applying")
    args = parser.parse_args()

    print(f"Fetching project {args.org}/projects/{args.project}...")
    project_id = get_project_node_id(args.org, args.project)

    print("Fetching project items...")
    all_items = fetch_project_items(project_id)
    print(f"  Found {len(all_items)} issues total")

    # Filter to target column
    column_items = [i for i in all_items if i["status"] == args.column]
    print(f"  {len(column_items)} in '{args.column}' column")

    if not column_items:
        print(f"No items in '{args.column}'. Nothing to reorder.")
        return

    # Fetch blocking relationships for ALL issues (not just column items)
    # because blockers may be in other columns
    print(f"Fetching blocking relationships...")
    all_numbers = {i["number"] for i in all_items}
    blockers_of = fetch_blockers_for_all(args.repo, all_numbers)

    for num in sorted(blockers_of.keys()):
        if blockers_of[num]:
            print(f"  #{num} blocked by: {', '.join(f'#{b}' for b in sorted(blockers_of[num]))}")

    # Compute depths
    print("Computing dependency depths...")
    depths = compute_depths(all_items, blockers_of)

    if args.dry_run:
        print(f"\nDry run — proposed order for '{args.column}':")
        ordered = sorted(
            column_items,
            key=lambda item: (depths.get(item["number"], 0), item["title"]),
        )
        for item in ordered:
            d = depths.get(item["number"], 0)
            print(f"  Depth {d:2d} | #{item['number']} | {item['title']}")
        return

    # Apply ordering
    print(f"\nReordering '{args.column}'...")
    ordered = reorder_column(project_id, column_items, depths)

    print(f"\nFinal order:")
    for item in ordered:
        d = depths.get(item["number"], 0)
        print(f"  Depth {d:2d} | #{item['number']} | {item['title']}")

    print(f"\nDone. {len(ordered)} items reordered in '{args.column}'.")


if __name__ == "__main__":
    main()
