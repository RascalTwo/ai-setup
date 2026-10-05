import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "PIN THE CLAIM",
    rows: [
      ["the thing under debate", "one crisp sentence", "ok"],
      ["fuzzy or compound", "sharpen, or split it", "ok"],
      ["arguing a vague claim", "refused", "bad"],
    ],
    lede: "A vague claim produces vague arguments, so nothing starts until the decision is <b>one sentence</b> — confirmed with you if there is any ambiguity about which decision this is.",
  },
  {
    t: "RESOLVE WHAT YOU CAN",
    rows: [
      ["facts", "codebase · web · memory", "ok"],
      ["assumptions", "noted → candidate cruxes", "ok"],
      ["asking you what it can look up", "refused", "bad"],
    ],
    lede: "The step that stops this being an interview. Everything knowable is resolved here; only what is <b>genuinely unresolvable</b> survives to step 5.",
  },
  {
    t: "STRONGEST CASE FOR",
    rows: [
      ["argued as", "its most capable proponent", "ok"],
      ["includes", "the cost of <i>not</i> doing it", "ok"],
      ["faint praise", "refused", "bad"],
    ],
    lede: "Full strength on the side you already hold — because a for-case that is soft makes the against-case look stronger than it is, and the comparison is the product.",
  },
  {
    t: "STRONGEST CASE AGAINST",
    rows: [
      ["the best objection", "at equal strength", "ok"],
      ["the thing you'd rather not see", "named", "ok"],
      ["strawmen", "refused", "bad"],
      ["if it comes out soft", "spawn a prosecutor subagent", "ok"],
    ],
    lede: "The whole point of the skill. If the against-case lands polite and symmetric, that is the model going easy on itself — so it escalates to an <b>independent subagent whose only mandate is to kill the idea</b>.",
  },
  {
    t: "SURFACE THE CRUXES",
    rows: [
      ["load-bearing assumptions", "flip it → flips the answer", "ok"],
      ["needs your private knowledge", "asked, one at a time", "ok"],
      ["a barrage of questions", "refused", "bad"],
    ],
    lede: "Not a summary of the two cases — the few points where the decision <b>actually turns</b>. Your risk tolerance and context are inputs only here, and only where nothing else could supply them.",
  },
  {
    t: "HAND OVER THE VERDICT",
    rows: [
      ["both cases + cruxes", "compact", "ok"],
      ["a tentative lean", "allowed, if labelled", "ok"],
      ["deciding for you", "refused", "bad"],
      ["acting on the outcome", "refused", "bad"],
    ],
    lede: "It stops here. <b>You are the judge</b> — the lean is subordinate to your call, and nothing downstream happens until you have made it.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "flow" });
$("#next")!.addEventListener("click", () => st.next());
$("#prev")!.addEventListener("click", () => st.prev());
const play = $("#play")!;
let on = false;
play.addEventListener("click", () => {
  on = !on;
  if (on) st.play();
  else st.pause();
  play.textContent = on ? "❚❚ pause" : "▶ play";
});
const stopPlay = (): void => {
  on = false;
  play.textContent = "▶ play";
};
for (const el of [$("#next")!, $("#prev")!]) el.addEventListener("click", stopPlay);
