// The dispatcher's logic, free of any particular tracker or terminal so it can be tested with
// fakes. Timeline Studio lives in timeline-studio.ts, herdr in herdr.ts, the CLI in
// kelpie.ts. Design and the why: README.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

export type Review = "needs" | "changes" | "approved" | "none";
export type Comment = { text: string; at: string; mine: boolean };
export type TaskView = {
  id: string; label: string; desc: string; ready: boolean; rank: number | null;
  status: "todo" | "running" | "paused" | "done"; review: Review; comments: Comment[];
  refined: boolean; // signed off (refinedAt)
  noQueue: boolean; // off its lane's queue, so only deps and the sign-off can hold it
  waitingOn: string | null; // the tracker's reason it isn't ready; "unrefined" = only the sign-off is missing
};
export interface Tracker {
  listTasks(color: string): Promise<TaskView[]>; // the tasks handed to agents (For: Agent) in this Project colour
  setNoQueue(id: string): Promise<void>;
  signOff(id: string): Promise<void>; // only on the human's explicit word, via the `signoff` command
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  comment(id: string, text: string): Promise<void>;
  finish(id: string): Promise<void>;
  setReview(id: string, v: Review): Promise<void>;
  setDesc(id: string, text: string): Promise<void>;
}
export type RunModel = { model: string; effort: string };
// Which model runs a run. Refines run on Sonnet: they write the spec page (spec-viz), and switching
// models part-way isn't worth it. A build runs on what its signed-off description
// asks for ("Build with: opus", written by the refine and approved with the sign-off), else Sonnet.
export const MODELS = {
  refine: { model: "claude-sonnet-5-5", effort: "high" },
  sonnet: { model: "claude-sonnet-5-5", effort: "high" },
  opus: { model: "claude-opus-5-5", effort: "medium" },
} as const satisfies Record<string, RunModel>;
export const buildModel = (desc: string): RunModel => (/^\W*Build with:\W*opus\b/im.test(desc) ? MODELS.opus : MODELS.sonnet);
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export interface Herdr {
  agents(): Promise<Map<string, { status: AgentStatus; seq: number; cwd?: string }>>; // pane id → its agent
  // → pane id. The tab opens in the herdr space labelled `space`, created (at `home`) if missing.
  spawn(label: string, cwd: string, promptFile: string, space: { label: string; home: string }, run: RunModel): Promise<string>;
  prompt(pane: string, text: string): Promise<void>;
  tail(pane: string, lines: number): Promise<string>;
  close(pane: string): Promise<void>;
}

// ── config ──────────────────────────────────────────────────────────────────────────────────

export type Config = { ceiling: number; stall_minutes: number; stale_minutes: number };
export type Repo = { path: string; base: string };
export type Project = { id: string; color: string; space: string; repos: Repo[]; setup: string[]; checks: string[]; productionalize: string; prompt: string };

const DEFAULTS: Config = { ceiling: 0.85, stall_minutes: 15, stale_minutes: 30 };
const home = () => process.env.HOME!;
const tilde = (p: string) => p.replace(/^~(?=\/|$)/, home());

export function loadConfig(dir: string): Config {
  const f = join(dir, "config.json");
  const c = { ...DEFAULTS, ...(existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}) };
  for (const k of Object.keys(DEFAULTS) as (keyof Config)[])
    if (typeof c[k] !== "number" || !(c[k] >= 0)) throw new Error(`${f}: ${k} must be a non-negative number`);
  return c;
}

export function loadProjects(dir: string): Project[] {
  const pdir = join(dir, "projects");
  if (!existsSync(pdir)) return [];
  return readdirSync(pdir).filter(f => f.endsWith(".md")).sort().map(f => {
    const file = join(pdir, f), bad = (m: string) => new Error(`${file}: ${m}`);
    const m = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) throw bad("needs YAML frontmatter between --- lines");
    const fm = (Bun.YAML.parse(m[1]!) ?? {}) as any;
    const strs = (k: string) => {
      const v = fm[k] ?? [];
      if (!Array.isArray(v) || v.some(x => typeof x !== "string")) throw bad(`${k} must be a list of strings`);
      return v as string[];
    };
    if (fm.color != null && (typeof fm.color !== "string" || !fm.color)) throw bad("color must be the id of a Project colour");
    if (fm.space != null && (typeof fm.space !== "string" || !fm.space)) throw bad("space must be a herdr space label");
    if (!Array.isArray(fm.repos ?? [])) throw bad("repos must be a list");
    const repos = (fm.repos ?? []).map((r: any, i: number) => {
      if (typeof r?.path !== "string" || typeof r?.base !== "string") throw bad(`repos[${i}] needs path and base`);
      return { path: tilde(r.path), base: r.base };
    });
    if (fm.productionalize != null && typeof fm.productionalize !== "string") throw bad("productionalize must be text");
    const id = f.slice(0, -3);
    // The herdr space its agents run in: "timeline-studio" → "Timeline Studio" unless it says otherwise.
    const space = fm.space ?? id.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return { id, color: fm.color ?? id, space, repos, setup: strs("setup"), checks: strs("checks"),
      productionalize: fm.productionalize ?? "", prompt: m[2]!.trim() };
  });
}

