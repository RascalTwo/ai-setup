// tests/lint.test.ts — `viz lint`: Oxlint with its type-aware engine over a viz, and the rules about the rules.
//
// WHY: lint is a gate on every viz, so what it reports has to be right in the ways that are easy to get wrong
// silently: type-aware rules flood with false hits when a viz has no tsconfig (measured: 133 vs 0), a run that
// could not use the type-aware engine must say so instead of passing, any finding must fail the run, and a disabled rule must always carry its
// reason. These tests drive the real CLI against
// throwaway vizzes.

import { afterAll, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { OFF_RULES, SKILL_OFF_RULES, TEST_OFF_RULES, oxlintConfig } from "../lib/lint/config.ts";
import { parseJson } from "./json.ts";

const SKILL = path.dirname(import.meta.dir);
const ROOT = mkdtempSync(path.join(os.tmpdir(), "viz-lint-test-"));
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
const page = (body = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

type Verdict = {
  ok: boolean;
  errors: string[];
  lint: { files: number; findings: string[]; skipped: string | null } | null;
};
async function lint(
  dir: string,
  env: Record<string, string> = {},
  flags: string[] = [],
): Promise<{ code: number; v: Verdict }> {
  const proc = Bun.spawn(
    ["bun", path.join(SKILL, "viz.ts"), "lint", `file://${dir}/index.html`, "--json", ...flags],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, VIZ_NO_OPEN: "1", ...env },
    },
  );
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, v: parseJson<Verdict>(out.slice(out.indexOf("{"))) };
}
const rules = (v: Verdict) => (v.lint?.findings ?? []).map((f) => f.split(" ")[1]);

describe("what lint reports", () => {
  test.concurrent("Given a floating promise, when lint runs, then it names the file, line, column and rule", async () => {
    // GIVEN a viz that starts a promise and drops it
    const dir = viz("floating", {
      "index.html": page(),
      "app.ts": `async function save(): Promise<void> {}\nsave();\nexport {};\n`,
    });

    // WHEN lint runs
    const { v } = await lint(dir);

    // THEN the finding says where and which rule: the type-aware engine ran
    expect(
      v.lint!.findings.some((f) => f.startsWith("app.ts:2:1 typescript(no-floating-promises) — ")),
    ).toBe(true);
  });

  test.concurrent("Given a viz with no tsconfig, when lint runs, then a correctly typed call is not flagged as unsafe", async () => {
    // GIVEN code that is fully typed and fine, calling a kit helper by its @viz/kit alias (resolvable only through a tsconfig, which lint has to supply)
    const dir = viz("typed", {
      "index.html": page(),
      "app.ts": `import { esc } from "@viz/kit";\nexport const safe: string = esc("a < b");\n`,
    });

    // WHEN lint runs
    const { v } = await lint(dir);

    // THEN no unsafe-any finding appears: without a tsconfig every type would read as any
    expect(rules(v).filter((r) => r?.startsWith("typescript(no-unsafe"))).toEqual([]);
    // THEN lint left no tsconfig behind in the viz
    expect(existsSync(path.join(dir, "tsconfig.json"))).toBe(false);
  });

  test.concurrent("Given a viz importing the kit by its /_kit/ path, when lint runs, then it is a finding that names the alias, and --fix rewrites it", async () => {
    // GIVEN the old spelling, for the main kit file and another
    const dir = viz("old-kit-path", {
      "index.html": page(),
      "app.ts": `import { esc } from "/_kit/viz.js";\nimport { z } from "/_kit/zod.js";\nexport const safe: string = esc("a");\nexport const n = z.number();\n`,
    });

    // WHEN lint runs
    const before = await lint(dir);

    // THEN the absolute import is a finding that says what to write instead
    const found = before.v.lint!.findings.filter((f) => f.includes("no-absolute-path"));
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('"@viz/kit"');

    // WHEN lint --fix runs
    const after = await lint(dir, {}, ["--fix"]);

    // THEN the file says @viz/kit and @viz/kit/zod.js, and nothing is left to report
    expect(readFileSync(path.join(dir, "app.ts"), "utf8")).toContain(
      'from "@viz/kit";\nimport { z } from "@viz/kit/zod.js";',
    );
    expect(rules(after.v).filter((r) => r?.includes("no-absolute-path"))).toEqual([]);
  });

  test.concurrent("Given a viz with its own tsconfig, when lint runs, then that file is kept untouched", async () => {
    // GIVEN a viz that ships its own tsconfig
    const own = `{ "compilerOptions": { "strict": true } }`;
    const dir = viz("own-tsconfig", {
      "index.html": page(),
      "app.ts": `export const n: number = 1;\n`,
      "tsconfig.json": own,
    });

    // WHEN lint runs
    await lint(dir);

    // THEN it is still there, unchanged
    expect(readFileSync(path.join(dir, "tsconfig.json"), "utf8")).toBe(own);
  });

  test.concurrent("Given thousands of findings, when lint runs, then every one is reported", async () => {
    // GIVEN a viz with 4,000 loose equalities, enough that the report runs past 1 MB (a pipe cuts that off)
    const lines = Array.from(
      { length: 4000 },
      (_, i) => `export const same${i} = (a: number, b: number) => a == b;`,
    );
    const dir = viz("many", { "index.html": page(), "app.ts": lines.join("\n") + "\n" });

    // WHEN lint runs
    const { v } = await lint(dir);

    // THEN all 4,000 are there, from the last line as well as the first, and nothing was lost to truncation
    expect(rules(v).filter((r) => r === "eslint(eqeqeq)")).toHaveLength(4000);
    expect(v.lint!.skipped).toBeNull();
  });

  test.concurrent("Given the type-aware engine cannot run, when lint runs, then ordinary rules still report and the result says what was skipped", async () => {
    // GIVEN tsgolint is not where it should be (a blocked binary on a locked-down machine looks the same), and a loose equality
    const dir = viz("no-tsgolint", {
      "index.html": page(),
      "app.ts": `export const same = (a: number, b: number) => a == b;\n`,
    });

    // WHEN lint runs
    const { v } = await lint(dir, { OXLINT_TSGOLINT_PATH: "/nonexistent/tsgolint" });

    // THEN the ordinary rule still found it
    expect(rules(v)).toContain("eslint(eqeqeq)");
    // THEN the result says the type-aware part was skipped, so it cannot read as a pass
    expect(v.lint!.skipped).toContain("type-aware lint skipped");
  });
});

