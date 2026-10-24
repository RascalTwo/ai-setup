#!/usr/bin/env bun
// build.ts <viz-dir> — spec.json → narration.json for the film, and the shared grill files beside the page. One voice (Kokoro) to keep it quick; add
// more under "voices" for a second take. Run after every change to spec.json; `viz verify` then compiles the clips.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Spec } from "./template/spec.schema.ts";
import { script } from "./template/script.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: build.ts <viz-dir>");
// Parsed by the page and its backend with the schema; this only reads what the script uses.
const specFile = path.join(dir, "spec.json");
const spec: Spec = JSON.parse(readFileSync(specFile, "utf8"));
// A prototype that 404s shows as a blank box on the card, so catch a missing file here.
for (const i of [...spec.examples, ...spec.assumptions])
  if (i.try && !/^https?:/u.test(i.try) && !existsSync(path.join(dir, i.try)))
    throw new Error(`${i.id}: try file ${i.try} is not in ${dir}`);
// A card is read in seconds, so its text stays plain: code names and long text go in `detail`.
for (const i of [...spec.examples, ...spec.assumptions])
  if (i.text.includes("`") || i.text.length > 200)
    console.warn(`${i.id}: not plain words (${i.text.length} chars${i.text.includes("`") ? ", has code" : ""}): move the technical part to "detail"`);
// Corrections sent since the last build make this a new version: the agent says what changed, the build bumps it.
const log = path.join(dir, ".viz-data", "feedback.jsonl");
const sentSince = existsSync(log) && readFileSync(log, "utf8").split("\n").some((l) => {
  if (!l.includes('"send"')) return false;
  const e: { type?: string; at?: string } = JSON.parse(l);
  return e.type === "send" && (e.at ?? "") > (spec.revisedAt ?? "");
});
const next = spec.version + 1;
const declared = spec.changes.at(-1)?.v === next;
if (sentSince && !declared)
  throw new Error(`corrections were sent since the last build: add { "v": ${next}, "what": "<what changed, one line>" } to changes`);
// A rebuild is the agent handing the page back: the page clears the ✗ and kinda it was sent.
const version = declared ? next : spec.version;
writeFileSync(specFile, `${JSON.stringify({ ...spec, version, revisedAt: new Date().toISOString() }, null, 2)}\n`);
// The page loads grill.ts for its cards, so a rebuild picks up any fix to the shared files.
for (const f of ["grill.ts", "grill.css", "grill-expand.js"])
  copyFileSync(path.join(import.meta.dir, "..", f), path.join(dir, f));
const cues: { at: string; say: string }[] = [];
for (const s of script(spec)) for (const say of s.lines) cues.push({ at: `beat:${cues.length + 1}`, say });
const narration = { voice: "af_heart", speed: 1.12, voices: [{ id: "kokoro", label: "Kokoro" }], cues };
writeFileSync(path.join(dir, "narration.json"), `${JSON.stringify(narration, null, 2)}\n`);
console.log(`narration.json: ${cues.length} beats`);