// ── state, derived from the task alone ──────────────────────────────────────────────────────

// Every dispatcher comment's first line is `[dispatch] <kind> key=value …`. They are told apart
// from the human's by `mine` (the tracker's author field), never by this prefix.
export type Event = { kind: string; kv: Record<string, string>; i: number };
export function events(t: TaskView): Event[] {
  return t.comments.flatMap((c, i) => {
    const line = c.text.split("\n", 1)[0]!;
    if (!c.mine || !line.startsWith("[dispatch] ")) return [];
    const [kind = "", ...rest] = line.slice(11).split(" ");
    return [{ kind: kind.replace(/:$/, ""), kv: Object.fromEntries(rest.filter(w => w.includes("=")).map(w => w.split(/=(.*)/s).slice(0, 2))), i }];
  });
}

const HANDOFF = ["review", "questions", "stalled", "idle"]; // each one set Needs review
const BOUNDARY = ["dispatching", "refining", "relayed", "input", "approved"]; // each one began a round of agent work

// A refine run drafts a task handed to agents but not signed off. It never starts the task,
// and ends when the human signs it off ("signedoff"); a `refined` comment then closes it, and the
// task starts over as an ordinary candidate.
export type State = "candidate" | "refinable" | "ignored" | "working" | "waiting" | "input" | "approved" | "signedoff" | "finished";
export type Derived = { state: State; since: Comment[]; pane?: string; restarts: number; relayPending: boolean; refine: boolean };

export function derive(t: TaskView): Derived {
  const all = events(t);
  const cut = Math.max(-1, ...all.filter(e => e.kind === "refined").map(e => e.i));
  const ev = all.filter(e => e.i > cut);
  const lastOf = (kinds: string[]) => Math.max(cut, ...ev.filter(e => kinds.includes(e.kind)).map(e => e.i));
  const handoff = lastOf(HANDOFF), relayed = lastOf(["relayed"]), boundary = lastOf(BOUNDARY);
  const base = { since: [] as Comment[], restarts: 0, relayPending: false, refine: false };
  if (!ev.length) return { ...base, state: t.status !== "todo" ? "ignored" : t.ready ? "candidate" : t.waitingOn === "unrefined" ? "refinable" : "ignored" };
  const refine = ev[0]!.kind === "refining";
  const pane = ev.filter(e => e.kv.pane).at(-1)?.kv.pane;
  const restarts = ev.filter(e => e.kind === "restarted" && e.i > boundary && e.kv.counted === "1").length;
  const since = t.comments.slice(Math.max(handoff, relayed) + 1).filter(c => !c.mine);
  const state: State = t.status === "done" ? "finished"
    : refine && t.refined ? "signedoff"
    : t.review === "approved" ? "approved"
    : t.review === "changes" ? "input"
    : t.review === "needs" ? (since.length || relayed > handoff ? "input" : "waiting")
    // Review cleared by hand while the agent still waits: its handoff comment is the truth.
    : handoff > boundary ? (since.length ? "input" : "waiting")
    : "working";
  // A relay that prompted the pane but died before clearing Review is finished, not repeated.
  return { state, since, pane, restarts, relayPending: relayed > handoff && t.review !== "none", refine };
}

// ── usage gate ──────────────────────────────────────────────────────────────────────────────

