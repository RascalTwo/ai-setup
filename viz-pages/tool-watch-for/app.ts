import { stepper, need } from "@viz/kit";

type Status = "ok" | "bad";
interface Step {
  t: string;
  rows: [string, string, Status][];
  lede: string;
}

const S: Step[] = [
  {
    t: "PARSE",
    rows: [
      ["ast.parse(expr, mode='eval')", "Python's parser", "ok"],
      ["strings, and/or/not, in, box(), px()", "allowed", "ok"],
      ["anything else", "exit 2", "bad"],
    ],
    lede: "The expression is <b>parsed, never evaluated</b>. A bad one is refused before any frame is captured.",
  },
  {
    t: "CAPTURE",
    rows: [
      ["screencapture -x -t png", "screen", "ok"],
      ["osascript window bounds + screencapture -R", "window:App", "ok"],
      ["ffmpeg -vf fps=1", "video, stream, camera", "ok"],
      ["live cadence", "max 1 frame/s", "ok"],
    ],
    lede: "Live sources capture the next frame as soon as the last answer is in, never faster than once a second.",
  },
  {
    t: "UNCHANGED?",
    rows: [
      ["grayscale at 512px vs last judged frame", "diff", "ok"],
      ["any pixel moved > 24/255", "judge it", "ok"],
      ["nothing moved", "repeat last verdict", "ok"],
    ],
    lede: "A still screen costs no model call: the previous verdict is repeated.",
  },
  {
    t: "ONE d1 CALL PER REGION",
    rows: [
      ["conditions grouped by region", "1 call each", "ok"],
      ["all questions in a region", "batched", "ok"],
      ["batched vs single", "98.8-100% same, ~3.5x faster", "ok"],
      ["native resolution", "2.4-3.0 s/call at 3456x2234", "ok"],
    ],
    lede: "Each call is given only the <b>time remaining</b> in <code>--timeout</code>, so the deadline holds while Ollama is busy.",
  },
  {
    t: "DECIDE",
    rows: [
      ["each p >= 0.5", "condition true", "ok"],
      ["boolean tree evaluated", "--gone inverts", "ok"],
      ["2 consecutive true frames", "match", "ok"],
      ["a single true frame", "not yet", "bad"],
    ],
    lede: "Two frames in a row filters out a flicker or one wrong ~93% verdict.",
  },
  {
    t: "EXIT",
    rows: [
      ["match", "frame saved, JSON line, exit 0", "ok"],
      ["timeout / end of stream", "matched:false line, exit 1", "bad"],
      ["error", "stderr, exit 2", "bad"],
    ],
    lede: "The JSON line carries <code>t</code>, the saved frame path and every condition's <code>p</code>.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const render = (i: number): void => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "step" });
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
