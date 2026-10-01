import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Phase { t: string; rows: Row[]; lede: string }

const S: Phase[] = [
  { t: "PHASE 0 · USAGE SNAPSHOT",
    rows: [["~/.claude/projects/**/*.jsonl", "6+ months, gap-free", "ok"], ["nothing to keep running", "written unconditionally", "ok"],
           ["\"0 calls\" = globally dead", "false — Codex is invisible", "bad"]],
    lede: "The only number in the audit drawn from evidence rather than inspection. It replaced a Prometheus/Loki/OTEL stack that was <b>down at audit time</b> — decommissioned 2026-07-11." },
  { t: "PHASE 1 · DISCOVERY",
    rows: [["parallel subagents", "read-only inventory", "ok"], ["classify every live entry", "SYMLINK · BROKEN · REAL_DIR · ABSENT", "ok"],
           ["which phases to run", "it asks you here", "ok"], ["changing anything yet", "refused", "bad"]],
    lede: "Interactive at the <b>start</b>, not the end. You get the whole inventory and choose the phases — most live entries classify as a healthy <code>SYMLINK</code>, so the list is longer than the problem." },
  { t: "PHASE 2 · RULES FILE",
    rows: [["ai-setup/AGENTS.md", "canonical", "ok"], ["~/.claude/CLAUDE.md", "→ AGENTS.md", "ok"],
           ["~/.codex/AGENTS.md", "→ AGENTS.md", "ok"], ["two files drifting apart", "impossible by construction", "ok"]],
    lede: "One file, two agents, <b>the same bytes</b>. What's audited here is the content — rules that no longer describe the setup, and cross-references pointing at things that moved." },
  { t: "PHASE 3 · SKILLS",
    rows: [["the hard invariant", "symlink, or named in the manifest", "ok"], ["freshness", "content hash vs upstream tree", "ok"],
           ["an unnamed real dir", "UNACCOUNTED — ask, don't delete", "bad"], ["trusting the npx lock file", "refused", "bad"]],
    lede: "Hashing rather than path-matching, because upstream reorganises — mattpocock moved every skill into category dirs without renaming one, and a path-based check would have reported the whole catalog missing." },
  { t: "PHASE 4 · SUBAGENTS",
    rows: [["authored once", ".ruler/agents/*.md", "ok"], ["compiled by Ruler", ".claude/*.md + .codex/*.toml", "ok"],
           ["a compiled file with no source", "orphan — Ruler never deletes", "bad"]],
    lede: "The r2-sdlc reviewers. The invariant is that every compiled artefact traces back to a <code>.ruler</code> source; a rename leaves the old compiled pair behind and nothing else ever notices." },
  { t: "PHASE 5 · MCP & SETTINGS",
    rows: [["/doctor", "run first, folded in", "ok"], ["Claude ~/.claude.json", "mcpServers", "ok"],
           ["Codex ~/.codex/config.toml", "[mcp_servers.*]", "ok"], ["green /doctor = healthy setup", "false", "bad"]],
    lede: "<code>/doctor</code> is one probe of one agent — blind to Codex, the overlays, the symlink model and memory. It is read and then <b>deliberately set aside</b>." },
  { t: "PHASE 6 · BASIC-MEMORY",
    rows: [["~/basic-memory/", "note inventory", "ok"], ["wiki-links and permalinks", "resolved", "ok"],
           ["dead references", "flagged", "bad"]],
    lede: "Notes link to each other and to skills. A dead reference costs tokens and confuses the model every time it is loaded, and nothing else in the setup would ever surface it." },
  { t: "PHASE 7 · ECOSYSTEM LINKS",
    rows: [["AGENTS.md → skill", "resolves?", "ok"], ["skill → memory note", "resolves?", "ok"],
           ["note → note", "resolves?", "ok"], ["missing cross-reference", "an opportunity, not a defect", "ok"]],
    lede: "The pass that treats the setup as a graph rather than a list of files. Dead edges waste tokens; <b>absent</b> edges are the missed connections, and they're reported as suggestions." },
  { t: "PHASE 8 · THE EXPLORABLES",
    rows: [["data-atom=\"&lt;skill&gt;\"", "one grep, not a judgment call", "ok"],
           ["poster whose atom is gone", "a live page selling nothing", "bad"],
           ["skill with no poster", "opt-in — not a defect", "ok"], ["og.auto.png", "regenerate with --og, or it lies", "bad"]],
    lede: "The audit turned on its own advertising. Hand-authored HTML that nothing regenerates drifts every time a skill changes, and <b>this is the only cadence that catches it</b>." },
  { t: "PHASE 9 · SYNC & PUBLISH",
    rows: [["install.ts", "idempotent re-run", "ok"], ["subagents", "recompiled", "ok"],
           ["commit on private/trunk", "offered, never taken", "ok"], ["publishing the public core", "secrets scan first", "bad"],
           ["cp over a symlink", "would break the setup", "bad"]],
    lede: "There is nothing to copy back — the edits <b>were</b> the repo. What's left is the installer, the compiler, and a commit you have to approve; the public snapshot never gets one without the mandatory secrets scan." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "phase" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