const WEEK = 7 * 864e5;
export function gate(tidemarkDir: string, c: Config, now = Date.now()): { open: boolean; why: string } {
  const files = existsSync(tidemarkDir) ? readdirSync(tidemarkDir).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().slice(-2).reverse() : [];
  for (const f of files) {
    const lines = readFileSync(join(tidemarkDir, f), "utf8").trimEnd().split("\n").reverse();
    for (const l of lines) {
      let r: any; try { r = JSON.parse(l); } catch { continue; }
      const w = r?.src === "api" && r.usage?.seven_day;
      if (!w || typeof w.utilization !== "number" || !w.resets_at) continue;
      const t = Date.parse(r.t), age = (now - t) / 6e4;
      if (!(age <= c.stale_minutes)) return { open: false, why: `usage data is ${Math.round(age)} min old` };
      const elapsed = Math.min(1, Math.max(0, (t - (Date.parse(w.resets_at) - WEEK)) / WEEK));
      const line = elapsed * 100 * c.ceiling;
      return { open: w.utilization <= line, why: `weekly ${w.utilization}% vs even pace ${line.toFixed(1)}%` };
    }
  }
  return { open: false, why: "no usage data" };
}

// ── task folders ────────────────────────────────────────────────────────────────────────────

export const safe = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_");
export const branch = (id: string) => `agent/${safe(id)}`;
export const folder = (stateDir: string, p: Project, id: string) => join(stateDir, "runs", p.id, safe(id));

function sh(args: string[], cwd?: string) {
  const r = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
}
function must(args: string[], cwd?: string) {
  const r = sh(args, cwd);
  if (!r.ok) throw new Error(`${args.join(" ")} failed: ${r.out.trim().split("\n").slice(-5).join("\n")}`);
  return r.out;
}

export function createFolder(stateDir: string, p: Project, t: TaskView): string {
  const dir = folder(stateDir, p, t.id);
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, ".task.json"), JSON.stringify({ project: p.id, id: t.id }));
  for (const r of p.repos) {
    const wt = join(dir, basename(r.path));
    if (existsSync(wt)) continue;
    const exists = sh(["git", "-C", r.path, "rev-parse", "--verify", "--quiet", `refs/heads/${branch(t.id)}`]).ok;
    must(["git", "-C", r.path, "worktree", "add", wt, ...(exists ? [branch(t.id)] : ["-b", branch(t.id), r.base])]);
    // A half-set-up worktree would be skipped on retry, so a failed setup takes it away again.
    try { for (const cmd of p.setup) must(["sh", "-c", cmd], wt); }
    catch (e) { sh(["git", "-C", r.path, "worktree", "remove", "--force", wt]); throw e; }
  }
  return dir;
}

// Why a folder can't be thrown away yet: a worktree with uncommitted changes, or a branch not
// merged into its base. Empty means everything of value already lives somewhere else.
export function unshipped(dir: string, p: Project, id: string): string[] {
  return p.repos.flatMap(r => {
    const wt = join(dir, basename(r.path));
    if (!existsSync(wt)) return [];
    const why: string[] = [];
    if (must(["git", "status", "--porcelain"], wt).trim()) why.push(`${basename(r.path)} has uncommitted changes`);
    if (!sh(["git", "-C", r.path, "merge-base", "--is-ancestor", branch(id), r.base]).ok) why.push(`${branch(id)} is not merged into ${r.base}`);
    return why;
  });
}

// Deletes the folder only when nothing in it is unshipped; otherwise marks it kept, for a human.
export function cleanup(dir: string, p: Project, id: string): string[] {
  const why = unshipped(dir, p, id);
  if (why.length) { writeFileSync(join(dir, ".kept"), why.join("\n") + "\n"); return why; }
  for (const r of p.repos) {
    const wt = join(dir, basename(r.path));
    if (!existsSync(wt)) continue;
    must(["git", "-C", r.path, "worktree", "remove", wt]);
    sh(["git", "-C", r.path, "branch", "-d", branch(id)]);
  }
  rmSync(dir, { recursive: true, force: true });
  return [];
}

// ── the prompt ──────────────────────────────────────────────────────────────────────────────

export function prompt(template: string, p: Project, t: TaskView, dir: string, cli: string, extra = ""): string {
  const list = (xs: string[]) => xs.length ? xs.map(x => `- \`${x}\``).join("\n") : "- (none)";
  const vars: Record<string, string> = {
    cli, project: p.id, task_id: t.id, label: t.label, desc: t.desc || "(no description)", folder: dir,
    repos: p.repos.length ? p.repos.map(r => `- \`${basename(r.path)}/\`: worktree of ${r.path} on \`${branch(t.id)}\`, branched off \`${r.base}\``).join("\n") : "- (none: this task has no repository)",
    repo_paths: p.repos.length ? p.repos.map(r => `- \`${r.path}\` (base \`${r.base}\`)`).join("\n") : "- (none)",
    checks: list(p.checks), productionalize: p.productionalize.trim() || "Nothing to ship: run `finish --nothing-to-ship`.",
    project_prompt: p.prompt || "(none)",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "") + (extra ? `\n\n${extra}` : "");
}

