// Behaviour tests: the tick and the agent commands run against an in-memory tracker and a fake
// herdr; task folders are real worktrees of a throwaway git repo.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { answerStale, buildNext, refineNext, start } from "./actions.ts";
import { status } from "./status.ts";
import * as projectFiles from "./projects.ts";
import { BY, timelineStudio } from "./timeline-studio.ts";
import {
  agentCommand, approvedFromPage, cleanup, createFolder, derive, dredgeFolder, folder, gate, loadConfig, loadProjects, pageEvent, PAGE_APPROVED, prompt, tick, unpublished, withShipLine,
  type AgentStatus, type Comment, type RunModel, type Config, type Deps, type Herdr, type Project, type Review, type TaskView, type Tracker, type OpenTask,
} from "./dispatcher.ts";
import { note } from "./panel.ts";
import { needsYou, riskOf } from "./viz-pages/kelpie-board/needs.ts";

const nth = <T>(xs: readonly T[], i: number): T => {
  const x = xs.at(i);
  if (x === undefined) throw new Error(`no item ${i} in ${xs.length}`);
  return x;
};
const tmp = () => mkdtempSync(join(tmpdir(), "ad-"));
const git = (cwd: string, ...a: string[]) => {
  const r = Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode) throw new Error(r.stderr.toString());
  return r.stdout.toString();
};
function repo() {
  const d = tmp();
  git(d, "init", "-q", "-b", "trunk");
  writeFileSync(join(d, "a.txt"), "a\n");
  git(d, "add", "."); git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return d;
}

const task = (id: string, o: Partial<TaskView> = {}): TaskView =>
  ({ id, label: `Task ${id}`, desc: "do it", ready: true, rank: null, status: "todo", review: "none", comments: [], refined: true, noQueue: true, due: null, waitingOn: null, blockedBy: [], touched: null, ...o });
// Handed over, and only lacking the human's sign-off.
const unsigned = (id: string, o: Partial<TaskView> = {}) => task(id, { ready: false, refined: false, waitingOn: "unrefined", ...o });
const me = (text: string): Comment => ({ text, at: "", mine: true });
const you = (text: string): Comment => ({ text, at: "", mine: false });

class FakeTracker implements Tracker {
  tasks = new Map<string, TaskView & { color: string }>();
  add(color: string, t: TaskView) { this.tasks.set(t.id, { ...t, color }); return this; }
  get = (id: string) => {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`no task ${id}`);
    return t;
  };
  async listTasks(color: string) { return [...this.tasks.values()].filter(t => t.color === color).map(t => structuredClone(t)); }
  async setNoQueue(id: string) { this.get(id).noQueue = true; }
  async setNotBefore(id: string, at: string) { this.notBefore[id] = at; Object.assign(this.get(id), { ready: false, waitingOn: "notBefore" }); }
  notBefore: Record<string, string> = {};
  async start(id: string) { if (this.get(id).status === "running") throw new Error("already running"); this.get(id).status = "running"; }
  async stop(id: string) { if (this.get(id).status !== "running") throw new Error("not running"); this.get(id).status = "paused"; }
  async finish(id: string) { this.get(id).status = "done"; }
  async comment(id: string, text: string) { this.get(id).comments.push({ ...me(text), at: new Date(clock).toISOString() }); }
  async setReview(id: string, v: Review) { this.get(id).review = v; }
  async signOff(id: string) { Object.assign(this.get(id), { refined: true, ready: true, waitingOn: null }); }
  async unrefine(id: string) { Object.assign(this.get(id), { refined: false, ready: false }); }
  async setDesc(id: string, text: string) { this.get(id).desc = text; this.get(id).refined = false; }
  noticeText: string | null = null; noticeWrites = 0;
  async colors() { return [...new Set([...this.tasks.values()].map(t => t.color))]; }
  async forAgent(id: string) { const o = this.others.find(t => t.id === id); if (o) o.agent = true; }
  async addColor(id: string, color: string) { this.others.find(t => t.id === id)?.colors.push(color); }
  others: OpenTask[] = []; // non-Agent tasks, for the "outside Kelpie" lists
  async openTasks() {
    return [...[...this.tasks.values()].filter(t => t.status !== "done").map(t => ({ id: t.id, label: t.label, status: t.status, agent: true, colors: [t.color] })), ...this.others];
  }
  async notice() { return this.noticeText; }
  async setNotice(text: string | null) { this.noticeText = text; this.noticeWrites++; }
  kinds = (id: string) => this.get(id).comments.filter(c => c.mine).map(c => c.text.replace(/\n[\s\S]*/, "").split(" ")[1]);
}

class FakeHerdr implements Herdr {
  live = new Map<string, { status: AgentStatus; seq: number; cwd?: string }>();
  spawned: { label: string; cwd: string; prompt: string; space: string; model: string; resume?: string }[] = [];
  prompts: [string, string][] = [];
  closed: string[] = [];
  blocked = false;
  async agents() { return new Map(this.live); }
  async spawn(label: string, cwd: string, file: string, space: { label: string }, run: RunModel, resume?: string) {
    const pane = `p${this.spawned.length + 1}`;
    this.spawned.push({ label, cwd, prompt: readFileSync(file, "utf8"), space: space.label, model: `${run.model}/${run.effort}`, resume });
    this.live.set(pane, { status: "working", seq: 1, cwd });
    return pane;
  }
  async prompt(pane: string, text: string) { if (this.blocked) throw new Error("agent_blocked"); this.prompts.push([pane, text]); }
  async tail() { return "Should I use option A or B?"; }
  async close(pane: string) { this.closed.push(pane); this.live.delete(pane); }
}

const CFG: Config = { ceiling: 0.85, stall_minutes: 15, stale_minutes: 30 };
const proj = (id: string, o: Partial<Project> = {}): Project =>
  ({ id, color: `C-${id}`, space: `Space ${id}`, repos: [], setup: [], checks: [], productionalize: "", prompt: "", ...o });

// Never this machine's real panel: each test that wants one writes its own session file here.
process.env.APP_PANEL_SESSIONS = mkdtempSync(join(tmpdir(), "ad-panel-"));
let tr: FakeTracker, hd: FakeHerdr, state: string, clock: number, gateOpen: boolean, logs: string[];
beforeEach(() => { tr = new FakeTracker(); hd = new FakeHerdr(); state = tmp(); clock = Date.parse("2026-10-09T12:00:00Z"); gateOpen = true; logs = []; });
const deps = (projects: Project[], o: Partial<Deps> = {}): Deps => ({
  tracker: tr, herdr: hd, config: CFG, projects, stateDir: state, templates: { work: "Work on {{label}} in {{folder}}.", refine: "Refine {{label}}.", dredge: "Dredge {{project}} in {{folder}}." }, cli: "/cli",
  gate: () => ({ open: gateOpen, why: "test" }), now: () => clock, log: s => logs.push(s), bootTime: () => 0, paused: () => false, active: () => Infinity, ...o,
});
const run = async (projects: Project[], o: Partial<Deps> = {}) => { await tick(deps(projects, o)); clock += 5 * 6e4; };

describe("config and project files", () => {
  it("fills defaults and reads a project file", () => {
    const d = tmp();
    mkdirSync(join(d, "projects"));
    writeFileSync(join(d, "projects/ts.md"), "---\ncolor: ts-colour\nrepos:\n  - path: ~/code/ts\n    base: private/trunk\nchecks: [bun test]\nproductionalize: |\n  merge it\n---\nBe careful.\n");
    expect(loadConfig(d).ceiling).toBe(0.85);
    const [p] = loadProjects(d);
    expect(p).toEqual({ id: "ts", color: "ts-colour", space: "Ts", repos: [{ path: `${process.env.HOME}/code/ts`, base: "private/trunk" }], setup: [], checks: ["bun test"], productionalize: "merge it\n", prompt: "Be careful." });
  });
  it("names the file and field that are wrong", () => {
    const d = tmp();
    mkdirSync(join(d, "projects"));
    writeFileSync(join(d, "projects/bad.md"), "---\nrepos: {}\n---\n");
    expect(() => loadProjects(d)).toThrow(/bad\.md: repos must be a list/);
  });
  it("takes the Project colour from the file name unless it says otherwise", () => {
    const d = tmp();
    mkdirSync(join(d, "projects"));
    writeFileSync(join(d, "projects/timeline-studio.md"), "---\nrepos: []\n---\n");
    expect(loadProjects(d)[0]).toMatchObject({ color: "timeline-studio", space: "Timeline Studio" });
  });
});

describe("derive", () => {
  const s = (t: TaskView) => derive(t).state;
  it("a paused, unsigned task held by `later` is not refined until its notBefore passes", () => {
    const paused = { status: "paused" as const, ready: false, refined: false };
    expect(s(task("a", { ...paused, notBefore: new Date(Date.now() + 864e5).toISOString() }))).toBe("ignored");
    expect(s(task("a", { ...paused, notBefore: new Date(Date.now() - 864e5).toISOString() }))).toBe("refinable");
  });
  it("reads each state off the task", () => {
    expect(s(task("a"))).toBe("candidate");
    expect(s(task("a", { ready: false }))).toBe("ignored");
    expect(s(task("a", { status: "running", comments: [me("[dispatch] started pane=p1")] }))).toBe("working");
    const handed = [me("[dispatch] started pane=p1"), me("[dispatch] review\n\nREVIEW")];
    expect(s(task("a", { status: "paused", review: "needs", comments: handed }))).toBe("waiting");
    expect(s(task("a", { status: "paused", review: "needs", comments: [...handed, you("use B")] }))).toBe("input");
    expect(s(task("a", { status: "paused", review: "changes", comments: handed }))).toBe("input");
    expect(s(task("a", { status: "paused", review: "approved", comments: handed }))).toBe("approved");
    expect(s(task("a", { status: "done", comments: handed }))).toBe("finished");
    // Started by hand once, then handed over: Kelpie's to take. Running by hand: left alone.
    expect(s(task("a", { status: "paused", comments: [you("looked into it")] }))).toBe("candidate");
    expect(s(task("a", { status: "paused", ready: false, refined: false }))).toBe("refinable");
    expect(s(task("a", { status: "paused", ready: false, refined: false, blockedBy: ["b"] }))).toBe("ignored");
    expect(s(task("a", { status: "running" }))).toBe("ignored");
    // Started by hand, then refined by Kelpie and signed off: still Kelpie's to build.
    expect(s(task("a", { status: "paused", comments: [you("looked into it"), me("[dispatch] refining"), me("[dispatch] refined")] }))).toBe("candidate");
  });
  it("tells the human's comments apart by author, not by text", () => {
    const d = derive(task("a", { review: "needs", comments: [me("[dispatch] review"), you("[dispatch] review")] }));
    expect(d.state).toBe("input");
  });
  it("carries comments made after approval along with it", () => {
    const d = derive(task("a", { review: "approved", comments: [me("[dispatch] review"), you("ship it, but bump the version")] }));
    expect(d.since.map(c => c.text)).toEqual(["ship it, but bump the version"]);
  });
});

describe("usage gate", () => {
  const rec = (t: string, util: number) => JSON.stringify({ src: "api", t, usage: { seven_day: { utilization: util, resets_at: "2026-10-10T06:00:00Z" } } });
  const now = Date.parse("2026-10-06T18:00:00Z"); // half the week gone: the line is 42.5%
  const dir = (...lines: string[]) => { const d = tmp(); writeFileSync(join(d, "2026-10.jsonl"), lines.join("\n") + "\n"); return d; };
  it("opens below even pace and shuts above it", () => {
    expect(gate(dir(rec("2026-10-06T17:50:00Z", 40)), CFG, now).open).toBe(true);
    expect(gate(dir(rec("2026-10-06T17:50:00Z", 45)), CFG, now).open).toBe(false);
  });
  it("fails closed on stale or missing data", () => {
    expect(gate(dir(rec("2026-10-06T16:00:00Z", 1)), CFG, now)).toMatchObject({ open: false, why: expect.stringContaining("min old") });
    expect(gate(dir('{"src":"statusline"}'), CFG, now)).toEqual({ open: false, why: "no usage data" });
    expect(gate(join(tmp(), "nope"), CFG, now).open).toBe(false);
  });
});

