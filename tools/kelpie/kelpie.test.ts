// Behaviour tests: the tick and the agent commands run against an in-memory tracker and a fake
// herdr; task folders are real worktrees of a throwaway git repo.
import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNext, refineNext } from "./actions.ts";
import { BY, timelineStudio } from "./timeline-studio.ts";
import {
  agentCommand, cleanup, createFolder, derive, dredgeFolder, folder, gate, loadConfig, loadProjects, pageEvent, tick,
  type AgentStatus, type Comment, type RunModel, type Config, type Deps, type Herdr, type Project, type Review, type TaskView, type Tracker,
} from "./dispatcher.ts";

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
  get = (id: string) => this.tasks.get(id)!;
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
  kinds = (id: string) => this.get(id).comments.filter(c => c.mine).map(c => c.text.split("\n")[0]!.split(" ")[1]);
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

let tr: FakeTracker, hd: FakeHerdr, state: string, clock: number, gateOpen: boolean, logs: string[];
beforeEach(() => { tr = new FakeTracker(); hd = new FakeHerdr(); state = tmp(); clock = Date.parse("2026-10-09T12:00:00Z"); gateOpen = true; logs = []; });
const deps = (projects: Project[], o: Partial<Deps> = {}): Deps => ({
  tracker: tr, herdr: hd, config: CFG, projects, stateDir: state, templates: { work: "Work on {{label}} in {{folder}}.", refine: "Refine {{label}}.", dredge: "Dredge {{project}} in {{folder}}." }, cli: "/cli",
  gate: () => ({ open: gateOpen, why: "test" }), now: () => clock, log: s => logs.push(s), bootTime: () => 0, paused: () => false, ...o,
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
    const wt = join(dir, r.split("/").pop()!);
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
    const wt = join(createFolder(state, p, task("T-3")), r.split("/").pop()!);
    expect(existsSync(join(wt, ".setup-ran"))).toBe(true);
  });
  it("keeps a folder whose worktree has uncommitted changes", () => {
    const r = repo();
    const p = proj("ts", { repos: [{ path: r, base: "trunk" }] });
    const dir = createFolder(state, p, task("T-2"));
    writeFileSync(join(dir, r.split("/").pop()!, "wip.txt"), "x");
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
    expect(tr.get("A").comments.at(-1)!.text).toBe("[dispatch] review\n\nDid the thing. Approve?");
    expect(await cmd(dir, "history")).toContain("Did the thing. Approve?");
  });
  it("review --questions bounces the task as not refined enough", async () => {
    tr.add(p.color, task("A", { status: "running" }));
    await cmd(at("A"), "review", "What counts as done?", "--questions");
    expect(tr.get("A").comments.at(-1)!.text).toContain("not refined enough:\n\nWhat counts as done?");
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
    const wt = join(dir, r.split("/").pop()!);
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
    expect(tr.get("R").comments.at(-1)!.text).toContain("> yes, sign it off");
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
    expect(hd.spawned[0]!.prompt).toBe(`Work on Task A2 in ${folder(state, a, "A2")}.`);
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
    expect(tr.get("A1").comments.at(-1)!.text).toMatch(/^\[dispatch\] restarted pane=p1 counted=0/);
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
    expect(hd.prompts[0]![0]).toBe("p9");
    expect(hd.prompts[0]![1]).toContain("> use B");
    expect(tr.get("A1")).toMatchObject({ review: "none", status: "running" });
  });
  it("revives a waiting run whose pane died, once, to wait at its prompt", async () => {
    tr.add(a.color, task("W1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=gone"), me("[dispatch] review")] }));
    await run([a]);
    expect(hd.spawned).toHaveLength(1);
    expect(hd.spawned[0]!.prompt).toContain("You are back, waiting on the human");
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
    expect(hd.spawned[0]!.prompt).toStartWith("## You are back"); // the briefing is already in the conversation
    tr.add(a.color, waiting("S2"));
    writeFileSync(join(createFolder(state, a, tr.get("S2")), ".session"), JSON.stringify({ id: "sess-2", transcript: join(dir, "gone.jsonl") }));
    await run([a]);
    expect(hd.spawned[1]!.resume).toBeUndefined();
    expect(hd.spawned[1]!.prompt).toStartWith("Work on Task S2");
    tr.add(a.color, waiting("S3")); // just /cleared: a session with no reply yet
    const cleared = join(dir, "cleared.jsonl");
    writeFileSync(cleared, `{"type":"user"}\n`);
    writeFileSync(join(createFolder(state, a, tr.get("S3")), ".session"), JSON.stringify({ id: "sess-3", transcript: cleared }));
    await run([a]);
    expect(hd.spawned[2]!.resume).toBeUndefined();
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
    expect(hd.prompts[0]![1]).toContain("APPROVED");
    expect(hd.spawned).toHaveLength(0);
  });
  it("tells a refine run that Approved is not a sign-off", async () => {
    tr.add(a.color, unsigned("R", { review: "approved", comments: [me("[dispatch] refining pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 5 });
    await run([a]);
    expect(hd.prompts[0]![1]).toContain("sign the task off");
    expect(hd.prompts[0]![1]).not.toContain("APPROVED");
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
    expect(tr.get("A1").comments.at(-1)!.text).toContain("counted=0");
    for (let i = 0; i < 3; i++) { await run([a]); hd.live.clear(); await run([a]); }
    expect(tr.kinds("A1").filter(k => k === "restarted").length).toBe(3);
    expect(tr.get("A1").comments.at(-1)!.text).toMatch(/^\[dispatch\] stalled: crashed 3×/);
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
    expect(tr.get("A1").comments.at(-1)!.text).toContain("Should I use option A or B?");
    expect(tr.get("A1").comments.at(-1)!.text).toMatch(/^\[dispatch\] idle: waiting on you/);
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
    expect(tr.get("A1").comments.at(-1)!.text).toMatch(/^\[dispatch\] stalled: unknown/);
  });
  it("puts corrections sent from a spec page in front of the waiting agent at once, as the human's words", async () => {
    const dir = createFolder(state, a, task("A1"));
    tr.add(a.color, task("A1", { status: "paused", review: "needs", comments: [me("[dispatch] started pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    const human = { comment: async (id: string, t: string) => { tr.get(id).comments.push(you(t)); } } as Tracker;
    await pageEvent(deps([a]), human, state, dir, "Corrections sent: E3 is wrong");
    expect(hd.prompts).toHaveLength(1);
    expect(hd.prompts[0]![1]).toContain("E3 is wrong");
    expect(tr.get("A1").review).toBe("none");
    expect(derive(tr.get("A1")).state).toBe("working");
  });
  it("tells a refine run its sign-off from the page without writing a comment", async () => {
    const dir = createFolder(state, a, task("A1"));
    tr.add(a.color, unsigned("A1", { review: "needs", comments: [me("[dispatch] refining pane=p1"), me("[dispatch] review")] }));
    hd.live.set("p1", { status: "idle", seq: 1 });
    const out = await pageEvent(deps([a]), tr, state, dir, "signed off, stop", true);
    expect(out.pane).toBe("p1");
    expect(hd.prompts[0]![1]).toContain("signed off");
    expect(tr.get("A1").comments).toHaveLength(2);
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
    expect(hd.spawned[1]!.prompt).toBe("Refine Task U.");
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
    expect(hd.spawned.at(-1)!.model).toBe("claude-opus-5-5/medium");
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
    Object.assign(tr.get("U"), { refined: true, ready: true, waitingOn: null }); // the human signs off
    await run([a]);
    expect(hd.closed).toEqual(["p1"]);
    expect(existsSync(folder(state, a, "U"))).toBe(false);
    expect(tr.get("U").review).toBe("none");
    await run([a]);
    expect(hd.spawned.map(s => s.prompt)).toEqual(["Refine Task U.", `Work on Task U in ${folder(state, a, "U")}.`]);
    expect(tr.get("U").status).toBe("running");
  });
  it("keeps a parked task's unshipped work through its refine sign-off, for the build", async () => {
    const r = repo();
    const pr = proj("ts", { repos: [{ path: r, base: "trunk" }] });
    tr.add(pr.color, task("P", { status: "paused", refined: false, ready: false, comments: [me("[dispatch] dispatching"), me("[dispatch] parked")] }));
    writeFileSync(join(createFolder(state, pr, task("P")), r.split("/").pop()!, "wip.txt"), "half done"); // the parked build's work
    await run([pr]);
    expect(hd.spawned.map(s => s.prompt)[0]).toContain("Refine");
    await tr.comment("P", "[dispatch] review"); await tr.setReview("P", "needs");
    await tr.signOff("P");
    await run([pr]);
    expect(existsSync(join(folder(state, pr, "P"), r.split("/").pop()!, "wip.txt"))).toBe(true);
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
      expect([ts.R!.rank, ts.S!.rank, ts.P!.rank]).toEqual([3, 7, null]);
      expect(ts.P!.ready).toBe(true);
    } finally { globalThis.fetch = real; }
  });
  it("sees a write made through another tracker (e.g. one writing a comment, another reading it back)", async () => {
    const doc = { shapes: [{ id: "s1", label: "Joseph" }, { id: "agent", label: "Agent" }], borders: [], tasks: [
      { id: "T", label: "t", shape: "agent", color: ["c"], comments: [{ text: "[dispatch] review", by: BY }] }] };
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/commands")) {
        const { cmd } = JSON.parse(String(init!.body));
        doc.tasks[0]!.comments.push({ text: cmd.comment.text, by: (init!.headers as Record<string, string>)["x-timeline-by"]! });
        return Response.json({ ok: true });
      }
      return Response.json(url.endsWith("/api/plan") ? { doc } : []);
    }) as typeof fetch;
    try {
      const cfg = join(tmp(), "c.json");
      writeFileSync(cfg, JSON.stringify({ base: "http://ts.test", token: "x" }));
      const dispatcher = timelineStudio(cfg), you = timelineStudio(cfg, "you");
      expect((await dispatcher.listTasks("c"))[0]!.comments).toHaveLength(1);
      await you.comment("T", "smaller, please");
      const after = (await dispatcher.listTasks("c"))[0]!.comments;
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
});
