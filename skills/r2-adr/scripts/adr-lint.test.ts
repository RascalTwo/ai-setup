import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintPaths } from "./adr-lint.ts";

const GOOD = `# Run builds in worktrees

Status: Accepted, 2026-11-13

## Context and Problem Statement

Two builds on one checkout overwrite each other's files.

## Decision

Each build gets its own worktree.

## Alternatives Considered

- Clone per build: slow.

## More Information

- Related: [old](2026-01-02-old-way.md)
`;

function dir(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "adr-lint-"));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t);
  return d;
}
const oldWay = GOOD.replace("Run builds in worktrees", "Old way").replace(
  "Accepted, 2026-11-13",
  "Superseded by [2026-11-13-run-builds-in-worktrees.md](2026-11-13-run-builds-in-worktrees.md), 2026-11-13",
).replace("[old](2026-01-02-old-way.md)", "none");

test("GIVEN a well-formed ADR and the one it supersedes WHEN linted THEN nothing is reported", () => {
  expect(lintPaths([dir({ "2026-11-13-run-builds-in-worktrees.md": GOOD, "2026-01-02-old-way.md": oldWay })])).toEqual([]);
});

test("GIVEN the upstream template unfilled WHEN linted THEN its placeholders and missing status are reported", () => {
  const tpl = readFileSync(join(import.meta.dir, "../upstream/assets/templates/adr-simple.md"), "utf8");
  const out = lintPaths([dir({ "2026-11-13-x.md": tpl })]).join("\n");
  expect(out).toContain("Status line");
  expect(out).toContain("placeholder");
});

test("GIVEN common mistakes WHEN linted THEN each is reported", () => {
  const d = dir({
    "0003-numbered.md": GOOD,
    "2026-02-30-bad-date.md": GOOD,
    "2026-11-13-typo-status.md": GOOD.replace("Status: Accepted", "Status: AcceptedSS"),
    "2026-11-13-no-alternatives.md": GOOD.replace("## Alternatives Considered", "## Options"),
    "2026-11-13-dead-link.md": GOOD.replace("2026-01-02-old-way.md", "2026-01-03-gone.md"),
  });
  const out = lintPaths([d]).join("\n");
  expect(out).toContain("0003-numbered.md: numbered");
  expect(out).toContain("2026-02-30 is not a real date");
  expect(out).toContain("typo-status.md: first line after the title must be a Status line");
  expect(out).toContain('no-alternatives.md: missing section "## Alternatives Considered"');
  expect(out).toContain("dead-link.md: link target not found: 2026-01-03-gone.md");
});

test("GIVEN markdown quoted in a code fence WHEN linted THEN headings and braces inside it are ignored", () => {
  const fenced = GOOD.replace("## More Information", "```md\n## Decision\n{Alternative 1}: {What is it, and why was it rejected?}\n```\n\n## More Information");
  expect(lintPaths([dir({ "2026-11-13-run-builds-in-worktrees.md": fenced, "2026-01-02-old-way.md": oldWay })])).toEqual([]);
});
