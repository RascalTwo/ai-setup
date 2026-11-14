import { stepper, need } from "@viz/kit";

/* ════════ Beat 5: one overlay, end to end ════════ */

type Row = [string, string, "ok" | "bad" | "mid"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}
const S: Step[] = [
  {
    t: "THE CALL",
    rows: [
      ["viz-overlay show <viz> --target Finder --element Back", "main.swift", "ok"],
      ["target not there", "exit 3 + reason", "bad"],
      ["no Accessibility", "exit 4", "bad"],
    ],
    lede: "<code>main.swift</code> parses the call, resolves a viz id to its URL through the viz server, raises the target once (<code>--no-raise</code> skips it) and starts a detached <code>_host</code> child of the same binary. The CLI waits until the page is up, then prints the id and the log path.",
  },
  {
    t: "THE PANEL",
    rows: [
      ["NSPanel, borderless, non-activating", "Host.swift", "ok"],
      ["WKWebView, transparent", "one display", "ok"],
      ["bridge.js injected first", "window.overlay", "ok"],
    ],
    lede: "The host opens a transparent panel above every window on the display holding the target, and loads the page in a <code>WKWebView</code>. <code>helper/bridge.js</code> runs before the page's own scripts, so <code>window.overlay</code> (track, elements, send, close, on) already exists when the page starts. The host draws the ✕ pill itself.",
  },
  {
    t: "FIND THE TARGET",
    rows: [
      ["app → window (CGWindowID)", "System.swift", "ok"],
      ["element: label, exact › prefix › substring", "background walk", "ok"],
      ["--web: only below AXWebArea", "skips toolbars", "mid"],
    ],
    lede: "<code>Tracker.swift</code> finds the app by name or bundle id, its window by <code>CGWindowID</code>, and the element by an Accessibility walk on a background queue, stopping at the first exact visible match. The <code>AXUIElement</code> is cached, so later ticks re-read only that one element.",
  },
  {
    t: "FOLLOW IT",
    rows: [
      ["follow loop", "4× a second", "ok"],
      ["another app's window over the centre", "covered", "mid"],
      ["window, element or app gone", "keeps looking", "mid"],
    ],
    lede: "Four times a second the host re-reads the target's rect and checks whether another app's window covers its centre. A changed state is pushed to the page (<code>on(\"target\")</code>), and <code>Rule.decide</code> in <code>Logic.swift</code> shows or hides the panel by its <code>--when</code> rule. The reason goes to the log.",
  },
  {
    t: "CLICKS",
    rows: [
      ["pointer over [data-overlay-hit]", "panel takes the click", "ok"],
      ["pointer anywhere else", "falls through", "ok"],
      ["your app", "stays frontmost", "ok"],
    ],
    lede: "Sixty times a second the host checks whether the pointer is over one of the page's <code>[data-overlay-hit]</code> boxes and toggles <code>ignoresMouseEvents</code> to match. The panel never activates, so a click on the tour's Next button leaves the app below in front.",
  },
  {
    t: "MESSAGE BACK",
    rows: [
      ["overlay.send(text)", "postMessage → host", "ok"],
      ["herdr agent prompt <pane>", "[viz-overlay · title] text", "ok"],
      ["no herdr pane", "log only", "mid"],
    ],
    lede: "<code>overlay.send</code> reaches the host, which types <code>[viz-overlay · &lt;title&gt;] &lt;text&gt;</code> into the session's herdr pane and logs it to <code>~/.agents/state/viz-overlay/logs/&lt;id&gt;.jsonl</code>. The agent reads it as page content, not as an instruction from you.",
  },
  {
    t: "THE END",
    rows: [
      ["the ✕, overlay.close(), viz-overlay stop", "closed", "ok"],
      ["the agent process exits (CLAUDE_PID)", "closed", "ok"],
      ["--duration SECONDS", "closed", "ok"],
    ],
    lede: "The overlay lives as long as the agent session that started it, and no longer. The registry entry in <code>$TMPDIR/viz-overlay/&lt;pid&gt;.json</code> goes, and the log ends with a <code>closed</code> event saying what ended it.",
  },
];

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");
const color = { ok: "var(--good)", bad: "var(--danger)", mid: "var(--warn)" };
const mark = { ok: "✓", bad: "✗", mid: "…" };
const render = (i: number): void => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k.replaceAll("<", "&lt;")}</span>
        <span style="color:${color[st]};white-space:nowrap">${mark[st]} ${v.replaceAll("<", "&lt;")}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};
const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "step" });
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
