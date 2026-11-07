// Behaviour tests: the tick and the agent commands run against an in-memory tracker and a fake
// herdr; task folders are real worktrees of a throwaway git repo.
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildNext, refineNext, start } from "./actions.ts";
import { status } from "./status.ts";
import { BY, timelineStudio } from "./timeline-studio.ts";
import {
  agentCommand, approvedFromPage, cleanup, createFolder, derive, dredgeFolder, folder, gate, loadConfig, loadProjects, pageEvent, PAGE_APPROVED, prompt, tick, unpublished, withShipLine,
  type AgentStatus, type Comment, type RunModel, type Config, type Deps, type Herdr, type Project, type Review, type TaskView, type Tracker,
} from "./dispatcher.ts";
import { note } from "./panel.ts";

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
  ({ id, label: `Task ${id}`, desc: "do it", ready: true, rank: null, status: "todo", review: "none", comments: [], refined: true, noQueue: true, due: null, waitingOn: null, blockedBy: [], ...o });
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
  async start(id: string) { if (this.get(id).status === "running") throw new Error("already running"); this.get(id).status = "running"; }
  async stop(id: string) { if (this.get(id).status !== "running") throw new Error("not running"); this.get(id).status = "paused"; }
  async finish(id: string) { this.get(id).status = "done"; }
  async comment(id: string, text: string) { this.get(id).comments.push(me(text)); }
  async setReview(id: string, v: Review) { this.get(id).review = v; }
  async signOff(id: string) { Object.assign(this.get(id), { refined: true, ready: true, waitingOn: null }); }
  async unrefine(id: string) { Object.assign(this.get(id), { refined: false, ready: false }); }
  async setDesc(id: string, text: string) { this.get(id).desc = text; this.get(id).refined = false; }
  noticeText: string | null = null; noticeWrites = 0;
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
  it("tells the build pane to productionalize when the walkthrough page approves, and leaves it open", async () => {
    const dir = createFolder(state, a, task("A1"));
    tr.add(a.color, task("A1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    await agentCommand(tr, [a], state, dir, "approve", "Walkthrough of abc: Accepted.", new Set());
    const out = await approvedFromPage(deps([a]), state, dir);
    expect(out).toEqual({ pane: "p1", msg: "Approved. Told the agent to ship it." });
    expect(nth(hd.prompts, 0)).toEqual(["p1", `[kelpie] ${PAGE_APPROVED}`]);
    expect(PAGE_APPROVED).toContain("Productionalize");
    expect(hd.closed).toEqual([]);
    expect(nth(tr.get("A1").comments, -1).text).toStartWith("[dispatch] approved"); // the approval, not the pane message
    expect(derive(tr.get("A1")).state).toBe("working"); // the tick doesn't relay it a second time
  });
  it("keeps a walkthrough approval when the build pane was closed: the task is approved all the same", async () => {
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
    writeFileSync(join(folder(state, a, "U"), "spec.json"), '{"signedOffAt":"now"}'); // the spec page's Sign off
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
  it("cleans up a finished run and closes its pane", async () => {
    tr.add(a.color, task("A1"));
    await run([a]);
    await tr.finish("A1");
    await run([a]);
    expect(hd.closed).toEqual(["p1"]);
    expect(existsSync(folder(state, a, "A1"))).toBe(false);
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
    const doc = { shapes: [{ id: "agent", label: "Agent" }], borders: [], tasks: [
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
  it("a paused project starts nothing new, and the others carry on", async () => {
    tr.add(a.color, task("A1")).add(b.color, task("B1"));
    await run([a, b], { paused: p => p === "a" });
    expect(hd.spawned.map(s => s.label)).toEqual(["⚒ Task B1"]);
    expect(logs).toContain("not starting A1: a paused");
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
  it("is a walkthrough for a build you can click through or run, with no PR draft or code film", () => {
    expect(handover).toContain("run the `walkthrough-viz` skill");
    expect(handover).toContain("Your handover is its URL under your short summary: no PR draft and no code film.");
    expect(handover).toContain("walk.json's `yes`");
  });
  it("is today's PR draft and code film only for a build with nothing to click through, or when a walkthrough can't be staged", () => {
    expect(handover).toMatch(/\*\*Nothing to click through\*\*[^\n]*run the `r2-pr` skill on your branch through its local draft, steps 1 to 6/);
    expect(handover).toContain("If the walkthrough can't be set up (the app won't start, say), say why in the handover and use the next item instead.");
  });
  it("makes the code film otherwise only on request, or in a PR productionalize opens", () => {
    expect(handover).toContain('Make no PR draft or code film beyond that, not even "to be safe".');
    expect(handover).toContain('when they ask for "the diff tour"');
    expect(handover).toContain("only if the project's productionalize step says to open one: then run `r2-pr` in full, and the PR carries the code film.");
  });
  it("says what Accept and Changes from the page mean", () => {
    expect(handover).toContain("**Changes:** fix what they said, stage the walkthrough again, and hand over its fresh URL");
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
