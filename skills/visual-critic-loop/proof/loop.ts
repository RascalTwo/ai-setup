#!/usr/bin/env node
// The loop proof's build step. Per task, an Opus builder writes one self-contained page (arm A, the builder alone).
// Arm B forks that same builder session and runs the visual critic loop on it (shoot.ts → round.ts → fix) until STOP,
// so the only difference between the two finals is the loop. Then both finals are shot the same way for the judges.
// Usage: node proof/loop.ts <loop-tasks.json> <out-dir> [parallel=3] [only-id ...]
// Resumable per arm: <out>/<id>/state.json records each finished arm; a half-done arm B restarts from A.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec } from "../critic.ts";
import { shoot } from "../shoot.ts";

const BUILDER = "claude-opus-5-5";
const skill = resolve(import.meta.dirname, "..");

type Task = { id: string; kind: string; screens: number; task: string; checks: string[] };
type Call = { session: string; cost: number; secs: number };

export function buildPrompt(t: Task) {
  return `Build this as one self-contained file, index.html, in the current folder: inline CSS and JS, no build step, no other files. ` +
    `The only external resource allowed is three.js from a CDN through an import map, and only if the task needs 3D. ` +
    `Use realistic invented content. It will be viewed at 1280 and 390 pixels wide. Write the file and stop.\n\nThe task (a ${t.kind}): ${t.task}`;
}

export function fixPrompt(report: string, shots: string[]) {
  return `A visual critic who sees only screenshots of your page reviewed it. The screenshots, numbered as the report numbers them:\n` +
    shots.map((s, i) => `${i + 1}. ${s}`).join("\n") +
    `\n\nIts report:\n${report}\n\nFix the blocker and major issues worst first, and minor ones only where cheap, by editing index.html in place. ` +
    `A box is x,y,width,height in that screenshot's pixels; open the PNG when the words don't locate the problem. Keep everything the task asked for.`;
}

// One builder turn: isolated from CLAUDE.md, skills and MCP like the critic, with only the file tools.
async function build(cwd: string, prompt: string, resume?: { id: string; fork: boolean }): Promise<Call> {
  const args = ["claude", "-p", "--output-format", "json", "--model", BUILDER, "--effort", "medium",
    "--tools", "Read,Write,Edit", "--permission-mode", "acceptEdits",
    "--setting-sources=", "--strict-mcp-config", "--disable-slash-commands"];
  if (resume) args.push("--resume", resume.id, ...(resume.fork ? ["--fork-session"] : []));
  const t0 = Date.now();
  const { out, err } = await exec(args, { cwd, input: prompt });
  let r: any;
  try { r = JSON.parse(out); } catch { throw new Error(`builder: unparseable output: ${out.slice(0, 300)} ${err.slice(0, 300)}`); }
  if (r.is_error) throw new Error(`builder: ${String(r.result).slice(0, 300)}`);
  if (!existsSync(join(cwd, "index.html"))) throw new Error("builder: wrote no index.html");
  return { session: r.session_id, cost: r.total_cost_usd ?? 0, secs: (Date.now() - t0) / 1000 };
}

// A hung headless Chrome would stall the whole proof; failing the task instead lets a rerun resume it.
const capped = <T>(p: Promise<T>, what: string, ms = 180_000) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`${what} timed out after ${ms / 1000} s`)), ms))]);

async function round(run: string, shots: string, first: { brief: string; checks: string } | null) {
  const args = [process.execPath, "round.ts", run, ...(first ? ["--brief", first.brief, "--checks", first.checks] : []), shots];
  const { out, err, code } = await exec(args, { cwd: skill });
  if (code !== 0) throw new Error(`round.ts exited ${code}: ${err.slice(0, 400)}`);
  return out.trim();
}

async function runTask(t: Task, out: string) {
  const dir = join(out, t.id), work = join(dir, "work"), file = join(dir, "state.json");
  mkdirSync(work, { recursive: true });
  const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const save = () => writeFileSync(file, JSON.stringify(state, null, 1));
  const url = "file://" + join(work, "index.html");

  if (!state.A) {
    state.A = await build(work, buildPrompt(t));
    copyFileSync(join(work, "index.html"), join(dir, "A.html"));
    save();
    console.log(`${t.id}: A built, $${state.A.cost.toFixed(2)}, ${Math.round(state.A.secs)} s`);
  }

  if (!state.B) {
    const run = join(work, "run");
    rmSync(run, { recursive: true, force: true });
    copyFileSync(join(dir, "A.html"), join(work, "index.html"));
    writeFileSync(join(dir, "brief.md"), t.task + "\n");
    writeFileSync(join(dir, "checks.md"), t.checks.join("\n") + "\n");
    const B = { calls: [] as Call[], reports: [] as string[], reason: "" };
    let session = state.A.session;
    for (let n = 1; ; n++) {
      const shots = join(run, `shots-${n}`);
      const paths = await capped(shoot(url, shots, { screens: t.screens }), "shoot");
      const report = await round(run, shots, n === 1 ? { brief: join(dir, "brief.md"), checks: join(dir, "checks.md") } : null);
      B.reports.push(report);
      const last = report.split("\n").at(-1)!;
      console.log(`${t.id}: B round ${n}: ${report.split("\n")[0]} · ${last.split(":")[0]}`);
      if (last.startsWith("STOP")) { B.reason = last.split(":")[0].replace("STOP ", ""); break; }
      const call = await build(work, fixPrompt(report, paths.map((p) => p.slice(work.length + 1))), { id: session, fork: n === 1 });
      B.calls.push(call);
      session = call.session;
    }
    const rounds = readdirSync(run).filter((f) => /^round-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(run, f), "utf8")));
    state.B = {
      ...B, rounds: rounds.length, trend: rounds.sort((a, b) => a.round - b.round).map((r) => r.overall),
      builderCost: B.calls.reduce((s, c) => s + c.cost, 0), criticCost: rounds.reduce((s, r) => s + r.cost, 0),
      secs: B.calls.reduce((s, c) => s + c.secs, 0) + rounds.reduce((s, r) => s + r.secs, 0),
    };
    copyFileSync(join(work, "index.html"), join(dir, "B.html"));
    save();
  }

  // Finals shot identically, outside the run, for the blind picks and the judge.
  for (const arm of ["A", "B"]) {
    if (!existsSync(join(dir, `final-${arm}`))) await capped(shoot("file://" + join(dir, `${arm}.html`), join(dir, `final-${arm}`), { screens: t.screens }), "shoot");
  }
  console.log(`${t.id}: done · B ${state.B.reason} after ${state.B.rounds} round(s), trend ${state.B.trend.join(" → ")}`);
}

if (import.meta.main) {
  const [tasksFile, out, par = "3", ...only] = process.argv.slice(2);
  if (!tasksFile || !out) {
    console.error("usage: node proof/loop.ts <loop-tasks.json> <out-dir> [parallel=3] [only-id ...]");
    process.exit(2);
  }
  const todo: Task[] = JSON.parse(readFileSync(tasksFile, "utf8")).filter((t: Task) => !only.length || only.includes(t.id));
  let failed = 0;
  const worker = async () => {
    for (let t = todo.shift(); t; t = todo.shift()) {
      try { await runTask(t, out); } catch (e) { failed++; console.log(`${t.id}: FAILED ${(e as Error).message}`); }
    }
  };
  await Promise.all(Array.from({ length: Number(par) }, worker));
  console.log(`finished, ${failed} failed`);
}
