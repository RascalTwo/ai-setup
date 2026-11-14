// The "Needs you" list: everything waiting on the human, across all projects, as cards. Pure, so
// kelpie.test.ts can check it; app.ts only draws what this returns.
import type { Row, Status, Words } from "./contract.js";

type Stale = "keep" | "drop" | "later";
// A button: runs a verb as is, or says something in the human's own words (`words`: the card's text box).
// `quick`: what a one-click press says for you, on a green card; typed words still win.
export type Act = { label: string; verb: Stale } | { label: string; words: Words; quick?: string };
// Merge Danger as a label. `why` is the short reason on the card and in a one-click's words.
export type Risk = {
  level: "green" | "yellow" | "red";
  why: string;
  blast: string | null;
  undo: string | null;
};
export type Card = {
  id: string;
  project: string;
  kind: "stale" | "spec" | "questions" | "approve" | "stalled" | "idle";
  headline: string; // top: what it is. A review's first line is its impact sentence; else the task label.
  risk: Risk | null; // spec and build reviews only: stale cards, questions and stuck runs get none
  ask: string; // middle: exactly what Kelpie needs
  since: string; // ISO: when it started waiting
  details: string | null; // the handover, collapsed
  page: string | null; // its spec or demo page
  acts: Act[];
};

const first = (text: string | null) => {
  const line = (text ?? "").split("\n").find((l) => l.trim()) ?? "";
  const clean = line.replace(/^[\s#>*-]+/u, "").replaceAll(/\*\*|`/gu, "").trim();
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
};
const ICON = { green: "🟢", yellow: "🟡", red: "🔴" } as const;
export const icon = (r: Risk) => ICON[r.level];

/** The agent's `Door:` / `Blast radius: small|wide — …` / `Undo:` lines, turned into a label by fixed rules.
 * `ships`: approving this ships to production, which the project file says, so the agent can't talk it down.
 * The agent only reports facts (which door, who is touched); it never scores its own confidence, and a
 * missing or garbled block is yellow, never green. */
export function riskOf(text: string | null, ships: boolean): Risk {
  const lines = (text ?? "").split("\n").map((l) => l.replaceAll(/[*`]/gu, "").replace(/^[\s>#-]+/u, ""));
  const get = (key: RegExp) => lines.map((l) => key.exec(l)?.[1]?.trim()).find(Boolean) ?? null;
  const door = get(/^door:\s*((?:one|two)-way)\b(?!\s*\|)/iu)?.toLowerCase();
  const blastLine = get(/^blast radius:\s*(.+)$/iu);
  const size = /^(small|wide)\b(?!\s*\|)/iu.exec(blastLine ?? "")?.[1]?.toLowerCase();
  const blast = blastLine && size ? blastLine.replace(/^\w+[\s:—–-]*/u, "") || size : null;
  const undo = get(/^undo:\s*(.+)$/iu);
  const said = { blast, undo };
  if (door === "one-way") return { level: "red", why: "one-way", ...said };
  if (ships) return { level: "red", why: "ships when approved", ...said };
  if (door && size && undo)
    return { level: size === "small" ? "green" : "yellow", why: `two-way, ${size}`, ...said };
  return { level: "yellow", why: "no risk block", ...said };
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const park: Act = { label: "Park it", words: "park" };
const close: Act = { label: "Close it", words: "close" };

/** What each kind of card asks, and what its buttons can do. */
function waiting(r: Row, project: string, page: string | null, ships: boolean): Card {
  const details = r.handover;
  const base = {
    id: r.id,
    project,
    headline: r.label,
    risk: null as Risk | null,
    since: r.at ?? "",
    details,
    page,
  };
  if (r.handoff === "questions") {
    const q = first(details);
    return {
      ...base,
      kind: "questions",
      ask: q ? `Answer: ${q}` : "Answer its questions",
      acts: [{ label: "Send answer", words: "reply" }, park, close],
    };
  }
  if (r.handoff === "stalled" || r.handoff === "idle")
    return {
      ...base,
      kind: r.handoff,
      ask: upper(first(details) || r.handoff),
      acts: [{ label: "Send reply", words: "reply" }, park, close],
    };
  // A spec or build handover opens with its impact sentence: that is the card's headline.
  // A green card is one click: the fixed words say so in the record. Yellow and red need yours.
  const risk = riskOf(details, ships && !r.refine);
  const lead = { ...base, headline: first(details) || r.label, risk };
  const quick = (verb: string) =>
    risk.level === "green" ? { quick: `${verb} from the board (${icon(risk)} ${risk.why})` } : {};
  return r.refine
    ? {
        ...lead,
        kind: "spec",
        ask: "Review the spec",
        acts: [
          { label: "Sign off · build now", words: "signoff-now" },
          { label: "Sign off · when a slot frees", words: "signoff", ...quick("signed off") },
          { label: "Sign off · hold until I say", words: "signoff-hold" },
          { label: "Send changes", words: "reply" },
          park,
          close,
        ],
      }
    : {
        ...lead,
        kind: "approve",
        ask: "Approve or request changes",
        acts: [
          { label: "Approve", words: "approve", ...quick("approved") },
          { label: "Request changes", words: "reply" },
          park,
          close,
        ],
      };
}

/** Runs waiting on you come first, oldest first: each holds its project's slot, so the oldest is
 * the one that has blocked work longest. "Still want this?" cards block nothing, so they follow,
 * also oldest first (the longest untouched). */
export function needsYou(s: Status, pages: Record<string, string>, now = Date.now()): Card[] {
  const runs = s.projects
    .flatMap((p) =>
      p.rows.filter((r) => r.handoff).map((r) => waiting(r, p.id, pages[r.id] ?? null, p.publishes)),
    )
    .toSorted((a, b) => a.since.localeCompare(b.since));
  const stale = s.stale
    .toSorted((a, b) => a.touched.localeCompare(b.touched))
    .map((x): Card => ({
      id: x.id,
      project: x.project,
      kind: "stale",
      headline: x.label,
      risk: null,
      since: x.touched,
      details: null,
      page: null,
      ask: `Still want this? Untouched for ${Math.floor((now - Date.parse(x.touched)) / 864e5)} days.`,
      acts: [
        { label: "Keep", verb: "keep" },
        { label: "Drop", verb: "drop" },
        { label: "Later", verb: "later" },
      ],
    }));
  return [...runs, ...stale];
}
