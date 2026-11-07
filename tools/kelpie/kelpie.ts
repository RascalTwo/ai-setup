#!/usr/bin/env bun
// kelpie: tick | status | pause | resume | refine | build | more | less | eta | review | input | comment | finish | page | bg | session. See README.md.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentCommand, approvedFromPage, locate, lock, pageEvent, pastGate, tick } from "./dispatcher.ts";
import { timelineStudio } from "./timeline-studio.ts";
import { buildNext, refineNext, start } from "./actions.ts";
import { status, type Row, type Section } from "./status.ts";
import { deps, log, STATE, CONFIG, PAUSED, ACTIVE_FILE, active, pausedFile } from "./wiring.ts";

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
  } else if ((cmd === "pause" || cmd === "resume") && arg) {
    // One project: nothing new starts there; its running agents carry on.
    if (!projects.some(p => p.id === arg)) throw new Error(`no project "${arg}" (have: ${projects.map(p => p.id).join(", ")})`);
    if (cmd === "pause") writeFileSync(pausedFile(arg), `paused ${new Date().toISOString()}\n`); else rmSync(pausedFile(arg), { force: true });
    log(`${arg} ${cmd}d`);
    console.log(cmd === "pause" ? `Paused ${arg}: no new builds, refines or dredges start there. Running agents carry on.` : `Resumed ${arg}.`);
  } else if (cmd === "pause" || cmd === "resume") {
    // A pause only stops new runs: running agents, relays, restarts and clean-up carry on.
    if (cmd === "pause") writeFileSync(PAUSED, `paused ${new Date().toISOString()}\n`);
    else { rmSync(PAUSED, { force: true }); writeFileSync(ACTIVE_FILE, "1\n"); } // turned back on: one project, `more` for another
    log(cmd === "pause" ? "paused: no new runs until resume" : "resumed");
    console.log(cmd === "pause" ? "Paused: no new builds or refines start. Running agents carry on. `resume` to undo." : "Resumed: new runs start on the next tick, in one project at a time. `kelpie more` lets one more project run.");
  } else if (cmd === "more" || cmd === "less") {
    // Never stops a run: `less` only keeps new projects from starting until the active ones finish.
    const n = Math.max(1, active() + (cmd === "more" ? 1 : -1));
    writeFileSync(ACTIVE_FILE, `${n}\n`);
    log(`active projects: ${n}`);
    console.log(`Up to ${n} project${n > 1 ? "s" : ""} at once.${cmd === "less" ? " Running agents carry on; no new project starts until one finishes." : ""}`);
  } else if (cmd === "refine-next") {
    const unlock = lock(STATE);
    if (!unlock) throw new Error("a tick is running; try again in a few seconds");
    try { console.log(`refining ${await refineNext(d, arg || undefined)}`); } finally { unlock(); }
  } else if (cmd === "refine" || cmd === "build") {
    if (!arg) throw new Error(`usage: kelpie ${cmd} <task-id>`);
    const unlock = lock(STATE);
    if (!unlock) throw new Error("a tick is running; try again in a few seconds");
    try { console.log(`${cmd === "refine" ? "refining" : "building"} ${await start(d, arg, cmd === "refine")}`); } finally { unlock(); }
  } else if (cmd === "build-next") {
    const unlock = lock(STATE);
    if (!unlock) throw new Error("a tick is running; try again in a few seconds");
    try { console.log(`building ${await buildNext(d, arg || undefined)}`); } finally { unlock(); }
  } else if (cmd === "status") {
    if (arg && !projects.some(p => p.id === arg)) throw new Error(`no project "${arg}" (have: ${projects.map(p => p.id).join(", ")})`);
    const st = await status(d, arg || undefined);
    if (flags.has("--json")) { console.log(JSON.stringify(st)); process.exit(0); }
    if (st.paused) console.log("PAUSED: no new runs start (kelpie.ts resume)");
    const top = projects.filter(p => pastGate(projects, p)).map(p => p.id);
    console.log(st.gate.open ? `gate: open (${st.gate.why})` : `gate: SHUT (${st.gate.why}): no new builds or refines start on their own${top.length ? ` except in ${top.join(", ")} (top priority)` : ""}. \`kelpie build-next [project]\` or \`refine-next [project]\` starts one anyway.`);
    console.log(`active: up to ${st.active} project${st.active > 1 ? "s" : ""} at once (\`kelpie more\` / \`less\`)`);
    if (!projects.length) console.log(`no projects in ${CONFIG}/projects/`);
    // One table per project, in the order Kelpie acts: the slots, what waits on you, the queues, then what sits outside them.
    const ago = (at: string | null) => { if (!at) return ""; const m = Math.round((Date.now() - Date.parse(at)) / 6e4); return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
    // Every project's table shares one set of column widths, so they line up down the screen.
    const head = ["", "", "Task", "Pane", "Since", "Note"], tables: [string, (string[] | null)[]][] = [];
    const table = (rows: (string[] | null)[], w: number[]) => {
      const rule = (l: string, m: string, r: string) => l + w.map(n => "─".repeat(n + 2)).join(m) + r;
      const row = (r: string[]) => "│ " + w.map((n, i) => { const c = r[i] ?? ""; return c + " ".repeat(n - Bun.stringWidth(c)); }).join(" │ ") + " │";
      return [rule("┌", "┬", "┐"), row(head), rule("╞", "╪", "╡").replace(/─/g, "═"), ...rows.map(r => r ? row(r) : rule("├", "┼", "┤")), rule("└", "┴", "┘")].join("\n");
    };
    for (const p of st.projects) {
      const icon = (r: Row) => r.refine ? "✎" : "⚒";
      const of = (s: Section) => p.rows.filter(r => r.section === s);
      const cells = (rs: Row[], n = (i: number, r: Row) => r.id) => rs.map((r, i) => [icon(r), n(i, r), r.pane ?? "", r.section === "buildQueue" || r.section === "refineQueue" || r.section === "blocked" ? "" : ago(r.at), r.note]);
      const none = (icon = "", what = "none", why = "") => [[icon, what, "", "", why]];
      const slot = (s: Section, refine: boolean) => {
        if (of(s).length) return cells(of(s));
        const h = of("waiting").find(r => r.refine === refine);
        return none(refine ? "✎" : "⚒", h ? `held by ${h.id}` : "free", h ? "until you answer it (Waiting on you)" : "");
      };
      const or = (rs: string[][], icon = "") => rs.length ? rs : none(icon);
      const numbered = (i: number, r: Row) => `${i + 1}. ${r.id}`;
      const sections: [string, string[][]][] = [
        ["Build slot", slot("building", false)],
        ["Refine slot", slot("refining", true)],
        ["Waiting on you", or(cells(of("waiting")))],
        ["Build queue", or(cells(of("buildQueue"), numbered), "⚒")],
        ["Refine queue", or(cells(of("refineQueue"), numbered), "✎")],
        ["Blocked", or(cells(of("blocked")).map(c => (c[0] = "", c)))],
        ["Finished", none("", String(of("finished").length))],
      ];
      const title = p.priority == null ? p.id : `${p.id} · priority ${p.priority}${p.pastGate ? ", past the gate" : ""}${p.active ? " · active" : ""}`;
      tables.push([title + (p.paused ? " · PAUSED (kelpie resume " + p.id + ")" : "") + (p.dredge ? ` · 💡 dredging ${p.dredge}` : ""), sections.flatMap(([name, rs], n) => [...(n ? [null] : []), ...rs.map((r, i) => [i ? "" : name, ...r])])]);
    }
    if (st.ship) console.log(`\n${st.ship}`);
    const all = tables.flatMap(([, rows]) => rows).filter(r => r !== null);
    const w = head.map((h, i) => Math.max(Bun.stringWidth(h), ...all.map(r => Bun.stringWidth(r[i] ?? ""))));
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
  } else if (["review", "eta", "input", "comment", "finish", "describe", "signoff", "approve", "close", "park", "history", "unpublished"].includes(cmd)) {
    const out = await agentCommand(d.tracker, projects, STATE, process.cwd(), cmd, arg, flags);
    // Approved from the walkthrough page: no agent ran this, so tell the build pane to ship. It stays open.
    console.log(!process.env.HERDR_PANE_ID && cmd === "approve" ? (await approvedFromPage(d, STATE, process.cwd())).msg : out);
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
    console.error("usage: kelpie tick | status [project] [--json] | pause [project] | resume [project] | refine <task-id> | build <task-id> | more | less | refine-next [project] | build-next [project] | eta <20m> [\"<stage>\"] | review \"<your handover>\" | review --questions \"…\" | history | unpublished | input \"…\" | comment \"…\" | describe <file|text> | finish [\"<what shipped>\"] [--nothing-to-ship] | signoff \"<their words>\" | approve \"<their words>\" | close \"<their words>\" | park \"<their words>\"");
    process.exit(2);
  }
} catch (e: any) {
  console.error(`kelpie: ${e.message}`);
  process.exit(1);
}
