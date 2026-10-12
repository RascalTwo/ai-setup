#!/usr/bin/env bun
// build.ts <viz-dir> — spec.json → narration.json for the film, and the shared grill files beside the page. One voice (Kokoro) to keep it quick; add
// more under "voices" for a second take. Run after every change to spec.json; `viz verify` then compiles the clips.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Spec } from "./template/spec.schema.ts";
import { script } from "./template/script.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: build.ts <viz-dir>");
// Parsed by the page and its backend with the schema; this only reads what the script uses.
const specFile = path.join(dir, "spec.json");
const spec: Spec = JSON.parse(readFileSync(specFile, "utf8"));
// A rebuild is the agent handing the page back: the page clears the ✗ and kinda it was sent.
writeFileSync(specFile, `${JSON.stringify({ ...spec, revisedAt: new Date().toISOString() }, null, 2)}\n`);
// The page loads grill.ts for its cards, so a rebuild picks up any fix to the shared files.
for (const f of ["grill.ts", "grill.css", "grill-expand.js"])
  copyFileSync(path.join(import.meta.dir, "..", f), path.join(dir, f));
const cues: { at: string; say: string }[] = [];
for (const s of script(spec)) for (const say of s.lines) cues.push({ at: `beat:${cues.length + 1}`, say });
const narration = { voice: "af_heart", speed: 1.12, voices: [{ id: "kokoro", label: "Kokoro" }], cues };
writeFileSync(path.join(dir, "narration.json"), `${JSON.stringify(narration, null, 2)}\n`);
console.log(`narration.json: ${cues.length} beats`);
