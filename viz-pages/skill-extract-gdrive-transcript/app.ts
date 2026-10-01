import { stepper, $ } from "/_kit/viz.js";

type Row = [k: string, v: string, st: "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "NAVIGATE, PLAY, PAUSE",
    rows: [["drive.google.com/file/d/…/view", "loaded", "ok"], ["click play, wait 3–5s, pause", "panel populates", "ok"],
           ["login / access denied", "full stop", "bad"]],
    lede: "The Transcript bar often isn't there, or is there and empty, until playback has started. Playing then pausing is the cheapest way to make the panel real." },
  { t: "CHECK THE BUTTON'S STATE",
    rows: [["find('Transcript')", "matches even when disabled", "bad"], ["left_click", "lands even when disabled", "bad"],
           ["t.disabled", "the truth", "ok"], ["aria-disabled", "the other truth", "ok"]],
    lede: "The trap. A recording without captions still renders the bar, so <b>the click succeeds and nothing opens</b> — an agent that trusts it retries forever. Read the property, before clicking." },
  { t: "OPEN THE PANEL",
    rows: [["click the 'Transcript' text", "panel on the right", "ok"], ["still closed", "try the chevron", "ok"],
           ["still closed", "play longer, retry", "ok"], ["no bar at all", "no captions", "bad"]],
    lede: "Screenshot to confirm. The panel is a right-hand drawer of timestamped entries with speaker names — the thing this whole skill exists to read." },
  { t: "DISCOVER THE CLASSES",
    rows: [["leaf elements matching /^\\d{1,2}:\\d{2}$/", "candidates", "ok"], ["first two matches", "skipped — player clock", "bad"],
           ["parent class repeats", "that's ENTRY_CLASS", "ok"], ["hardcoded selectors", "never", "ok"]],
    lede: "Google's class names are obfuscated and rotate. Discovery runs <b>every time</b> — nothing is cached, because a remembered selector is a skill that breaks silently." },
  { t: "PARSE",
    rows: [["/^\\(([^)]+)\\)/", "speaker captured", "ok"], ["\\([^)]+\\)\\n? stripped", "label ≠ speech", "ok"],
           ["no name on an entry", "inherit lastSpeaker", "ok"], ["cue end", "next cue's start", "ok"]],
    lede: "The speaker name repeats inside the block because it is a <b>label</b>, not something that was said. Captured once, removed everywhere, re-emitted as a <code>&lt;v&gt;</code> tag." },
  { t: "DOWNLOAD VIA BLOB",
    rows: [["JS return value", "truncated on long text", "bad"], ["Blob + objectURL + <a download>", "whole file", "ok"],
           ["filename", "slug of document.title", "ok"], ["URL.revokeObjectURL", "immediately", "ok"]],
    lede: "The file comes out of the <b>browser</b>, not the tool. Returning a long transcript as a JS value truncates it; the Blob route has no size limit and returns only a receipt." },
  { t: "REPORT",
    rows: [["entries extracted", "counted", "ok"], ["distinct speakers", "listed", "ok"],
           ["time range", "first → last", "ok"], ["file location", "~/Downloads", "ok"]],
    lede: "The receipt is what proves the extraction was complete — a short transcript from a long meeting means the panel lazy-loaded and needs scrolling before a re-extract." },
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

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "flow" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
