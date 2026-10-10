// tests/format.test.ts — `viz format`: oxfmt over a viz, and the rule about its ignore comments.
//
// WHY: format is a gate on every viz, so the easy-to-get-wrong parts are pinned: an unformatted file must fail the
// run (not just be mentioned), `--fix` must leave a second run clean, a failure of oxfmt itself must not read as a
// pass, copies of other vizzes are not ours to format, and a `prettier-ignore` must always say why on the line above
// (oxfmt ignores `// prettier-ignore -- why`, so the reason cannot share the line). These tests drive the real CLI
// against throwaway vizzes.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parseJson } from "./json.ts";

setDefaultTimeout(60_000); // each test spawns the CLI (and --fix the type-aware lint); the full suite runs 20 files at once
const SKILL = path.dirname(import.meta.dir);
const ROOT = mkdtempSync(path.join(os.tmpdir(), "viz-format-test-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/** A throwaway viz inside its own fake repo (a `.git` folder is all the skill looks for). */
function viz(name: string, files: Record<string, string>): string {
  const repo = path.join(ROOT, name);
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  const dir = path.join(repo, "v");
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), body);
  }
  return dir;
}
const page =
  '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>t</title>\n  </head>\n  <body></body>\n</html>\n';
const messy = "export const a  =  { x:1,   y:2 };\n";
const tidy = "export const a = { x: 1, y: 2 };\n";

type Verdict = {
  ok: boolean;
  parts: string[];
  errors: string[];
  format: { files: number; findings: string[]; skipped: string | null } | null;
};
async function format(dir: string, ...flags: string[]): Promise<{ code: number; v: Verdict }> {
  const proc = Bun.spawn(
    ["bun", path.join(SKILL, "viz.ts"), "format", `file://${dir}/index.html`, "--json", ...flags],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, VIZ_NO_OPEN: "1" },
    },
  );
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, v: parseJson<Verdict>(out.slice(out.indexOf("{"))) };
}

describe("what format reports", () => {
  test.concurrent("Given an unformatted .ts, when format runs, then it fails and names the file", async () => {
    const dir = viz("unformatted", { "index.html": page, "app.ts": messy });
    const { code, v } = await format(dir);
    expect(v.parts).toEqual(["format"]);
    expect(v.format?.findings.some((f) => f.startsWith("app.ts is not formatted"))).toBe(true);
    expect(v.ok).toBe(false);
    expect(code).not.toBe(0);
    expect(readFileSync(path.join(dir, "app.ts"), "utf8")).toBe(messy); // a check never writes
  });

  test.concurrent("Given formatted files, when format runs, then it passes", async () => {
    const dir = viz("formatted", { "index.html": page, "app.ts": tidy });
    const { code, v } = await format(dir);
    expect(v.format?.findings).toEqual([]);
    expect(code).toBe(0);
  });

  test.concurrent("Given an unformatted viz, when format --fix runs, then the files are rewritten and a second run is clean", async () => {
    const dir = viz("fixable", {
      "index.html": page,
      "app.ts": messy,
      "style.css": "a{color:red}\n",
    });
    await format(dir, "--fix");
    expect(readFileSync(path.join(dir, "app.ts"), "utf8")).toBe(tidy);
    expect(readFileSync(path.join(dir, "style.css"), "utf8")).toBe("a {\n  color: red;\n}\n");
    const again = await format(dir);
    expect(again.v.format?.findings).toEqual([]);
  });

  test.concurrent("Given a syntax error, when format runs, then oxfmt's failure fails the run instead of passing", async () => {
    const dir = viz("syntax", { "index.html": page, "app.ts": "export const = ;\n" });
    const { code, v } = await format(dir);
    expect(v.format?.findings.some((f) => f.startsWith("oxfmt could not format"))).toBe(true);
    expect(code).not.toBe(0);
  });

  test.concurrent("Given a copy of another viz (.mirror.json), when format runs, then it is left alone", async () => {
    const dir = viz("mirror", { "index.html": page, "app.ts": messy, ".mirror.json": "{}" });
    const { v } = await format(dir);
    expect(v.format).toBeNull();
    expect(readFileSync(path.join(dir, "app.ts"), "utf8")).toBe(messy);
  });
});

describe("the rule about ignores", () => {
  const aligned = "export const t = {  a:1,   b:2  };\n";

  test.concurrent("Given a prettier-ignore with a reason above it, when format runs, then the block keeps its alignment and passes", async () => {
    const dir = viz("ignore-ok", {
      "index.html": page,
      "app.ts": `// the columns line up the data table below\n// prettier-ignore\n${aligned}`,
    });
    const { v } = await format(dir);
    expect(v.format?.findings).toEqual([]);
    await format(dir, "--fix");
    expect(readFileSync(path.join(dir, "app.ts"), "utf8")).toContain(aligned);
  });

  test.concurrent("Given a bare prettier-ignore, when format runs, then it fails with the line number", async () => {
    const dir = viz("ignore-bare", {
      "index.html": page,
      "app.ts": `export const x = 1;\n// prettier-ignore\n${aligned}`,
    });
    const { code, v } = await format(dir);
    expect(v.format?.findings).toEqual([
      "app.ts:2 format-ignore without a reason: say why in a comment on the line above",
    ]);
    expect(code).not.toBe(0);
  });

  test.concurrent("Given a reason on the same line (which oxfmt would not honour), when format runs, then it is still a bare ignore", async () => {
    const dir = viz("ignore-sameline", {
      "index.html": page,
      "app.ts": `// prettier-ignore -- columns carry the meaning here\n${aligned}`,
    });
    const { v } = await format(dir);
    expect(
      v.format?.findings.some((f) => f.startsWith("app.ts:1 format-ignore without a reason")),
    ).toBe(true);
  });

  test.concurrent("Given a one-word comment above an ignore, when format runs, then it is not a reason", async () => {
    const dir = viz("ignore-thin", {
      "index.html": page,
      "app.ts": `// table\n// prettier-ignore\n${aligned}`,
    });
    const { v } = await format(dir);
    expect(
      v.format?.findings.some((f) => f.startsWith("app.ts:2 format-ignore without a reason")),
    ).toBe(true);
  });

  test.concurrent("Given a CSS ignore with a reason above it, when format runs, then it passes", async () => {
    const dir = viz("ignore-css", {
      "index.html": page,
      "s.css":
        "/* these two rules are read side by side */\n/* prettier-ignore */\n.a { margin:0;  padding:1px }\n",
    });
    const { v } = await format(dir);
    expect(v.format?.findings).toEqual([]);
  });
});
