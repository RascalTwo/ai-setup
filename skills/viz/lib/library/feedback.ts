// lib/library/feedback.ts — `viz feedback`: the agent's side of the feedback widget (ADR 0021).
//
// The page (kit/feedback.js) appends to <viz>/.viz-data/feedback.jsonl; this folds that log
// into the lines still on the page and prints them in two levels, so the agent pays for
// detail only when it needs it: level 1 is text + what it's anchored to; --detail adds where
// the pointer was. The agent's two writes are appends too: `resolve` (done, + note) and
// `clear` (the page drops every earlier line; grill-me-viz does this after reading a round).

import { die, emit } from "../../cli.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../server/data.ts";
import { Viz } from "./viz.ts";

type Entry = Record<string, any>;
export type Line = { id: string; type: string; text: string; anchor?: Entry; where?: Entry; at: string; done: boolean; note?: string };

/** Fold the log exactly the way the widget does: what's on the page now, plus picks and sends. */
export function foldFeedback(entries: Entry[]) {
  const lines = new Map<string, Line>();
  const picks: Record<string, string> = {};
  const sends: Entry[] = [];
  for (const e of entries) {
    const l = lines.get(e.id);
    if (e.type === "speech" || e.type === "comment") lines.set(e.id, { ...e, done: false } as Line);
    else if (e.type === "edit" && l) l.text = e.text;
    else if (e.type === "retract") lines.delete(e.id);
    else if (e.type === "resolve" && l) (l.done = true), (l.note = e.note);
    else if (e.type === "clear") lines.clear();
    else if (e.type === "pick") picks[e.q] = e.opt;
    else if (e.type === "send") sends.push(e);
  }
  return { lines: [...lines.values()], picks, sends };
}

const logFile = (viz: Viz) => path.join(viz.dir, DATA_DIR, "feedback.jsonl");
function readLog(file: string): Entry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; } // a torn line shouldn't hide the rest
  });
}
const append = (file: string, e: Entry) => {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n");
};
const nameOf = (a?: Entry) => (a ? a.label || (a.text ? `"${String(a.text).slice(0, 40)}"` : a.selector) : "page");

export function cmdFeedback(viz: Viz, flags: Record<string, string | boolean>): void {
  const file = logFile(viz);
  const folded = foldFeedback(readLog(file));

  if (flags.clear) {
    append(file, { type: "clear" });
    return console.log(`Cleared ${folded.lines.length} line(s) from the page (the log keeps them).`);
  }
  if (typeof flags.resolve === "string") {
    const ids = flags.resolve === "all" ? folded.lines.filter((l) => !l.done).map((l) => l.id) : flags.resolve.split(",");
    const known = new Set(folded.lines.map((l) => l.id));
    const bad = ids.filter((id) => !known.has(id));
    if (bad.length) die(`ERROR: no line ${bad.join(", ")} on the page. \`viz feedback ${viz.slug}\` lists the ids.`, 2);
    for (const id of ids) append(file, { type: "resolve", id, ...(typeof flags.note === "string" ? { note: flags.note } : {}) });
    return console.log(`Resolved ${ids.length} line(s); they show green until the user clears them.`);
  }

  emit(flags, folded, () => {
    const { lines, picks, sends } = folded;
    const last = sends.at(-1);
    console.log(`${lines.length} line(s) on the page, ${lines.filter((l) => l.done).length} resolved` +
      (last ? ` · last send ${last.at}${last.round ? ` (round ${last.round})` : ""}` : " · never sent"));
    const groups = new Map<string, Line[]>();
    for (const l of lines) {
      const k = nameOf(l.anchor);
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    for (const [name, ls] of groups) {
      console.log(`\n[${name}]${flags.detail && ls[0].anchor ? `  ${ls[0].anchor.selector}` : ""}`);
      for (const l of ls) {
        console.log(`  ${l.id}  ${l.done ? "✓ " : ""}${l.type === "comment" ? "(typed) " : ""}${l.text}${l.note ? `  — ${l.note}` : ""}`);
        const w = l.where;
        if (flags.detail && w) {
          console.log(`            pointer ${w.x},${w.y} · window ${w.w}×${w.h} · scroll ${w.sx},${w.sy}` +
            `${w.hash ? ` · ${w.hash}` : ""}${w.exact ? ` · exactly on ${w.exact}` : ""} · ${l.at}`);
        }
      }
    }
    if (Object.keys(picks).length) console.log(`\npicks: ${Object.entries(picks).map(([q, o]) => `${q}:${o}`).join("  ")}`);
    if (!flags.detail && lines.length) console.log(`\n(--detail adds pointer position, window, scroll and selectors)`);
  });
}
