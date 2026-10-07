import { arrowMarkers, connect, labelBox, side, stepper, vizAudit, $ } from "@viz/kit";

interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ─────────────────────────── 1. the gates ─────────────────────────── */
// Five boxes in a row, defined once; every edge is derived from them.
const GATE_Y = 14;
const BW = 132;
const BH = 80;
const gx = (i: number): number => 10 + i * 162;
const gates: Node[] = [0, 1, 2, 3, 4].map((i) => ({ x: gx(i), y: GATE_Y, w: BW, h: BH }));
const exits: (Node | null)[] = [0, 1, 2, 3, 4].map((i) =>
  i === 3 ? null : { x: gx(i), y: 162, w: BW, h: i === 4 ? 66 : 112 },
);

const gateText: [string, string][] = [
  ["L11 · TRIGGER", "A direct command from the user?"],
  ["L13 · STEP 1", "Is the wording unambiguous?"],
  ["L14 · STEP 2", "Inside herdr? <code>$HERDR_PANE_ID</code> set"],
  ["L15 · STEP 3", "One-line goodbye, naming what is unfinished"],
  ["L16-19 · STEP 4", "Detached timer, then close the pane"],
];
const exitText: ([string, string, string] | null)[] = [
  [
    "NO · STAYS OPEN",
    "var(--danger)",
    "A finished task, thanks, bye: nothing happens. The skill is never entered.",
  ],
  ["NO · ASK ONCE", "var(--c5)", "Looks like “and the session”? One line, then wait."],
  [
    "NO · STAYS OPEN",
    "var(--danger)",
    "Say so, tell the user to type <code>/exit</code>, and stop.",
  ],
  null,
  ["GONE · +3 s", "var(--good)", "The session ends."],
];

const gatesSvg = document.querySelector<SVGSVGElement>("#gates")!;
let g = arrowMarkers();
gates.forEach((n, i) => {
  g += `<g data-viz-id="gate-${i}" data-label="gate ${i}: ${gateText[i]![1].replaceAll(/<[^>]+>/gu, "")}">
    <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="var(--panel)" stroke="${i === 4 ? "var(--accent)" : "var(--border)"}" stroke-width="${i === 4 ? 1.6 : 1}"/>
    ${labelBox(n, `<div class="nd"><b>${gateText[i]![0]}</b>${gateText[i]![1]}</div>`)}
  </g>`;
  const next = gates[i + 1];
  if (next) {
    const a = side(n, "right");
    g += `<path d="${connect(n, next)}" stroke="var(--accent)" stroke-width="1.6" fill="none" marker-end="url(#ah-accent)"/>
      <text x="${a.x + 15}" y="${a.y - 8}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--faint)">yes</text>`;
  }
});
exits.forEach((n, i) => {
  const t = exitText[i];
  if (!n || !t) return;
  const from = side(gates[i]!, "bottom");
  const col = t[1];
  const last = i === 4;
  g += `<g data-viz-id="exit-${i}" data-label="exit from gate ${i}">
    <path d="M ${from.x} ${from.y} L ${from.x} ${n.y}" stroke="${col}" stroke-width="1.4" ${last ? "" : 'stroke-dasharray="4 4"'} fill="none" marker-end="url(#${last ? "ah-good" : "ah-danger"})"/>
    <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="color-mix(in srgb, ${col} 8%, transparent)" stroke="color-mix(in srgb, ${col} 45%, transparent)"/>
    ${labelBox({ x: n.x + 2, y: n.y, w: n.w - 4, h: n.h }, `<div class="ex"><b style="color:${col}">${t[0]}</b>${t[2]}</div>`)}
  </g>`;
});
// the goodbye is special: show the one rule that gives it its place
const gb = gates[3]!;
g += `<g data-viz-id="goodbye-note" data-label="the goodbye is the last text written">
  <rect x="${gb.x}" y="162" width="${gb.w}" height="66" rx="10" fill="none" stroke="var(--border)" stroke-dasharray="3 4"/>
  ${labelBox({ x: gb.x + 2, y: 162, w: gb.w - 4, h: 66 }, `<div class="ex"><b style="color:var(--accent)">LAST WORDS</b>“This is the last text you write.”</div>`)}
</g>
<text x="${gb.x + gb.w / 2}" y="292" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--faint)">no exit: a goodbye is always sayable</text>`;
gatesSvg.innerHTML = g;

