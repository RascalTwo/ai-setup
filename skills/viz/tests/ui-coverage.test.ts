// tests/ui-coverage.test.ts — the self-portrait covers exactly the verbs the CLI says it does.
//
// WHY: every command declares `ui` next to `mcp` (lib/cli-meta.ts). MCP coverage is
// generated from its declaration, so it cannot drift; the UI is hand-written, so the next
// best thing is a test holding the two to each other. The UI drifted precisely because
// nothing said which verbs it was meant to cover.
//
// "Spawned" is read from api.ts's source — the literal argv arrays it hands to viz() —
// because that is the UI's whole write path (ADR 0009): if a verb isn't spawned there,
// the page cannot do it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildProgram } from "../program.ts";
import { walk, resolveMeta } from "../lib/cli-meta.ts";

const SKILL = path.dirname(import.meta.dir);
const API = readFileSync(path.join(SKILL, "viz-pages", "viz-self-portrait", "api.ts"), "utf8");
// The server's own absolute routes (/_rescan …), which the page can call besides its api/.
const SERVER_ROUTES = readFileSync(path.join(SKILL, "lib", "server", "routes.ts"), "utf8");
const leaves = walk(buildProgram()).map(({ cmd, path }) => ({ cmd, verb: path.join(" ") }));
const leafSet = new Set(leaves.map((l) => l.verb));

/** Verb paths api.ts spawns: `viz([...])`, `vizSpawn([...])`, or a `const args = [...]` it builds. */
function spawnedVerbs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:\bviz|\bvizSpawn)\(\s*\[([^\]]*)|const args = \[([^\]]*)/g)) {
    const items = (m[1] ?? m[2])!.split(",").map((s) => s.trim());
    const lit = (s: string | undefined) => s?.match(/^"([^"]+)"$/)?.[1];
    const first = lit(items[0]);
    if (!first) continue;
    const second = lit(items[1]);
    if (second && leafSet.has(`${first} ${second}`)) out.push(`${first} ${second}`);
    else if (leafSet.has(first)) out.push(first);
    else {
      // A group verb with a dynamic sub must list its subs literally: <GROUP>_SUBS = [...].
      const subs = src.match(new RegExp(`${first.toUpperCase()}_SUBS = \\[([^\\]]*)\\]`))?.[1];
      if (!subs) { out.push(first); continue; } // not a leaf, not expandable — test (c) reports it
      for (const s of subs.matchAll(/"([^"]+)"/g)) out.push(`${first} ${s[1]}`);
    }
  }
  return [...new Set(out)];
}
const spawned = spawnedVerbs(API);

describe("ui coverage is declared, and api.ts honours it", () => {
  test("Given the command tree, then every leaf resolves a ui shape (none unclassified)", () => {
    const missing = leaves.filter(({ cmd }) => !resolveMeta(cmd)?.ui).map((l) => l.verb);
    expect(missing).toEqual([]);
  });

  test("Given a cli-only leaf, then it says why", () => {
    const bare = leaves.filter(({ cmd }) => { const ui = resolveMeta(cmd)?.ui; return ui?.kind === "cli-only" && !ui.why.trim(); });
    expect(bare.map((l) => l.verb)).toEqual([]);
  });

  // "shown" = the page shows this data without running the command. `how` must name what it
  // reads — an api.ts route, a server route, or a lib module api.ts imports — and that thing
  // must exist, so a `how` cannot quietly rot into a claim about a route that is gone.
  test("Given a shown leaf, then its how names a route or lib module that exists", () => {
    const rotten: string[] = [];
    for (const { cmd, verb } of leaves) {
      const ui = resolveMeta(cmd)?.ui;
      if (ui?.kind !== "shown") continue;
      const routes = [...ui.how.matchAll(/(?<![\w.])\/[a-z_][\w-]*(?![\w\/.])/g)].map((m) => m[0]);
      const libs = [...ui.how.matchAll(/\blib\/[\w\/-]+\.ts\b/g)].map((m) => m[0]);
      if (!routes.length && !libs.length) rotten.push(`${verb}: how names no route or lib`);
      for (const r of routes) if (!API.includes(`"${r}":`) && !SERVER_ROUTES.includes(`"${r}"`)) rotten.push(`${verb}: no route ${r}`);
      for (const l of libs) if (!API.includes(`"../../${l}"`)) rotten.push(`${verb}: api.ts does not import ${l}`);
    }
    expect(rotten).toEqual([]);
  });

  test("Given a drawer leaf, then api.ts spawns it", () => {
    const drawer = leaves.filter(({ cmd }) => resolveMeta(cmd)?.ui.kind === "drawer").map((l) => l.verb);
    expect(drawer.length).toBeGreaterThan(0);
    expect(drawer.filter((v) => !spawned.includes(v))).toEqual([]);
  });

  test("Given a verb api.ts spawns, then it is a real leaf declared drawer", () => {
    expect(spawned.length).toBeGreaterThan(0);
    const bad = spawned.filter((v) => {
      const leaf = leaves.find((l) => l.verb === v);
      return !leaf || resolveMeta(leaf.cmd)?.ui.kind !== "drawer";
    });
    expect(bad).toEqual([]);
  });
});
