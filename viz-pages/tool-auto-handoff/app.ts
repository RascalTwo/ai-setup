import { stepper, $, arrowMarkers, labelBox, esc } from "@viz/kit";

/* ── figure 1: one automatic handoff, as a swimlane you step through ─────────────
   Lane order is chosen so the arrows that matter are short: herdr sits between the
   injector and the session it types into, and the Stop hook sits between the state
   files and the session that triggers it. */

interface Lane {
  id: string;
  name: string;
  sub: string;
  cx: number;
}
const LANE_NAMES: [string, string, string][] = [
  ["files", "files", "state + the doc"],
  ["stop", "Stop hook", "auto-handoff stop"],
  ["claude", "Claude session", "the agent's turn"],
  ["herdr", "herdr", "types into the pane"],
  ["inj", "injector", "detached inject"],
];
const LANE_X0 = 90;
const LANE_DX = 155;
const lanes: Record<string, Lane> = Object.fromEntries(
  LANE_NAMES.map(([id, name, sub], i) => [id, { id, name, sub, cx: LANE_X0 + i * LANE_DX }]),
);

interface Msg {
  step: number;
  from: string;
  to: string;
  text: string;
  keys?: boolean; // keystrokes into the session's prompt box rather than a call
}
const M: Msg[] = [
  { step: 0, from: "claude", to: "stop", text: "Stop payload" },
  { step: 1, from: "stop", to: "files", text: "phase = writing" },
  { step: 1, from: "stop", to: "claude", text: "block + reason" },
  { step: 2, from: "claude", to: "files", text: "write handoff.md" },
  { step: 3, from: "claude", to: "stop", text: "Stop, second visit" },
  { step: 3, from: "stop", to: "files", text: "phase = injecting" },
  { step: 3, from: "stop", to: "inj", text: "Popen(inject, new session)" },
  { step: 4, from: "inj", to: "herdr", text: "wait idle · poll ❯" },
  { step: 5, from: "inj", to: "herdr", text: "prompt /clear" },
  { step: 5, from: "herdr", to: "claude", text: "/clear", keys: true },
  { step: 6, from: "inj", to: "herdr", text: "prompt /model, /effort" },
  { step: 6, from: "herdr", to: "claude", text: "/model · /effort", keys: true },
  { step: 7, from: "inj", to: "herdr", text: "prompt read … continue" },
  { step: 7, from: "herdr", to: "claude", text: "read … and continue", keys: true },
  { step: 7, from: "inj", to: "files", text: "phase cleared" },
];

const ROW0 = 98;
const ROW_DY = 34;
const H = ROW0 + M.length * ROW_DY + 4;
const W = LANE_X0 * 2 + LANE_DX * (LANE_NAMES.length - 1) - 20;

