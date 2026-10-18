#!/usr/bin/env bun
// kelpie: tick | status | review | input | comment | finish | page | bg | session. See README.md.
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
    // One table per project, in the order Kelpie acts: the slots, what waits on you, the queues in
    // the order the tick starts them (lowest rank first, unranked last), then what sits outside them.
    const ago = (at?: string) => { if (!at) return ""; const m = Math.round((Date.now() - Date.parse(at)) / 6e4); return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
    // Every project's table shares one set of column widths, so they line up down the screen.
    const head = ["", "", "Task", "Pane", "Since", "Note"], tables: [string, (string[] | null)[]][] = [];
    const table = (rows: (string[] | null)[], w: number[]) => {
      const rule = (l: string, m: string, r: string) => l + w.map(n => "─".repeat(n + 2)).join(m) + r;
      const row = (r: string[]) => "│ " + r.map((c, i) => c + " ".repeat(w[i]! - Bun.stringWidth(c))).join(" │ ") + " │";
      return [rule("┌", "┬", "┐"), row(head), rule("╞", "╪", "╡").replace(/─/g, "═"), ...rows.map(r => r ? row(r) : rule("├", "┼", "┤")), rule("└", "┴", "┘")].join("\n");
    };
    for (const p of projects) {
      const runs = (await tracker.listTasks(p.color)).map(t => ({ t, s: derive(t) }));
      type R = (typeof runs)[number];
      const of = (...states: string[]) => runs.filter(r => states.includes(r.s.state));
      const icon = (r: R) => r.s.refine || r.s.state === "refinable" ? "✎" : "⚒";
      const since = (r: R) => ago(r.t.comments.filter(c => c.mine).at(-1)?.at);
      const none = (icon = "", what = "none") => [[icon, what, "", "", ""]];
      const blocked = runs.filter(r => r.s.state === "ignored" && r.t.status !== "done");
      const holding = of("waiting", "input", "approved");
      const slot = (refine: boolean) => {
        const rs = of("working").filter(r => r.s.refine === refine);
        if (rs.length) return rs.map(r => [icon(r), r.t.id, r.s.pane ?? "", since(r), "working"]);
        const h = holding.find(r => r.s.refine === refine);
        return none(refine ? "✎" : "⚒", h ? `held by ${h.t.id}` : "free").map(x => (x[4] = h ? "until you answer it (Waiting on you)" : "", x));
      };
      const ask: Record<string, (r: R) => string> = {
        waiting: r => r.s.refine ? "answer its questions" : "review it", input: () => "your reply is on its way",
        approved: () => "approved: shipping", signedoff: () => "signed off: closing",
      };
      const queue = (state: string) => of(state).sort((a, b) => (a.t.rank ?? Infinity) - (b.t.rank ?? Infinity))
        .map((r, i) => [icon(r), `${i + 1}. ${r.t.id}`, "", "", r.t.rank != null ? `rank ${r.t.rank}` : "unranked: starts last"]);
      const why = (r: R) => r.t.blockedBy.length ? `waits on ${r.t.blockedBy.join(", ")}` : r.t.status !== "todo" ? "started by hand, outside Kelpie" : r.t.waitingOn ?? "not ready";
      const or = (rs: string[][], icon = "") => rs.length ? rs : none(icon);
      const sections: [string, string[][]][] = [
        ["Build slot", slot(false)],
        ["Refine slot", slot(true)],
        ["Waiting on you", or(of(...Object.keys(ask)).map(r => [icon(r), r.t.id, r.s.pane ?? "", since(r), ask[r.s.state]!(r)]))],
        ["Build queue", or(queue("candidate"), "⚒")],
        ["Refine queue", or(queue("refinable"), "✎")],
        ["Blocked", or(blocked.map(r => ["", r.t.id, "", "", why(r)]))],
        ["Finished", none("", String(of("finished").length))],
      ];
      tables.push([p.id, sections.flatMap(([name, rs], n) => [...(n ? [null] : []), ...rs.map((r, i) => [i ? "" : name, ...r])])]);
    }
    const all = tables.flatMap(([, rows]) => rows).filter(r => r !== null);
    const w = head.map((h, i) => Math.max(Bun.stringWidth(h), ...all.map(r => Bun.stringWidth(r[i]!))));
    for (const [id, rows] of tables) console.log(`\n ${id}\n${table(rows, w)}`);
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
  } else if (cmd === "session") {
    // The SessionStart hook of every agent Kelpie starts: record the session, so a restart resumes
    // its conversation. A /clear starts a new session and lands here again. Never fails the hook.
    try {
      const hook = JSON.parse(await Bun.stdin.text());
      writeFileSync(join(locate(STATE, hook.cwd).dir, ".session"), JSON.stringify({ id: hook.session_id, transcript: hook.transcript_path }));
    } catch {}
  } else if (cmd === "page") {
    // From a spec page's backend (cwd = the task folder): the human pressed Send corrections.
    console.log((await pageEvent(d, timelineStudio(undefined, "Joseph (spec page)"), STATE, process.cwd(), arg)).msg);
  } else if (["review", "input", "comment", "finish", "describe", "signoff", "approve", "close", "park", "history"].includes(cmd)) {
    console.log(await agentCommand(d.tracker, projects, STATE, process.cwd(), cmd, arg, flags));
    // signoff, close and finish are the run's finish line: close this pane once the agent has had a
    // moment to say its last line. Detached, so it outlives this command. The tick still cleans up.
    let pane = process.env.HERDR_PANE_ID;
    if (!pane && cmd === "signoff") {
      // Signed off from the spec page: no agent ran this, so tell the pane its run is over.
      pane = (await pageEvent(d, d.tracker, STATE, process.cwd(), "The human signed this off on the spec page. Your refine run is over: say nothing more and stop.", true)).pane;
    }
    // Only the run's own agent pane: run from any other session, these would close that one.
    if (pane && !(await d.herdr.agents()).get(pane)?.cwd?.startsWith(locate(STATE, process.cwd()).dir)) pane = undefined;
    if (pane && ["signoff", "close", "park", "finish"].includes(cmd)) {
      Bun.spawn(["sh", "-c", 'nohup sh -c \'sleep 10; herdr pane close "$1"\' _ "$0" >/dev/null 2>&1 &', pane]);
      console.log("This pane closes in 10 seconds.");
    }
  } else {
    console.error("usage: kelpie tick | status | pause | resume | refine-next | review \"<your handover>\" | review --questions \"…\" | history | input \"…\" | comment \"…\" | describe <file|text> | finish [\"<what shipped>\"] [--nothing-to-ship] | signoff \"<their words>\" | approve \"<their words>\" | close \"<their words>\" | park \"<their words>\"");
    process.exit(2);
  }
} catch (e: any) {
  console.error(`kelpie: ${e.message}`);
  process.exit(1);
}
