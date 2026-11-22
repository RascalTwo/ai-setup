#!/usr/bin/env node
// voice.ts <viz>: pre-renders every line the story's ▶ Play says, in both voices, with r2-tts
// (--audience both --lean me: Harper is the default track, Joseph's voice the other), into
// <viz>/voice/, and writes voice/index.json (line → file stem) for the page. A line already
// rendered is kept, so re-running after an edit renders only the changed lines. Without these
// files the page falls back to the browser's voice.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cardLines, endLine } from "./template/story.ts";
import type { Walk } from "./template/walk.schema.ts";

const viz = process.argv[2];
if (!viz) throw new Error("usage: node voice.ts <viz folder>");
const R2TTS = process.env.R2TTS ?? path.join(os.homedir(), ".agents/skills/r2-tts/r2_tts.py");
const walk = JSON.parse(readFileSync(path.join(viz, "walk.json"), "utf8")) as Walk; // from-spec.ts has checked it
const changes = walk.changes ?? [];
const who = (id: string) => walk.personas.find((p) => p.id === id)?.who ?? id;
const lines = [
  ...changes.flatMap((c, i) => cardLines(c, i, changes.length, who(c.persona))),
  endLine(walk.mode === "promised"),
];

const dir = path.join(viz, "voice");
mkdirSync(dir, { recursive: true });
const index: Record<string, string> = {};
for (const line of lines) {
  const stem = createHash("sha256").update(line).digest("hex").slice(0, 16);
  index[line] = stem;
  if (existsSync(path.join(dir, `${stem}.me.mp3`)) && existsSync(path.join(dir, `${stem}.others.mp3`))) continue;
  const p = spawnSync(
    "python3",
    ["-B", R2TTS, "say", "--audience", "both", "--lean", "me", "--text", line, "--out", path.join(dir, `${stem}.mp3`)],
    { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" },
  );
  if (p.error) throw p.error;
  if (p.status !== 0) throw new Error(`r2-tts could not speak "${line.slice(0, 50)}": ${p.stderr.trim().slice(-300)}`);
}
writeFileSync(path.join(dir, "index.json"), JSON.stringify({ lines: index }, null, 1));
console.log(`✓ ${lines.length} lines in ${dir}`);
