// The r2-app-stack poster explorer draws the skill from its own markdown. This runs the explorer's
// own parser (viz-pages/skill-r2-app-stack/stack-model.ts) over the real files, so a table that stops
// parsing, a rule without its reason, or a tool the page names but the skill no longer does fails the
// repo checks, not just the page. The negative cases prove each check can fail.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { checkLens, MATRIX } from "../viz-pages/skill-r2-app-stack/stack-lens.ts";
import { FILES, loadStack, md, parseDoc, type Stack } from "../viz-pages/skill-r2-app-stack/stack-model.ts";

const ROOT = path.join(import.meta.dir, "..");
const SKILL = path.join(ROOT, "skills/r2-app-stack");
const PAGE = path.join(ROOT, "viz-pages/skill-r2-app-stack");
const onDisk = (file: string) => Promise.resolve(readFileSync(path.join(SKILL, file), "utf8"));
const real = await loadStack(onDisk);
const rulesOf = (s: Stack) => Object.values(s.docs).flatMap((d) => d.sections.flatMap((x) => x.rules));
/** The real files with one of them replaced, as the explorer would fetch them. */
const withFile = (file: string, text: string) => loadStack((f) => (f === file ? Promise.resolve(text) : onDisk(f)));

test("the skill's real files parse with no problems", () => {
  expect(real.problems).toEqual([]);
  expect(Object.keys(real.docs).toSorted()).toEqual([...FILES].toSorted());
});

test("every kind page, and every shared page, yields at least one rule", () => {
  for (const file of FILES.filter((f) => f.startsWith("reference/") && !f.endsWith("adopt.md"))) {
    const n = real.docs[file]?.sections.reduce((k, s) => k + s.rules.length, 0) ?? 0;
    expect(n, file).toBeGreaterThan(0);
  }
});

test("every rule has a rule, a why and sources, and every table row or Rule: block an Enforced", () => {
  const rules = rulesOf(real);
  expect(rules.length).toBeGreaterThan(60);
  for (const r of rules) {
    const at = `${r.file}:${r.line}`;
    expect(r.rule.trim(), at).not.toBe("");
    expect(r.why.trim(), at).not.toBe("");
    expect(r.sources.trim(), at).not.toBe("");
    if (r.form === "table") expect(r.enforced.trim(), at).not.toBe("");
  }
});

test("every row of every Rule | Why | Sources | Enforced table has 4 cells in the markdown itself", () => {
  for (const file of FILES) {
    const lines = readFileSync(path.join(SKILL, file), "utf8").split("\n");
    lines.forEach((ln, i) => {
      if (!ln.startsWith("|") || /^\|[\s:|-]+\|$/u.test(ln)) return;
      if (file === "SKILL.md") return; // the routing table has two columns
      expect(ln.replaceAll(/`[^`]*`/gu, "").split("|").length - 2, `${file}:${i + 1}`).toBe(4);
    });
  }
});

test("everything the explorer's matrix and flow name is still said by the skill", () => {
  expect(checkLens(real)).toEqual([]);
  expect(Object.values(MATRIX).flatMap((row) => Object.values(row)).length).toBeGreaterThan(20);
});

test("SKILL.md routes to exactly the pages the explorer has tabs for", () => {
  const routes = real.docs["SKILL.md"]?.routes ?? [];
  expect(routes.length).toBeGreaterThan(5);
  expect(checkLens(real).filter((p) => /routing table|routes to/u.test(p.message))).toEqual([]);
});

// ---- the checks can fail

test("a paragraph that breaks a table is reported, not skipped", () => {
  const { problems } = parseDoc("x.md", "# T\n\n## S\n\n| Rule | Why | Sources | Enforced |\n|---|---|---|---|\n| a | b | c | d |\n\nprose\n| e | f | g | h |\n");
  expect(problems.map((p) => p.message).join()).toContain("table row outside a table");
});

test("a row with 3 cells, an empty cell, or the wrong header is reported", () => {
  const rows = "| a | b | c |\n| a | | c | d |\n";
  const { problems } = parseDoc("x.md", `# T\n\n## S\n\n| Rule | Why | Sources | Enforced |\n|---|---|---|---|\n${rows}`);
  expect(problems.length).toBe(2);
  const bad = parseDoc("x.md", "# T\n\n## S\n\n| Rule | Reason |\n|---|---|\n| a | b |\n");
  expect(bad.problems.map((p) => p.message).join()).toContain("is not Rule | Why | Sources | Enforced");
});

test("a block rule with a Why but no Sources, or a Rule: with no Enforced, is reported", () => {
  const noSources = parseDoc("x.md", "# T\n\n## S\n\n**Rule:** r. **Why:** w. **Enforced:** e.\n");
  expect(noSources.problems.map((p) => p.message).join()).toContain("no Sources");
  const noEnforced = parseDoc("x.md", "# T\n\n## S\n\n**Rule:** r. **Why:** w. **Sources:** s.\n");
  expect(noEnforced.problems.map((p) => p.message).join()).toContain("no Enforced");
});

test("a file that fails to load, and a kind page with no rules, are reported", async () => {
  const missing = await loadStack((f) => (f === "reference/kinds/cli.md" ? Promise.reject(new Error("HTTP 404")) : onDisk(f)));
  expect(missing.problems.map((p) => p.message).join()).toContain("could not be loaded: HTTP 404");
  const empty = await withFile("reference/kinds/cli.md", "# CLI\n\nNothing tabular here.\n");
  expect(empty.problems.map((p) => p.message)).toContain("a kind page yielded no rules");
});

test("a tool the page names that the skill drops is reported", async () => {
  const text = readFileSync(path.join(SKILL, "reference/kinds/server.md"), "utf8").replaceAll("Hono", "Elysia");
  const changed = await withFile("reference/kinds/server.md", text);
  expect(checkLens(changed).map((p) => p.message).join()).toContain('"Hono 4"');
});

test("the markdown renderer escapes HTML and keeps links on the skill's own files", () => {
  expect(md("<img onerror=x> `<b>` **b**", "SKILL.md")).toBe("&lt;img onerror=x&gt; <code>&lt;b&gt;</code> <b>b</b>");
  expect(md("[`a.md`](../shared.md)", "reference/kinds/cli.md")).toContain('href="https://github.com/RascalTwo/ai-setup/blob/main/skills/r2-app-stack/reference/shared.md"');
});

// ---- how the page reaches the files, here and once published

test("the page reaches the skill through its own skill/ link, and publish carries it", () => {
  const link = path.join(PAGE, "skill");
  expect(realpathSync(link)).toBe(realpathSync(SKILL));
  for (const f of FILES) expect(existsSync(path.join(link, f)), f).toBe(true);
  const html = readFileSync(path.join(PAGE, "index.html"), "utf8");
  expect(html).toMatch(/<meta\s+name="viz:bundle"\s+content="skill\/"/u);
});
