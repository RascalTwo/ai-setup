import { stepper, $ } from "/_kit/viz.js";

type Row = [k: string, v: string, st: "ok" | "bad"];
interface Phase { t: string; rows: Row[]; lede: string }

const S: Phase[] = [
  { t: "PHASE 0 · SETUP",
    rows: [["&lt;repo-id&gt;", "git remote path → user--repo", "ok"], ["run dir", "~/.agents/state/r2-sdlc/…", "ok"],
           ["dir already there", "resume or restart?", "ok"], ["deleting the old run", "renamed .abandoned-&lt;ts&gt;", "ok"]],
    lede: "Before anything is read, the run gets a home <b>outside the repo</b> and a <code>pipeline-state.md</code> holding phase, approval flags and iteration counts. Nothing here is ever committed." },
  { t: "PHASE 1 · UNDERSTAND",
    rows: [["understood.md", "drafted, not asked for", "ok"], ["acceptance criteria", "GIVEN / WHEN / THEN", "ok"],
           ["Assumptions", "listed, so you can catch a miss", "ok"], ["open-ended questions", "refused", "bad"]],
    lede: "Escalation point <b>#1</b>. You redline a finished draft rather than answering a quiz — and the Ambiguities section is for genuine A/B forks only, where <b>zero is acceptable and often correct</b>." },
  { t: "PHASE 2 · DESIGN",
    rows: [["design.md", "approach · touch points · risks", "ok"], ["test plan", "ordered, easiest first", "ok"],
           ["style notes", "lifted from neighbouring files", "ok"], ["hard-to-reverse choice", "steelman it first", "ok"]],
    lede: "Escalation point <b>#2</b>. If the approach rests on an architecture, a dependency or a migration, <a href='../skill-steelman/'>steelman</a> runs <i>before</i> the draft reaches you — so what you redline is already pressure-tested." },
  { t: "PHASE 3 · IMPLEMENT",
    rows: [["one behavior at a time", "red → green → refactor → break it", "ok"], ["the red test", "must fail for the RIGHT reason", "ok"],
           ["surviving mutants", "killed or explained", "ok"], ["design turns out wrong", "stop → escalation #3", "ok"]],
    lede: "Vertical, not horizontal. A missing import is not a red test, and the fix for one goes in the <b>test</b>, not the implementation. Refactoring stays local; architecture is the next phase's job." },
  { t: "PHASE 4 · SIMPLIFY",
    rows: [["simplify skill", "invoked on the change", "ok"], ["duplication, hedge-code", "collapsed", "ok"],
           ["full test suite", "must be green to continue", "ok"]],
    lede: "Feature-level cleanup, deliberately after TDD rather than during it — what one red-green cycle produces is not yet enough information to know what the abstraction should be." },
  { t: "PHASE 5 · REVIEW TIER 1",
    rows: [["fidelity-reviewer", "oracle: design.md", "ok"], ["qa-validator", "oracle: understood.md", "ok"],
           ["both", "parallel, read-only", "ok"], ["design-may-be-wrong", "stop → escalation #3", "bad"]],
    lede: "\"Is it right?\" — two reviewers with two different oracles, so <i>matches the design</i> and <i>solves the ask</i> can fail independently. Capped at two fix-and-re-review rounds, then it escalates." },
  { t: "PHASE 6 · REVIEW TIER 2",
    rows: [["r2-gauntlet --quality-only", "the full roster, deduped", "ok"], ["consensus findings", "acted on first", "ok"],
           ["re-run after a fix", "--only &lt;touched reviewers&gt;", "ok"], ["running before Tier 1 is clean", "refused", "bad"]],
    lede: "\"Is it good?\" — delegated rather than hardcoded, so the pipeline inherits every reviewer <a href='../skill-r2-gauntlet/'>the gauntlet</a> gains. Polishing code that is about to change is spent tokens, so this gate waits." },
  { t: "PHASE 7 · DONE",
    rows: [["summary", "ACs · tests · both tiers · files", "ok"], ["deferred suggestions", "handed to you verbatim", "ok"],
           ["link to the run dir", "included", "ok"], ["commit · push · PR", "refused. ever.", "bad"]],
    lede: "It stops holding the change. The summary reads as a PR description on purpose — but <b>opening the PR is yours</b>, and the run directory stays on disk under the retain policy." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number): void => {
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3000, hashKey: "phase" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
