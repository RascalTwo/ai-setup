import { stepper, need } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "FREEZE THE BRIEF · round 1 only",
    rows: [
      ["brief.md", "purpose + every intended oddity", "ok"],
      ["checks.md", "0 to 5 things you can see", "ok"],
      ["a new brief in round 2", "refused: frozen", "bad"],
    ],
    lede: "<code>round.ts</code> copies the brief and checks into the run folder, <code>~/.agents/state/visual-critic-loop/runs/&lt;slug&gt;-&lt;date&gt;/</code>. Later rounds reuse that copy, so the goalposts <b>cannot move</b> to make a round pass.",
  },
  {
    t: "SHOOT THE SCREENS",
    rows: [
      ["w1280-s1.png", "from shoot.ts", "ok"],
      ["w390-s1.png", "from shoot.ts", "ok"],
      ["a 3D render or app", "your own PNGs, a few views", "ok"],
      ["a JPEG", "refused: PNG only", "bad"],
    ],
    lede: "<code>shoot.ts &lt;url&gt; $RUN/shots-N</code> opens the page in headless Chrome at both widths. <code>--screens</code> adds screens down a long page and <code>--frames</code> adds shots of motion.",
  },
  {
    t: "ASK THE CRITIC",
    rows: [
      ["the PNGs, the brief, the checks", "all it sees", "ok"],
      ["claude -p --model claude-sonnet-5-5", "effort medium", "ok"],
      ["answer shape", "forced by schema.json", "ok"],
      ["code, CLAUDE.md, skills, MCP, tools", "none: empty folder", "bad"],
    ],
    lede: '<code>critic.ts</code> starts a fresh process with <code>--tools "" --setting-sources=</code> in an empty temp folder and sends the pictures. With no source to read, it can only judge <b>what a person would see</b>.',
  },
  {
    t: "READ THE VERDICT",
    rows: [
      ["legibility, layout, hierarchy, polish", "0 to 10 each, plus overall", "ok"],
      ["issues, worst first", "blocker / major / minor + a box", "ok"],
      ["each task check", "pass or fail + a note", "ok"],
      ["problems to fill the list", "refused: list none", "bad"],
    ],
    lede: "Each issue carries <code>shot</code> and <code>box</code> as <code>x,y,width,height</code> in that screenshot's pixels, so the builder can <b>find it</b>. The round is saved as <code>round-N.json</code> and printed.",
  },
  {
    t: "DECIDE",
    rows: [
      ["clean", "no blocker/major, all checks pass: STOP", "ok"],
      ["plateau", "rose under 0.5 over 2 rounds: STOP", "ok"],
      ["cap", "4 rounds done: STOP", "ok"],
      ["otherwise", "CONTINUE", "ok"],
      ["a fifth round", "refused", "bad"],
    ],
    lede: "<code>decide()</code> in <code>round.ts</code> prints the last line, <b>CONTINUE</b> or <b>STOP &lt;reason&gt;</b>. Run it again on a run that already stopped and it refuses.",
  },
  {
    t: "FIX AND GO AGAIN, OR HAND OVER",
    rows: [
      ["blockers and majors", "fixed, worst first", "ok"],
      ["minors", "only where cheap", "ok"],
      ["handover", "trend, reason, final shots, open items", "ok"],
      ['calling a plateau or cap "done"', "refused", "bad"],
      ["saying the loop is proved", "refused", "bad"],
    ],
    lede: "On CONTINUE the builder fixes, re-shoots into <code>shots-N+1</code> and runs the next round. On STOP it hands over. Only <b>STOP clean</b> means the critic has nothing serious left.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const render = (i: number) => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"}">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "flow" });
need("#next").addEventListener("click", () => st.next());
need("#prev").addEventListener("click", () => st.prev());
const play = need("#play");
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
for (const el of [need("#next"), need("#prev")]) el.addEventListener("click", stopPlay);
