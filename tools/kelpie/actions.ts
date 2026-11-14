// What you can start from any herdr pane, past the limits: the dispatcher's own machinery, run now
// instead of on the next tick.
import { byRank, derive, dispatch, STALE_DAYS, tidy, type Deps, type Derived, type Project, type TaskView } from "./dispatcher.ts";

export type Run = { p: Project; t: TaskView; s: Derived };

export async function runs(d: Deps): Promise<Run[]> {
  const all = (await Promise.all(d.projects.map(async p => (await d.tracker.listTasks(p.color)).map(t => ({ p, t, s: derive(t) }))))).flat();
  tidy(all, d.now());
  return all;
}

/** Projects whose build slot a run holds, from start until it is finished, waiting on you included. */
const heldBuilds = (all: Run[]) => new Set(all.filter(r => !r.s.refine && ["working", "waiting", "input", "approved"].includes(r.s.state)).map(r => r.p));

/** Why this task can't be refined (or built) now, or null if it can. The board greys its button with this. */
export function blocker(r: Run, all: Run[], refine: boolean): string | null {
  const s = r.s.state;
  if (s === (refine ? "refinable" : "candidate")) return !refine && heldBuilds(all).has(r.p) ? `${r.p.id}'s build slot is busy` : null;
  return s === "stale" ? `untouched for ${STALE_DAYS} days: answer \`kelpie keep ${r.t.id}\` first`
    : s === "superseded" ? "a later copy of this recurring task runs instead"
    : s === "candidate" ? "already signed off" : s === "refinable" ? "not signed off yet"
    : s === "finished" ? "finished"
    : s !== "ignored" ? "already running"
    : r.t.blockedBy.length ? `waits on ${r.t.blockedBy.join(", ")}` : r.t.waitingOn ?? "not ready";
}

/** "Do this one": refine or build the task named, past the gate and active limit, never past a blocker. */
export async function start(d: Deps, id: string, refine: boolean): Promise<string> {
  const all = await runs(d), r = all.find(r => r.t.id === id);
  if (!r) throw new Error(`no task "${id}" handed to agents`);
  const why = blocker(r, all, refine);
  if (why) throw new Error(`can't ${refine ? "refine" : "build"} ${id}: ${why}`);
  await dispatch(d, r.p, r.t, refine);
  return id;
}

/** "I'm idle": refine the best-ranked handed-over task nobody has refined, without picking it. */
export async function refineNext(d: Deps, project?: string): Promise<string> {
  const next = (await runs(d)).filter(r => r.s.state === "refinable" && (!project || r.p.id === project)).sort((a, b) => byRank(a.t, b.t))[0];
  if (!next) throw new Error(`nothing handed over is waiting to be refined${project ? ` in ${project}` : ""}`);
  await dispatch(d, next.p, next.t, true);
  return next.t.id;
}

/** Past the usage gate, not the slot: start the best-ranked signed-off build in a project whose
 * build slot is free, so two builds never share a project's code. */
export async function buildNext(d: Deps, project?: string): Promise<string> {
  const all = (await runs(d)).filter(r => !project || r.p.id === project);
  const held = heldBuilds(all);
  const next = all.filter(r => r.s.state === "candidate" && r.s.when !== "hold" && !held.has(r.p)).sort((a, b) => byRank(a.t, b.t))[0];
  if (!next) throw new Error(`no signed-off task with a free build slot${project ? ` in ${project}` : ""}`);
  await dispatch(d, next.p, next.t, false);
  return next.t.id;
}

/** The answer to "Still want this?": keep it, drop it (closed like `close`, never deleted), or later (not for another STALE_DAYS). */
export async function answerStale(d: Deps, how: "keep" | "drop" | "later", id: string): Promise<string> {
  const r = (await runs(d)).find(r => r.t.id === id);
  if (!r) throw new Error(`no task "${id}" handed to agents`);
  if (r.s.state !== "stale") throw new Error(`${id} isn't on the Still-want-this list (it is ${r.s.state})`);
  if (how === "keep") await d.tracker.comment(id, "[tidy] keep\n\nKept, on the human's word.");
  else if (how === "drop") {
    await d.tracker.comment(id, "[dispatch] closed\n\nClosed without building, on the human's word: dropped from the Still-want-this list.");
    await d.tracker.finish(id);
  } else {
    const until = new Date(d.now() + STALE_DAYS * 864e5).toISOString();
    await d.tracker.setNotBefore(id, until);
    await d.tracker.comment(id, `[tidy] later until=${until}\n\nPushed out ${STALE_DAYS} days, on the human's word.`);
  }
  return how === "keep" ? `${id} kept: Kelpie dispatches it as before.` : how === "drop" ? `${id} dropped: closed, not deleted.` : `${id} pushed out ${STALE_DAYS} days.`;
}
