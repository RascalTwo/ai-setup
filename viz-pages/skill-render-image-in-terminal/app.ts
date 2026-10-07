import { stepper, $ } from "@viz/kit";

type Status = "ok" | "bad";
interface Step {
  t: string;
  rows: [string, string, Status][];
  lede: string;
}

const S: Step[] = [
  {
    t: "THE SKILL FIRES",
    rows: [
      ['"show me the logo"', "fires", "ok"],
      ["an image Claude made is the answer", "fires", "ok"],
      ["a screenshot / Read / paste", "already inline — skip", "bad"],
    ],
    lede: "The description matches on <b>seeing</b> something. Images the hook already draws on its own are excluded, so the skill covers only what would otherwise stay a path.",
  },
  {
    t: "MAKE IT A FILE",
    rows: [
      ["a chart, a rendered page, a diagram", "write to a file first", "ok"],
      ["a path / URL / clipboard", "use as-is", "ok"],
    ],
    lede: "<code>show-image</code> takes a source, not bytes on stdin — so anything Claude generates lands on disk before it can be shown.",
  },
  {
    t: "ITS OWN BASH CALL",
    rows: [
      ["~/.agents/ai-setup/tools/ttyimgspool/show-image <src>", "one call", "ok"],
      ["buried in a pipeline", "line may be swallowed", "bad"],
    ],
    lede: "The hook reads <b>this call's</b> tool response. Keeping the command alone keeps its one line of output intact.",
  },
  {
    t: "NORMALISE TO PNG",
    rows: [
      ["http(s)://…", "curl -fsSL", "ok"],
      ["clipboard", "osascript «class PNGf», else pbpaste", "ok"],
      ["any file", "sips -s format png → $TMPDIR", "ok"],
      ["missing / not an image", "stderr, exit 1", "bad"],
    ],
    lede: "Every source converges on one PNG in <code>$TMPDIR</code>. On success the script prints exactly <code>show-image: &lt;png&gt;</code>.",
  },
  {
    t: "THE HOOK MATCHES",
    rows: [
      ["PostToolUse → ttyimgspool-hook.py", "fires", "ok"],
      ["SHOW_RE ^show-image: (/.+)$", "match", "ok"],
      ['spool_path(…, "show-image", p)', "copied to the gallery", "ok"],
    ],
    lede: "The hook fast-paths any payload without <code>show-image: </code> in it, then regex-matches the line and spools the PNG like any other image.",
  },
  {
    t: "DRAWN INLINE",
    rows: [
      ["kitty APC upload to Claude Code's tty", "q=2", "ok"],
      ["systemMessage of placeholder cells", "fg colour = image id", "ok"],
      ["caption + thumbnail", "≤ 40×12 cells", "ok"],
      ["no kitty graphics", "silent", "bad"],
    ],
    lede: 'Claude Code prints the systemMessage as text and the terminal paints the image onto it. The details are <a href="../tool-ttyimgspool/">ttyimgspool\'s poster</a>.',
  },
  {
    t: "CTRL+CLICK",
    rows: [
      ["OSC 8 file:// link", "on image + caption", "ok"],
      ["Ctrl+click", "herdr plugin → full pane", "ok"],
      ["plain click", "Finder reveal (#95675)", "bad"],
      ["click / key / scroll", "closes", "ok"],
    ],
    lede: "The thumbnail is a preview; the original, at full resolution, is one Ctrl+click away. Done means the <code>show-image:</code> line printed.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const esc = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text);overflow-wrap:anywhere">${esc(k)}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};text-align:right">${st === "ok" ? "✓" : "✗"} ${esc(v)}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "show" });
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