const quote = (cs: Comment[]) => cs.map(c => `> ${c.text.replace(/\n/g, "\n> ")}`).join("\n\n");
export function relayText(d: Derived, cli: string): string {
  const said = d.since.length ? `\n\nWhat they wrote:\n\n${quote(d.since)}` : "";
  if (d.state === "approved" && d.refine)
    return `[kelpie] The human marked this Approved, but a refine run ends only when they sign the task off: the Refined field in its Inspector ("Refined just now"). Tell them so, then run \`${cli} review\`.${said}`;
  return d.state === "approved"
    ? `[kelpie] The human APPROVED this task. Productionalize it as your instructions say, then run \`${cli} finish\`.${said}`
    : `[kelpie] The human replied${d.since.length ? "" : " (marked Changes requested, no comment)"}. Continue, and run \`${cli} review\` when you next need them.${said}`;
}

// ── tick ────────────────────────────────────────────────────────────────────────────────────

export type Deps = {
  tracker: Tracker; herdr: Herdr; config: Config; projects: Project[];
  stateDir: string; templates: { work: string; refine: string }; cli: string;
  gate: () => { open: boolean; why: string }; now: () => number; log: (s: string) => void;
  bootTime: () => number; // when the machine last booted: deaths across a reboot aren't the agent's fault
  paused: () => boolean; // `kelpie pause`: start nothing new; running agents carry on
};
type Cache = { lastTick: number; panes: Record<string, { seq: number; status: AgentStatus; idleMs: number }> };

export function lock(stateDir: string): (() => void) | null {
  const dir = join(stateDir, "tick.lock");
  mkdirSync(stateDir, { recursive: true });
  try { mkdirSync(dir); } catch {
    const pid = Number(readFileSync(join(dir, "pid"), "utf8").trim() || 0);
    try { if (pid) { process.kill(pid, 0); return null; } } catch { /* dead holder: take over */ }
  }
  writeFileSync(join(dir, "pid"), String(process.pid));
  return () => rmSync(dir, { recursive: true, force: true });
}

