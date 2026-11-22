import { stepper, need } from "@viz/kit";

type Row = [k: string, v: string, st: "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "0 · PICK THE CAPTURE",
    rows: [
      ["still", "page.screenshot", "ok"],
      ["video", "browse recording", "ok"],
      ["GIF", "video, then to-gif.sh", "ok"],
      ["click-marked how-to GIF", "claude-in-chrome fallback", "ok"],
      ["GIF from gif_creator for smooth motion", "a slideshow, always", "bad"],
    ],
    lede: "The choice comes before any command, because the wrong route fails <b>silently</b>: a choppy GIF is not a quality bug to tune, it is a route choice.",
  },
  {
    t: "1 · SESSION AND START STATE",
    rows: [
      ["browse session new &lt;name&gt;", "tab opens in the background", "ok"],
      ["page.goto(url)", "before recording", "ok"],
      ["setViewportSize 1280×800", "read back 1280×800", "ok"],
      ["first frame is a spinner", "re-take", "bad"],
    ],
    lede: "The tab is the user's own Chrome, so their SSO is already there, and it never takes focus. Reach the state you want <b>in frame one</b> before the recorder starts.",
  },
  {
    t: "2 · START THE RECORDER",
    rows: [
      ["recording start -s name --cursor", "→ path.mp4", "ok"],
      ["--mode auto", "CDP, 60 fps target", "ok"],
      ["startedAt (epoch ms)", "kept for trimming", "ok"],
      ["--mode tab-capture", "needs a human toolbar click", "bad"],
    ],
    lede: "One CLI call, no picker and no overlay. CDP mode records from the browser's own frames, so a covered window, another app in front or a user who keeps working changes nothing.",
  },
  {
    t: "3 · RUN THE CHOREOGRAPHY",
    rows: [
      ["one execute --file flow.js", "whole take, one script", "ok"],
      ["pressSequentially delay 40", "paced for a viewer", "ok"],
      ["{ timeout: 5000 } per action", "a miss fails fast", "ok"],
      ["typing through browse", "~10 distinct frames/s", "bad"],
    ],
    lede: "Frames follow <b>repaints</b>. A CSS animation recorded at about 60 source fps; keystrokes through browse about 10, so a typing-heavy take looks stepped. Lead with motion when smoothness is the point.",
  },
  {
    t: "4 · STOP",
    rows: [
      ["recording stop -s name --json", "writes the file", "ok"],
      ["flow.mp4.json", "sidecar with quality stats", "ok"],
      ["max-duration-ms 900000", "forgotten takes self-stop", "ok"],
      ["browse session delete", "no stray tab", "ok"],
    ],
    lede: "The file lands exactly where you pointed it, under <code>~/.agents/state/browser/&lt;task&gt;/</code>. The session is deleted so nothing of yours is left in the user's Chrome.",
  },
  {
    t: "5 · PROVE THE FILE IS REAL",
    rows: [
      ["ffprobe -count_frames", "283 frames, 4.72 s", "ok"],
      ["h264 1672×946", "even dimensions", "ok"],
      ["pix_fmt", "yuvj420p (full range)", "bad"],
      ["achievedSourceFrameRate", "the truth about smoothness", "ok"],
    ],
    lede: "The last silent failure: a file that exists and has the right size but three frames. Count them. The nominal 60 fps says nothing; <code>achievedSourceFrameRate</code> does.",
  },
  {
    t: "6 · CONVERT FOR WHERE IT LANDS",
    rows: [
      ["out_range=tv, format=yuv420p", "QuickTime, Slack, Confluence", "ok"],
      ["to-gif.sh in.mp4 out.gif", "palettegen + paletteuse", "ok"],
      ["4.7 s → 71 frames", "800×453, 54 KB", "ok"],
      ["drop frames, not dimensions", "text must stay legible", "ok"],
    ],
    lede: "ffmpeg's two-pass palette gives one palette per clip: crisp UI text at a fraction of the size. Colors are the cheapest lever; destination budgets are in the skill.",
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "take" });
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
