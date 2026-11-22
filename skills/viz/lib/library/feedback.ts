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
import type { Viz } from "./viz.ts";
import { feedbackText, foldFeedback, type Entry } from "../../kit/src/feedback-text.ts";

export { foldFeedback, fromNote, type Entry, type Line } from "../../kit/src/feedback-text.ts";

const logFile = (viz: Viz) => path.join(viz.dir, DATA_DIR, "feedback.jsonl");
function readLog(file: string): Entry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const e: unknown = JSON.parse(l);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the widget writes this shape and every field is read defensively
        return [e as Entry];
      } catch {
        return [];
      } // a torn line shouldn't hide the rest
    });
}
const append = (file: string, e: Record<string, unknown>): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n");
};
export function cmdFeedback(viz: Viz, flags: Record<string, string | boolean>): void {
  const file = logFile(viz);
  const folded = foldFeedback(readLog(file));

  if (flags.clear) {
    append(file, { type: "clear" });
    return console.log(
      `Cleared ${folded.lines.length} line(s) from the page (the log keeps them).`,
    );
  }
  if (typeof flags.resolve === "string") {
    const ids =
      flags.resolve === "all"
        ? folded.lines.filter((l) => !l.done).map((l) => l.id)
        : flags.resolve.split(",");
    const known = new Set(folded.lines.map((l) => l.id));
    const bad = ids.filter((id) => !known.has(id));
    if (bad.length > 0)
      die(
        `ERROR: no line ${bad.join(", ")} on the page. \`viz feedback ${viz.slug}\` lists the ids.`,
        2,
      );
    for (const id of ids)
      append(file, {
        type: "resolve",
        id,
        ...(typeof flags.note === "string" ? { note: flags.note } : {}),
      });
    return console.log(
      `Resolved ${ids.length} line(s); they show green until the user clears them.`,
    );
  }

  emit(flags, folded, () => {
    const { lines, picks, sends } = folded;
    const last = sends.at(-1);
    console.log(
      `${lines.length} line(s) on the page, ${lines.filter((l) => l.done).length} resolved` +
        (last
          ? ` · last send ${last.at ?? ""}${last.round ? ` (round ${last.round})` : ""}`
          : " · never sent"),
    );
    for (const l of feedbackText(lines, picks, !!flags.detail, (f) => `${DATA_DIR}/files/${f}`))
      console.log(l);
    if (!flags.detail && lines.length > 0)
      console.log(
        `\n(--detail adds pointer position, window, scroll, selectors and screenshot paths)`,
      );
  });
}