export async function tick(d: Deps): Promise<void> {
  const cacheFile = join(d.stateDir, "state.json");
  const cache: Cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : { lastTick: 0, panes: {} };
  const now = d.now();
  // ponytail: a gap longer than 10 min (sleep, launchd skipped) counts as 10, so a Mac that slept
  // overnight doesn't wake to every run stalled.
  const dt = cache.lastTick ? Math.min(now - cache.lastTick, 10 * 6e4) : 0;
  const runs = (await Promise.all(d.projects.map(async p => (await d.tracker.listTasks(p.color)).map(t => ({ p, t, s: derive(t) }))))).flat();
  type Run = (typeof runs)[number];
  const guarded = async (r: Run, what: string, f: () => Promise<void>, flag = true) => {
    try { await f(); } catch (e: any) {
      d.log(`${r.t.id}: ${what} failed: ${e.message}`);
      if (!flag) return; // retried next tick
      await stall(d, r.t, `error`, `${what} failed:\n\n${e.message}`).catch(e2 => d.log(`${r.t.id}: could not flag: ${e2.message}`));
      r.s.state = "waiting";
    }
  };

  // Handed over without noQueue, a task waits behind the human's own queue and never reads as
  // ready. Fixed here rather than trusted to every way of setting For: Agent; ready catches up next tick.
  for (const r of runs.filter(r => !r.t.noQueue && r.t.status !== "done"))
    await d.tracker.setNoQueue(r.t.id).then(() => d.log(`${r.t.id}: set noQueue`), e => d.log(`${r.t.id}: setNoQueue failed: ${e.message}`));

  // Review cleared by hand on a run that still waits (derive reads the handoff): put the chip back.
  for (const r of runs.filter(r => r.s.state === "waiting" && r.t.review === "none"))
    await d.tracker.setReview(r.t.id, "needs").then(() => d.log(`${r.t.id}: Review was cleared, set back to Needs review`), e => d.log(`${r.t.id}: setReview failed: ${e.message}`));

  let agents: Awaited<ReturnType<Herdr["agents"]>> | null = null;
  try { agents = await d.herdr.agents(); } catch (e: any) { d.log(`herdr unavailable, only cleaning up: ${e.message}`); }

  // 1. clean up finished runs
  for (const { p, t, s } of runs.filter(r => r.s.state === "finished")) {
    const dir = folder(d.stateDir, p, t.id);
    if (!existsSync(dir) || existsSync(join(dir, ".kept"))) continue;
    if (s.pane && agents) await d.herdr.close(s.pane).catch(() => {});
    const why = cleanup(dir, p, t.id);
    if (why.length) await d.tracker.comment(t.id, `[dispatch] kept folder=${dir}\n\nThe task folder was kept because:\n\n${why.map(w => `- ${w}`).join("\n")}`);
    d.log(why.length ? `${t.id}: kept ${dir}` : `${t.id}: cleaned up`);
  }
  // A refine run whose task you signed off is over: its folder held only a draft.
  for (const { p, t, s } of runs.filter(r => r.s.state === "signedoff")) {
    if (s.pane && agents) await d.herdr.close(s.pane).catch(() => {});
    rmSync(folder(d.stateDir, p, t.id), { recursive: true, force: true });
    await d.tracker.comment(t.id, `[dispatch] refined`);
    if (t.review !== "none") await d.tracker.setReview(t.id, "none");
    d.log(`${t.id}: signed off, refine run closed`);
  }
  if (!agents) { save(); return; }

  // A pane moved to another herdr space gets a new id. Find its agent by the run folder it works in
  // and record the new id, rather than taking the old one for dead and restarting a live agent.
  for (const r of runs.filter(r => r.s.pane && !agents!.has(r.s.pane) && r.s.state !== "finished")) {
    const dir = folder(d.stateDir, r.p, r.t.id);
    const moved = [...agents.entries()].find(([, a]) => a.cwd === dir || a.cwd?.startsWith(dir + "/"))?.[0];
    if (!moved) continue;
    await d.tracker.comment(r.t.id, `[dispatch] moved pane=${moved}`);
    d.log(`${r.t.id}: pane moved ${r.s.pane} → ${moved}`);
    r.s.pane = moved;
  }

  // 2. watch working runs
  const seen = new Set<string>();
  for (const r of runs.filter(r => r.s.state === "working")) {
    const a = r.s.pane ? agents.get(r.s.pane) : undefined;
    if (!a) {
      const counted = cache.panes[r.s.pane ?? ""]?.status === "working" && d.bootTime() < cache.lastTick;
      await guarded(r, "restart", () => restart(d, r.p, r.t, r.s, counted));
      continue;
    }
    const prev = cache.panes[r.s.pane!];
    // Background work (a shell, a subagent, a workflow) is the agent still at it, however quiet the pane.
    const busy = backgroundRunning(folder(d.stateDir, r.p, r.t.id)).length > 0;
    const idleMs = a.status === "working" || busy || !prev || prev.seq !== a.seq ? 0 : prev.idleMs + dt;
    cache.panes[r.s.pane!] = { seq: a.seq, status: a.status, idleMs };
    seen.add(r.s.pane!);
    if (idleMs >= d.config.stall_minutes * 6e4) {
      const tail = await d.herdr.tail(r.s.pane!, 20).catch(() => "");
      const lines = tail ? "The pane's last lines:\n\n```\n" + tail.trimEnd() + "\n```" : "";
      // An agent that went quiet at a prompt is waiting on the human, not broken: only a pane
      // herdr can't read is a stall.
      if (a.status === "idle" || a.status === "blocked") await waitOnHuman(d, r.t, a.status, lines);
      else await stall(d, r.t, a.status, lines);
      r.s.state = "waiting";
    }
  }
  for (const k of Object.keys(cache.panes)) if (!seen.has(k)) delete cache.panes[k];

  // 3. fill free slots. Each project has its own build slot and refine slot: a refine run (talking
  // to the human) never holds up a build, nor one project another. Only the usage gate is shared.
  // In-flight runs first (approved, then input), then at most one new run of each kind per tick.
  const kind = (r: Run): "work" | "refine" => r.s.refine || r.s.state === "refinable" ? "refine" : "work";
  const busy = (k: "work" | "refine", p?: Project) => runs.filter(r => kind(r) === k && r.s.state === "working" && (!p || r.p === p)).length;
  for (const state of ["approved", "input"] as const)
    for (const r of runs.filter(r => r.s.state === state)) {
      const k = kind(r);
      if (busy(k, r.p)) continue;
      // Not flagged on failure: a stall would bury the human's input under a new handoff.
      let ok = false;
      await guarded(r, "relay", async () => { await relay(d, r.p, r.t, r.s, agents!); ok = true; }, false);
      if (ok) r.s.state = "working";
    }
  const g = d.gate();
  const byRank = (a: Run, b: Run) => (a.t.rank ?? Infinity) - (b.t.rank ?? Infinity);
  for (const k of ["work", "refine"] as const) {
    // Refining only touches tasks handed over unsigned, by the human's choice.
    const want: State = k === "work" ? "candidate" : "refinable";
    for (const p of d.projects) {
      const pending = runs.some(r => r.p === p && kind(r) === k && ["waiting", "input", "approved"].includes(r.s.state));
      const next = runs.filter(r => r.p === p && r.s.state === want).sort(byRank)[0];
      if (!next || busy(k, p) || pending) continue;
      if (d.paused()) { d.log(`not starting ${next.t.id}: paused`); break; }
      if (!g.open) { d.log(`not starting ${next.t.id}: gate shut (${g.why})`); break; }
      await guarded(next, "dispatch", () => dispatch(d, p, next.t, k === "refine"));
      Object.assign(next.s, { state: "working", refine: k === "refine" });
      break; // one new run of each kind per tick: usage data only refreshes every ~15 min, so projects start staggered
    }
  }
  save();

  function save() { cache.lastTick = now; writeFileSync(cacheFile, JSON.stringify(cache)); }
}

