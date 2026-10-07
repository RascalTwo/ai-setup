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

type Anchor = { selector?: string; label?: string; text?: string };
type Where = {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  hash?: string;
  exact?: string;
};
/** One log record. The page writes them, so every field is optional here: a torn or foreign line must not crash the fold. */
export type Entry = {
  id?: string;
  type?: string;
  text?: string;
  at?: string;
  note?: string;
  q?: string;
  opt?: string;
  round?: number;
  anchor?: Anchor;
  where?: Where;
  /** Speech only: the pointer's anchor and position as the stretch began (anchor/where are where it ended). */
  from?: { anchor?: Anchor; where?: Where };
  shots?: { start?: string; end?: string };
};
export type Line = {
  id: string;
  type: string;
  text: string;
  anchor?: Anchor;
  where?: Where;
  from?: { anchor?: Anchor; where?: Where };
  shots?: { start?: string; end?: string };
  at: string;
  done: boolean;
  note?: string | undefined;
};

/** Fold the log exactly the way the widget does: what's on the page now, plus picks and sends. */
export function foldFeedback(entries: Entry[]): {
  lines: Line[];
  picks: Record<string, string>;
  sends: Entry[];
} {
  const lines = new Map<string, Line>();
  const picks: Record<string, string> = {};
  const sends: Entry[] = [];
  for (const e of entries) {
    const id = e.id ?? "";
    const l = lines.get(id);
    if (e.type === "speech" || e.type === "comment")
      lines.set(id, { ...e, id, type: e.type, text: e.text ?? "", at: e.at ?? "", done: false });
    else if (e.type === "edit" && l) l.text = e.text ?? "";
    else if (e.type === "retract") lines.delete(id);
    else if (e.type === "resolve" && l) {
      l.done = true;
      l.note = e.note;
    } else if (e.type === "clear") lines.clear();
    else if (e.type === "pick") picks[e.q ?? ""] = e.opt ?? "";
    else if (e.type === "send") sends.push(e);
  }
  return { lines: [...lines.values()], picks, sends };
}

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
const nameOf = (a?: Anchor): string =>
  a
    ? a.label !== undefined && a.label !== ""
      ? a.label
      : a.text
        ? `"${a.text.slice(0, 40)}"`
        : (a.selector ?? "page")
    : "page";

const pointerLine = (w: Where, at: string, tag = ""): string =>
  `            ${tag}pointer ${w.x},${w.y} · window ${w.w}×${w.h} · scroll ${w.sx},${w.sy}` +
  `${w.hash ? ` · ${w.hash}` : ""}${w.exact ? ` · exactly on ${w.exact}` : ""}${at ? ` · ${at}` : ""}`;

/** Files of a line's screenshots, relative to the viz folder (level 3: read them only when words and coordinates aren't enough). */
export const shotPaths = (l: Line): string[] =>
  Object.values(l.shots ?? {}).map((f) => `${DATA_DIR}/files/${f}`);

/** "from <start anchor>" when speech began on something other than where it ended; else nothing. */
export const fromNote = (l: Line): string =>
  l.from && nameOf(l.from.anchor) !== nameOf(l.anchor) ? `  ← from ${nameOf(l.from.anchor)}` : "";

function printLine(l: Line, detail: boolean): void {
  console.log(
    `  ${l.id}  ${l.done ? "✓ " : ""}${l.type === "comment" ? "(typed) " : ""}${l.text}${fromNote(l)}${l.shots ? "  📷" : ""}${l.note ? `  — ${l.note}` : ""}`,
  );
  if (!detail || !l.where) return;
  if (l.from?.where) {
    const sel = l.from.anchor?.selector;
    console.log(pointerLine(l.from.where, "", "start ") + (sel ? ` · on ${sel}` : ""));
  }
  console.log(pointerLine(l.where, l.at, l.from?.where ? "end   " : ""));
  if (l.shots) console.log(`            screenshots: ${shotPaths(l).join(" · ")}`);
}

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
    const groups = new Map<string, Line[]>();
    for (const l of lines) {
      const k = nameOf(l.anchor);
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    for (const [name, ls] of groups) {
      console.log(
        `\n[${name}]${flags.detail && ls[0]?.anchor ? `  ${ls[0].anchor.selector}` : ""}`,
      );
      for (const l of ls) printLine(l, !!flags.detail);
    }
    if (Object.keys(picks).length > 0)
      console.log(
        `\npicks: ${Object.entries(picks)
          .map(([q, o]) => `${q}:${o}`)
          .join("  ")}`,
      );
    if (!flags.detail && lines.length > 0)
      console.log(
        `\n(--detail adds pointer position, window, scroll, selectors and screenshot paths)`,
      );
  });
}
