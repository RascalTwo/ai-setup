import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "SPEC TO STEPS",
    rows: [
      ["spec.json ✓ examples", "one step each, in the spec's order", "ok"],
      ["from-spec.ts", "writes the walk.json skeleton", "ok"],
      ["each step names its example", "so nothing is skipped", "ok"],
      ["say what is right", "refused: from-spec rejects judging words", "bad"],
    ],
    lede: "<b>say</b> is where to look and what to do. The human judges; the guide only leads.",
  },
  {
    t: "STAGE THE COPIES",
    rows: [
      ["clone-pair.sh", "makes now/ and before/ clones", "ok"],
      ["web: inject.ts", "driver.js 1.10.2, tour.js, theme.css, start.js into dist", "ok"],
      ["cli: sandbox", "own HOME, state, config; fake herdr on PATH", "ok"],
      ["a real checkout, data folder or port", "refused: throwaway copies only", "bad"],
    ],
    lede: "Everything lives in <b>&lt;run&gt;/walkthrough/</b>. The app's source is never changed.",
  },
  {
    t: "WALK THE WEB BUILD",
    rows: [
      ["guide runs only with ?tour", "start.js reads the flag", "ok"],
      ["guide posts {tour:{id,n,of}}", "the page knows the step", "ok"],
      ['page saves {"step":"S3"} in the URL hash', "feedback entries file by step", "ok"],
      ["pressing the guide's Next to get there", "refused: do the action", "bad"],
    ],
    lede: "A pin or a spoken reaction lands in the feedback log with <b>where.hash</b>, so it is filed under its step.",
  },
  {
    t: "RUN THE CLI BUILD",
    rows: [
      ["each step is a Run button", "api /cmd runs that side's command", "ok"],
      ["rows in look", "highlighted in the output", "ok"],
      ["before:true", "runs it on the previous build too", "ok"],
      ["clip steps", "a recording and a one-line why, not live", "ok"],
    ],
    lede: "Anything slow, or touching something real, is a <b>clip</b> of the agent's own run in the sandbox.",
  },
  {
    t: "DECIDE ONCE",
    rows: [
      ["Send disabled", "with a line saying why", "ok"],
      ["Accept or Changes", "unlocks Send and the notes", "ok"],
      ["notes", "not rendered until decided", "ok"],
      ["a silent disabled button", "refused: the park prototype's bug", "bad"],
    ],
    lede: "The agent's own account and doubts open only <b>after</b> the human has decided.",
  },
  {
    t: "SEND",
    rows: [
      ["words.ts sendWords", "decision, steps reached n/m, reactions by step", "ok"],
      ["POST api/sent to relay.ts", "bun kelpie.ts page <words>, cwd = run folder", "ok"],
      ["Kelpie", "comments on the task, types [kelpie] ... into the pane", "ok"],
      ["no live pane", "Not delivered: error, copyable words, Send again", "bad"],
    ],
    lede: 'A delivered Send logs <b>{type:"send"}</b>, so the next Send carries only reactions made after it.',
  },
];

const el = (id: string): HTMLElement => {
  const e = $(id);
  if (!e) throw new Error(`missing ${id}`);
  return e;
};
const stage = el("#stage"),
  lede = el("#lede"),
  pos = el("#pos"),
  play = el("#play");
const render = (i: number) => {
  const s = S[i];
  if (!s) return;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};text-align:right">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "flow" });
let on = false;
const setPlay = (v: boolean): void => {
  on = v;
  if (on) st.play();
  else st.pause();
  play.textContent = on ? "❚❚ pause" : "▶ play";
};
el("#next").addEventListener("click", () => {
  st.next();
  setPlay(false);
});
el("#prev").addEventListener("click", () => {
  st.prev();
  setPlay(false);
});
play.addEventListener("click", () => setPlay(!on));
