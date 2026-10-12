// feedback-text.js — the feedback log (ADR 0021) folded into what's on the page, and that as text.
//
// One source for both readers: `viz feedback` prints it for the agent, and the widget's Copy
// puts the same text on the clipboard (with crops named by their number on the contact sheet
// instead of by file), so what a person pastes reads exactly like what the agent reads.

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
  round?: number | null;
  anchor?: Anchor | null;
  where?: Where;
  /** Speech only: the pointer's anchor and position as the stretch began (anchor/where are where it ended). */
  from?: { anchor?: Anchor | null; where?: Where };
  shots?: { start?: string; end?: string };
  /** Who said it, when the presence layer knows (kit/presence.js): shown once a page has more than one author. */
  by?: { name: string; color: string };
  /** Speech only: how long the stretch was. */
  secs?: number;
};
export type Line = {
  id: string;
  type: string;
  text: string;
  anchor?: Anchor | null;
  where?: Where;
  from?: { anchor?: Anchor | null; where?: Where };
  shots?: { start?: string; end?: string };
  at: string;
  done: boolean;
  note?: string | undefined;
  by?: { name: string; color: string };
};

/** "Name: " before a line, once the lines have more than one author; else nothing. */
export const byNote = (lines: Line[]): ((l: Line) => string) => {
  const many = new Set(lines.map((l) => l.by?.name)).size > 1;
  return (l) => (many && l.by ? `${l.by.name}: ` : "");
};

/** Fold the log: the lines on the page now (edits applied, deletions gone), the latest pick per question, and every send. */
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

/** How a person would name what a line is attached to. */
export const nameOf = (a?: Anchor | null): string =>
  a
    ? a.label !== undefined && a.label !== ""
      ? a.label
      : a.text
        ? `"${a.text.slice(0, 40)}"`
        : (a.selector ?? "page")
    : "page";

/** "from <start anchor>" when speech began on something other than where it ended; else nothing. */
export const fromNote = (l: Line): string =>
  l.from && nameOf(l.from.anchor) !== nameOf(l.anchor) ? `  ← from ${nameOf(l.from.anchor)}` : "";

const pointerLine = (w: Where, at: string, tag = ""): string =>
  `            ${tag}pointer ${w.x},${w.y} · window ${w.w}×${w.h} · scroll ${w.sx},${w.sy}` +
  `${w.hash ? ` · ${w.hash}` : ""}${w.exact ? ` · exactly on ${w.exact}` : ""}${at ? ` · ${at}` : ""}`;

/**
 * The folded lines grouped by what they're attached to, then the picks. `detail` adds where the
 * pointer was and the screenshots, each named by `shot` (a file path for the agent, "crop 3" in a copy).
 */
export function feedbackText(
  lines: Line[],
  picks: Record<string, string>,
  detail: boolean,
  shot: (name: string, key: string) => string,
): string[] {
  const out: string[] = [];
  const who = byNote(lines);
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const k = nameOf(l.anchor);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const [name, ls] of groups) {
    out.push("", `[${name}]${detail && ls[0]?.anchor ? `  ${ls[0].anchor.selector ?? ""}` : ""}`);
    for (const l of ls) {
      out.push(
        `  ${l.id}  ${l.done ? "✓ " : ""}${l.type === "comment" ? "(typed) " : ""}${who(l)}${l.text}${fromNote(l)}${l.shots ? "  📷" : ""}${l.note ? `  — ${l.note}` : ""}`,
      );
      if (!detail || !l.where) continue;
      if (l.from?.where) {
        const sel = l.from.anchor?.selector;
        out.push(pointerLine(l.from.where, "", "start ") + (sel ? ` · on ${sel}` : ""));
      }
      out.push(pointerLine(l.where, l.at, l.from?.where ? "end   " : ""));
      if (l.shots)
        out.push(
          `            screenshots: ${Object.entries(l.shots)
            .map(([k, f]) => shot(f, k))
            .join(" · ")}`,
        );
    }
  }
  if (Object.keys(picks).length > 0)
    out.push(
      "",
      `picks: ${Object.entries(picks)
        .map(([q, o]) => `${q}:${o}`)
        .join("  ")}`,
    );
  return out;
}
