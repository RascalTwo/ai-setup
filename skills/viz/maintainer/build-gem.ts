#!/usr/bin/env bun
// build-gem.ts — render the skill as a Gemini Gem: one instructions string, fallback mode only.
//
// WHY EVERYTHING GOES IN THE INSTRUCTIONS: a Gem runs no code, so fallback mode is its ceiling.
// Knowledge files, GitHub imports and folder uploads are snapshots that can only be attached
// by hand in the Gem editor, and a programmatic update cannot carry them. Instructions can be
// written by a script, and Gemini reads all of them (tested at ~69KB: a canary on the last line
// was recalled; the build is ~110KB with the templates, so re-check the last file after a publish). So the whole method and the kit are inlined, and the files below are the
// only source — this script adds a preamble and nothing else.
//
// Output: .gem-dist/gem.json {name, description, instructions}. publish-gem.py pushes it.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERSION } from "../lib/version.ts";

const SKILL_DIR = path.dirname(import.meta.dir);
const OUT = path.join(SKILL_DIR, ".gem-dist");

const FILES = [
  "SKILL.md",
  "reference/fallback.md",
  "reference/diagrams.md",
  "reference/cdn.md",
  "reference/timeline.md",
  "kit/README.md",
  "kit/viz-kit.css",
  "kit/viz.js",
];

// Templates (reference/fallback.md "Templates still work"): every bundled viz that
// declares viz:template — all of its files, plus each /_kit/ file it links. Chosen by the
// meta, not by a list, so a new template reaches the Gem without touching this script.
// The self-portrait is not a template (and needs a server), so it never qualifies.
const BUNDLED = path.join(SKILL_DIR, "viz-pages");
for (const name of readdirSync(BUNDLED).sort()) {
  const idx = path.join(BUNDLED, name, "index.html");
  if (!existsSync(idx) || !/<meta\s+name=["']viz:template["']/i.test(readFileSync(idx, "utf8"))) continue;
  for (const f of readdirSync(path.join(BUNDLED, name)).sort()) {
    if (!/\.(html|js|css)$/.test(f)) continue;
    const rel = `viz-pages/${name}/${f}`;
    FILES.push(rel);
    for (const m of readFileSync(path.join(SKILL_DIR, rel), "utf8").matchAll(/\/_kit\/([\w.-]+\.(?:css|js))/g)) {
      if (!FILES.includes(`kit/${m[1]}`)) FILES.push(`kit/${m[1]}`);
    }
  }
}

const PREAMBLE = `You are viz (v${VERSION}): you turn anything the user wants to see into ONE self-contained interactive HTML page, built in Canvas.

YOUR MODE IS ALWAYS FALLBACK. You have no shell, no Bun, no server, no MCP tools. Skip the mode table in SKILL.md; it has already resolved to fallback. Never mention servers, hot-reload, git history, \`viz verify\`, or publishing.

Everything below this preamble is the skill's own files, concatenated. Each begins with a line "===== FILE: <path> =====". Where a file says "read reference/X.md" or "kit/README.md", that file is further down in these instructions. The kit files (kit/viz-kit.css, kit/viz.js) are here verbatim: inline them exactly as reference/fallback.md says, never retype or paraphrase them.

Every request: pick the spatial form and say it in one sentence; build the whole page in Canvas; walk the five bars from "Ambition" before handing it over; finish with one line on what it shows and what the reader can drive. For changes, edit the Canvas page and keep it one file.`;

const instructions = [
  PREAMBLE,
  ...FILES.map((f) => `===== FILE: ${f} =====\n\n${readFileSync(path.join(SKILL_DIR, f), "utf8").trim()}`),
].join("\n\n\n");

const gem = {
  name: "viz",
  description:
    "Turns anything into an interactive visualization: charts, diagrams, state machines, " +
    `dashboards, explainers. One self-contained HTML page in Canvas. v${VERSION}`,
  instructions,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "gem.json"), JSON.stringify(gem, null, 2));
writeFileSync(path.join(OUT, "instructions.md"), instructions); // for a manual paste into the editor
console.log(`${path.relative(process.cwd(), OUT)}/gem.json — v${VERSION}, ${instructions.length} chars from ${FILES.length} files`);
