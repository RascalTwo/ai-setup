import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "THE TARGET AND ITS LEDGER",
    rows: [
      ["watermark", "when the last dredge began", "ok"],
      ["ledger.md", "every proposal, and your verdict", "ok"],
      ["no watermark", "first dredge: all history, recent first", "ok"],
      ["starting without reading them", "refused", "bad"],
    ],
    lede: "It reads <code>~/.agents/state/dredge/&lt;slug&gt;/</code> before anything else, and notes the time: that becomes the next watermark.",
  },
  {
    t: "GATHER THE LESSONS",
    rows: [
      ["commits since the watermark", "read, with the larger diffs", "ok"],
      ["sessions and run transcripts", "read for errors and retries", "ok"],
      ["your pushback", "the most valuable lesson", "ok"],
      ["what went well", "worth extending", "ok"],
      ["a lesson without its source", "refused", "bad"],
    ],
    lede: "Each source is checked or noted as absent. Every lesson cites a commit, a session or a comment, so you can check it.",
  },
  {
    t: "JUDGE WITH PLUS-ULTRA",
    rows: [
      ["debts before ideas, a price per line", "kept", "ok"],
      ["the cap on the list", "removed", "ok"],
      ["a rejected idea, no new evidence", "stays buried", "ok"],
      ["filler", "refused", "bad"],
    ],
    lede: "plus-ultra's rules hold, read from its own <code>SKILL.md</code>. Lessons outrank invented ideas of the same value, and every proposal is tagged: bug, debt, feature, tech debt or process.",
  },
  {
    t: "PRESENT, THEN RECORD",
    rows: [
      ["one numbered list", "in the conversation", "ok"],
      ["new proposals", "ledger: undecided", "ok"],
      ["watermark", "moved forward", "ok"],
      ["tasks created now", "refused", "bad"],
    ],
    lede: "The ledger is written the moment the list is shown, so a session that dies early still leaves a record.",
  },
  {
    t: "TAKE VERDICTS",
    rows: [
      ["file it", "a Timeline Studio task, on your word", "ok"],
      ["reject it", "ledger: rejected, with your reason", "ok"],
      ["no answer", "stays undecided", "ok"],
      ["filing on its own judgment", "refused", "bad"],
    ],
    lede: "A filed task in a Kelpie project goes For: Agent and unrefined, so <b>Kelpie refines it next</b>: the queue that ran dry has work again.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "run" });
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