/* ─────────────────────────── 2. the timeline ─────────────────────────── */
// t = 0 sits at x0; one second is PX pixels. The zone left of x0 is ordered, not timed.
const X0 = 300;
const PX = 130;
const tx = (s: number): number => X0 + s * PX;
const LANE = { agent: 56, sh: 140, pane: 224 };
const LH = 44;

interface El {
  id: string;
  at: number; // first step where it is drawn
  cur: number[]; // steps where it is the focus
  svg: string;
  label: string;
}

const goodbye: Node = { x: 150, y: LANE.agent, w: 76, h: LH };
const bash: Node = { x: 232, y: LANE.agent, w: 62, h: LH };
const sleepBar: Node = { x: X0, y: LANE.sh, w: 3 * PX, h: LH };
const closeBlk: Node = { x: tx(3) + 6, y: LANE.sh - 4, w: 70, h: LH + 8 };
const paneBar: Node = { x: 150, y: LANE.pane, w: tx(3) - 150, h: LH };
const idle: Node = { x: X0 + 6, y: LANE.agent + 6, w: 3 * PX - 6, h: LH - 12 };

const els: El[] = [
  {
    id: "pane-bar",
    at: 0,
    cur: [3],
    label: "the pane, alive from start to close",
    svg: `<rect x="${paneBar.x}" y="${paneBar.y}" width="${paneBar.w}" height="${paneBar.h}" rx="8" fill="color-mix(in srgb, var(--good) 14%, transparent)" stroke="var(--good)"/>
      ${labelBox(paneBar, `<div class="nd"><b style="color:var(--good)">THE PANE</b>agent, tool shell and the timer all live inside it</div>`)}`,
  },
  {
    id: "goodbye",
    at: 0,
    cur: [0],
    label: "the goodbye line",
    svg: `<rect x="${goodbye.x}" y="${goodbye.y}" width="${goodbye.w}" height="${goodbye.h}" rx="8" fill="var(--panel)" stroke="var(--accent)"/>
      ${labelBox(goodbye, `<div class="nd"><b>STEP 3</b>goodbye</div>`)}`,
  },
  {
    id: "bash",
    at: 1,
    cur: [1],
    label: "the Bash call that starts the timer",
    svg: `<rect x="${bash.x}" y="${bash.y}" width="${bash.w}" height="${bash.h}" rx="8" fill="var(--panel)" stroke="var(--accent)"/>
      ${labelBox(bash, `<div class="nd"><b>STEP 4</b>Bash</div>`)}
      <path d="M ${bash.x + bash.w / 2} ${bash.y + bash.h} L ${bash.x + bash.w / 2} ${LANE.sh + LH / 2} L ${X0} ${LANE.sh + LH / 2}" fill="none" stroke="var(--accent)" stroke-width="1.6" marker-end="url(#ah-accent)"/>
      <g><text x="${bash.x + bash.w / 2 + 6}" y="${LANE.sh - 6}" font-family="var(--mono)" font-size="10" fill="var(--faint)">forks, returns</text></g>`,
  },
  {
    id: "zero",
    at: 1,
    cur: [1],
    label: "t = 0: the tool call has returned",
    svg: `<line x1="${X0}" y1="34" x2="${X0}" y2="270" stroke="var(--muted)" stroke-dasharray="2 4"/>
      <text x="${X0}" y="26" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--muted)">t = 0</text>
      <text x="215" y="26" text-anchor="middle" font-family="var(--mono)" font-size="10.5" fill="var(--faint)">ordered, not timed</text>`,
  },
  {
    id: "sleep",
    at: 1,
    cur: [2],
    label: "sleep 3 in the detached shell",
    svg: `<rect x="${sleepBar.x}" y="${sleepBar.y}" width="${sleepBar.w}" height="${sleepBar.h}" rx="8" fill="color-mix(in srgb, var(--accent) 14%, transparent)" stroke="var(--accent)"/>
      ${labelBox(sleepBar, `<div class="nd"><b>DETACHED SH</b><code>nohup sh -c 'sleep 3; …'</code></div>`)}`,
  },
  {
    id: "idle",
    at: 2,
    cur: [2],
    label: "the agent's turn is over; the goodbye renders",
    svg: `<rect x="${idle.x}" y="${idle.y}" width="${idle.w}" height="${idle.h}" rx="6" fill="none" stroke="var(--faint)" stroke-dasharray="4 4"/>
      ${labelBox(idle, `<div class="nd" style="color:var(--muted)">turn over, nothing sent · the goodbye renders</div>`)}`,
  },
  {
    id: "cut",
    at: 3,
    cur: [3, 4],
    label: "t = 3 s: herdr pane close",
    svg: `<rect x="${closeBlk.x}" y="${closeBlk.y}" width="${closeBlk.w}" height="${closeBlk.h}" rx="8" fill="color-mix(in srgb, var(--danger) 16%, transparent)" stroke="var(--danger)"/>
      ${labelBox(closeBlk, `<div class="nd"><b style="color:var(--danger)">CLOSE</b>pane close</div>`)}
      <line x1="${tx(3)}" y1="34" x2="${tx(3)}" y2="${LANE.pane + LH + 12}" stroke="var(--danger)" stroke-width="2"/>
      <g><text x="${tx(3)}" y="26" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--danger)">t = 3 s</text></g>`,
  },
  {
    id: "after",
    at: 4,
    cur: [4],
    label: "after the close: nothing",
    svg: `<rect x="${tx(3) + 8}" y="${LANE.pane}" width="${800 - tx(3) - 12}" height="${LH}" rx="8" fill="none" stroke="var(--faint)" stroke-dasharray="3 4"/>
      ${labelBox({ x: tx(3) + 8, y: LANE.pane, w: 800 - tx(3) - 12, h: LH }, `<div class="nd" style="color:var(--faint)">nothing left</div>`)}`,
  },
];

