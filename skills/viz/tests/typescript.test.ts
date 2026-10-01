// tests/typescript.test.ts — a viz may be written in TypeScript (ADR 0023).
//
// WHY: types are protection only if something checks them. The server strips them as it
// serves, the export bundles them away, and `viz verify` is where they are checked — so each
// of the three is held here: served as JS, exported as JS, and a type error fails verify.
import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { serveStatic } from "../lib/server/static.ts";
import { buildSelfContained } from "../inline.ts";
import { typecheck } from "../lib/verify/types.ts";

const SKILL = path.dirname(import.meta.dir);
const TMP = path.join(SKILL, "tests", ".tmp-vizzes-ts");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function viz(name: string, files: Record<string, string>): string {
  const dir = path.join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), body);
  }
  return dir;
}
const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><h1>Fixture</h1><svg width="200" height="100"><rect width="80" height="60"/><circle cx="140" cy="50" r="30"/></svg><p>A fixture viz with enough on it to pass the layout audit.</p>${body}</body></html>`;

// An app.ts referenced as ./app.js, importing a sibling the same way.
const typed = {
  "index.html": page(`<p id="out"></p><script type="module" src="./app.js"></script>`),
  "content.ts": `export interface Item { label: string; n: number }\nexport const items: Item[] = [{ label: "a", n: 2 }, { label: "b", n: 3 }];\n`,
  "app.ts": `import { items, type Item } from "./content.js";\nconst total = (xs: Item[]): number => xs.reduce((s, x) => s + x.n, 0);\ndocument.getElementById("out")!.textContent = String(total(items));\n`,
};

describe("writing a viz in TypeScript", () => {
  test("Given app.ts and a page asking for app.js, when the server serves app.js, then it is the TypeScript with its types stripped", async () => {
    const dir = viz("served", typed);
    const res = await serveStatic(dir, "app.js", "served");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const js = await res.text();
    expect(js).toContain("reduce((s, x) => s + x.n, 0)");
    expect(js).not.toContain(": number");
    expect(js).not.toContain("type Item");
    // a .js that exists is served as itself, and one with no .ts beside it is still a 404
    expect((await serveStatic(dir, "missing.js", "served")).status).toBe(404);
  });

  test("Given a module and a classic script in TypeScript, when served, then the module carries a source map to its .ts and the classic script stays classic", async () => {
    // The map is what lets verify's coverage report .ts lines; the classic script must not be bundled,
    // or its top-level const would become a var — a property of window.
    const dir = viz("served-maps", {
      "app.ts": `import { n } from "./data.js";\nconst label: string = "x";\nexport const out = label + n;\n`,
      "data.ts": `export const n: number = 1;\n`,
      "boot.ts": `const status: string = "ok";\ndocument.title = status;\n`,
    });
    const mod = await (await serveStatic(dir, "app.js", "served-maps")).text();
    expect(mod).toContain('from "./data.js"'); // imports left as written, not bundled in
    const map = JSON.parse(Buffer.from(mod.match(/sourceMappingURL=data:application\/json;base64,(\S+)/)![1]!, "base64").toString());
    expect(map.sources).toEqual(["app.ts"]);
    const classic = await (await serveStatic(dir, "boot.js", "served-maps")).text();
    expect(classic).toContain("const status");
    expect(classic).not.toContain("sourceMappingURL");
  });

  test("Given a TypeScript viz, when it is exported self-contained, then the page carries plain JavaScript and no warnings", () => {
    const dir = viz("exported", typed);
    const { html, warnings } = buildSelfContained(dir);
    expect(warnings).toEqual([]);
    expect(html).toContain("var items = [");
    expect(html).not.toContain("interface Item");
    expect(html).not.toContain('src="./app.js"');
  });

  test("Given a module that imports a library the page's import map names, when exported self-contained, then the import is left for the browser to resolve", () => {
    // GIVEN a page whose import map points a bare specifier at a CDN, and a module that imports it (as closeout-technique does with three)
    const dir = viz("importmap-bare", {
      "index.html": page(`<script type="importmap">{ "imports": { "three": "https://esm.sh/three@0.160.0", "three/addons/": "https://esm.sh/three@0.160.0/examples/jsm/" } }</script><script type="module" src="./app.js"></script>`),
      "app.ts": `const T: any = await import("three");\nconst { OrbitControls } = await import("three/addons/controls/OrbitControls.js");\nexport const ok: boolean = !!T && !!OrbitControls;\n`,
    });

    // WHEN it is exported
    const { html, warnings } = buildSelfContained(dir);

    // THEN the export succeeds, and the specifiers are still there for the import map to resolve in the browser
    expect(warnings).toEqual([]);
    expect(html).toContain('import("three")');
    expect(html).toContain('"three/addons/controls/OrbitControls.js"');
  });

  test("Given a type error in a .ts file and a wrong call into the kit, when types are checked, then both are named with file and line", () => {
    const dir = viz("typecheck", {
      ...typed,
      "bad.ts": `import { saveHash } from "/_kit/viz.js";\nconst n: number = "text";\nsaveHash(1, 2, 3);\n`,
    });
    const r = typecheck(dir)!;
    expect(r.files).toEqual(["app.ts", "bad.ts", "content.ts"]);
    expect(r.errors.some((e) => e.startsWith("bad.ts(2,") && e.includes("TS2322"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("bad.ts(3,") && e.includes("TS2554"))).toBe(true);
    expect(r.errors.filter((e) => !e.startsWith("bad.ts"))).toEqual([]);
  });

  test("Given a wrong use of what the kit returns, when types are checked, then it is caught with the kit's own types", () => {
    // Argument counts are checkable against the generated JS; return types need kit/src.
    const dir = viz("kit-returns", {
      "app.ts": `import { $ } from "/_kit/viz.js";\nimport { sortIndices } from "/_kit/pairwise.js";\nconst el = $("#out")!;\nel.textContent = 42;\nvoid sortIndices;\n`,
    });
    const errs = typecheck(dir)!.errors;
    expect(errs.some((e) => e.startsWith("app.ts(4,") && e.includes("TS2322"))).toBe(true);
    expect(errs.filter((e) => !e.startsWith("app.ts(4,"))).toEqual([]); // pairwise.js, with no source, still resolves
  });

  test("Given a page that loads /_kit/deck.js by <script src>, when types are checked, then a deck:slide listener's event is typed and a wrong field is caught", () => {
    const dir = viz("deck-event", {
      "index.html": page(`<div id="deck"></div><script type="module" src="/_kit/deck.js"></script><script src="./hooks.js"></script>`),
      "hooks.ts": `addEventListener("deck:slide", (e) => { const n: number = e.detail.index; const s: string = e.detail.total; void n; void s; });\n`,
    });
    const errs = typecheck(dir)!.errors;
    expect(errs.some((e) => e.startsWith("hooks.ts(1,") && e.includes("TS2322"))).toBe(true); // total is a number
    expect(errs).toHaveLength(1); // e.detail.index needs no cast
  });

  test("Given CDN imports of libraries the skill has types for, when types are checked, then misuse is caught and unknown ones are any", () => {
    const dir = viz("cdn-types", {
      "app.ts": `import * as d3 from "https://esm.sh/d3@7";\nimport { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";\nimport anything from "https://esm.sh/not-a-real-package@1";\nconst s: string = d3.scaleLinear()(0.5);\nvoid OrbitControls;\nanything.goes();\nvoid s;\n`,
    });
    const errs = typecheck(dir)!.errors;
    expect(errs.some((e) => e.startsWith("app.ts(4,") && e.includes("TS2322"))).toBe(true); // d3's real types
    expect(errs.filter((e) => !e.startsWith("app.ts(4,"))).toEqual([]); // three's subpath resolves; the unknown one is any
  });

  test("Given a classic <script src> backed by TypeScript, when exported self-contained, then it is inlined as a classic script, types stripped", () => {
    const dir = viz("classic-export", {
      "index.html": page(`<p id="out"></p><script src="./boot.js"></script>`),
      "boot.ts": `const label: string = "</script> safe";\nfunction showTab(n: number): void { document.getElementById("out")!.textContent = label + n; }\nshowTab(1);\n`,
    });
    const { html } = buildSelfContained(dir);
    expect(html).not.toContain('src="./boot.js"');
    expect(html).toContain("function showTab(n)");       // stripped, and still a global function
    expect(html).not.toMatch(/<script type="module">[^<]*showTab/); // not turned into a module
    expect(html).toContain("<\\/script> safe");       // a literal </script> can't end the tag early
  });

  test("Given code that is fine under plain `strict` but not under the full set, when types are checked, then each is caught", () => {
    const dir = viz("max-strict", {
      "a.ts": `export const xs: number[] = [1];\nexport const first: number = xs[0];\n`,           // index may be undefined
      "b.ts": `export function f(n: number): string {\n  if (n > 0) return "pos";\n}\n`,              // not every path returns
      "c.ts": `import { xs } from "./a.js";\nconst unused = xs;\n`,                                   // unused local
      "d.ts": `import { Item } from "./e.js";\nexport const i: Item = { n: 1 };\n`,                   // type imported as a value
      "e.ts": `export interface Item { n: number }\n`,
    });
    const errs = typecheck(dir)!.errors.join("\n");
    expect(errs).toMatch(/a\.ts\(2,\d+\): error TS2322/);   // noUncheckedIndexedAccess
    expect(errs).toMatch(/b\.ts\(1,\d+\): error TS(2366|7030)/); // noImplicitReturns
    expect(errs).toMatch(/c\.ts\(2,\d+\): error TS6133/);   // noUnusedLocals
    expect(errs).toMatch(/d\.ts\(1,\d+\): error TS1484/);   // verbatimModuleSyntax
  });

  test("Given a Bun backend beside the page, when types are checked, then Bun's globals and ./x.ts imports are fine and it is still checked", () => {
    // The page program is rooted at what index.html loads; everything else is backend, typed against Bun.
    const dir = viz("with-backend", {
      ...typed,
      "api.ts": `import { port } from "./lib/env.ts";\nexport default { data: () => Response.json({ v: Bun.version, port, home: process.env.HOME }) };\n`,
      "lib/env.ts": `export const port: number = Number(process.env.PORT ?? 3000);\nexport const f = Bun.file("x");\n`,
      "verify.interactions.ts": `export default async (page, { shot }) => { await shot(page); };\n`,
    });
    const r = typecheck(dir)!;
    expect(r.errors).toEqual([]);
    expect(r.files).toEqual(["api.ts", "app.ts", "content.ts", "lib/env.ts"]); // the verify script is left out
    const bad = viz("with-backend-bad", { ...typed, "api.ts": `export const n: number = "text";\nconst z = Bun.nope;\nvoid z;\n` });
    const errs = typecheck(bad)!.errors;
    expect(errs.some((e) => e.startsWith("api.ts(1,") && e.includes("TS2322"))).toBe(true);   // checked at all
    expect(errs.some((e) => e.startsWith("api.ts(2,") && e.includes("TS2339"))).toBe(true);   // against Bun's real types
  });

  test("Given a contract shared by a backend and a page, when types are checked, then a wrong reply, a wrong body and a missing route are each caught and a right one is not", () => {
    const files = (over: Record<string, string> = {}) => ({
      "index.html": page(`<script type="module" src="./app.js"></script>`),
      "contract.ts": `export interface Routes {\n  "/run": { body: { stage: string }; reply: { jobId: string } };\n  "/status": { body: null; reply: { done: boolean } };\n  "/step": { body: null; method: "POST"; query: { id: string }; reply: { ok: true } };\n}\n`,
      "api.ts": `import type { Handlers } from "/_kit/api.js";\nimport type { Routes } from "./contract.ts";\nexport default {\n  "/run": async (req) => { const { stage } = await req.json(); return { jobId: stage }; },\n  "/status": () => ({ done: true }),\n  "/step": () => ({ ok: true as const }),\n} satisfies Handlers<Routes>;\n`,
      "app.ts": `import { api } from "/_kit/api.js";\nimport type { Routes } from "./contract.js";\nconst { get, post } = api<Routes>();\nconst run: string = (await post("/run", { body: { stage: "a" } })).jobId;\nconst done: boolean = (await get("/status")).done;\nawait post("/step", { query: { id: "a" }, timeout: 5000, cache: "no-store" });\nawait get("/status", { timeout: 1000 });\nvoid run; void done;\n`,
      ...over,
    });
    expect(typecheck(viz("contract-ok", files()))!.errors).toEqual([]);
    // the server returns the wrong shape: `satisfies` compares the value, so this is an error (an `as` would let a missing field through)
    const badReply = typecheck(viz("contract-bad-reply", files({ "api.ts": files()["api.ts"]!.replace("({ done: true })", "({ finished: true })") })))!.errors;
    expect(badReply.some((e) => e.startsWith("api.ts(") && e.includes("finished"))).toBe(true);
    // a route the contract has and the backend does not
    const missing = typecheck(viz("contract-missing", files({ "api.ts": files()["api.ts"]!.replace('  "/status": () => ({ done: true }),\n', "") })))!.errors;
    expect(missing.some((e) => e.startsWith("api.ts(") && e.includes("/status"))).toBe(true);
    // the page sends the wrong body, or reads a field the reply does not have
    const page1 = typecheck(viz("contract-bad-page", files({ "app.ts": files()["app.ts"]!.replace('{ stage: "a" }', "{ stage: 1 }").replace(".done", ".finished") })))!.errors;
    expect(page1.filter((e) => e.startsWith("app.ts(")).length).toBe(2);
    // the wrong verb, a missing required query, an undeclared query key: each is an error on the page
    for (const [name, call] of [["verb", 'await get("/run");'], ["query", 'await post("/step");'], ["extra", 'await post("/step", { query: { id: "a", nope: 1 } });'], ["option", 'await get("/status", { timeout: "soon" });'], ["body", 'await post("/run", { timeout: 5 });']] as const) {
      const errs = typecheck(viz(`contract-${name}`, files({ "app.ts": files()["app.ts"]!.replace("void run;", `${call} void run;`) })))!.errors;
      expect({ name, n: errs.filter((e) => e.startsWith("app.ts(")).length > 0 }).toEqual({ name, n: true });
    }
  });

  test("Given a page whose script is inline in index.html, when a backend sits beside it, then api.ts is still checked as backend, not as page", () => {
    // No <script src> means nothing to root the page at; api.ts must not fall into "all page" and lose Bun's types.
    const dir = viz("inline-page", {
      "index.html": page(`<script type="module">document.title = "x";</script>`),
      "api.ts": `import { readdirSync } from "node:fs";\nexport default { "/ls": () => readdirSync(import.meta.dir) };\n`,
    });
    expect(typecheck(dir)!.errors).toEqual([]);
    const bad = viz("inline-page-bad", { "index.html": page(`<script type="module">1</script>`), "api.ts": `export const n: number = "x";\n` });
    expect(typecheck(bad)!.errors.some((e) => e.startsWith("api.ts(1,") && e.includes("TS2322"))).toBe(true);
  });

  test("Given a backend that parses upstream JSON with the kit's Zod, when types are checked, then the inferred type is real: a wrong use is caught and a right one is not", () => {
    const api = (use: string) => `import { z } from "/_kit/zod.js";\nconst Token = z.object({ access_token: z.string(), expires_in: z.number().optional() });\nexport type Token = z.infer<typeof Token>;\nexport async function token(r: Response): Promise<string> {\n  const t = Token.parse(await r.json());\n  ${use}\n}\n`;
    expect(typecheck(viz("zod-ok", { "index.html": page(""), "api.ts": api("return t.access_token;") }))!.errors).toEqual([]);
    const bad = typecheck(viz("zod-bad", { "index.html": page(""), "api.ts": api("return t.access_tokn;") }))!.errors;
    expect(bad.some((e) => e.startsWith("api.ts(") && e.includes("access_tokn"))).toBe(true);
    const wrong = typecheck(viz("zod-wrong", { "index.html": page(""), "api.ts": api("return t.expires_in;") }))!.errors;
    expect(wrong.some((e) => e.startsWith("api.ts(") && e.includes("TS2322"))).toBe(true); // number | undefined is not a string
  });

  test("Given a browser script that uses a Bun global, when types are checked, then it is an error: the page keeps its browser settings", () => {
    const dir = viz("page-uses-bun", { ...typed, "app.ts": `console.log(Bun.version);\n` });
    expect(typecheck(dir)!.errors.some((e) => e.startsWith("app.ts(1,") && e.includes("Bun"))).toBe(true);
  });

  test("Given a viz's own tests that use the viz global correctly, when types are checked, then they are checked and clean", () => {
    // GIVEN a journey test and a function-scope test that imports the page's module
    const dir = viz("tests-ok", {
      ...typed,
      "tests/journey.test.ts": `import { it, expect } from "bun:test";\nit("opens", async () => {\n  const page = await viz.open({ type: "x" }, { width: 800 });\n  expect(page.errors).toEqual([]);\n  const n = await page.$eval("#out", (e) => e.textContent);\n  expect(n).toBe("");\n  await viz.screenshot(page, "shot", { selector: "#out", maxDiffPixels: 4 });\n});\n`,
      "calc.ts": `export const items: number[] = [1, 2];\n`,
      "tests/unit.test.ts": `import { it, expect } from "bun:test";\nimport { items } from "../calc.ts";\nit("has items", () => { expect(items.length).toBeGreaterThan(0); });\n`,
    });
    // WHEN types are checked
    const r = typecheck(dir)!;
    // THEN the tests are among the files checked, and there is nothing to report
    expect(r.files).toContain("tests/journey.test.ts");
    expect(r.files).toContain("tests/unit.test.ts");
    expect(r.errors).toEqual([]);
  });

  test("Given tests that mark work to do with a bare it.todo(label), when types are checked, then they are clean", () => {
    // GIVEN todo markers with no body, the way Bun accepts them (bun-types 1.4.2 types them as ordinary tests, which need one)
    const dir = viz("tests-todo", {
      ...typed,
      "tests/todo.test.ts": `import { describe, it, test } from "bun:test";\nit.todo("a journey nobody wrote yet");\ntest.todo("a unit nobody wrote yet");\ndescribe("group", () => { it.todo("inside a group"); it.todo("with a body too", () => {}); });\n`,
    });
    // WHEN types are checked, THEN there is nothing to report
    expect(typecheck(dir)!.errors).toEqual([]);
  });

  test("Given a test that misuses the viz global or has a plain type error, when types are checked, then each is named with file and line", () => {
    // GIVEN a screenshot with no name, a wrong option, and a string where a number goes
    const dir = viz("tests-bad", {
      ...typed,
      "tests/bad.test.ts": `import { it } from "bun:test";\nit("bad", async () => {\n  const page = await viz.open();\n  await viz.screenshot(page);\n  await viz.open({}, { widht: 800 });\n  const n: number = "text";\n  void n;\n});\n`,
    });
    // WHEN types are checked
    const errors = typecheck(dir)!.errors;
    // THEN all three are caught, attributed to the test file
    expect(errors.some((e) => e.startsWith("tests/bad.test.ts(4,") && e.includes("TS2554"))).toBe(true); // screenshot needs a name
    expect(errors.some((e) => e.startsWith("tests/bad.test.ts(5,"))).toBe(true); // widht is not an option
    expect(errors.some((e) => e.startsWith("tests/bad.test.ts(6,") && e.includes("TS2322"))).toBe(true);
  });

  test("Given a test that only fails inside the page's own code, when types are checked, then the error is reported once, against the page, not again against the test", () => {
    const dir = viz("tests-import-page-error", {
      ...typed,
      "app.ts": `export const items: number[] = [1];\nexport const bad: number = "page bug";\n`,
      "tests/unit.test.ts": `import { it } from "bun:test";\nimport { items } from "../app.ts";\nit("x", () => { void items; });\n`,
    });
    const errors = typecheck(dir)!.errors;
    expect(errors.filter((e) => e.includes("page bug") || e.startsWith("app.ts("))).toHaveLength(1);
    expect(errors.some((e) => e.startsWith("tests/"))).toBe(false);
  });

  test("Given a backend that imports code outside the viz, when types are checked, then that code's errors are not the viz's", () => {
    const outside = viz("outside-lib", { "lib.ts": `export const n: number = "not mine";\n` });
    const dir = viz("imports-outside", { ...typed, "api.ts": `import { n } from "../outside-lib/lib.ts";\nexport default () => Response.json(n);\n` });
    expect(outside).toContain("outside-lib");
    expect(typecheck(dir)!.errors).toEqual([]);
  });

  test("Given a viz with nothing typed, when types are checked, then there is nothing to report", () => {
    const dir = viz("untyped", { "index.html": page(""), "app.js": "console.log(1)\n" });
    expect(typecheck(dir)).toBeNull();
  });

  test.concurrent("Given a plain-JS viz whose script opts into // @ts-check, when verify runs, then a JSDoc type error fails it", async () => {
    // Fallback mode's route to the same protection: plain JS the browser runs as-is, typed in comments.
    const dir = viz("ts-check-js", {
      "index.html": page(`<script type="module" src="./app.js"></script>`),
      "app.js": `// @ts-check\n/** @param {{ label: string }} x */\nconst show = (x) => x.label.toUpperCase();\nshow({ label: 7 });\n`,
    });
    const proc = Bun.spawn(["bun", path.join(SKILL, "viz.ts"), "verify", `file://${dir}/index.html`, "--json"], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, VIZ_NO_OPEN: "1" },
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    const v = JSON.parse(out.slice(out.indexOf("{")));
    expect(code).toBe(1);
    expect(v.errors.some((e: string) => e.includes("TYPES: app.js(4,") && e.includes("TS2322"))).toBe(true);
  }, 120_000);
});