// Refine runs leave the task's sessions alone: it stays todo, so a sign-off makes it a plain candidate.
async function ensureRunning(d: Deps, t: TaskView, refine = false) { if (!refine && t.status !== "running") { await d.tracker.start(t.id); t.status = "running"; } }

// The agent stopped without running `review` (an unanswered question, or work done and left for
// the human). Same handoff as a review, so the human's reply is relayed the usual way.
async function waitOnHuman(d: Deps, t: TaskView, status: AgentStatus, body: string) {
  await d.tracker.comment(t.id, `[dispatch] idle: ${status === "blocked" ? "blocked on a prompt, waiting on you" : "waiting on you"}${body ? `\n\n${body}` : ""}`);
  await d.tracker.setReview(t.id, "needs");
  if (t.status === "running") await d.tracker.stop(t.id);
  d.log(`${t.id}: ${status}, waiting on the human`);
}

async function stall(d: Deps, t: TaskView, reason: string, body: string) {
  await d.tracker.comment(t.id, `[dispatch] stalled: ${reason}${body ? `\n\n${body}` : ""}`);
  await d.tracker.setReview(t.id, "needs");
  if (t.status === "running") await d.tracker.stop(t.id);
  d.log(`${t.id}: stalled (${reason})`);
}

// "✎ add type-aware Oxlint…": a refine (✎) or work (⚒) run, minus a "Timeline Studio: " prefix
// that only repeats the project, cut to what a sidebar shows.
export const tabLabel = (p: Project, label: string, refine: boolean) =>
  `${refine ? "✎" : "⚒"} ${label.replace(new RegExp(`^${p.id.replace(/-/g, "[ -]")}:\\s*`, "i"), "")}`.slice(0, 60);

async function spawn(d: Deps, p: Project, t: TaskView, refine: boolean, extra = ""): Promise<string> {
  const dir = createFolder(d.stateDir, refine ? { ...p, repos: [] } : p, t); // refining only reads the repos
  const file = join(dir, ".prompt.md");
  writeFileSync(file, prompt(refine ? d.templates.refine : d.templates.work, p, t, dir, d.cli, extra));
  // The tab is named for the task, so herdr's sidebar says what each agent is on.
  return d.herdr.spawn(tabLabel(p, t.label, refine), dir, file, { label: p.space, home: p.repos[0]?.path ?? dir }, refine ? MODELS.refine : buildModel(t.desc));
}