interface Step {
  t: string;
  lede: string;
  files: string;
}
const S: Step[] = [
  {
    t: "THE TURN ENDS",
    files: "<code>&lt;pane&gt;.json</code> <b>none yet</b>",
    lede: "Claude Code runs <code>auto-handoff stop</code> with a JSON payload on stdin: <code>transcript_path</code>, <code>stop_hook_active</code>, <code>background_tasks</code>. <code>stop()</code> returns at once unless <code>$HERDR_PANE_ID</code> is set and the pane is not switched off. <code>scan()</code> then sums the last main-chain reply's input, cache-read and cache-creation tokens: <b>253k</b>. <code>running()</code> is empty. 253k ≥ 250k.",
  },
  {
    t: "BLOCK ONCE",
    files: "<code>&lt;pane&gt;.json</code> <b>phase: writing</b> · path · t · enter: true",
    lede: 'State is saved <em>first</em>, then line 136 prints <code>{"decision": "block", "reason": …}</code>. A blocked Stop is not a stop: the reason goes back to the model as its next instruction, <b>AUTO HANDOFF (context at 253k). Do not start new work</b>, naming a fresh temp path and the <code>Auto</code> section of r2-handoff.',
  },
  {
    t: "THE MODEL WRITES THE DOC",
    files:
      "<code>&lt;pane&gt;.json</code> writing · <b>handoff-auto-…-&lt;epoch&gt;.md</b> written",
    lede: "No questions allowed. It writes the default handoff to <em>that</em> path: the lineage line, then <code>Topic:</code> and <code>Next session:</code>, then the nine template sections, with every background task that outlives <code>/clear</code> listed in section 3. Its last reply is only the path.",
  },
  {
    t: "THE SECOND VISIT",
    files: "<code>&lt;pane&gt;.json</code> <b>phase: injecting</b> · doc mtime ≥ t",
    lede: "Ending that turn fires Stop again. Phase is <code>writing</code>, the file exists and its mtime is ≥ <code>t</code> (line 122), so the phase becomes <code>injecting</code> and lines 124–126 launch <code>auto-handoff inject PANE PATH 1 &lt;model&gt; &lt;effort&gt;</code> with <code>start_new_session=True</code>. The model and effort are read <em>now</em>, from the old transcript, as the baseline for later. The hook returns and the turn ends normally.",
  },
  {
    t: "WAIT FOR AN EMPTY BOX",
    files: "<code>&lt;pane&gt;.json</code> injecting · <b>polling the prompt box</b>",
    lede: "The injector first waits for herdr to report the agent idle or done (line 199, 300 s cap), sleeps a second, then calls <code>draft_empty()</code> every 2 s, up to 900 times. Anything in the box means someone is mid-sentence, so it keeps waiting, and after 30 minutes it returns having touched nothing.",
  },
  {
    t: "/CLEAR",
    files: "<code>&lt;pane&gt;.json</code> injecting · <b>session cleared</b>",
    lede: "<code>herdr agent prompt &lt;pane&gt; /clear</code> (line 209), then <code>CLEAR_WAIT = 4</code> seconds to settle (line 210). If the continue prompt ever gets eaten, this constant is the knob the README says to raise.",
  },
  {
    t: "MODEL AND EFFORT, FREE",
    files: "<code>&lt;pane&gt;.json</code> injecting · <b>cache already gone</b>",
    lede: "<code>next_session()</code> reads the doc's <code>Next session:</code> line; <code>upgrade()</code> keeps it only if it ranks <em>above</em> the session's current setting. The cache was emptied one step ago, so the switch costs nothing extra. A lower, equal, unknown or missing value types nothing.",
  },
  {
    t: "CONTINUE, THEN FORGET",
    files: "<code>&lt;pane&gt;.json</code> <b>removed</b> · the doc stays in the temp dir",
    lede: "<code>read &lt;path&gt; and continue</code> goes in with Enter (line 220). On the idle path it is typed with <code>pane send-text</code> and <em>not</em> sent, behind a note naming the session's <code>Topic:</code>. The <code>finally</code> on line 226 runs <code>save(pane, {})</code>, which deletes the file: the pane is eligible for its next handoff.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;

const FONT = `font-family="var(--mono)" font-size="11"`;
const laneBoxes = Object.values(lanes).map((l) => ({
  l,
  node: { x: l.cx - 68, y: 6, w: 136, h: 46 },
}));
const static_ =
  `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="swimlane of one automatic handoff">` +
  arrowMarkers({ "ah-hi": "var(--warn)", "ah-seen": "var(--muted)", "ah-key": "var(--c4)" }) +
  laneBoxes
    .map(
      ({ l, node }) =>
        `<g data-viz-id="lane-${l.id}" data-label="lane: ${esc(l.name)}">` +
        `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="9" fill="var(--panel)" stroke="var(--border)"/>` +
        labelBox(
          node,
          `<div><b style="color:#fff">${esc(l.name)}</b><br><span style="font:10.5px var(--mono);color:var(--muted)">${l.sub}</span></div>`,
        ) +
        `<line x1="${l.cx}" y1="${node.y + node.h}" x2="${l.cx}" y2="${H - 4}" stroke="var(--border)" stroke-dasharray="3 5"/></g>`,
    )
    .join("");

const arrows = (cur: number): string =>
  M.map((m, i) => {
    const a = lanes[m.from]!,
      b = lanes[m.to]!;
    const y = ROW0 + i * ROW_DY;
    const dir = b.cx > a.cx ? 1 : -1;
    const x1 = a.cx + dir * 4,
      x2 = b.cx - dir * 4;
    const state = m.step === cur ? "hi" : m.step < cur ? "seen" : "future";
    const col =
      state === "hi"
        ? m.keys
          ? "var(--c4)"
          : "var(--warn)"
        : state === "seen"
          ? "var(--muted)"
          : "var(--muted)";
    const mk = state === "hi" ? (m.keys ? "ah-key" : "ah-hi") : "ah-seen";
    const op = state === "future" ? 0.55 : state === "seen" ? 0.85 : 1;
    const sw = state === "hi" ? 2.4 : 1.4;
    const mid = (x1 + x2) / 2;
    return (
      `<g data-viz-id="msg-${i}" data-label="${esc(`${m.from} → ${m.to}: ${m.text}`)}" opacity="${op}">` +
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${col}" stroke-width="${sw}"${m.keys ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#${mk})"/>` +
      `<text x="${mid}" y="${y - 7}" text-anchor="middle" ${FONT} fill="${state === "hi" ? "var(--text)" : col}">${esc(m.text)}</text>` +
      `</g>`
    );
  }).join("");

const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    static_ +
    arrows(i) +
    `</svg><div class="files"><span>${i + 1} · ${s.t}</span><span>on disk:</span>${s.files}</div>`;
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 4200, hashKey: "flow" });
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

/* ── figure 2: why 250k — bands within 1% of the best threshold, five replays ───── */

interface Row {
  label: string;
  lo: number;
  hi: number;
  best: number;
  atBest: string;
  at250: string;
}
const ROWS: Row[] = [
  {
    label: "all sessions, actual models",
    lo: 190,
    hi: 260,
    best: 250,
    atBest: "−15.4%",
    at250: "−15.4%",
  },
  {
    label: "all, at Opus 5.5 prices",
    lo: 210,
    hi: 260,
    best: 250,
    atBest: "−13.8%",
    at250: "−13.8%",
  },
  {
    label: "all, at Sonnet 5.5 / Haiku 4.5 prices",
    lo: 160,
    hi: 250,
    best: 210,
    atBest: "−20.3%",
    at250: "−20.0%",
  },
  {
    label: "Opus 5.5 sessions, own prices",
    lo: 190,
    hi: 260,
    best: 250,
    atBest: "−14.9%",
    at250: "−14.9%",
  },
  {
    label: "Sonnet 5.5 sessions, own prices",
    lo: 170,
    hi: 260,
    best: 250,
    atBest: "−16.6%",
    at250: "−16.6%",
  },
];
const K0 = 140,
  K1 = 280,
  PX0 = 262,
  PX1 = 566;
const x = (k: number) => PX0 + ((k - K0) / (K1 - K0)) * (PX1 - PX0);
const BW = 800;
const bandsSvg = $("#bands")!;
const rowY = (i: number) => 62 + i * 38;
bandsSvg.setAttribute("viewBox", `0 0 ${BW} 292`);
bandsSvg.innerHTML =
  [150, 200, 250]
    .map(
      (k) =>
        `<line x1="${x(k)}" y1="36" x2="${x(k)}" y2="254" stroke="var(--border)"/><text x="${x(k)}" y="28" text-anchor="middle" ${FONT} fill="var(--faint)">${k}k</text>`,
    )
    .join("") +
  `<line x1="${x(250)}" y1="36" x2="${x(250)}" y2="254" stroke="var(--warn)" stroke-width="1.6" stroke-dasharray="6 4"/>` +
  `<text x="${PX1 + 18}" y="28" ${FONT} fill="var(--faint)">saving at 250k</text>` +
  ROWS.map((r, i) => {
    const y = rowY(i);
    return (
      `<g data-viz-id="band-${i}" data-label="${esc(r.label)}: within 1% of best from ${r.lo}k to ${r.hi}k, best ${r.best}k">` +
      `<text x="0" y="${y + 4}" font-family="var(--sans)" font-size="12.5" fill="var(--text)">${esc(r.label)}</text>` +
      `<rect x="${x(r.lo)}" y="${y - 8}" width="${x(r.hi) - x(r.lo)}" height="16" rx="4" fill="color-mix(in srgb, var(--c4) 40%, transparent)" stroke="var(--c4)"/>` +
      `<circle cx="${x(r.best)}" cy="${y}" r="5.5" fill="var(--warn)" stroke="#0b0f16" stroke-width="1.5"/>` +
      `<text x="${PX1 + 18}" y="${y + 4}" ${FONT} fill="${r.best === 250 ? "var(--text)" : "var(--warn)"}">${r.at250}${r.best !== 250 ? ` (best ${r.best}k: ${r.atBest})` : ""}</text>` +
      `</g>`
    );
  }).join("") +
  `<text x="${PX0}" y="282" ${FONT} fill="var(--faint)">bar: thresholds within 1% of the best · dot: the best · dashed: 250k</text>`;
