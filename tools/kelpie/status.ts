// What `kelpie status` shows, as data: the table and `status --json` (which the board reads) both
// come from here, so they never disagree.
import { ACTIVE, byRank, dredgeFolder, pastGate, shipLine, type Deps } from "./dispatcher.ts";
import { blocker, runs, type Run } from "./actions.ts";
import { note, session } from "./panel.ts";
import type { ProjectStatus, Row, Section, Status } from "./status-shape.ts";

export type { ProjectStatus, Row, Section, Status };

const ASK: Partial<Record<string, (r: Run) => string>> = {
  waiting: r => r.s.refine ? "answer its questions" : "review it", input: () => "your reply is on its way",
  approved: () => "approved: shipping", signedoff: () => "signed off: closing",
};

export async function status(d: Deps, only?: string): Promise<Status> {
  const g = d.gate(), all = await runs(d), agents = await d.herdr.agents();
  const projects = d.projects.filter(p => !only || p.id === only).map(p => {
    const held = !g.open && !pastGate(d.projects, p);
    const mine = all.filter(r => r.p === p);
    const row = (r: Run, section: Section, note: string): Row => ({
      id: r.t.id, label: r.t.label, section, refine: r.s.refine || r.s.state === "refinable", pane: r.s.pane ?? null,
      at: r.t.comments.filter(c => c.mine).at(-1)?.at ?? null, note, due: r.t.due, rank: r.t.rank, blockedBy: r.t.blockedBy,
      whyNotBuild: blocker(r, all, false), whyNotRefine: blocker(r, all, true),
    });
    // The queues in the order the tick starts them: earliest deadline first, then lowest rank, unranked last.
    const queue = (state: string, section: Section) => mine.filter(r => r.s.state === state).sort((a, b) => byRank(a.t, b.t))
      .map((r, i) => row(r, section, (i || !held ? "" : "held by the gate · ") + (r.t.due ? `due ${new Date(r.t.due).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : r.t.rank != null ? `rank ${r.t.rank}` : "unranked: starts last")));
    const why = (r: Run) => r.t.blockedBy.length ? `waits on ${r.t.blockedBy.join(", ")}` : r.t.status !== "todo" ? "started by hand, outside Kelpie" : r.t.waitingOn ?? "not ready";
    const dir = dredgeFolder(d.stateDir, p);
    const rows = [
      ...mine.filter(r => r.s.state === "working").map(r => row(r, r.s.refine ? "refining" : "building", note(r.t.id, session(r.s.pane)))),
      ...mine.filter(r => ASK[r.s.state]).map(r => row(r, "waiting", ASK[r.s.state]?.(r) ?? "")),
      ...queue("candidate", "buildQueue"),
      ...queue("refinable", "refineQueue"),
      ...mine.filter(r => r.s.state === "ignored" && r.t.status !== "done").map(r => row(r, "blocked", why(r))),
      ...mine.filter(r => r.s.state === "finished").map(r => row(r, "finished", "")),
    ];
    return {
      id: p.id, priority: p.priority ?? null, pastGate: pastGate(d.projects, p), active: mine.some(r => ACTIVE.includes(r.s.state)), paused: d.paused(p.id),
      dredge: [...agents].find(([, a]) => a.cwd === dir || a.cwd?.startsWith(dir + "/"))?.[0] ?? null, rows,
    };
  });
  return { paused: d.paused(), gate: g, active: d.active(), ship: shipLine(d.projects.filter(p => !only || p.id === only), s => console.error(s)), projects };
}
