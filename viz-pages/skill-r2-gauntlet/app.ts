import { stepper, $ } from "/_kit/viz.js";

type Status = "ok" | "bad" | "warn";
interface Step { t: string; rows: [string, string, Status][]; lede: string }

const S: Step[] = [
  { t: "1 · RESOLVE SCOPE (BLOCKING)",
    rows: [["named in the invocation?", "use it", "ok"],
           ["not named?", "ask — never default", "warn"],
           ["git diff --cached", "→ gauntlet-scope.diff", "ok"],
           ["computed", "ONCE, for everyone", "ok"]],
    lede: "Four scopes and no fifth. The artifact is written to <code>$SCRATCH</code> a single time — reviewers that each resolved scope for themselves would diverge, and the dedup would compare apples to oranges." },
  { t: "2 · PROBE THE CONDITIONALS",
    rows: [[".scratch/*/design.md", "found — fidelity runs", "ok"],
           ["the original ask", "not found — qa skipped", "bad"],
           ["gh pr view --json number", "fails — /review skipped", "bad"],
           ["package.json in the diff", "dep audit enabled", "ok"]],
    lede: "Look, decide, note, move on. Every skip is <b>printed in the report</b> with its reason, so a lens that didn't run is visible rather than quietly absent." },
  { t: "3 · FAN OUT, ONE MESSAGE",
    rows: [["A · reviewer subagents", "×5 (+2 conditional)", "ok"],
           ["B · skills in general-purpose wrappers", "×6", "ok"],
           ["C · built-in security-review", "×1", "ok"],
           ["D · deterministic floor", "jscpd · madge · a11y · async", "ok"]],
    lede: "Every lens goes out in a <b>single message</b> so they run concurrently, each handed the same scope artifact, the changed-file list and the canonical schema up front. A subagent cannot ask mid-run." },
  { t: "4 · SYNTHESIZE",
    rows: [["normalize severity", "5 levels", "ok"],
           ["dedup by MEANING", "not string match", "ok"],
           ["consensus = distinct sources", "×5 on one entry", "ok"],
           ["rank: severity → consensus → file", "done", "ok"]],
    lede: "The part that isn't free. <em>\"Premature <code>BaseProcessor</code> abstraction\"</em> and <em>\"single-impl interface, inline it\"</em> are one finding with two sources — merged, and the source set becomes the confidence score." },
  { t: "5 · EMIT",
    rows: [["raw → after dedup", "41 → 17", "ok"],
           ["🤝 consensus highlights", "3+ reviewers", "ok"],
           ["⏭️ skipped reviewers", "listed, not hidden", "ok"],
           ["$SCRATCH/gauntlet-report.md", "saved + path named", "ok"]],
    lede: "In chat <b>and</b> on disk beside the diff. Never \"they mostly agreed, looks fine\" — a flat digest with no dedup and no ranking is the old chaos with one keystroke. <b>The ranking is the deliverable.</b>" },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const mark: Record<Status, [string, string]> = { ok: ["var(--good)", "✓"], bad: ["var(--danger)", "✗"], warn: ["var(--warn)", "•"] };
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${mark[st][0]};white-space:nowrap">${mark[st][1]} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "run" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
