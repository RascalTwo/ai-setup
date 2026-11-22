// The board's columns and its "Coming up" strip, as data. Pure, so kelpie.test.ts can check it;
// app.ts only draws what this returns.
import type { Row, Status } from "./contract.js";

type Project = Status["projects"][number];
export type Lane = "refine" | "build" | "notYet";
export type Item = { r: Row; n: number }; // n: how many copies of a repeating calendar event r stands for
type Part = { title: string; items: Item[] };

const DAY = 864e5;
const GCAL = /^(gcal-.+)_[^_]+$/u; // a calendar task: gcal-<event id>_<occurrence instant>, as in dispatcher.ts
const time = (r: Row) => Date.parse(r.notBefore ?? "");
const notYet = (r: Row) => r.section === "blocked";
/** Not yet only until a time: its chip shows that time instead of the tracker's reason. */
export const scheduled = (r: Row, now: number): boolean =>
  notYet(r) && r.blockedBy.length === 0 && time(r) > now;

/** A repeating event's copies fold into its soonest one, counted: only that copy can run anyway. Soonest first. */
export function fold(rows: Row[]): Item[] {
  const by = new Map<string, Item>();
  for (const r of rows.toSorted((a, b) => time(a) - time(b))) {
    const k = GCAL.exec(r.id)?.[1] ?? r.id,
      had = by.get(k);
    if (had) had.n++;
    else by.set(k, { r, n: 1 });
  }
  return [...by.values()];
}

const one = (rows: Row[]): Item[] => rows.map((r) => ({ r, n: 1 }));

/** One column's sections, top to bottom, empty ones left out. Queues keep the order status gives them. */
export function parts(rows: Row[], lane: Lane, now: number): Part[] {
  const pick = (f: (r: Row) => boolean) => rows.filter(f);
  const all: Part[] =
    lane === "notYet"
      ? [
          { title: "🕐 scheduled", items: fold(pick((r) => scheduled(r, now))) },
          {
            title: "⛓ waits on a task",
            items: one(pick((r) => notYet(r) && r.blockedBy.length > 0)),
          },
          {
            title: "✋ other",
            items: one(pick((r) => notYet(r) && r.blockedBy.length === 0 && !scheduled(r, now))),
          },
        ]
      : (() => {
          const refine = lane === "refine";
          return [
            {
              title: "waiting on you",
              items: one(pick((r) => r.section === "waiting" && r.refine === refine)),
            },
            {
              title: refine ? "refining" : "building",
              items: one(pick((r) => r.section === (refine ? "refining" : "building"))),
            },
            {
              title: "queued",
              items: one(pick((r) => r.section === (refine ? "refineQueue" : "buildQueue"))),
            },
          ];
        })();
  return all.filter((p) => p.items.length > 0);
}

/** Everything scheduled to start within a day, across projects, soonest first. */
export function comingUp(projects: Project[], now: number): (Item & { project: string })[] {
  return projects
    .flatMap((p) =>
      fold(p.rows.filter((r) => scheduled(r, now)))
        .filter((i) => time(i.r) - now < DAY)
        .map((i) => ({
          r: i.r,
          n: i.n,
          project: p.id,
        })),
    )
    .toSorted((a, b) => time(a.r) - time(b.r));
}

/** When a scheduled task starts, short: "8:00 AM" today, "Mon 5:00 PM" this week, else "Nov 30". */
export function when(iso: string, now: number): string {
  const t = new Date(iso),
    clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (t.toDateString() === new Date(now).toDateString()) return clock;
  if (+t - now < 6 * DAY) return `${t.toLocaleDateString([], { weekday: "short" })} ${clock}`;
  return t.toLocaleDateString([], { month: "short", day: "numeric" });
}
