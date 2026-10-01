import { stepper, $ } from "/_kit/viz.js";

type Row = [k: string, v: string, st: "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "0 · SAY SOMETHING FIRST",
    rows: [["one line in chat", "before arming", "ok"], ["red overlay incoming", "user warned", "ok"],
           ["skipping it", "\"was I supposed to click that?\"", "bad"]],
    lede: "A verbatim user report is why this is step zero. A giant red panel is about to eat their screen and <b>the agent</b> clicks it — they need to know they can ignore it." },
  { t: "1 · INJECT THE RECORDER",
    rows: [["assets/mcp-recorder.js", "→ window.__cap", "ok"], ["ui-narration (optional here)", "→ window.__narrate", "ok"],
           ["per tab", "dies with the tab", "ok"]],
    lede: "Nothing is installed. The kit is text handed to <code>javascript_tool</code>, living in the page — which is also why the skill keeps no state between runs." },
  { t: "2 · ARM A FULL-VIEWPORT TARGET",
    rows: [["position:fixed; inset:0", "whole viewport", "ok"], ["z-index 2147483647", "top of the stack", "ok"],
           ["host: dialog[open] / [role=dialog]", "or body", "ok"], ["appended to body under a dialog", "click lands on the dialog", "bad"]],
    lede: "Full-viewport because screenshot coordinates drift between calls. Hosted inside an open dialog because the <b>top layer</b> paints above every z-index there is." },
  { t: "3 · RAISE CHROME",
    rows: [["osascript: select the tab", "index 1", "ok"], ["System Events: frontmost", "true", "ok"],
           ["occluded by another app", "= hidden = rejection", "bad"], ["InvalidStateError", "means exactly this", "bad"]],
    lede: "The one constraint, and it has nothing to do with headlessness: macOS marks a page <code>hidden</code> when another app covers the window, and <code>getDisplayMedia</code> refuses a hidden tab." },
  { t: "4 · SCREENSHOT, THEN CLICK",
    rows: [["screenshot dims", "1456×840, then 1502×818", "bad"], ["a stale scale factor", "silently misses", "bad"],
           ["screenshot immediately before", "use those coords", "ok"], ["MCP computer clicks", "trusted", "ok"]],
    lede: "The trusted click is the gesture <code>getDisplayMedia</code> requires, and it has about five seconds of activation. Screenshot dimensions move between calls — never reuse a factor." },
  { t: "5 · RECORD",
    rows: [["preferCurrentTab: true", "no picker at all", "ok"], ["vp9, 8 Mb/s, 30fps", "MediaRecorder", "ok"],
           ["start(250)", "chunk every 250ms", "ok"], ["arm target", "removed before frame 1", "ok"]],
    lede: "The page records itself. <code>preferCurrentTab</code> is the flag that makes this humane — no chooser dialog, so no human has to pick a surface." },
  { t: "6 · PARK THE POINTER",
    rows: [["system cursor", "in every frame", "bad"], ["park() → coords", "bottom-right dot", "ok"],
           ["click them", "pointer out of frame", "ok"], ["gate on cap.parked", "not just RECORDING", "ok"]],
    lede: "There is no API to hide the OS pointer, so it gets moved somewhere harmless. Parking costs seconds — beats that start before it are beats with a mouse wandering through them." },
  { t: "7 · STOP AND DOWNLOAD",
    rows: [["chunks → Blob", "video/webm", "ok"], ["<a download> click", "genuine browser download", "ok"],
           ["~/Downloads/<filename>", "landed", "ok"], ["computer save_to_disk", "stills only, not video", "bad"]],
    lede: "A real <code>&lt;a download&gt;</code> click, because the tool flag that looks like it should do this only saves screenshots. A <code>.vtt</code> lands beside it if the flow narrated." },
  { t: "8 · PROVE THE FILE IS REAL",
    rows: [["ffprobe -count_frames", "hundreds = real", "ok"], ["-pix_fmt yuv420p", "or QuickTime won't open it", "ok"],
           ["even dimensions", "required", "ok"], ["frame-index extraction", "VFR — seek by time", "bad"]],
    lede: "The last silent failure: a webm that exists, has the right size, and contains three frames. Count them, then convert — <code>yuv420p</code> and even dimensions are not polish." },
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "take" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
