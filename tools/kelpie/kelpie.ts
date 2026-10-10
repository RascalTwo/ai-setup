#!/usr/bin/env bun
// kelpie: tick | status | review | input | comment | finish | page | bg. See README.md.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentCommand, derive, locate, lock, pageEvent, tick } from "./dispatcher.ts";
import { timelineStudio } from "./timeline-studio.ts";
import { refineNext } from "./actions.ts";
import { deps, log, STATE, CONFIG, PAUSED } from "./wiring.ts";

const [cmd = "", ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith("--")));
const arg = rest.filter(a => !a.startsWith("--")).join(" ");

try {
  const d = deps(), { config, projects } = d;
  if (cmd === "tick") {
    mkdirSync(STATE, { recursive: true });
    const unlock = lock(STATE);
    if (!unlock) { log("another tick is running"); process.exit(0); }
    try { await tick(d); }
    catch (e: any) { log(`tick failed: ${e.stack ?? e.message}`); throw e; }
    finally { unlock(); }
  } else if (cmd === "pause" || cmd === "resume") {
    // A pause only stops new runs: running agents, relays, restarts and clean-up carry on.
    if (cmd === "pause") writeFileSync(PAUSED, `paused ${new Date().toISOString()}\n`);
    else rmSync(PAUSED, { force: true });
    log(cmd === "pause" ? "paused: no new runs until resume" : "resumed");
    console.log(cmd === "pause" ? "Paused: no new builds or refines start. Running agents carry on. `resume` to undo." : "Resumed: new runs start on the next tick.");
  } else if (cmd === "refine-next") {
    const unlock = lock(STATE);
    if (!unlock) throw new Error("a tick is running; try again in a few seconds");
    try { console.log(`refining ${await refineNext(d)}`); } finally { unlock(); }
  } else if (cmd === "status") {
    const tracker = timelineStudio();
    const g = d.gate();
    if (d.paused()) console.log("PAUSED: no new runs start (kelpie.ts resume)");
    console.log(`gate: ${g.open ? "open" : "shut"} (${g.why})`);
    if (!projects.length) console.log(`no projects in ${CONFIG}/projects/`);
    for (const p of projects) {
      console.log(`\n${p.id} (For: Agent · Project ${p.color})`);
      for (const t of await tracker.listTasks(p.color)) {
        const s = derive(t);
        if (s.state === "ignored" || (s.state === "finished" && !s.pane)) continue;
        console.log(`  ${s.state.padEnd(9)} ${t.id}  ${t.label}${s.pane ? `  [${s.pane}]` : ""}${t.rank != null ? `  rank ${t.rank}` : ""}`);
      }
    }
  } else if (cmd === "bg") {
    // The Stop hook of every agent Kelpie starts: record what is running in the background, so a
    // quiet pane with a shell or subagent going isn't taken for a stuck one. Never fails the hook.
    try {
      const hook = JSON.parse(await Bun.stdin.text());
      if (Array.isArray(hook.background_tasks)) {
        const running = hook.background_tasks.filter((t: any) => t.status === "running").map((t: any) => `${t.type}: ${t.description ?? t.id}`);
        writeFileSync(join(locate(STATE, hook.cwd).dir, ".background"), JSON.stringify({ t: Date.now(), running }));
      }
    } catch {}
  } else if (cmd === "page") {
    // From a spec page's backend (cwd = the task folder): the human pressed Send corrections.
    console.log((await pageEvent(d, timelineStudio(undefined, "Joseph (spec page)"), STATE, process.cwd(), arg)).msg);
  } else if (["review", "input", "comment", "finish", "describe", "signoff", "approve", "close", "history"].includes(cmd)) {
    console.log(await agentCommand(d.tracker, projects, STATE, process.cwd(), cmd, arg, flags));
    // signoff, close and finish are the run's finish line: close this pane once the agent has had a
    // moment to say its last line. Detached, so it outlives this command. The tick still cleans up.
    let pane = process.env.HERDR_PANE_ID;
    if (!pane && cmd === "signoff") {
      // Signed off from the spec page: no agent ran this, so tell the pane its run is over.
      pane = (await pageEvent(d, d.tracker, STATE, process.cwd(), "The human signed this off on the spec page. Your refine run is over: say nothing more and stop.", true)).pane;
    }
    if (pane && ["signoff", "close", "finish"].includes(cmd)) {
      Bun.spawn(["sh", "-c", 'nohup sh -c \'sleep 10; herdr pane close "$1"\' _ "$0" >/dev/null 2>&1 &', pane]);
      console.log("This pane closes in 10 seconds.");
    }
  } else {
    console.error("usage: kelpie tick | status | pause | resume | refine-next | review \"<your handover>\" | review --questions \"…\" | history | input \"…\" | comment \"…\" | describe <file|text> | finish [\"<what shipped>\"] [--nothing-to-ship] | signoff \"<their words>\" | approve \"<their words>\" | close \"<their words>\"");
    process.exit(2);
  }
} catch (e: any) {
  console.error(`kelpie: ${e.message}`);
  process.exit(1);
}
