// tests/export-bundle.test.ts — a single-file export carries what a page loads at runtime.
//
// Three things broke a real film's export (pr-viz, PR #1187): a bare relative module src
// ("main.js", no "./") was left pointing at a file that doesn't travel; data the page fetch()es
// had no way in; and a kit module importing another kit module ("/_kit/viz.js") can't resolve
// that from inside a data: URL.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJson } from "./json.ts";

const SKILL = path.dirname(import.meta.dir);

test("Given a page with a bare module src, viz:bundle data and a kit film import, when exported, then all of it is inside the one file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "viz-bundle-"));
  const src = path.join(dir, "page"),
    out = path.join(dir, "out");
  Bun.spawnSync(["mkdir", "-p", src]);
  writeFileSync(
    path.join(src, "index.html"),
    `<!doctype html><meta name="viz:posture" content="public">
<meta name="viz:bundle" content="data.json"><div id=x></div><script type="module" src="main.js"></script>`,
  );
  writeFileSync(
    path.join(src, "main.js"),
    `import { film } from "/_kit/film.js"; void film;
document.getElementById("x").textContent = (await (await fetch("data.json")).json()).hello;`,
  );
  writeFileSync(path.join(src, "data.json"), `{"hello":"from the bundle"}`);
  const r = Bun.spawnSync(
    [process.execPath, path.join(SKILL, "viz.ts"), "export", src, "--out", out, "--no-og"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(r.exitCode).toBe(0);
  const html = readFileSync(path.join(out, readdirSync(out)[0]!, "index.html"), "utf8");

  expect(html).not.toContain('src="main.js"'); // bundled inline
  expect(html).toContain(Buffer.from(`{"hello":"from the bundle"}`).toString("base64")); // data.json embedded
  const map = parseJson<{ imports: Record<string, string> }>(
    /<script type="importmap">(.*?)<\/script>/u.exec(html)![1]!,
  ).imports;
  const filmSrc = Buffer.from(map["/_kit/film.js"]!.split(",")[1]!, "base64").toString();
  expect(filmSrc).not.toContain('"/_kit/viz.js"'); // rewritten to viz.js's own data: URL
  rmSync(dir, { recursive: true, force: true });
}, 60_000);

test("Given a page importing the kit by its alias, when exported, then @viz/kit and @viz/kit/film.js resolve to inlined data: URLs", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "viz-alias-"));
  const src = path.join(dir, "page"),
    out = path.join(dir, "out");
  Bun.spawnSync(["mkdir", "-p", src]);
  writeFileSync(
    path.join(src, "index.html"),
    `<!doctype html><meta name="viz:posture" content="public"><div id=x></div><script type="module" src="main.js"></script>`,
  );
  writeFileSync(
    path.join(src, "main.js"),
    `import { $ } from "@viz/kit"; import { film } from "@viz/kit/film.js"; void $; void film;`,
  );
  const r = Bun.spawnSync(
    [process.execPath, path.join(SKILL, "viz.ts"), "export", src, "--out", out, "--no-og"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(r.exitCode).toBe(0);
  const html = readFileSync(path.join(out, readdirSync(out)[0]!, "index.html"), "utf8");

  const map = parseJson<{ imports: Record<string, string> }>(
    /<script type="importmap">(.*?)<\/script>/u.exec(html)![1]!,
  ).imports;
  expect(map["@viz/kit"]).toStartWith("data:text/javascript;base64,");
  expect(map["@viz/kit/film.js"]).toStartWith("data:text/javascript;base64,");
  expect(html).toContain('from "@viz/kit"'); // the page's own specifiers are untouched; the map resolves them
  rmSync(dir, { recursive: true, force: true });
}, 60_000);