describe("task folders", () => {
  it("attaches each repo as a worktree off its base, runs setup, and cleans up only shipped work", () => {
    const r = repo();
    writeFileSync(join(r, ".git/info/exclude"), ".setup-ran\n"); // setup output is ignored, like node_modules
    const p = proj("ts", { repos: [{ path: r, base: "trunk" }], setup: ["touch .setup-ran"] });
    const dir = createFolder(state, p, task("T-1"));
    const wt = join(dir, basename(r));
    expect(git(wt, "branch", "--show-current").trim()).toBe("agent/T-1");
    expect(existsSync(join(wt, ".setup-ran"))).toBe(true);

    writeFileSync(join(wt, "b.txt"), "b\n");
    git(wt, "add", "b.txt"); git(wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "b");
    expect(cleanup(dir, p, "T-1")).toEqual(["agent/T-1 is not merged into trunk"]);
    expect(existsSync(join(dir, ".kept"))).toBe(true);

    git(r, "merge", "-q", "agent/T-1");
    expect(cleanup(dir, p, "T-1")).toEqual([]);
    expect(existsSync(dir)).toBe(false);
    expect(git(r, "branch", "--list", "agent/T-1").trim()).toBe("");
  });
  it("reruns setup on retry after it failed", () => {
    const r = repo();
    writeFileSync(join(r, ".git/info/exclude"), ".setup-ran\n");
    const flag = join(tmp(), "fixed");
    const p = proj("ts", { repos: [{ path: r, base: "trunk" }], setup: [`test -e ${flag} && touch .setup-ran`] });
    expect(() => createFolder(state, p, task("T-3"))).toThrow(/failed/);
    writeFileSync(flag, "");
    const wt = join(createFolder(state, p, task("T-3")), basename(r));
    expect(existsSync(join(wt, ".setup-ran"))).toBe(true);
  });
  it("keeps a folder whose worktree has uncommitted changes", () => {
    const r = repo();
    const p = proj("ts", { repos: [{ path: r, base: "trunk" }] });
    const dir = createFolder(state, p, task("T-2"));
    writeFileSync(join(dir, basename(r), "wip.txt"), "x");
    expect(cleanup(dir, p, "T-2")).toContain(`${r.split("/").pop()} has uncommitted changes`);
  });
  it("works with no repo at all", () => {
    const p = proj("notes");
    const dir = createFolder(state, p, task("T-3"));
    expect(existsSync(join(dir, "notes"))).toBe(true);
    expect(cleanup(dir, p, "T-3")).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("agent commands", () => {
  const p = proj("ts");
  const at = (id: string) => createFolder(state, p, task(id));
  const cmd = (dir: string, c: string, arg = "", ...flags: string[]) => agentCommand(tr, [p], state, dir, c, arg, new Set(flags));
  it("review records the handover the human just read, asks for review and pauses the task", async () => {
    tr.add(p.color, task("A", { status: "running" }));
    const dir = at("A");
    await expect(cmd(dir, "review")).rejects.toThrow(/review needs your handover as text/);
    await cmd(join(dir, "notes"), "review", "Did the thing. Approve?"); // works from any depth inside the folder
    expect(tr.get("A")).toMatchObject({ review: "needs", status: "paused" });
    expect(nth(tr.get("A").comments, -1).text).toBe("[dispatch] review\n\nDid the thing. Approve?");
    expect(await cmd(dir, "history")).toContain("Did the thing. Approve?");
  });
  it("review --questions bounces the task as not refined enough", async () => {
    tr.add(p.color, task("A", { status: "running" }));
    await cmd(at("A"), "review", "What counts as done?", "--questions");
    expect(nth(tr.get("A").comments, -1).text).toContain("not refined enough:\n\nWhat counts as done?");
  });
  it("input logs what the human typed into the pane and resumes", async () => {
    tr.add(p.color, task("A", { status: "paused", review: "needs" }));
    await cmd(at("A"), "input", "go with B");
    expect(tr.get("A")).toMatchObject({ review: "none", status: "running" });
    expect(derive(tr.get("A")).state).toBe("working");
  });
  it("finish refuses unshipped work unless told there is nothing to ship", async () => {
    const r = repo();
    const pr = proj("ts", { repos: [{ path: r, base: "trunk" }] });
    tr.add(pr.color, task("A", { status: "running" }));
    const dir = createFolder(state, pr, task("A"));
    const wt = join(dir, basename(r));
    writeFileSync(join(wt, "c.txt"), "c"); git(wt, "add", "."); git(wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "c");
    await expect(agentCommand(tr, [pr], state, dir, "finish", "", new Set())).rejects.toThrow(/not merged into trunk/);
    expect(tr.get("A").status).toBe("running");
    await agentCommand(tr, [pr], state, dir, "finish", "", new Set(["--nothing-to-ship"]));
    expect(tr.get("A").status).toBe("done");
  });
  it("describe rewrites the description only during a refine run", async () => {
    tr.add(p.color, task("W", { status: "running", comments: [me("[dispatch] dispatching")] }));
    await expect(cmd(at("W"), "describe", "new words")).rejects.toThrow(/only for refine runs/);
    tr.add(p.color, unsigned("R", { comments: [me("[dispatch] refining")] }));
    const dir = at("R");
    writeFileSync(join(dir, "DRAFT.md"), "## Done when\n- it works");
    await cmd(dir, "describe", "DRAFT.md");
    expect(tr.get("R").desc).toBe("## Done when\n- it works");
    await cmd(dir, "input", "scope it to the API only");
    expect(tr.get("R").status).toBe("todo"); // refining never starts the task
    await expect(cmd(dir, "finish", "", "--nothing-to-ship")).rejects.toThrow(/refine run ends with `signoff`/);
    expect(tr.get("R").status).toBe("todo");
  });
  it("signs a refine run off, approves a build, and closes either, only quoting the human", async () => {
    tr.add(p.color, unsigned("R", { review: "needs", comments: [me("[dispatch] refining"), me("[dispatch] review")] }));
    tr.add(p.color, task("W", { status: "paused", review: "needs", comments: [me("[dispatch] dispatching"), me("[dispatch] review")] }));
    tr.add(p.color, unsigned("X", { review: "needs", comments: [me("[dispatch] refining"), me("[dispatch] review")] }));
    const r = at("R"), w = at("W"), x = at("X");
    await expect(cmd(r, "signoff")).rejects.toThrow(/needs text/);
    await expect(cmd(r, "approve", "ship it")).rejects.toThrow(/signed off with `signoff`/);
    await expect(cmd(w, "signoff", "sign it off")).rejects.toThrow(/approved with `approve`/);
    await cmd(r, "signoff", "yes, sign it off");
    expect(tr.get("R").refined).toBe(true);
    expect(nth(tr.get("R").comments, -1).text).toContain("> yes, sign it off");
    expect(derive(tr.get("R")).state).toBe("signedoff");
    await cmd(w, "approve", "approved, merge it");
    expect(tr.get("W")).toMatchObject({ review: "none", status: "running" });
    expect(derive(tr.get("W")).state).toBe("working"); // no relay of an approval it already has
    await cmd(x, "close", "not worth doing, close it");
    expect(tr.get("X").status).toBe("done");
  });
  it("park unrefines a run: no Review, holds no slot, back in the refine queue unless blocked", async () => {
    tr.add(p.color, task("W", { status: "running", comments: [me("[dispatch] dispatching"), me("[dispatch] started pane=p1")] }));
    const w = at("W");
    await expect(cmd(w, "park")).rejects.toThrow(/needs text/);
    await cmd(w, "park", "park it for now");
    expect(tr.get("W")).toMatchObject({ status: "paused", review: "none", refined: false });
    expect(derive(tr.get("W")).state).toBe("refinable");
    expect(derive({ ...tr.get("W"), blockedBy: ["X"] }).state).toBe("ignored");
    expect(existsSync(w)).toBe(true); // the work stays for the next runs
    // Refined again and signed off: a paused task, but parked once, so it builds.
    await tr.comment("W", "[dispatch] refined"); await tr.signOff("W");
    expect(derive(tr.get("W")).state).toBe("candidate");
    // Paused + Needs review by hand is still a waiting run: only `park` frees the slot.
    expect(derive(task("V", { status: "paused", review: "needs", comments: [me("[dispatch] review")] })).state).toBe("waiting");
  });
  it("refuses to run outside a task folder", async () => {
    await expect(cmd(tmp(), "review")).rejects.toThrow(/not inside a task folder/);
  });
});

describe("tick", () => {
  const a = proj("a"), b = proj("b");
  it("dispatches the best-ranked candidate, one new spawn per tick", async () => {
    tr.add(a.color, task("A1", { rank: 2 })).add(a.color, task("A2", { rank: 1 })).add(b.color, task("B1"));
    await run([a, b]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task A2"]);
    expect(nth(hd.spawned, 0).prompt).toBe(`Work on Task A2 in ${folder(state, a, "A2")}.`);
    expect(tr.kinds("A2")).toEqual(["dispatching", "started"]);
    expect(tr.get("A2").status).toBe("running");
    await run([a, b]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task A2", "⚒ Task B1"]); // a is busy, so b goes next
    expect(hd.spawned.map(s => s.space)).toEqual(["Space a", "Space b"]); // each project in its own herdr space
  });
  it("starts the earliest deadline first, before any ranked task", async () => {
    tr.add(a.color, task("A1", { rank: 1 })).add(a.color, task("Later", { due: "2026-10-24T15:00:00.000Z" }))
      .add(a.color, task("Soon", { due: "2026-10-24T13:30:00.000Z" }));
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task Soon"]);
  });
  it("finishes a dispatch that died halfway, without counting it as a crash", async () => {
    tr.add(a.color, task("A1", { status: "running", comments: [me("[dispatch] dispatching")] }));
    await run([a]);
    expect(hd.spawned).toHaveLength(1);
    expect(nth(tr.get("A1").comments, -1).text).toMatch(/^\[dispatch\] restarted pane=p1 counted=0/);
  });
  it("relays the human's input, and keeps it for next tick if the pane is blocked", async () => {
    tr.add(a.color, task("A1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p9"), me("[dispatch] review"), you("use B")] }));
    hd.live.set("p9", { status: "blocked", seq: 3 });
    hd.blocked = true;
    await run([a]);
    expect(tr.get("A1").review).toBe("needs");
    expect(derive(tr.get("A1")).state).toBe("input");
    hd.blocked = false;
    await run([a]);
    expect(nth(hd.prompts, 0)[0]).toBe("p9");
    expect(nth(hd.prompts, 0)[1]).toContain("> use B");
    expect(tr.get("A1")).toMatchObject({ review: "none", status: "running" });
  });
  it("revives a waiting run whose pane died, once, to wait at its prompt", async () => {
    tr.add(a.color, task("W1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=gone"), me("[dispatch] review")] }));
    await run([a]);
    expect(hd.spawned).toHaveLength(1);
    expect(nth(hd.spawned, 0).prompt).toContain("You are back, waiting on the human");
    expect(tr.kinds("W1").at(-1)).toBe("revived");
    expect(tr.get("W1")).toMatchObject({ review: "needs", status: "paused" });
    expect(derive(tr.get("W1"))).toMatchObject({ state: "waiting", pane: "p1", restarts: 0 });
    await run([a]);
    expect(hd.spawned).toHaveLength(1); // its new pane is live: no second spawn
  });
  it("revives into the run's recorded session when its transcript is still there, else afresh", async () => {
    const waiting = (id: string) => task(id, { status: "paused", review: "needs", comments: [me("[dispatch] started pane=gone"), me("[dispatch] review")] });
    tr.add(a.color, waiting("S1"));
    const dir = createFolder(state, a, tr.get("S1")), transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, `{"type":"assistant"}\n`);
    writeFileSync(join(dir, ".session"), JSON.stringify({ id: "sess-1", transcript }));
    await run([a]);
    expect(hd.spawned[0]).toMatchObject({ resume: "sess-1" });
    expect(nth(hd.spawned, 0).prompt).toStartWith("## You are back"); // the briefing is already in the conversation
    tr.add(a.color, waiting("S2"));
    writeFileSync(join(createFolder(state, a, tr.get("S2")), ".session"), JSON.stringify({ id: "sess-2", transcript: join(dir, "gone.jsonl") }));
    await run([a]);
    expect(nth(hd.spawned, 1).resume).toBeUndefined();
    expect(nth(hd.spawned, 1).prompt).toStartWith("Work on Task S2");
    tr.add(a.color, waiting("S3")); // just /cleared: a session with no reply yet
    const cleared = join(dir, "cleared.jsonl");
    writeFileSync(cleared, `{"type":"user"}\n`);
    writeFileSync(join(createFolder(state, a, tr.get("S3")), ".session"), JSON.stringify({ id: "sess-3", transcript: cleared }));
    await run([a]);
    expect(nth(hd.spawned, 2).resume).toBeUndefined();
  });
  it("starts nothing new while a run still waits on the human; the slot frees when it is done", async () => {
    const waiting = (id: string) => task(id, { status: "paused", review: "needs", comments: [me("[dispatch] started pane=x"), me("[dispatch] review")] });
    tr.add(a.color, waiting("W1")).add(a.color, task("N"));
    hd.live.set("x", { status: "idle", seq: 1 });
    await run([a]);
    expect(hd.spawned).toHaveLength(0);
    tr.get("W1").status = "done";
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task N"]);
  });
  it("runs a build in every project at once: only the usage gate is shared", async () => {
    tr.add(a.color, task("A1")).add(b.color, task("B1")).add(a.color, task("A2"));
    await run([a, b]);
    await run([a, b]); // one new build per tick, so the second project starts a tick later
    expect(hd.spawned.map(s => s.label).sort()).toEqual(["⚒ Task A1", "⚒ Task B1"]);
    await run([a, b]); // A2 waits for A's own slot, not for B's
    expect(hd.spawned).toHaveLength(2);
  });
  it("ships approved work even while the usage gate is shut", async () => {
    gateOpen = false;
    tr.add(a.color, task("A1", { status: "paused", review: "approved", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    tr.add(b.color, task("B1"));
    hd.live.set("p1", { status: "idle", seq: 5 });
    await run([a, b]);
    expect(nth(hd.prompts, 0)[1]).toContain("APPROVED");
    expect(hd.spawned).toHaveLength(0);
  });
  it("tells a refine run that Approved is not a sign-off", async () => {
    tr.add(a.color, unsigned("R", { review: "approved", comments: [me("[dispatch] refining pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 5 });
    await run([a]);
    expect(nth(hd.prompts, 0)[1]).toContain("sign the task off");
    expect(nth(hd.prompts, 0)[1]).not.toContain("APPROVED");
  });
  // A refine run still unsigned asks "Is this still worth it?" in its 3rd handover. Falsifiers: not before the 3rd, not after a park, not a build.
  const rev = me("[dispatch] review\n\nspec"), refining = me("[dispatch] refining pane=p1");
  const worth = ([
    ["the 2nd handover", [refining, rev, you("tighten E2")], false],
    ["the 3rd", [refining, rev, you("no"), me("[dispatch] relayed kind=input"), rev, you("still no")], true],
    ["every one after the 3rd", [refining, rev, rev, rev, you("hmm")], true],
    ["a handover after a park starts the count over", [refining, rev, rev, me("[dispatch] parked"), refining, rev, you("ok")], false],
  ] as const).map(([name, comments, asked]) => ({ name, comments: [...comments], asked }));
  for (const { name, comments, asked } of worth)
    it(`${asked ? "asks" : "does not ask"} a refine run for "Is this still worth it?" at ${name}`, async () => {
      tr.add(a.color, unsigned("R", { status: "paused", review: "needs", comments }));
      hd.live.set("p1", { status: "idle", seq: 5 });
      await run([a]);
      expect(nth(hd.prompts, 0)[1].includes("Is this still worth it?")).toBe(asked);
    });
  it("does not ask a build run that (only a refine can be not worth starting)", async () => {
    tr.add(a.color, task("B", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p1"), rev, rev, rev, you("again")] }));
    hd.live.set("p1", { status: "idle", seq: 5 });
    await run([a]);
    expect(nth(hd.prompts, 0)[1]).not.toContain("Is this still worth it?");
  });
  it("follows a pane moved to another herdr space instead of restarting its agent", async () => {
    tr.add(a.color, task("A1", { status: "running", comments: [me("[dispatch] dispatching"), me("[dispatch] started pane=p1")] }));
    hd.live.set("p9", { status: "working", seq: 3, cwd: join(folder(state, a, "A1"), "repo") });
    await run([a]);
    expect(hd.spawned).toHaveLength(0);
    expect(derive(tr.get("A1")).pane).toBe("p9");
  });
  it("doesn't count deaths across a reboot, but stalls after the third real one", async () => {
    tr.add(a.color, task("A1"));
    await run([a]); // dispatched to p1, seen working
    await run([a]);
    hd.live.clear();
    await run([a], { bootTime: () => clock - 6e4 }); // rebooted a minute ago
    expect(nth(tr.get("A1").comments, -1).text).toContain("counted=0");
    for (let i = 0; i < 3; i++) { await run([a]); hd.live.clear(); await run([a]); }
    expect(tr.kinds("A1").filter(k => k === "restarted").length).toBe(3);
    expect(nth(tr.get("A1").comments, -1).text).toMatch(/^\[dispatch\] stalled: crashed 3×/);
    expect(tr.get("A1").review).toBe("needs");
  });
  it("hands a run left idle for 15 minutes to the human as waiting (not stalled), with the pane's last lines, counting no sleep", async () => {
    tr.add(a.color, task("A1"));
    await run([a]);
    hd.live.set("p1", { status: "idle", seq: 2 });
    await run([a]);
    clock += 8 * 3600e3; // the Mac slept overnight
    await run([a]);
    expect(tr.get("A1").review).toBe("none");
    await run([a]);
    expect(tr.get("A1").review).toBe("needs");
    expect(nth(tr.get("A1").comments, -1).text).toContain("Should I use option A or B?");
    expect(nth(tr.get("A1").comments, -1).text).toMatch(/^\[dispatch\] idle: waiting on you/);
    expect(derive(tr.get("A1")).state).toBe("waiting");
  });
  it("doesn't take a quiet pane for a quiet agent while a background task runs", async () => {
    tr.add(a.color, task("A1"));
    await run([a]);
    writeFileSync(join(folder(state, a, "A1"), ".background"), JSON.stringify({ running: ["shell: bun test"] }));
    hd.live.set("p1", { status: "idle", seq: 2 });
    for (let i = 0; i < 6; i++) await run([a]);
    expect(tr.get("A1").review).toBe("none");
    writeFileSync(join(folder(state, a, "A1"), ".background"), JSON.stringify({ running: [] })); // it finished
    for (let i = 0; i < 5; i++) await run([a]);
    expect(tr.get("A1").review).toBe("needs");
  });
  it("still calls a pane herdr can't read stalled", async () => {
    tr.add(a.color, task("A1"));
    await run([a]);
    hd.live.set("p1", { status: "unknown", seq: 2 });
    for (let i = 0; i < 5; i++) await run([a]);
    expect(nth(tr.get("A1").comments, -1).text).toMatch(/^\[dispatch\] stalled: unknown/);
  });
  it("puts corrections sent from a spec page in front of the waiting agent at once, as the human's words", async () => {
    const dir = createFolder(state, a, task("A1"));
    tr.add(a.color, task("A1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    const human = { comment: async (id: string, t: string) => { tr.get(id).comments.push(you(t)); } } as Tracker;
    await pageEvent(deps([a]), human, state, dir, "Corrections sent: E3 is wrong");
    expect(hd.prompts).toHaveLength(1);
    expect(nth(hd.prompts, 0)[1]).toContain("E3 is wrong");
    expect(tr.get("A1").review).toBe("none");
    expect(derive(tr.get("A1")).state).toBe("working");
  });
  it("tells a refine run its sign-off from the page without writing a comment", async () => {
    const dir = createFolder(state, a, task("A1"));
    tr.add(a.color, unsigned("A1", { review: "needs", comments: [me("[dispatch] refining pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    const out = await pageEvent(deps([a]), tr, state, dir, "signed off, stop", true);
    expect(out.pane).toBe("p1");
    expect(nth(hd.prompts, 0)[1]).toContain("signed off");
    expect(tr.get("A1").comments).toHaveLength(2);
  });
  it("tells the build pane to productionalize when the demo page approves, and leaves it open", async () => {
    const dir = createFolder(state, a, task("A1"));
    tr.add(a.color, task("A1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    await agentCommand(tr, [a], state, dir, "approve", "Demo of abc: Accepted.", new Set());
    const out = await approvedFromPage(deps([a]), state, dir);
    expect(out).toEqual({ pane: "p1", msg: "Approved. Told the agent to ship it." });
    expect(nth(hd.prompts, 0)).toEqual(["p1", `[kelpie] ${PAGE_APPROVED}`]);
    expect(PAGE_APPROVED).toContain("Productionalize");
    expect(PAGE_APPROVED).toContain("demo page");
    expect(hd.closed).toEqual([]);
    expect(nth(tr.get("A1").comments, -1).text).toStartWith("[dispatch] approved"); // the approval, not the pane message
    expect(derive(tr.get("A1")).state).toBe("working"); // the tick doesn't relay it a second time
  });
  it("keeps a demo approval when the build pane was closed: the task is approved all the same", async () => {
    const dir = createFolder(state, a, task("A1"));
    tr.add(a.color, task("A1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    await agentCommand(tr, [a], state, dir, "approve", "Accepted.", new Set());
    const out = await approvedFromPage(deps([a]), state, dir);
    expect(out.pane).toBeUndefined();
    expect(out.msg).toContain("pane was closed");
    expect(hd.prompts).toHaveLength(0);
    expect(tr.get("A1")).toMatchObject({ review: "none", status: "running" });
    expect(tr.get("A1").comments.some(c => c.text.startsWith("[dispatch] approved"))).toBe(true);
  });
  it("takes a task handed over without noQueue off the queue", async () => {
    tr.add(a.color, task("A1", { noQueue: false, ready: false, waitingOn: "lane" }));
    await run([a]);
    expect(tr.get("A1").noQueue).toBe(true);
    expect(hd.spawned).toHaveLength(0); // ready catches up on the next read
  });
  it("builds and refines side by side, one of each kind at a time", async () => {
    tr.add(a.color, unsigned("U", { rank: 1 })).add(a.color, unsigned("V", { rank: 2 })).add(a.color, task("S", { rank: 5 })).add(a.color, task("T", { rank: 6 }));
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task S", "✎ Task U"]);
    expect(nth(hd.spawned, 1).prompt).toBe("Refine Task U.");
    expect(tr.kinds("U")).toEqual(["refining", "started"]);
    expect(tr.get("U").status).toBe("todo"); // refining never starts the task
    await run([a]);
    expect(hd.spawned).toHaveLength(2); // a build and a refine are both running: T and V wait
  });
  it("refines on Opus, and builds on the model the signed-off description asks for", async () => {
    tr.add(a.color, unsigned("U", { rank: 1 })).add(a.color, task("S", { rank: 2, desc: "Done when: x.\n\n**Build with:** sonnet (mechanical test fix)" }));
    await run([a]);
    expect(hd.spawned.map(s => s.model)).toEqual(["claude-sonnet-5-5/high", "claude-opus-5-5/medium"]);
    tr.get("S").status = "done";
    tr.add(a.color, task("T", { desc: "no recommendation" }));
    await run([a]);
    expect(nth(hd.spawned, -1).model).toBe("claude-opus-5-5/medium");
  });
  it("starts nothing new while paused, but still relays to a run waiting on the human", async () => {
    tr.add(a.color, task("S")).add(a.color, unsigned("U"));
    tr.add(a.color, task("W", { status: "paused", review: "changes", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 2 });
    await run([a], { paused: () => true });
    expect(hd.spawned).toHaveLength(0);
    expect(hd.prompts.map(([pane]) => pane)).toEqual(["p1"]);
    expect(logs).toContain("not starting U: paused"); // S never gets that far: relaying to W fills the build slot
  });
  it("doesn't let refines waiting on the human hold up a build", async () => {
    const asked = (id: string) => unsigned(id, { review: "needs", comments: [me("[dispatch] refining pane=px"), me("[dispatch] review")] });
    tr.add(a.color, asked("R1")).add(a.color, asked("R2")).add(a.color, task("S"));
    hd.live.set("px", { status: "idle", seq: 1 });
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task S"]);
  });
  it("keeps a run waiting when its Review chip is cleared by hand, and puts the chip back", async () => {
    tr.add(a.color, task("A", { status: "paused", review: "none", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    expect(derive(tr.get("A")).state).toBe("waiting");
    await run([a]); await run([a]); await run([a]); await run([a]);
    expect(tr.kinds("A")).not.toContain("stalled:");
    expect(tr.get("A").review).toBe("needs");
  });
  it("closes a refine run once the human signs off, then starts the real work", async () => {
    tr.add(a.color, unsigned("U"));
    await run([a]);
    await tr.comment("U", "[dispatch] review"); await tr.setReview("U", "needs");
    writeFileSync(join(folder(state, a, "U"), "spec.json"), '{"signedOffAt":"now","demo":{"personas":[]}}'); // the spec page's Sign off
    Object.assign(tr.get("U"), { refined: true, ready: true, waitingOn: null }); // the human signs off
    await run([a]);
    expect(hd.closed).toEqual(["p1"]);
    expect(readdirSync(folder(state, a, "U"))).toEqual(["spec.json"]); // the draft goes, the signed spec stays for the build
    expect(tr.get("U").review).toBe("none");
    await run([a]);
    expect(hd.spawned.map(s => s.prompt)).toEqual(["Refine Task U.", `Work on Task U in ${folder(state, a, "U")}.`]);
    expect(tr.get("U").status).toBe("running");
  });
  it("puts the human's sign-off words, page comments included, into the build prompt", () => {
    const t = task("S", { comments: [me("[dispatch] review"), me("[dispatch] signoff\n\nSigned off, on the human's word:\n\n> What they said, by card:\n> no retries")] });
    expect(prompt("{{signoff}}", a, t, "/d", "/cli")).toBe("Signed off, on the human's word:\n\n> What they said, by card:\n> no retries");
    expect(prompt("{{signoff}}", a, task("T"), "/d", "/cli")).toBe("(none recorded)");
  });
  it("keeps a parked task's unshipped work through its refine sign-off, for the build", async () => {
    const r = repo();
    const pr = proj("ts", { repos: [{ path: r, base: "trunk" }] });
    tr.add(pr.color, task("P", { status: "paused", refined: false, ready: false, comments: [me("[dispatch] dispatching"), me("[dispatch] parked")] }));
    writeFileSync(join(createFolder(state, pr, task("P")), basename(r), "wip.txt"), "half done"); // the parked build's work
    await run([pr]);
    expect(hd.spawned.map(s => s.prompt)[0]).toContain("Refine");
    await tr.comment("P", "[dispatch] review"); await tr.setReview("P", "needs");
    await tr.signOff("P");
    await run([pr]);
    expect(existsSync(join(folder(state, pr, "P"), basename(r), "wip.txt"))).toBe(true);
  });
  it("sends a signed-off task whose spec has no demo back to refine instead of building it; a spec with one builds", async () => {
    tr.add(a.color, task("OLD"));
    tr.add(b.color, task("NEW"));
    const specAt = (p: typeof a, id: string, spec: object) => { const dir = folder(state, p, id); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "spec.json"), JSON.stringify(spec)); };
    specAt(a, "OLD", { version: 2, hero: { scope: "x" }, signedOffAt: "2026-11-01" });
    specAt(b, "NEW", { version: 1, demo: { scope: "x", page: "http://x", personas: [] }, signedOffAt: "2026-11-08" });
    await run([a, b]);
    expect(tr.get("OLD")).toMatchObject({ refined: false, ready: false });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task NEW", "✎ Task OLD"]); // OLD is refined again, not built; NEW builds
    expect(tr.kinds("OLD")[0]).toBe("parked");
    expect(tr.get("OLD").comments[0]?.text).toContain("signed spec has no `demo`");
    expect(tr.kinds("NEW")).not.toContain("parked");
  });
  it("builds a signed-off task that has no spec.json at all, as before", async () => {
    tr.add(a.color, task("A1"));
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task A1"]);
  });
  it("cleans up a finished run and closes its pane", async () => {
    tr.add(a.color, task("A1"));
    await run([a]);
    await tr.finish("A1");
    await run([a]);
    expect(hd.closed).toEqual(["p1"]);
    expect(existsSync(folder(state, a, "A1"))).toBe(false);
  });
});

describe("tidying: recurring calendar copies and stale tasks", () => {
  const a = proj("a");
  const ago = (days: number) => new Date(Date.parse("2026-10-09T12:00:00Z") - days * 864e5).toISOString();
  const inHours = (h: number) => new Date(Date.parse("2026-10-09T12:00:00Z") + h * 36e5).toISOString();
  const queued = async () => (await status(deps([a]))).projects.flatMap(p => p.rows.filter(r => r.section === "buildQueue" || r.section === "refineQueue").map(r => r.id)).sort();
  it("runs only the next copy of a recurring calendar task, and deletes none", async () => {
    tr.add(a.color, task("gcal-ev1_20261008T150000Z", { due: inHours(-21) })).add(a.color, task("gcal-ev1_20261009T150000Z", { due: inHours(4) }))
      .add(a.color, task("gcal-ev1_20261016T150000Z", { due: inHours(172) }));
    expect(await queued()).toEqual(["gcal-ev1_20261009T150000Z"]);
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task gcal-ev1_20261009T150000Z"]);
    expect(tr.tasks.size).toBe(3);
    await expect(start(deps([a]), "gcal-ev1_20261016T150000Z", false)).rejects.toThrow(/a later copy of this recurring task runs instead/);
  });
  it("falls back to the latest copy when every one is past, and the next copy being busy keeps the older ones out", async () => {
    tr.add(a.color, task("gcal-ev2_1", { due: inHours(-30) })).add(a.color, task("gcal-ev2_2", { due: inHours(-6) }))
      .add(a.color, task("gcal-ev3_1", { due: inHours(-30) })).add(a.color, task("gcal-ev3_2", { due: inHours(2), status: "running", comments: [me("[dispatch] pane=p0")] }));
    hd.live.set("p0", { status: "working", seq: 1 });
    expect(await queued()).toEqual(["gcal-ev2_2"]); // ev3's next copy is the one running: its past copy is not revived
  });
  it("collapses only gcal ids: other underscored ids, a gcal id with no instant, and other events stay queued", async () => {
    for (const id of ["notes_1", "notes_2", "gcal-solo", "gcal-ev4_1", "gcal-ev5_1"]) tr.add(a.color, task(id, { due: inHours(5) }));
    expect(await queued()).toEqual(["gcal-ev4_1", "gcal-ev5_1", "gcal-solo", "notes_1", "notes_2"]);
  });
  it("stops dispatching a task untouched for over 14 days and lists it with the three answers; 13 days is still live", async () => {
    tr.add(a.color, task("OLD", { touched: ago(15) })).add(a.color, task("FRESH", { touched: ago(13) })).add(a.color, unsigned("OLDU", { touched: ago(20) }))
      .add(a.color, task("TALKED", { touched: ago(30), comments: [{ text: "hm", at: ago(2), mine: false }] }))
      .add(a.color, task("gcal-far_1", { touched: ago(30), due: inHours(1) })); // calendar tasks keep their fast lane
    const st = await status(deps([a]));
    expect(st.stale.map(s => s.id)).toEqual(["OLDU", "OLD"]); // least recently touched first
    expect(st.stale[1]).toEqual({ id: "OLD", label: "Task OLD", project: "a", touched: ago(15), keep: "kelpie keep OLD", drop: "kelpie drop OLD", later: "kelpie later OLD" });
    expect(await queued()).toEqual(["FRESH", "TALKED", "gcal-far_1"]);
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task gcal-far_1"]); // by due, then rank; stale ones never start
    await expect(start(deps([a]), "OLD", false)).rejects.toThrow(/untouched for 14 days: answer `kelpie keep OLD` first/);
  });
  it("keep brings it back, later holds it for 14 days, drop closes it without deleting", async () => {
    tr.add(a.color, task("K", { touched: ago(15), rank: 1 })).add(a.color, task("L", { touched: ago(15), rank: 2 })).add(a.color, task("D", { touched: ago(15), rank: 3 }))
      .add(a.color, task("N", { touched: ago(1) }));
    const d = deps([a]);
    await answerStale(d, "later", "L");
    expect(tr.notBefore.L).toBe(inHours(14 * 24));
    await answerStale(d, "drop", "D");
    expect(tr.get("D")).toMatchObject({ status: "done" });
    expect(tr.kinds("D")).toEqual(["closed"]);
    await answerStale(d, "keep", "K");
    expect((await status(d)).stale).toEqual([]);
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task K"]);
    await expect(answerStale(d, "drop", "N")).rejects.toThrow(/N isn't on the Still-want-this list/); // never closes a task that isn't stale
    await expect(answerStale(d, "keep", "nope")).rejects.toThrow(/no task "nope"/);
    expect(tr.tasks.size).toBe(4);
  });
  it("later: it is back on the list once its 14 days pass untouched", async () => {
    tr.add(a.color, task("L", { touched: ago(15) }));
    await answerStale(deps([a]), "later", "L");
    clock += 15 * 864e5;
    tr.get("L").ready = true; // the plan's not-before has passed
    expect((await status(deps([a]))).stale.map(s => s.id)).toEqual(["L"]);
  });
  it("counts setting For: Agent as keep: a task made long ago and handed over now is not stale", async () => {
    tr.add(a.color, task("H", { noQueue: false, ready: false, waitingOn: "lane", touched: ago(40) }));
    await run([a]);
    expect(tr.kinds("H")).toEqual(["keep"]);
    tr.get("H").ready = true;
    expect((await status(deps([a]))).stale).toEqual([]);
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task H"]);
  });
});

describe("the board's Needs you list", () => {
  const a = proj("a"), b = proj("b");
  const at = (h: number) => new Date(Date.parse("2026-10-09T12:00:00Z") - h * 36e5).toISOString();
  const said = (text: string, h: number): Comment => ({ text, at: at(h), mine: true });
  const list = async (pages: Record<string, string> = {}) => needsYou(await status(deps([a, b])), pages, clock);
  const ids = async () => (await list()).map(c => c.id);
  it("is empty when nothing waits and nothing is stale", async () => {
    tr.add(a.color, task("Q", { touched: at(1) }));
    expect(await list()).toEqual([]);
  });
  it("lists each kind of wait with what it needs, its handover collapsed, and the right buttons", async () => {
    const wait = (id: string, color: string, first: string, handoff: string, o: Partial<TaskView> = {}) =>
      tr.add(color, task(id, { status: "paused", review: "needs", comments: [said(first, 9), said(handoff, o.refined === false ? 5 : 3)], ...o }));
    wait("SPEC", a.color, "[dispatch] refining pane=p1", "[dispatch] review\n\nPlanners stop re-keying shifts by hand.\n\nRound 1.", { ready: false, refined: false, waitingOn: "unrefined" });
    wait("QS", b.color, "[dispatch] refining pane=p2", "[dispatch] questions\n\nnot refined enough:\n\nWho owns the cron?\nAnd when?", { ready: false, refined: false, waitingOn: "unrefined" });
    wait("BUILD", a.color, "[dispatch] started pane=p3", "[dispatch] review\n\nBuilt. Demo is up.");
    wait("IDLE", b.color, "[dispatch] started pane=p4", "[dispatch] idle: blocked on a prompt, waiting on you\n\nAllow rm?");
    const cards = await list({ SPEC: "http://spec/" });
    expect(cards.map(c => c.id)).toEqual(["SPEC", "QS", "BUILD", "IDLE"]); // ties keep project order
    const by = Object.fromEntries(cards.map(c => [c.id, c]));
    expect(by.SPEC).toMatchObject({ kind: "spec", headline: "Planners stop re-keying shifts by hand.", ask: "Review the spec", details: "Planners stop re-keying shifts by hand.\n\nRound 1.", page: "http://spec/", risk: { level: "yellow", why: "no risk block" } });
    expect([by.QS, by.IDLE].map(c => c?.risk)).toEqual([null, null]); // only a spec or build review is labelled
    expect(by.SPEC?.acts.map(x => "words" in x && x.words)).toEqual(["signoff-now", "signoff", "signoff-hold", "reply", "park", "close"]);
    expect(by.QS).toMatchObject({ kind: "questions", headline: "Task QS", ask: "Answer: Who owns the cron?", project: "b", details: "Who owns the cron?\nAnd when?" });
    expect(by.BUILD).toMatchObject({ kind: "approve", headline: "Built. Demo is up.", ask: "Approve or request changes", page: null });
    expect(by.BUILD?.acts.map(x => "words" in x && x.words)).toEqual(["approve", "reply", "park", "close"]);
    expect(by.IDLE).toMatchObject({ kind: "idle", ask: "Idle: blocked on a prompt, waiting on you", details: "idle: blocked on a prompt, waiting on you\n\nAllow rm?" });
  });
  it("headlines a review with the first line of its handover, and with the task's label when the handover is empty (falsifier: a stalled run keeps the label)", async () => {
    const wait = (id: string, handoff: string) => tr.add(a.color, task(id, { status: "paused", review: "needs", comments: [said("[dispatch] started pane=p1", 4), said(handoff, 3)] }));
    wait("HAS", "[dispatch] review\n\n## **Facilitators** can rerun a vote without losing round one.\n\nDetails.");
    wait("NONE", "[dispatch] review\n\n##");
    wait("STALL", "[dispatch] stalled: crashed 3×");
    const by = Object.fromEntries((await list()).map(c => [c.id, c.headline]));
    expect(by).toEqual({ HAS: "Facilitators can rerun a vote without losing round one.", NONE: "Task NONE", STALL: "Task STALL" });
  });
  it("puts runs waiting on you first, oldest first, then stale items oldest first", async () => {
    const hand = (h: number) => [said("[dispatch] started pane=p1", h + 1), said("[dispatch] review\n\nok", h)];
    tr.add(a.color, task("NEW", { status: "paused", review: "needs", comments: hand(1) })).add(b.color, task("OLD", { status: "paused", review: "needs", comments: hand(8) }))
      .add(a.color, task("S1", { touched: at(24 * 15) })).add(b.color, task("S2", { touched: at(24 * 30) }));
    expect(await ids()).toEqual(["OLD", "NEW", "S2", "S1"]);
  });
  it("gives a stale item Keep, Drop and Later, which answerStale accepts and which clear it from the list", async () => {
    tr.add(a.color, task("S", { touched: at(24 * 20) }));
    const [card, ...rest] = await list();
    expect(rest).toEqual([]);
    expect(card).toMatchObject({ kind: "stale", ask: "Still want this? Untouched for 20 days.", details: null });
    expect(card?.acts).toEqual([{ label: "Keep", verb: "keep" }, { label: "Drop", verb: "drop" }, { label: "Later", verb: "later" }]);
    await answerStale(deps([a, b]), "keep", "S");
    expect(await ids()).toEqual([]);
  });
  it("does not list a run whose reply is on its way, an approved or a finished one, or a plain working run (falsifier: only a handoff nobody has answered counts)", async () => {
    const hand = [said("[dispatch] started pane=p1", 3), said("[dispatch] review\n\nok", 2)];
    tr.add(a.color, task("REPLIED", { status: "paused", review: "needs", comments: [...hand, { text: "use B", at: at(1), mine: false }] }))
      .add(a.color, task("APPROVED", { review: "approved", comments: hand })).add(a.color, task("DONE", { status: "done", comments: hand }))
      .add(a.color, task("BUSY", { status: "running", comments: [said("[dispatch] started pane=p2", 1)] }))
      .add(a.color, task("WAITS", { status: "paused", review: "needs", comments: hand }));
    expect(await ids()).toEqual(["WAITS"]);
  });
});

describe("Merge Danger: the risk label on a Needs you card", () => {
  const block = (door: string, blast: string, undo = "revert the commit") => `Door: ${door}\nBlast radius: ${blast}\nUndo: ${undo}`;
  const table: [string, string | null, boolean, string, string][] = [
    ["two-way, small", block("two-way", "small — the board only"), false, "green", "two-way, small"],
    ["two-way, wide", block("two-way", "wide — every planner"), false, "yellow", "two-way, wide"],
    ["one-way, small", block("one-way", "small — one email"), false, "red", "one-way"],
    ["one-way beats a small blast radius, bold and bulleted", "- **Door:** One-way\n- **Blast radius:** small\n- **Undo:** none", false, "red", "one-way"],
    ["outward-facing project, though the agent wrote two-way and small", block("two-way", "small — the board only"), true, "red", "ships when approved"],
    ["no block at all", "Built. Demo is up.", false, "yellow", "no risk block"],
    ["no handover text", null, false, "yellow", "no risk block"],
    ["no undo line", "Door: two-way\nBlast radius: small", false, "yellow", "no risk block"],
    ["blast radius with no small|wide", block("two-way", "the board"), false, "yellow", "no risk block"],
    ["the template copied back unfilled", block("one-way | two-way", "small | wide — x"), false, "yellow", "no risk block"],
  ];
  it.each(table)("%s", (_name, text, ships, level, why) => {
    expect(riskOf(text, ships)).toMatchObject({ level, why });
  });
  it("keeps what the agent said about the blast radius and the undo", () => {
    expect(riskOf(`Impact.\n\n**Door:** two-way\n**Blast radius:** small — only this repo's board\n**Undo:** \`git revert\` the commit`, false))
      .toEqual({ level: "green", why: "two-way, small", blast: "only this repo's board", undo: "git revert the commit" });
  });

  const a = proj("a"), pub = proj("pub", { repos: [{ path: "/r", base: "trunk", live: "main", publish: "./ship.sh" }] });
  const at = (h: number) => new Date(Date.parse("2026-10-09T12:00:00Z") - h * 36e5).toISOString();
  const said = (text: string, h: number): Comment => ({ text, at: at(h), mine: true });
  const wait = (color: string, id: string, handover: string, spec = false) =>
    tr.add(color, task(id, { status: "paused", review: "needs", comments: [said(`[dispatch] ${spec ? "refining" : "started"} pane=p1`, 4), said(`[dispatch] review\n\n${handover}`, 3)], ...(spec && { ready: false, refined: false, waitingOn: "unrefined" }) }));
  const quick = async (id: string, ps = [a, pub]) =>
    (await needsYou(await status(deps(ps)), {}, clock)).find(c => c.id === id)?.acts.flatMap(x => "quick" in x && x.quick ? [x.label] : []);
  it("a green build is one click on Approve, with words that say it was; yellow and red need yours", async () => {
    wait(a.color, "G", `Impact.\n\n${block("two-way", "small — the board")}`).add(a.color, task("Y", { status: "paused", review: "needs", comments: [said("[dispatch] review\n\nNo block.", 2)] }))
      .add(a.color, task("R", { status: "paused", review: "needs", comments: [said(`[dispatch] review\n\n${block("one-way", "small — one email")}`, 1)] }));
    const cards = await needsYou(await status(deps([a])), {}, clock);
    const approve = (id: string) => cards.find(c => c.id === id)?.acts.find(x => "words" in x && x.words === "approve");
    expect(approve("G")).toMatchObject({ quick: "approved from the board (🟢 two-way, small)" });
    expect(approve("Y")).not.toHaveProperty("quick");
    expect(approve("R")).not.toHaveProperty("quick");
  });
  it("a project that publishes on approve is red even when the agent wrote two-way, small", async () => {
    wait(pub.color, "P", `Impact.\n\n${block("two-way", "small — the board")}`);
    expect(await quick("P")).toEqual([]);
    expect((await needsYou(await status(deps([pub])), {}, clock))[0]?.risk).toMatchObject({ level: "red", why: "ships when approved" });
  });
  it("a green spec makes only the default sign-off one click (not Build now, not Hold), and publishing doesn't redden a spec", async () => {
    wait(pub.color, "S", `Impact.\n\n${block("two-way", "small — the board")}`, true);
    expect(await quick("S")).toEqual(["Sign off · when a slot frees"]);
  });
  it("labels no stale card, question or stuck run", async () => {
    tr.add(a.color, task("OLD", { touched: at(24 * 20) }));
    wait(a.color, "Q", "x").get("Q").comments.push(said("[dispatch] questions\n\n" + block("two-way", "small"), 2));
    expect((await needsYou(await status(deps([a])), {}, clock)).map(c => c.risk)).toEqual([null, null]);
  });
});

describe("sign-off picks when the build starts (now / when a slot frees / hold)", () => {
  const a = proj("a");
  // A refine run for U, then the human's sign-off with the given flags (as `kelpie signoff` from the run's folder).
  const signed = async (...flags: string[]) => {
    tr.add(a.color, unsigned("U"));
    await run([a]);
    await agentCommand(tr, [a], state, folder(state, a, "U"), "signoff", "yes, do it", new Set(flags));
  };
  const builds = () => hd.spawned.filter(s => s.label.startsWith("⚒")).length;
  it("default is unchanged: the build starts on the tick after the one that closes the refine run, behind the gate", async () => {
    await signed();
    expect(tr.get("U").comments.at(-1)?.text).toStartWith("[dispatch] signoff\n");
    gateOpen = false;
    await run([a]); await run([a]);
    expect(builds()).toBe(0); // gate shut: waits for a slot like any candidate
    gateOpen = true;
    await run([a]);
    expect(builds()).toBe(1);
  });
  it("--now starts the build in the same tick that closes the refine run, past a shut gate and active 0", async () => {
    await signed("--now");
    expect(derive(tr.get("U")).when).toBe("now");
    gateOpen = false;
    await run([a], { active: () => 0 });
    expect(builds()).toBe(1);
    expect(tr.get("U").status).toBe("running");
  });
  it("--hold is never started by the tick, shows in status as held, and is released by an explicit build", async () => {
    await signed("--hold");
    for (let i = 0; i < 4; i++) await run([a]);
    expect(builds()).toBe(0);
    expect(derive(tr.get("U"))).toMatchObject({ state: "candidate", when: "hold" });
    const st = await status(deps([a]));
    expect(st.projects[0]?.rows.find(r => r.id === "U")).toMatchObject({ section: "buildQueue", note: "held — start when you say", whyNotBuild: null });
    await expect(buildNext(deps([a]))).rejects.toThrow(/no signed-off task/); // build-next picks for itself, so it leaves held ones
    await start(deps([a]), "U", false); // naming it releases it
    expect(builds()).toBe(1);
    expect(derive(tr.get("U")).when).toBe("slot");
  });
  it("refuses --now with --hold", async () => {
    tr.add(a.color, unsigned("R", { comments: [me("[dispatch] refining")] }));
    await expect(agentCommand(tr, [a], state, createFolder(state, a, tr.get("R")), "signoff", "x", new Set(["--now", "--hold"]))).rejects.toThrow(/not both/);
  });
  it("a parked, held task signed off again the usual way is no longer held", async () => {
    await signed("--hold");
    await tr.comment("U", "[dispatch] parked"); await tr.unrefine("U"); await tr.signOff("U");
    expect(derive(tr.get("U")).when).toBe("slot");
  });
});

describe("dredge", () => {
  const DAY = 864e5;
  it("starts one when a project has nothing left to build or refine", async () => {
    const a = proj("a");
    tr.add(a.color, task("A1", { status: "done" }));
    await run([a]);
    expect(hd.spawned).toEqual([{ label: "💡 dredge a", cwd: dredgeFolder(state, a), prompt: `Dredge a in ${dredgeFolder(state, a)}.`, space: "Space a", model: "claude-opus-5-5/medium", resume: undefined }]);
  });
  it("waits while there is work, the gate is shut, or one is already running", async () => {
    const a = proj("a");
    tr.add(a.color, unsigned("U", { blockedBy: [], status: "todo" }));
    gateOpen = false;
    await run([a]);
    tr.get("U").status = "done";
    await run([a]);
    expect(hd.spawned).toHaveLength(0);
    gateOpen = true;
    await run([a]);
    clock += 2 * DAY;
    await run([a]);
    expect(hd.spawned.map(s => s.label)).toEqual(["💡 dredge a"]);
  });
  it("counts as an active project, so it waits for room like a build", async () => {
    const top = proj("top", { priority: 1 }), b = proj("b", { priority: 2 });
    tr.add(top.color, task("T")).add(b.color, task("B1", { status: "done" }));
    await run([top, b], { active: () => 1 });
    await run([top, b], { active: () => 1 });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task T"]);
    hd.live.clear();
    hd.live.set("pd", { status: "working", seq: 1, cwd: dredgeFolder(state, b) }); // b's dredge holds the room
    tr.get("T").status = "done";
    tr.add(top.color, task("T2"));
    await run([top, b], { active: () => 1 });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task T"]);
  });
  it("starts nothing at active 0, not even in an already-active project", async () => {
    const top = proj("top", { priority: 1 });
    tr.add(top.color, task("T"));
    await run([top], { active: () => 0 });
    expect(hd.spawned).toHaveLength(0);
    await run([top], { active: () => 1 });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task T"]); // top is now active
    tr.add(top.color, unsigned("U")); // a free refine slot in the active project
    await run([top], { active: () => 0 });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task T"]);
  });
  it("runs at most once a day, and only after a commit lands on a repo's base", async () => {
    const r = repo(), a = proj("a", { repos: [{ path: r, base: "trunk" }] });
    const commit = (f: string) => {
      writeFileSync(join(r, f), f);
      git(r, "add", ".");
      Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", f], { cwd: r, env: { ...process.env, GIT_COMMITTER_DATE: new Date(clock).toISOString() } });
    };
    clock = Date.now() + 6e4; // after the repo's first commit, which git stamps with the real time
    await run([a]);
    hd.live.clear(); // the human closed it
    commit("b");
    await run([a]);
    expect(hd.spawned).toHaveLength(1); // something new, but within the day
    clock += DAY;
    await run([a]);
    expect(hd.spawned).toHaveLength(2);
    hd.live.clear();
    clock += DAY;
    await run([a]);
    expect(hd.spawned).toHaveLength(2); // a day on, but nothing new since
    commit("c");
    await run([a]);
    expect(hd.spawned).toHaveLength(3);
  });
});

describe("refine-next", () => {
  const a = proj("a");
  it("refines the best-ranked unrefined hand-off on demand, past the limits", async () => {
    tr.add(a.color, task("W", { status: "running", comments: [me("[dispatch] refining pane=p0")] }));
    hd.live.set("p0", { status: "working", seq: 1 });
    tr.add(a.color, unsigned("U2", { rank: 2 })).add(a.color, unsigned("U1", { rank: 1 })).add(a.color, task("S"));
    expect(await refineNext(deps([a]))).toBe("U1");
    expect(hd.spawned.map(s => s.prompt)).toEqual(["Refine Task U1."]);
    tr.tasks.delete("U2"); tr.tasks.delete("U1");
    await expect(refineNext(deps([a]))).rejects.toThrow(/nothing handed over/);
  });
  it("refines only in the project named", async () => {
    const b = proj("b");
    tr.add(a.color, unsigned("A1", { rank: 1 })).add(b.color, unsigned("B2", { rank: 2 }));
    await expect(refineNext(deps([a, b]), "c")).rejects.toThrow(/refined in c/);
    expect(await refineNext(deps([a, b]), "b")).toBe("B2");
  });
});

describe("timeline-studio tracker", () => {
  it("maps the ready list: your rank (else the suggestion), and a parked task ready once signed off", async () => {
    const doc = { shapes: [{ id: "agent", label: "Agent" }, { id: "mtg", label: "Meeting" }, { id: "me", label: "Joseph" }], borders: [], tasks: [
      { id: "M", label: "m", shape: "mtg" }, { id: "D", label: "d", shape: "me", done: true }, { id: "J", label: "j", shape: "me", color: ["x"] },
      { id: "R", label: "r", shape: "agent", color: ["c"] }, { id: "S", label: "s", shape: "agent", color: ["c"] },
      { id: "P", label: "p", shape: "agent", color: ["c"], refinedAt: "2026-10-10T00:00:00Z" }] };
    const ready = [{ id: "R", status: "todo", ready: true, rank: 3, suggestedRank: 9 }, { id: "S", status: "todo", ready: true, rank: null, suggestedRank: 7 },
      { id: "P", status: "paused", ready: null, blockedBy: [], rank: null }];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => Response.json(url.endsWith("/api/plan") ? { doc } : ready)) as typeof fetch;
    try {
      const cfg = join(tmp(), "c.json");
      writeFileSync(cfg, JSON.stringify({ base: "http://ts.test", token: "x" }));
      const ts = Object.fromEntries((await timelineStudio(cfg).listTasks("c")).map(t => [t.id, t]));
      expect([ts.R?.rank, ts.S?.rank, ts.P?.rank]).toEqual([3, 7, null]);
      expect(ts.P?.ready).toBe(true);
      const sent: object[] = [];
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        if (url.endsWith("/api/commands")) { sent.push(JSON.parse(String(init?.body)).cmd); return Response.json({}); }
        return Response.json(url.endsWith("/api/plan") ? { doc } : ready);
      }) as typeof fetch;
      const w = timelineStudio(cfg);
      await w.forAgent("J");
      await w.addColor("J", "c");
      await w.addColor("R", "c"); // already in it: nothing sent
      await expect(w.forAgent("nope")).rejects.toThrow(/no task "nope"/);
      expect(sent.map(({ at: _, ...c }: any) => c)).toEqual([{ type: "setTaskChannel", id: "J", channel: "shape", value: "agent" }, { type: "setTaskColors", id: "J", colors: ["x", "c"] }]);
      expect((await timelineStudio(cfg).openTasks()).map(t => [t.id, t.status, t.agent])).toEqual([["J", "todo", false], ["R", "todo", true], ["S", "todo", true], ["P", "paused", true]]);
    } finally { globalThis.fetch = real; }
  });
  it("reads when a task was last touched, and sets not-before", async () => {
    const doc = { shapes: [{ id: "agent", label: "Agent" }], borders: [], tasks: [
      { id: "T", label: "t", shape: "agent", color: ["c"], createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", refinedAt: "2026-09-10T00:00:00Z" },
      { id: "U", label: "u", shape: "agent", color: ["c"] }] };
    const sent: any[] = [], real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/commands")) { sent.push(JSON.parse(String(init?.body)).cmd); return Response.json({}); }
      return Response.json(url.endsWith("/api/plan") ? { doc } : []);
    }) as typeof fetch;
    try {
      const cfg = join(tmp(), "c.json");
      writeFileSync(cfg, JSON.stringify({ base: "http://ts.test", token: "x" }));
      const ts = timelineStudio(cfg);
      expect((await ts.listTasks("c")).map(t => t.touched)).toEqual(["2026-09-20T00:00:00Z", null]);
      await ts.setNotBefore("T", "2026-11-01T00:00:00.000Z");
      expect(sent.map(({ at: _, ...c }) => c)).toEqual([{ type: "setNotBefore", id: "T", notBefore: "2026-11-01T00:00:00.000Z" }]);
    } finally { globalThis.fetch = real; }
  });
  it("sees a write made through another tracker (e.g. one writing a comment, another reading it back)", async () => {
    const doc = { shapes: [{ id: "s1", label: "Joseph" }, { id: "agent", label: "Agent" }], borders: [], tasks: [
      { id: "T", label: "t", shape: "agent", color: ["c"], comments: [{ text: "[dispatch] review", by: BY }] }] };
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/commands")) {
        const { cmd } = JSON.parse(String(init?.body));
        nth(doc.tasks, 0).comments.push({ text: cmd.comment.text, by: (init?.headers as Record<string, string>)["x-timeline-by"] ?? "" });
        return Response.json({ ok: true });
      }
      return Response.json(url.endsWith("/api/plan") ? { doc } : []);
    }) as typeof fetch;
    try {
      const cfg = join(tmp(), "c.json");
      writeFileSync(cfg, JSON.stringify({ base: "http://ts.test", token: "x" }));
      const dispatcher = timelineStudio(cfg), you = timelineStudio(cfg, "you");
      expect(nth(await dispatcher.listTasks("c"), 0).comments).toHaveLength(1);
      await you.comment("T", "smaller, please");
      const after = nth(await dispatcher.listTasks("c"), 0).comments;
      expect(after.at(-1)).toMatchObject({ text: "smaller, please", mine: false });
    } finally { globalThis.fetch = real; }
  });
});

describe("build-next", () => {
  const a = proj("a"), b = proj("b");
  it("starts the best-ranked signed-off build past the gate, but never in a busy build slot", async () => {
    tr.add(a.color, task("W", { status: "running", comments: [me("[dispatch] pane=p0")] })).add(a.color, task("A1", { rank: 1 }));
    hd.live.set("p0", { status: "working", seq: 1 });
    tr.add(b.color, task("B2", { rank: 2 }));
    const shut = deps([a, b], { gate: () => ({ open: false, why: "test" }) });
    expect(await buildNext(shut)).toBe("B2");
    await expect(buildNext(shut, "a")).rejects.toThrow(/free build slot in a/);
  });
});

describe("start one task by name (the board's \"do this one\")", () => {
  const a = proj("a"), b = proj("b");
  it("builds or refines the task named, past the gate, but never past a blocker", async () => {
    tr.add(a.color, task("A1", { rank: 1 })).add(a.color, task("A2", { rank: 2 })).add(a.color, unsigned("U"))
      .add(a.color, task("X", { ready: false, blockedBy: ["A1"], waitingOn: "blocked" }));
    const shut = deps([a], { gate: () => ({ open: false, why: "test" }) });
    await expect(start(shut, "X", false)).rejects.toThrow(/can't build X: waits on A1/);
    await expect(start(shut, "U", false)).rejects.toThrow(/not signed off yet/);
    await expect(start(shut, "A2", true)).rejects.toThrow(/already signed off/);
    await expect(start(shut, "nope", false)).rejects.toThrow(/no task "nope"/);
    expect(await start(shut, "A2", false)).toBe("A2"); // not the best-ranked: the one named
    tr.get("A2").status = "running"; tr.get("A2").comments.push(me("[dispatch] pane=p1"));
    await expect(start(shut, "A1", false)).rejects.toThrow(/a's build slot is busy/);
    expect(await start(shut, "U", true)).toBe("U");
  });
  it("status gives the board each task's section and why its buttons are greyed", async () => {
    tr.add(a.color, task("W", { status: "running", comments: [me("[dispatch] pane=p0")] })).add(a.color, task("A1", { rank: 1 }))
      .add(b.color, unsigned("U", { rank: 1 }));
    hd.live.set("p0", { status: "working", seq: 1 });
    const st = await status(deps([a, b]));
    const rows = Object.fromEntries(st.projects.flatMap(p => p.rows.map(r => [r.id, r])));
    expect([rows.W.section, rows.A1.section, rows.U.section]).toEqual(["building", "buildQueue", "refineQueue"]);
    expect([rows.A1.whyNotBuild, rows.U.whyNotRefine, rows.U.whyNotBuild]).toEqual(["a's build slot is busy", null, "not signed off yet"]);
  });
  it("lists open tasks Kelpie never runs: orphaned Agent tasks, project tasks not For Agent, and the rest, paused last", async () => {
    tr.add(a.color, task("A1")).add("nowhere", task("O1", { status: "paused" })).add("nowhere", task("O2"));
    tr.others = [{ id: "J1", label: "j1", status: "todo", agent: false, colors: [b.color] }, { id: "X1", label: "x1", status: "running", agent: false, colors: ["nowhere"] }];
    const st = await status(deps([a, b]));
    const ids = (l: { id: string }[]) => l.map(t => t.id);
    expect([ids(st.outside.orphan), ids(st.outside.notAgent), ids(st.outside.other)]).toEqual([["O2", "O1"], ["J1"], ["X1"]]);
    expect(st.outside.notAgent[0]?.project).toBe("b");
  });
  it("a paused project starts nothing new, and the others carry on", async () => {
    tr.add(a.color, task("A1")).add(b.color, task("B1"));
    await run([a, b], { paused: p => p === "a" });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task B1"]);
    expect(logs).toContain("not starting A1: a paused");
  });
});

describe("project files (the board's editor)", () => {
  const good = (o = "") => `---\npriority: 1\ncolor: c1\n${o}---\nBody.\n`;
  it("saves only a file the tick can load, naming what is wrong", () => {
    const d = tmp();
    expect(() => projectFiles.save(d, "p1", "---\nrepos: {}\n---\n", true)).toThrow(/p1\.md: repos must be a list/);
    expect(() => projectFiles.save(d, "P 1", good(), true)).toThrow(/isn't a project id/);
    expect(() => projectFiles.save(d, "p1", good(), true, ["other"])).toThrow(/no Project colour "c1"/);
    projectFiles.save(d, "p1", good(), true, ["c1"]);
    expect(loadProjects(d).map(p => p.id)).toEqual(["p1"]);
    expect(() => projectFiles.save(d, "p1", good(), true)).toThrow(/already exists/);
    expect(() => projectFiles.save(d, "nope", good(), false)).toThrow(/no project "nope"/);
  });
  it("retires and restores by renaming, so nothing is lost", () => {
    const d = tmp();
    projectFiles.save(d, "p1", good(), true);
    projectFiles.retire(d, "p1");
    expect(loadProjects(d)).toEqual([]);
    expect(projectFiles.list(d)).toEqual([{ id: "p1", retired: true, text: good() }]);
    expect(() => projectFiles.save(d, "p1", good(), true)).toThrow(/retired: restore it/);
    projectFiles.retire(d, "p1", true);
    expect(loadProjects(d).map(p => p.id)).toEqual(["p1"]);
  });
  it("moves a project by swapping priorities with its neighbour", () => {
    const d = tmp();
    projectFiles.save(d, "a", good().replace("priority: 1", "priority: 1"), true);
    projectFiles.save(d, "b", good().replace("priority: 1", "priority: 2"), true);
    projectFiles.save(d, "c", "---\ncolor: c1\n---\n", true); // no priority: last
    projectFiles.move(d, "b", "up");
    expect(loadProjects(d).map(p => p.id)).toEqual(["b", "a", "c"]);
    projectFiles.move(d, "c", "up");
    expect(loadProjects(d).map(p => p.id)).toEqual(["b", "c", "a"]);
    expect(() => projectFiles.move(d, "b", "up")).toThrow(/already first/);
  });
});

describe("project priority", () => {
  it("reads priority, lowest first, unset last by file name", () => {
    const d = tmp();
    mkdirSync(join(d, "projects"));
    for (const [f, fm] of [["a", ""], ["b", "priority: 2\n"], ["c", ""], ["z", "priority: 1\n"]]) writeFileSync(join(d, `projects/${f}.md`), `---\n${fm}repos: []\n---\n`);
    expect(loadProjects(d).map(p => p.id)).toEqual(["z", "b", "a", "c"]);
    writeFileSync(join(d, "projects/bad.md"), "---\npriority: high\n---\n");
    expect(() => loadProjects(d)).toThrow(/bad\.md: priority must be a number/);
  });
  it("lets only the top-priority project start past a shut gate", async () => {
    const top = proj("top", { priority: 1 }), next = proj("next", { priority: 2 });
    tr.add(top.color, task("T")).add(next.color, task("N"));
    gateOpen = false;
    await run([top, next]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task T"]);
    await run([top, next]);
    expect(hd.spawned).toHaveLength(1);
    expect(logs.at(-1)).toMatch(/not starting N: gate shut/);
  });
  it("runs only as many projects as `more` allows, highest priority first", async () => {
    const top = proj("top", { priority: 1 }), next = proj("next", { priority: 2 });
    tr.add(top.color, task("T")).add(next.color, task("N"));
    let n = 1;
    await run([top, next], { active: () => n });
    await run([top, next], { active: () => n });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task T"]);
    n = 2;
    await run([top, next], { active: () => n });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task T", "⚒ Task N"]);
  });
  it("still starts work in a project that is already active when there is no room for another", async () => {
    const top = proj("top", { priority: 1 }), next = proj("next", { priority: 2 });
    tr.add(top.color, task("T")).add(top.color, unsigned("TU")); // both held back: no room for top
    tr.add(next.color, task("W", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] })).add(next.color, unsigned("U"));
    hd.live.set("p1", { status: "idle", seq: 1 });
    await run([top, next], { active: () => 1 });
    expect(hd.spawned.map(s => s.label)).toEqual(["✎ Task U"]);
  });
});

// ts-daily-budget, 2026-10-10: the human said "delete it" to a refine run that had no way to drop the
// task, and the task went out for a build as if signed off. A refine run now ends with `close`.
describe("a refine run the human drops", () => {
  const p = proj("a");
  const WORDS = "i no longer care for this task - delete it";
  const waiting = () => { // a refine run waiting on the human, its pane idle
    tr.add(p.color, unsigned("R", { review: "needs", comments: [me("[dispatch] refining pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    return createFolder(state, p, tr.get("R"));
  };
  it("closes with the human's words: done, never signed off, and the next tick builds nothing", async () => {
    const dir = waiting();
    await agentCommand(tr, [p], state, dir, "close", WORDS, new Set());
    expect(tr.get("R")).toMatchObject({ status: "done", refined: false, review: "none" });
    const last = nth(tr.get("R").comments, -1).text;
    expect(last).toStartWith("[dispatch] closed");
    expect(last).toContain(`> ${WORDS}`);
    expect(derive(tr.get("R")).state).toBe("finished");
    await run([p]);
    expect(hd.spawned.filter(s => s.label.includes("Task R"))).toEqual([]); // an idle project may still dredge
    expect(tr.kinds("R")).toEqual(["refining", "review", "closed"]); // no `refined`, no `dispatching`
    expect(existsSync(dir)).toBe(false);
  });
  it("keeps the rule in the real briefing", () => {
    const text = prompt(readFileSync(join(import.meta.dir, "refine.md"), "utf8"), p, task("R"), "/f", "/cli");
    expect(text).toContain('/cli close "<their words>"');
    expect(text).toContain("delete it");
  });
  it("makes the refine run name its personas first, and hand back with questions when none changes", () => {
    const text = prompt(readFileSync(join(import.meta.dir, "refine.md"), "utf8"), p, task("R"), "/f", "/cli");
    expect(text).toContain("**Name the personas.**");
    expect(text).toContain("make no spec page and no demo");
    expect(text).toContain('/cli review --questions "<…>"');
    expect(text).toContain("merge it into a named task, close it, or \"tell me who this is for\"");
    expect(text).toContain("closing or parking it is never yours to do");
    expect(text).toContain("the `demo-viz` skill and make the promised demo");
    expect(text).toContain("`demo.page` set to the promised demo's URL");
    expect(text).not.toContain("hero");
  });
  it("contrast: a refine task marked refined any other way (the old console's Sign off) is taken as signed off and built", async () => {
    waiting();
    await tr.signOff("R"); // refinedAt set, and no `signoff` command ran
    await run([p]);
    expect(tr.kinds("R")).toEqual(["refining", "review", "refined"]);
    expect(derive(tr.get("R")).state).toBe("candidate");
    await run([p]);
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task R"]);
  });
});

describe("publish on approve and the live notice", () => {
  const commit = (d: string, name: string) => { writeFileSync(join(d, name), name); git(d, "add", "."); git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", name); return git(d, "rev-parse", "--short", "HEAD").trim(); };
  // squash-to-main.sh's shape: `main` is one parentless commit holding trunk's tree.
  const snapshot = (d: string) => {
    const sha = git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit-tree", "trunk^{tree}", "-m", "drop").trim();
    git(d, "update-ref", "refs/heads/main", sha);
  };
  const live = (o: Partial<Project["repos"][number]> = {}) => {
    const d = repo(); commit(d, "b.txt"); snapshot(d);
    return { d, p: proj("ts", { space: "Timeline Studio", repos: [{ path: d, base: "trunk", live: "main", publish: "./squash-to-main.sh", ...o }] }) };
  };
  const CAL = "📅🔄 Sat 10:00 AM";

  it("reads live and publish per repo, and rejects anything but text", () => {
    const d = tmp();
    mkdirSync(join(d, "projects"));
    const file = (repo: string) => writeFileSync(join(d, "projects/ts.md"), `---\nrepos:\n  - path: /r\n    base: trunk\n${repo}---\n`);
    file("    live: origin/main\n    publish: ./squash-to-main.sh\n");
    expect(nth(loadProjects(d), 0).repos).toEqual([{ path: "/r", base: "trunk", live: "origin/main", publish: "./squash-to-main.sh" }]);
    file("");
    expect(nth(loadProjects(d), 0).repos).toEqual([{ path: "/r", base: "trunk" }]); // no keys added when unset
    file("    live: 3\n");
    expect(() => loadProjects(d)).toThrow(/repos\[0\]\.live must be text/);
    file("    live: origin/main\n    publish: [a]\n");
    expect(() => loadProjects(d)).toThrow(/repos\[0\]\.publish must be text/);
    file("    publish: ./squash-to-main.sh\n");
    expect(() => loadProjects(d)).toThrow(/publish but no live/);
  });

  it("counts trunk commits past the live snapshot: 0, then 3, then none matching", () => {
    const { d, p } = live(), r = nth(p.repos, 0) as any;
    expect(unpublished(r)).toEqual([]);
    const shas = ["c", "d", "e"].map(n => commit(d, `${n}.txt`));
    expect(unpublished(r)).toEqual(shas.reverse());
    writeFileSync(join(d, "x.txt"), "never on trunk"); git(d, "add", ".");
    const odd = git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit-tree", git(d, "write-tree").trim(), "-m", "x").trim();
    git(d, "update-ref", "refs/heads/main", odd);
    expect(unpublished(r)).toBeNull();
  });

  it("keeps one notice line of its own: added, rewritten, removed, nobody else's touched, no write when unchanged", async () => {
    const { d, p } = live();
    tr.noticeText = CAL;
    await run([p]);
    expect(tr.noticeWrites).toBe(0); // live already: nothing to say
    ["c", "d", "e"].forEach(n => commit(d, `${n}.txt`));
    await run([p]);
    expect(tr.noticeText).toBe(`${CAL}\n🚢 Timeline Studio: 3 commits on trunk aren't live yet`);
    await run([p]);
    expect(tr.noticeWrites).toBe(1);
    tr.noticeText = `${CAL} (synced again)\n🚢 Timeline Studio: 3 commits on trunk aren't live yet`; // the calendar sync rewrote its line
    commit(d, "f.txt");
    await run([p]);
    expect(tr.noticeText).toBe(`${CAL} (synced again)\n🚢 Timeline Studio: 4 commits on trunk aren't live yet`);
    snapshot(d); // published
    await run([p]);
    expect(tr.noticeText).toBe(`${CAL} (synced again)`);
    expect(tr.noticeWrites).toBe(3);
  });

  it("joins several projects into its one line, says when no commit matches, and clears an empty notice", async () => {
    const a = live(), b = live();
    const pb = { ...b.p, id: "b", color: "C-b", space: "AI Setup" };
    commit(a.d, "c.txt"); commit(b.d, "c.txt"); commit(b.d, "d.txt");
    await run([a.p, pb]);
    expect(tr.noticeText).toBe("🚢 Timeline Studio: 1 commit on trunk isn't live yet, AI Setup: 2 commits on trunk aren't live yet");
    git(a.d, "update-ref", "refs/heads/main", git(a.d, "-c", "user.email=t@t", "-c", "user.name=t", "commit-tree", git(a.d, "mktree").trim(), "-m", "empty").trim()); // a tree trunk never had
    snapshot(b.d);
    await run([a.p, pb]);
    expect(tr.noticeText).toBe("🚢 Timeline Studio: trunk differs from the live site");
    snapshot(a.d);
    await run([a.p, pb]);
    expect(tr.noticeText).toBeNull();
    expect(withShipLine(null, null)).toBeNull();
  });

  it("leaves a project without live alone: no notice, no git", async () => {
    tr.noticeText = CAL;
    await run([proj("x", { repos: [{ path: "/does/not/exist", base: "trunk" }] })]);
    expect(tr.noticeWrites).toBe(0);
    expect(logs.filter(l => l.includes("live check"))).toEqual([]);
  });

  it("puts the publish and the CI wait in the approved step only for a repo with publish", () => {
    const tpl = readFileSync(join(import.meta.dir, "prompt.md"), "utf8");
    const { p } = live();
    const withPub = prompt(tpl, { ...p, productionalize: "merge it" }, task("T"), "/f", "/cli");
    expect(withPub).toContain("merge it\n\nThen publish, still before `finish`");
    expect(withPub).toContain("run `./squash-to-main.sh`");
    expect(withPub).toContain('gh run list --commit "$sha"');
    expect(withPub).toContain("gh run watch <run id> --exit-status");
    expect(withPub).toContain("/cli unpublished");
    const plain = prompt(tpl, { ...p, repos: p.repos.map(({ path, base }) => ({ path, base })), productionalize: "merge it" }, task("T"), "/f", "/cli");
    expect(plain).toContain("merge it\n\n3. Run `/cli finish`");
    expect(plain).toContain("say so in your handover.\n\n# Step 3");
    expect(plain).not.toMatch(/squash|gh run|unpublished|Approving here also publishes/);
  });

  it("finish refuses while trunk isn't live, and passes once it is; unpublished lists the others' commits", async () => {
    const { d, p } = live();
    tr.add(p.color, task("A", { status: "running", comments: [me("[dispatch] dispatching")] }));
    const dir = createFolder(state, p, task("A"));
    const others = commit(d, "other.txt");
    const wt = join(dir, basename(d));
    commit(wt, "mine.txt");
    const c = (cmd: string, ...f: string[]) => agentCommand(tr, [p], state, dir, cmd, "", new Set(f));
    expect(await c("unpublished")).toBe(`${basename(d)}: also goes live: ${others}`);
    git(d, "merge", "-q", "--no-edit", "agent/A");
    expect(await c("unpublished")).toBe(`${basename(d)}: also goes live: ${others}`); // its own merged work isn't "else"
    await expect(c("finish")).rejects.toThrow(/trunk isn't live yet: main has a different tree/);
    expect(tr.get("A").status).toBe("running");
    snapshot(d);
    expect(await c("unpublished")).toBe(`${basename(d)}: nothing else goes live`);
    await c("finish");
    expect(tr.get("A").status).toBe("done");
  });
  it("--nothing-to-ship still overrides the live check", async () => {
    const { d, p } = live();
    tr.add(p.color, task("A", { status: "running", comments: [me("[dispatch] dispatching")] }));
    const dir = createFolder(state, p, task("A"));
    commit(d, "other.txt");
    await agentCommand(tr, [p], state, dir, "finish", "", new Set(["--nothing-to-ship"]));
    expect(tr.get("A").status).toBe("done");
  });
});

describe("the run's bar in this pane's app-panel", () => {
  const p = proj("ts");
  const cmd = (dir: string, c: string, arg = "", ...flags: string[]) => agentCommand(tr, [p], state, dir, c, arg, new Set(flags));
  // The app-panel host, faked: its session file for pane p1 points at a server that records each update.
  let posts: Record<string, unknown>[] = [];
  const host = Bun.serve({ port: 0, fetch: async req => (posts.push(await req.json()), new Response("ok")) });
  const sessionFile = (running: object[]) =>
    writeFileSync(join(process.env.APP_PANEL_SESSIONS!, "p1.json"), JSON.stringify({ url: `${host.url}progress?key=k`, running }));
  const pane = process.env.HERDR_PANE_ID;
  beforeEach(() => { posts = []; process.env.HERDR_PANE_ID = "p1"; sessionFile([]); });
  afterAll(() => { host.stop(); process.env.HERDR_PANE_ID = pane; });

  it("eta posts a bar titled with the task id and comments the estimate", async () => {
    tr.add(p.color, task("A", { status: "running" }));
    const dir = createFolder(state, p, task("A"));
    expect(await cmd(dir, "eta", "20m")).toBe("Estimate posted: 20m.");
    await cmd(dir, "eta", "5m viz tests");
    expect(posts).toEqual([{ title: "A", stage: "Working", eta: 1200 }, { title: "A", stage: "viz tests", eta: 300 }]);
    expect(tr.get("A").comments.map(c => c.text).slice(-2)).toEqual(["[dispatch] eta 20m", "[dispatch] eta 5m (viz tests)"]);
    await expect(cmd(dir, "eta", "soon")).rejects.toThrow(/can't read "soon"/);
  });
  it("review sets the bar to Waiting on you; finish, close, park and signoff mark it done", async () => {
    tr.add(p.color, task("W", { status: "running", comments: [me("[dispatch] dispatching")] }));
    tr.add(p.color, task("X", { status: "running", comments: [me("[dispatch] dispatching")] }));
    tr.add(p.color, task("K", { status: "running", comments: [me("[dispatch] dispatching")] }));
    tr.add(p.color, unsigned("R", { review: "needs", comments: [me("[dispatch] refining")] }));
    sessionFile(["W", "X", "K", "R"].map(title => ({ title, stage: "Working", started: 1 })));
    const [w, x, k, r] = ["W", "X", "K", "R"].map(id => createFolder(state, p, task(id)));
    await cmd(w, "review", "Done. Approve?");
    await cmd(w, "finish", "", "--nothing-to-ship");
    await cmd(x, "close", "drop it");
    await cmd(k, "park", "park it");
    await cmd(r, "signoff", "sign it off");
    expect(posts).toEqual([{ title: "W", stage: "Waiting on you" }, ...["W", "X", "K", "R"].map(title => ({ title, status: "done" }))]);
  });
  it("leaves the panel alone for a run with no bar up, and works with no panel or outside herdr", async () => {
    tr.add(p.color, task("A", { status: "running" }));
    const dir = createFolder(state, p, task("A"));
    await cmd(dir, "review", "Done. Approve?");
    expect(posts).toEqual([]); // no stray bar for a run that never posted one
    rmSync(join(process.env.APP_PANEL_SESSIONS!, "p1.json"));
    expect(await cmd(dir, "eta", "20m")).toContain("No app-panel in this pane, so no bar");
    delete process.env.HERDR_PANE_ID;
    expect(await cmd(dir, "eta", "20m")).toContain("no bar");
    await cmd(dir, "finish", "", "--nothing-to-ship");
    expect(tr.get("A").status).toBe("done");
    expect(posts).toEqual([]);
  });
  it("status's Note: the longest running bar against its estimate, then the run's own ETA", () => {
    const now = Date.parse("2026-10-09T12:00:00Z"), min = 60000;
    const tests = { title: "viz tests", started: now - 51 * min, due: now - 48 * min };
    expect(note("A", { running: [{ title: "A", started: now - 30 * min, due: now + 5.5 * min }, tests, { title: "lint", started: now - min }, { title: "Back in… · build it", started: now - 60 * min }] }, now))
      .toBe("working · viz tests 51m (usually 3m) · ⏳~6m");
    expect(note("A", { running: [{ title: "A", due: now - 28 * min - 30000 }] }, now)).toBe("working · ⏳+28m");
    expect(note("A", { running: [{ title: "build", started: now - 90 * min }] }, now)).toBe("working · build 1h30m");
    expect(note("A", undefined, now)).toBe("working");
  });
});

describe("the build's handover", () => {
  const tpl = readFileSync(join(import.meta.dir, "prompt.md"), "utf8");
  const handover = tpl.slice(tpl.indexOf("**A finished build is demoed"), tpl.indexOf("They are the reviewer"));
  it("is always a live demo, per persona, whatever the kind of change", () => {
    expect(handover).toContain("run the `demo-viz` skill in live mode, for every kind of change");
    expect(handover).toContain("Your handover is the demo's URL under your short summary.");
    expect(handover).toContain("walk.json's `yes`");
    for (const kind of ["**A web app**", "**A CLI**", "**A skill, prompt or agent instructions**", "**A refactor or developer-only change**"]) expect(handover).toContain(kind);
  });
  it("has no fallback: a demo that can't be set up, or shows no difference, is reported with a recommendation, not approved", () => {
    expect(handover).toContain("There is no fallback.");
    expect(handover).toContain('"Approve?" comes only with a working demo.');
    expect(handover).not.toContain("walkthrough");
    expect(handover).not.toContain("local draft, steps 1 to 6");
  });
  it("makes the code film only on request, or in a PR productionalize opens", () => {
    expect(handover).toContain("A PR draft or code film waits for a request");
    expect(handover).toContain('when they ask for "the diff tour"');
    expect(handover).toContain("only if the project's productionalize step says to open one: then run `r2-pr` in full, and the PR carries the code film.");
  });
  it("says what Accept and Changes from the page mean", () => {
    expect(handover).toContain("arrives here as a `[kelpie] Demo of …` line");
    expect(handover).toContain("**Changes:** fix what they said, stage the demo again, and hand over its fresh URL");
    expect(handover).toContain("**Accept:** the page has already approved the task");
    expect(handover).toContain("don't change the build for them beyond what productionalize needs");
  });
});

describe("timeline-studio notice", () => {
  it("reads doc.notice and patches it, null clearing it", async () => {
    const sent: any[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/commands")) { sent.push(JSON.parse(String(init?.body)).cmd); return Response.json({ ok: true }); }
      return Response.json(url.endsWith("/api/plan") ? { doc: { notice: "📅🔄 Sat" } } : []);
    }) as typeof fetch;
    try {
      const cfg = join(tmp(), "c.json");
      writeFileSync(cfg, JSON.stringify({ base: "http://ts.test", token: "x" }));
      const ts = timelineStudio(cfg);
      expect(await ts.notice()).toBe("📅🔄 Sat");
      await ts.setNotice(null);
      expect(sent).toMatchObject([{ type: "patchDoc", patch: { notice: null } }]);
    } finally { globalThis.fetch = real; }
  });
});
