import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "DEBTS — WALK THE LEDGER",
    rows: [["trimmed scope, TODO, FIXME", "collected", "ok"], ["skipped edge cases, shallow tests", "collected", "ok"],
           ["assumed, not verified", "collected", "ok"], ["brainstorming first", "refused", "bad"]],
    lede: "Retrieval, not invention. The session and the diff already hold the compromises somebody made and moved past — and if the work isn't in context, the artifact gets <b>read before anything is said</b>." },
  { t: "THEN INVENT",
    rows: [["the adjacent capability", "proposed", "ok"], ["the direction the work could take", "proposed", "ok"],
           ["running before the ledger is empty", "refused", "bad"]],
    lede: "The fun part, deliberately second. Ideas crowd out debts whenever they go first — a cold brainstorm reaches for what is <i>interesting</i> rather than what is <b>actually missing</b>." },
  { t: "PRICE EVERY LINE",
    rows: [["effort estimate", "required", "ok"], ["what it buys", "required", "ok"],
           ["can't estimate", "say so, in place of the price", "ok"], ["silently dropping the price", "refused", "bad"]],
    lede: "\"Add retry with backoff · ~20 min · removes the most likely production page\" beats \"improve error handling\" by an enormous margin — the second one hands the judgment straight back to you." },
  { t: "THREE BUCKETS",
    rows: [["promised and missing", "Debts — a risk call", "ok"], ["never promised", "Beyond — a value call", "ok"],
           ["considered and rejected", "Gold-plating, with the reason", "ok"], ["one merged ranked list", "refused", "bad"]],
    lede: "Sorted by one question: <b>was it promised?</b> Merged into a single list, a shiny idea outranks a missing error handler and you re-sort by hand — which is the labour this exists to spare you." },
  { t: "THE VERDICT",
    rows: [["one call", "the next thing, or ship it", "ok"], ["an empty list", "a valid outcome", "ok"],
           ["a summary of the buckets", "refused", "bad"], ["building any of it", "refused", "bad"]],
    lede: "It proposes and stops. <b>\"Nothing — ship it\" is a real answer</b>, and the reason the other four steps are allowed to be this strict about what earns a line." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number) => {
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "run" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
