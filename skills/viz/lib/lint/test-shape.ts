// lib/lint/test-shape.ts — the check Oxlint cannot do for tests: every test is written as GIVEN, then WHEN, then
// THEN, each a step call (`await viz.given("a user with no session", …)`), because a step is run and recorded and a
// comment is neither. Text-based, not parsed: TypeScript 7 has no JS syntax-tree API, and the formatter fixes
// indentation, which is enough to find where a test starts and ends.
//
// ponytail: a step in a helper function the test calls is not seen; keep the steps in the test.

import { readFileSync } from "node:fs";
import path from "node:path";

export const START = /^(\s*)(?:it|test)(?:\.(?:concurrent|serial|only|each))*\b/u;
export const TITLE = /(["'`])((?:\\.|(?!\1).)*)\1/u;
const MARKER = /\bviz\.(given|when|then)\(/u;
// A header line at the test's own indent that closes and reopens, e.g. `] as const)("should %s", async () => {` after an
// `it.each([` table: the test goes on.
const REOPENS = /^\s*[\])}].*[[({]$/u;
const VERBS = ["GIVEN", "WHEN", "THEN"] as const;
const indent = (l: string) => l.length - l.trimStart().length;

/** For a test starting at line `i` with indent `n`: the line its title is on, and the first line past its body. */
export function extent(lines: string[], i: number, n: number): { head: number; end: number } {
  let head = i;
  let end = i + 1;
  for (;;) {
    while (end < lines.length && (lines[end]!.trim() === "" || indent(lines[end]!) > n)) end++;
    if (end >= lines.length || indent(lines[end]!) !== n || !REOPENS.test(lines[end]!))
      return { head, end };
    head = end++;
  }
}

/** Findings for one test file's text; `name` is how the file is named in them. */
export function testShape(text: string, name: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    const m = START.exec(line);
    if (!m || /^\s*(?:it|test)\.(?:todo|skip)\b/u.test(line)) return;
    const { head, end } = extent(lines, i, m[1]!.length);
    if (end === i + 1) return; // one line, no body to read: `it.todo("…")` style
    const first: Record<string, number> = {};
    for (const [k, body] of lines.slice(i + 1, end).entries()) {
      const v = MARKER.exec(body);
      const verb = v?.[1]?.toUpperCase();
      if (verb) first[verb] ??= k;
    }
    const title = TITLE.exec(lines.slice(head, head + 3).join(" "))?.[2] ?? "(untitled)";
    const missing = VERBS.filter((w) => first[w] === undefined);
    const why =
      missing.length > 0
        ? `has no ${missing.map((w) => `viz.${w.toLowerCase()}(…)`).join(" or ")}`
        : first["GIVEN"]! > first["WHEN"]! || first["WHEN"]! > first["THEN"]!
          ? "does not go GIVEN, then WHEN, then THEN"
          : "";
    if (why)
      out.push(
        `${name}:${i + 1} test "${title}" ${why} (write each as \`await viz.given("…", () => …)\`, \`viz.when\`, \`viz.then\`)`,
      );
  });
  return out;
}

/** The viz's `tests/*.test.ts`, checked. */
export function testShapes(vizDir: string, files: string[]): string[] {
  return files
    .filter((f) => /[\\/]tests[\\/][^\\/]*\.test\.ts$/u.test(f))
    .flatMap((f) => testShape(readFileSync(f, "utf8"), path.relative(vizDir, f)));
}
