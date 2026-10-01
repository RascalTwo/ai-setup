import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "RESOLVE THE PROJECT",
    rows: [["organization(login:).projectV2(number:)", "node id", "ok"], ["project title", "printed", "ok"],
           ["GraphQL errors", "exit 1", "bad"]],
    lede: "Every later call needs the opaque node ID. The title is echoed so a wrong project number is visible before anything moves." },
  { t: "PAGE EVERY ITEM",
    rows: [["items(first: 100, after:)", "until hasNextPage false", "ok"], ["project item ID", "≠ the issue's ID", "ok"],
           ["fieldValueByName('Status')", "the column", "ok"], ["draft issues (no number)", "skipped", "bad"]],
    lede: "The <b>project item ID</b> is what gets moved — a distinct ID from the issue's own, and the reason the item list has to be fetched before anything can be reordered." },
  { t: "FILTER TO THE COLUMN",
    rows: [["status == --column", "kept for reordering", "ok"], ["everything else", "kept for the GRAPH", "ok"],
           ["empty column", "nothing to do, exit", "ok"]],
    lede: "Two different sets. Only the column gets reordered — but the depth calculation needs the whole board, because a blocker usually lives somewhere else." },
  { t: "FETCH blockedBy, BATCHED",
    rows: [["10 aliased issues per query", "complexity limit", "ok"], ["blockedBy(first: 50)", "nodes { number }", "ok"],
           ["sleep(0.5) between batches", "rate limit", "ok"], ["blocker not on the board", "dropped", "bad"]],
    lede: "One GraphQL field, aliased ten at a time. The SKILL.md still describes an older two-call REST route — the code reads <code>blockedBy</code> directly." },
  { t: "LONGEST-PATH DFS",
    rows: [["cache", "memoized, computed once", "ok"], ["1 + max(depth of deps)", "longest, not shortest", "ok"],
           ["no dependencies", "depth 0", "ok"], ["in_progress → cycle", "returns 0, loop broken", "bad"]],
    lede: "<b>Max</b>, not min, is the thesis: an item is only as ready as its deepest chain. That is what sinks \"blocked by one thing blocked by five\" below \"blocked by three roots\"." },
  { t: "SORT",
    rows: [["primary key", "depth ascending", "ok"], ["tie-break", "title A→Z", "ok"],
           ["result", "top = most actionable", "ok"]],
    lede: "The entire ordering rule, and it is deliberately boring — a stable alphabetical tie-break means re-running on an unchanged board produces an unchanged column." },
  { t: "CHAIN THE MUTATIONS",
    rows: [["first item: no afterId", "moves to the top", "ok"], ["then afterId: previous item", "lands behind it", "ok"],
           ["sleep(0.2) each", "~3 calls/sec", "ok"], ["--dry-run", "stops before this", "ok"]],
    lede: "There is no bulk reorder mutation, so the column is laid down one link at a time. Then it prints <code>Depth NN | #123 | Title</code> — receipt and explanation in one table." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
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
