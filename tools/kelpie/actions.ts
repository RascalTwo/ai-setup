// What you can start from any herdr pane, past the limits: the dispatcher's own machinery, run now
// instead of on the next tick.
import { derive, dispatch, type Deps, type Derived, type Project, type TaskView } from "./dispatcher.ts";

export type Run = { p: Project; t: TaskView; s: Derived };

export async function runs(d: Deps): Promise<Run[]> {
  return (await Promise.all(d.projects.map(async p => (await d.tracker.listTasks(p.color)).map(t => ({ p, t, s: derive(t) }))))).flat();
}

/** "I'm idle": refine the best-ranked handed-over task nobody has refined, without picking it. */
export async function refineNext(d: Deps): Promise<string> {
  const next = (await runs(d)).filter(r => r.s.state === "refinable").sort((a, b) => (a.t.rank ?? Infinity) - (b.t.rank ?? Infinity))[0];
  if (!next) throw new Error("nothing handed over is waiting to be refined");
  await dispatch(d, next.p, next.t, true);
  return next.t.id;
}
