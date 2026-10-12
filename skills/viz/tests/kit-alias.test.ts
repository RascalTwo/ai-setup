// tests/kit-alias.test.ts — the kit's import alias (lib/server/kit-alias.ts).

import { describe, expect, test } from "bun:test";
import { KIT_ALIAS, aliasKitImports, withKitAlias } from "../lib/server/kit-alias.ts";
import { parseJson } from "./json.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mapOf = (html: string): { imports: Record<string, string>; scopes?: object } =>
  parseJson(/<script type="importmap">(.*?)<\/script>/u.exec(html)![1]!);

describe("aliasKitImports", () => {
  test("Given every import form, when rewritten, then viz.js is @viz/kit and any other kit file is @viz/kit/<file>", () => {
    const src = [
      `import { $ } from "/_kit/viz.js";`,
      `import type { Exchange } from '/_kit/exchange.js';`,
      `import "/_kit/deck.js";`,
      `const m = await import("/_kit/zod.js");`,
      `} from "/_kit/api.js";`,
    ].join("\n");
    expect(aliasKitImports(src)).toBe(
      [
        `import { $ } from "@viz/kit";`,
        `import type { Exchange } from '@viz/kit/exchange.js';`,
        `import "@viz/kit/deck.js";`,
        `const m = await import("@viz/kit/zod.js");`,
        `} from "@viz/kit/api.js";`,
      ].join("\n"),
    );
  });

  test("Given tags and strings that are not imports, when rewritten, then they are left alone", () => {
    const keep = `<script src="/_kit/feedback.js"></script><link href="/_kit/viz-kit.css"> fetch("/_kit/viz.js")`;
    expect(aliasKitImports(keep)).toBe(keep);
  });
});

describe("withKitAlias", () => {
  test("Given a page with no import map, when served, then one is first in <head>", () => {
    const html = withKitAlias(
      `<!doctype html><html><head><title>x</title></head><body></body></html>`,
    );
    expect(html).toMatch(/<head><script type="importmap">/u);
    expect(mapOf(html).imports).toEqual(KIT_ALIAS);
  });

  test("Given a page with its own import map, when served, then the alias is merged into that one map, the page's entries and scopes kept", () => {
    const own = `{"imports":{"three":"https://esm.sh/three"},"scopes":{"/a/":{"b":"/c"}}}`;
    const html = withKitAlias(`<head><script type="importmap">${own}</script></head>`);
    expect(html.match(/type="importmap"/gu)).toHaveLength(1);
    expect(mapOf(html).imports).toEqual({ ...KIT_ALIAS, three: "https://esm.sh/three" });
    expect(mapOf(html).scopes).toEqual({ "/a/": { b: "/c" } });
  });

  test("Given a page that maps the alias itself, when served, then the page's choice wins", () => {
    const html = withKitAlias(
      `<head><script type="importmap">{"imports":{"@viz/kit":"/mine.js"}}</script></head>`,
    );
    expect(mapOf(html).imports["@viz/kit"]).toBe("/mine.js");
  });

  test("Given an import map that is not JSON, when served, then the page is returned untouched", () => {
    const bad = `<head><script type="importmap">{nope</script></head>`;
    expect(withKitAlias(bad)).toBe(bad);
  });

  test("Given a fragment with no <head>, when served, then the map comes first", () => {
    expect(withKitAlias(`<div></div>`)).toStartWith(`<script type="importmap">`);
  });
});

describe("kit-resolve (the alias at runtime, in bun)", () => {
  const resolver = path.join(import.meta.dir, "../lib/server/kit-resolve.ts");
  // A backend (or a test of one) imports the kit statically, from its own file.
  const dir = mkdtempSync(path.join(tmpdir(), "kit-resolve-"));
  writeFileSync(
    path.join(dir, "api.ts"),
    `import { z } from "@viz/kit/zod.js"; console.log(typeof z);`,
  );
  const run = (preload: boolean) =>
    Bun.spawnSync(
      [
        "bun",
        "-e",
        `${preload ? `(await import(${JSON.stringify(resolver)})).registerKitResolver();` : ""} await import(${JSON.stringify(path.join(dir, "api.ts"))})`,
      ],
      { cwd: dir },
    );

  test("Given kit-resolve is imported, when a file imports @viz/kit/zod.js, then it resolves to the kit's file", () => {
    expect(run(true).stdout.toString().trim()).toBe("object");
  });
  test("Given it is not imported, when the same file runs, then it fails (so the plugin is what resolves it)", () => {
    expect(run(false).exitCode).not.toBe(0);
  });
});