describe("what makes lint fail", () => {
  test.concurrent("Given a finding, when lint runs, then it fails and the error says it is lint", async () => {
    // GIVEN a viz with a finding
    const dir = viz("fails", {
      "index.html": page(),
      "app.ts": `export const same = (a: number, b: number) => a == b;\n`,
    });

    // WHEN lint runs
    const { code, v } = await lint(dir);

    // THEN it fails, and the error says it is lint
    expect(code).toBe(1);
    expect(v.errors.some((e) => e.includes("LINT:") && e.includes("eqeqeq"))).toBe(true);
  });
});

describe("the checks Oxlint cannot do", () => {
  test.concurrent("Given a disable comment, when lint runs, then only the one with no reason is a finding", async () => {
    // GIVEN one disable comment with a reason and one without
    const dir = viz("disables", {
      "index.html": page(),
      "app.ts": [
        `// oxlint-disable-next-line eqeqeq -- the API returns null or undefined and both mean absent`,
        `export const a = (x: number | null) => x == null;`,
        ["// oxlint-", "disable-next-line eqeqeq"].join(""), // split so lint does not read this fixture line as a disable of its own
        `export const b = (x: number | null) => x == null;`,
        ``,
      ].join("\n"),
    });

    // WHEN lint runs
    const { v } = await lint(dir);

    // THEN only the bare one (line 3) is reported
    const bare = v.lint!.findings.filter((f) => f.includes("without a reason"));
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatch(/^app\.ts:3 /u);
  });

  test.concurrent("Given inline scripts, when lint runs, then code is a finding and an import map and a data block are not", async () => {
    // GIVEN a page with executable code inline, an import map and a JSON data block
    const dir = viz("inline", {
      "index.html": page(
        `<script>console.log("hi")</script>` +
          `<script type="importmap">{"imports":{}}</script>` +
          `<script type="application/json" id="d">{"a":1}</script>`,
      ),
      "app.ts": `export {};\n`,
    });

    // WHEN lint runs
    const { v } = await lint(dir);

    // THEN exactly the one holding code is reported
    const inline = v.lint!.findings.filter((f) => f.includes("inline <script>"));
    expect(inline).toHaveLength(1);
  });
});