export async function dispatch(d: Deps, p: Project, t: TaskView, refine: boolean) {
  await d.tracker.comment(t.id, refine ? `[dispatch] refining` : `[dispatch] dispatching`);
  await ensureRunning(d, t, refine);
  const pane = await spawn(d, p, t, refine);
  await d.tracker.comment(t.id, `[dispatch] started pane=${pane} folder=${folder(d.stateDir, p, t.id)}`);
  d.log(`${t.id}: dispatched to ${pane}`);
}

const RESUME = "## You are resuming\n\nAn earlier session on this task ended unexpectedly. Run the `history` command (your earlier handovers and the human's replies), then read notes/ and the repositories' state to see how far it got, and carry on.";

export async function restart(d: Deps, p: Project, t: TaskView, s: Derived, wasWorking: boolean) {
  if (wasWorking && s.restarts >= 2) return stall(d, t, "crashed 3×", "The agent died three times in this round.");
  if (s.pane) await d.herdr.close(s.pane).catch(() => {});
  await ensureRunning(d, t, s.refine);
  const pane = await spawn(d, p, t, s.refine, RESUME);
  await d.tracker.comment(t.id, `[dispatch] restarted pane=${pane} counted=${wasWorking ? 1 : 0}`);
  d.log(`${t.id}: restarted in ${pane}`);
}

export async function relay(d: Deps, p: Project, t: TaskView, s: Derived, agents: Map<string, unknown>) {
  if (!s.relayPending) {
    const text = relayText(s, d.cli);
    let pane = "";
    if (s.pane && agents.has(s.pane)) await d.herdr.prompt(s.pane, text);
    else pane = await spawn(d, p, t, s.refine, `${RESUME}\n\n## Latest from the human\n\n${text}`);
    await d.tracker.comment(t.id, `[dispatch] relayed kind=${s.state}${pane ? ` pane=${pane}` : ""}`);
  }
  await d.tracker.setReview(t.id, "none");
  await ensureRunning(d, t, s.refine);
  d.log(`${t.id}: relayed ${s.state}`);
}

// ── commands an agent runs from inside its task folder ──────────────────────────────────────

// What the agent's Stop hook (`kelpie bg`) last saw running in the background, per run folder.
export function backgroundRunning(dir: string): string[] {
  try { return JSON.parse(readFileSync(join(dir, ".background"), "utf8")).running ?? []; } catch { return []; }
}

export function locate(stateDir: string, cwd: string) {
  const runs = join(stateDir, "runs");
  const rel = existsSync(runs) ? relative(realpathSync(runs), realpathSync(cwd)) : "..";
  const [project, dirName] = rel.split(sep);
  if (rel.startsWith("..") || !project || !dirName) throw new Error(`not inside a task folder (under ${runs}/<project>/<task>)`);
  const dir = join(runs, project, dirName);
  const meta = JSON.parse(readFileSync(join(dir, ".task.json"), "utf8")) as { project: string; id: string };
  return { dir, ...meta };
}