const lanes: [string, number][] = [
  ["AGENT TURN", LANE.agent],
  ["DETACHED SHELL", LANE.sh],
  ["THE PANE", LANE.pane],
];
let t = arrowMarkers();
for (const [name, y] of lanes)
  t += `<text x="6" y="${y + LH / 2 + 4}" font-family="var(--mono)" font-size="10.5" letter-spacing="1" fill="var(--muted)">${name}</text>
    <line x1="146" y1="${y + LH + 14}" x2="796" y2="${y + LH + 14}" stroke="var(--border)" stroke-width="0.6"/>`;
// time axis, in seconds
t += `<g data-viz-id="axis" data-label="time axis in seconds">`;
for (let s = 0; s <= 3; s++)
  t += `<line x1="${tx(s)}" y1="276" x2="${tx(s)}" y2="282" stroke="var(--faint)"/><text x="${tx(s)}" y="294" text-anchor="middle" font-family="var(--mono)" font-size="10.5" fill="var(--faint)">${s} s</text>`;
t += `</g>`;
for (const e of els)
  t += `<g class="el" id="el-${e.id}" data-viz-id="${e.id}" data-label="${e.label}">${e.svg}</g>`;
const timeSvg = document.querySelector<SVGSVGElement>("#time")!;
timeSvg.innerHTML = t;

const ledes: string[] = [
  "<b>t = 0, nothing closed yet.</b> The goodbye is ordinary text, written into a pane that is still alive. The file makes it <b>the last text the model writes</b> and has it name whatever is unfinished (uncommitted work, a background task, an unanswered question), because once the pane is gone nobody is left to say it.",
  '<b>The command.</b> One Bash call starts <code>nohup sh -c \'sleep 3; herdr pane close "$0"\' "$HERDR_PANE_ID" …&amp;</code>. A new shell now exists, separate from the agent\'s turn, and it carries the pane id as <code>$0</code>. The call itself only started something, so it returns at once.',
  "<b>The turn ends; the timer does not.</b> With nothing left to do and nothing to send (“send nothing after the command”), the turn is over. The goodbye renders on a pane that is still there. That is all the three seconds are for.",
  "<b>t = 3 s.</b> The detached shell runs <code>herdr pane close</code> with the id it was handed. The pane goes and takes everything in it: the agent, the tool shell, and this very process, whose last act removes its own floor.",
  "<b>After.</b> No lane continues past the cut. The skill's final instruction, “Send nothing after the command”, is the same fact seen from the model's side: anything it wrote now would race the shutdown and have no reader.",
];

const lede = $("#lede")!;
const pos = $("#pos")!;
const render = (i: number): void => {
  for (const e of els) {
    const node = $(`#el-${e.id}`)!;
    node.classList.toggle("on", i >= e.at);
    node.classList.toggle("cur", e.cur.includes(i));
  }
  lede.innerHTML = ledes[i]!;
  pos.textContent = `${i + 1} / ${ledes.length}`;
};
const st = stepper({ n: ledes.length, onStep: render, autoplayMs: 3600, hashKey: "time" });
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

vizAudit();