describe("parent imports (import/no-relative-parent-imports)", () => {
  test.concurrent("Given ../ in app code and in a test, when lint runs, then only the app code's is a finding", async () => {
    // GIVEN a viz whose subfolder reaches up, and whose test imports the viz it tests
    const dir = viz("parent-imports", {
      "index.html": page('<script type="module" src="app.ts"></script>'),
      "app.ts": 'import { n } from "./sub/up.ts";\nexport const m: number = n;\n',
      "sub/up.ts": 'import { base } from "../base.ts";\nexport const n: number = base;\n',
      "base.ts": "export const base: number = 1;\n",
      "tests/app.test.ts": 'import { m } from "../app.ts";\nexport const t: number = m;\n',
    });

    // WHEN it is linted
    const { v } = await lint(dir);

    // THEN sub/up.ts is flagged, and tests/app.test.ts (the same ../) is not
    const found = (v.lint?.findings ?? []).filter((f) => f.includes("no-relative-parent-imports"));
    expect(found.map((f) => f.split(":")[0])).toEqual(["sub/up.ts"]);
  });
});

describe("the rules about the rules", () => {
  test("Given every disabled rule, then each carries a written reason", () => {
    // GIVEN the exceptions map

    // WHEN each entry is read
    const bare = Object.entries({ ...OFF_RULES, ...TEST_OFF_RULES, ...SKILL_OFF_RULES })
      .filter(([, why]) => why.trim().length < 5)
      .map(([r]) => r);

    // THEN none is missing its reason
    expect(bare).toEqual([]);
  });

  test("Given the generated config, then it turns off exactly the rules in the map and never enables style", () => {
    // GIVEN the config handed to Oxlint
    const cfg = parseJson<{
      categories: Record<string, string>;
      rules: Record<string, string>;
      overrides: { files: string[]; rules: Record<string, string> }[];
    }>(JSON.stringify(oxlintConfig()));

    // THEN the rules it turns off are the rules with reasons, and no more
    expect(Object.keys(cfg.rules).toSorted()).toEqual(Object.keys(OFF_RULES).toSorted());
    // THEN the rules it turns off inside tests/ are the ones with a reason there
    expect(cfg.overrides).toEqual([
      {
        files: ["**/tests/**"],
        rules: Object.fromEntries(Object.keys(TEST_OFF_RULES).map((r) => [r, "off"])),
      },
    ]);
    // THEN linting the skill's own source also turns off the skill-only exceptions (and a viz's lint does not)
    const own = parseJson<{ rules: Record<string, string> }>(JSON.stringify(oxlintConfig(true)));
    expect(Object.keys(own.rules).toSorted()).toEqual(
      Object.keys({ ...OFF_RULES, ...SKILL_OFF_RULES }).toSorted(),
    );
    // THEN the style category (the formatter's) is not enabled
    expect(cfg.categories["style"]).toBeUndefined();
  });

  test("Given each rule named as an exception, then Oxlint knows it", () => {
    // GIVEN Oxlint's own list of rules
    const r = Bun.spawnSync({
      cmd: [
        process.execPath,
        path.join(SKILL, "node_modules/oxlint/bin/oxlint"),
        "--rules",
        "--format=json",
      ],
    });
    const known = new Set(
      parseJson<{ scope: string; value: string }[]>(r.stdout.toString()).map((x) =>
        x.scope === "eslint" ? x.value : `${x.scope}/${x.value}`,
      ),
    );

    // WHEN the exception names are checked against it
    const unknown = Object.keys({ ...OFF_RULES, ...TEST_OFF_RULES, ...SKILL_OFF_RULES }).filter(
      (rule) => !known.has(rule),
    );

    // THEN a misspelt name cannot sit there silently switching nothing off
    expect(unknown).toEqual([]);
  });
});
