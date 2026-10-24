// What you can start from any herdr pane, past the limits: the dispatcher's own machinery, run now
// instead of on the next tick.
import { byRank, derive, dispatch, type Deps, type Derived, type Project, type TaskView } from "./dispatcher.ts";

export type Run = { p: Project; t: TaskView; s: Derived };

export async function runs(d: Deps): Promise<Run[]> {
  return (await Promise.all(d.projects.map(async p => (await d.tracker.listTasks(p.color)).map(t => ({ p, t, s: derive(t) }))))).flat();
}

/** "I'm idle": refine the best-ranked handed-over task nobody has refined, without picking it. */
export async function refineNext(d: Deps): Promise<string> {
  const next = (await runs(d)).filter(r => r.s.state === "refinable").sort((a, b) => byRank(a.t, b.t))[0];
  if (!next) throw new Error("nothing handed over is waiting to be refined");
  await dispatch(d, next.p, next.t, true);
  return next.t.id;
}

/** Past the usage gate, not the slot: start the best-ranked signed-off build in a project whose
 * build slot is free, so two builds never share a project's code. */
export async function buildNext(d: Deps, project?: string): Promise<string> {
  const all = (await runs(d)).filter(r => !project || r.p.id === project);
  const held = new Set(all.filter(r => !r.s.refine && ["working", "waiting", "input", "approved"].includes(r.s.state)).map(r => r.p));
  const next = all.filter(r => r.s.state === "candidate" && !held.has(r.p)).sort((a, b) => byRank(a.t, b.t))[0];
  if (!next) throw new Error(`no signed-off task with a free build slot${project ? ` in ${project}` : ""}`);
  await dispatch(d, next.p, next.t, false);
  return next.t.id;
}