export async function agentCommand(tracker: Tracker, projects: Project[], stateDir: string, cwd: string, cmd: string, arg: string, flags: Set<string>) {
  const at = locate(stateDir, cwd);
  const p = projects.find(x => x.id === at.project);
  if (!p) throw new Error(`no project file for ${at.project}`);
  const t = (await tracker.listTasks(p.color)).find(x => x.id === at.id);
  if (!t) throw new Error(`task ${at.id} is no longer handed to agents (For: Agent, Project ${p.color})`);
  const needText = () => { if (!arg.trim()) throw new Error(`${cmd} needs text`); };
  // signoff / approve / close act on the human's explicit word (typed into the pane, or the spec page's
  // Sign off button, which quotes the judgments), and quote it
  // into the task's history so the record shows exactly what was said.
  const said = (what: string) => { needText(); return `${what}, on the human's word:\n\n> ${arg.trim().replace(/\n/g, "\n> ")}`; };
  switch (cmd) {
    case "review":
      if (flags.has("--questions")) { needText(); await tracker.comment(t.id, `[dispatch] questions\n\nnot refined enough:\n\n${arg}`); }
      // The record is the handover itself: the words the human just read in the pane.
      else {
        if (!arg.trim()) throw new Error('review needs your handover as text: review "<what you just told the human: what you did, then what you need from them>". There is no REVIEW.md any more.');
        await tracker.comment(t.id, `[dispatch] review\n\n${arg}`);
      }
      await tracker.setReview(t.id, "needs");
      if (t.status === "running") await tracker.stop(t.id);
      return "Recorded on the task. Now tell the human, here, what you need from them (see Handing over), and wait. They are the reviewer: don't tell them you sent it for review.";
    case "history":
      // What a resumed session needs: the task as written, and every handover and reply so far.
      return [`# ${t.label}`, t.desc || "(no description)", ...t.comments.map(c => `---\n${c.mine ? "dispatcher/agent" : "human"} ${c.at}\n${c.text}`)].join("\n\n");
    case "input":
      needText();
      await tracker.comment(t.id, `[dispatch] input\n\n${arg}`);
      await tracker.setReview(t.id, "none");
      if (!derive(t).refine && t.status !== "running") await tracker.start(t.id);
      return "Logged.";
    case "describe": {
      // Only while refining: rewriting a description clears the human's sign-off.
      if (!derive(t).refine) throw new Error("describe is only for refine runs: changing a signed-off task's description voids the sign-off");
      const text = existsSync(join(at.dir, arg)) ? readFileSync(join(at.dir, arg), "utf8") : arg;
      if (!text.trim()) throw new Error("describe needs the new description, or a file in the task folder holding it");
      await tracker.setDesc(t.id, text);
      return "Description updated.";
    }
    case "comment":
      needText();
      await tracker.comment(t.id, `[dispatch] note\n\n${arg}`);
      return "Commented.";
    case "signoff":
      if (!derive(t).refine) throw new Error("signoff is for refine runs; a build is approved with `approve`");
      await tracker.comment(t.id, `[dispatch] signoff\n\n${said("Signed off")}`);
      await tracker.signOff(t.id);
      return "Signed off. Your refine run is over: stop here. The build starts on the next tick.";
    case "approve":
      if (derive(t).refine) throw new Error("approve is for builds; a refine run is signed off with `signoff`");
      await tracker.comment(t.id, `[dispatch] approved\n\n${said("Approved")}`);
      await tracker.setReview(t.id, "none");
      if (t.status !== "running") await tracker.start(t.id);
      return "Approved. Productionalize it as your instructions say, then run finish.";
    case "close":
      await tracker.comment(t.id, `[dispatch] closed\n\n${said("Closed without building")}`);
      if (t.review !== "none") await tracker.setReview(t.id, "none");
      await tracker.finish(t.id);
      return "Closed. The dispatcher cleans up this folder on its next tick.";
    case "finish": {
      if (derive(t).refine) throw new Error("finish is for work runs: a refine run ends with `signoff`, or `close` if the human drops it");
      const why = flags.has("--nothing-to-ship") ? [] : unshipped(at.dir, p, t.id);
      if (why.length) throw new Error(`not finished, because:\n${why.map(w => `- ${w}`).join("\n")}\nShip it, or pass --nothing-to-ship if this task genuinely has nothing to ship.`);
      await tracker.comment(t.id, `[dispatch] finished${arg.trim() ? `\n\n${arg.trim()}` : ""}`);
      await tracker.finish(t.id);
      return "Finished. The dispatcher cleans up this folder on its next tick.";
    }
  }
  throw new Error(`unknown command ${cmd}`);
}

// The human's word from a page (corrections sent, a sign-off), delivered to the run's pane now
// instead of at the next tick. `human` writes as the human, so the reply reads as theirs.
export async function pageEvent(d: Deps, human: Tracker, stateDir: string, cwd: string, text: string, closeAfter = false) {
  const at = locate(stateDir, cwd);
  const p = d.projects.find(x => x.id === at.project);
  if (!p) throw new Error(`no project file for ${at.project}`);
  const find = async () => (await d.tracker.listTasks(p.color)).find(x => x.id === at.id);
  let t = await find();
  if (!t) throw new Error(`task ${at.id} is no longer handed to agents`);
  const agents = await d.herdr.agents();
  const pane = derive(t).pane;
  const live = !!pane && agents.has(pane);
  if (!closeAfter) {
    await human.comment(t.id, text); // the record, and what a relay quotes
    t = (await find())!;
    const s = derive(t);
    if (s.state === "input" || s.state === "approved") { await relay(d, p, t, s, agents); return { msg: live ? "Told the agent." : "The agent had no live pane: restarted it with your words.", pane: live ? pane : undefined }; }
  }
  if (live) { await d.herdr.prompt(pane!, `[kelpie] ${text}`); return { msg: "Told the agent.", pane }; }
  return { msg: "The agent has no live pane; the next tick picks the comment up.", pane: undefined };
}
