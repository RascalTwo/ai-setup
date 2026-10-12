import { arrowMarkers, connect, labelBox, stepper, vizAudit, $ } from "@viz/kit";

interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Figure 1: the same ten rows, one document or split ──────────────────────
type Doc = "S" | "A" | "B";
interface Item {
  k: string;
  t: string;
  plain: number; // row slot in the single document
  doc: Doc; // which document it lands in when split
  slot: number; // row slot there
  slice: boolean; // describes a slice of the remaining work
  copy?: boolean; // a duplicate that only exists once split
}
const ITEMS: Item[] = [
  { k: "·", t: "Lineage line", plain: 0, doc: "S", slot: 0, slice: false },
  { k: "1", t: "Goal", plain: 1, doc: "S", slot: 1, slice: false },
  { k: "2", t: "Timeline", plain: 2, doc: "S", slot: 2, slice: false },
  { k: "3", t: "State at the end", plain: 3, doc: "A", slot: 1, slice: true },
  { k: "4", t: "Files · repos · commands", plain: 4, doc: "A", slot: 2, slice: true },
  { k: "5", t: "Decisions · open questions", plain: 5, doc: "S", slot: 3, slice: false },
  { k: "6", t: "Dead ends · retractions", plain: 6, doc: "S", slot: 4, slice: false },
  { k: "7", t: "Preferences · constraints", plain: 7, doc: "S", slot: 5, slice: false },
  { k: "8", t: "Next steps", plain: 8, doc: "A", slot: 3, slice: true },
  { k: "9", t: "Gotchas", plain: 9, doc: "S", slot: 6, slice: false },
  { k: "+", t: "Suggested skills", plain: 10, doc: "A", slot: 4, slice: true },
  { k: "·", t: "Lineage line", plain: 0, doc: "A", slot: 0, slice: false, copy: true },
  { k: "·", t: "Lineage line", plain: 0, doc: "B", slot: 0, slice: false, copy: true },
  { k: "3", t: "State at the end", plain: 3, doc: "B", slot: 1, slice: true, copy: true },
  { k: "4", t: "Files · repos · commands", plain: 4, doc: "B", slot: 2, slice: true, copy: true },
  { k: "8", t: "Next steps", plain: 8, doc: "B", slot: 3, slice: true, copy: true },
  { k: "+", t: "Suggested skills", plain: 10, doc: "B", slot: 4, slice: true, copy: true },
];
const RW = 226,
  RH = 24;
const rowY = (slot: number): number => 40 + slot * 28;
const DOCX: Record<Doc, number> = { S: 12, A: 271, B: 523 };
const PLAINX = 267;
const SHARED = "var(--warn)",
  STREAM_A = "var(--c4)",
  STREAM_B = "var(--accent)";
const tone = (it: Item, split: boolean): string =>
  split
    ? it.doc === "S"
      ? SHARED
      : it.doc === "A"
        ? STREAM_A
        : STREAM_B
    : it.slice
      ? STREAM_A
      : SHARED;

const frame = (id: string, n: Node, color: string, title: string): string =>
  `<g class="sec" id="${id}" data-viz-id="${id}" data-label="${title}">` +
  `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="color-mix(in srgb, ${color} 6%, transparent)" stroke="color-mix(in srgb, ${color} 55%, transparent)"/>` +
  `<text x="${n.x + 12}" y="${n.y + 24}" font-family="var(--mono)" font-size="11" letter-spacing="0.04em" fill="${color}">${title}</text></g>`;

let secs = `<defs></defs>`;
secs += frame(
  "f-plain",
  { x: 250, y: 6, w: 260, h: 346 },
  "var(--warn)",
  "handoff-&lt;slug&gt;.md",
);
secs += frame("f-shared", { x: 4, y: 6, w: 246, h: 244 }, "var(--warn)", "…-shared.md");
secs += frame("f-a", { x: 262, y: 6, w: 244, h: 188 }, "var(--c4)", "…-stream-a.md");
secs += frame("f-b", { x: 514, y: 6, w: 242, h: 188 }, "var(--accent)", "…-stream-b.md");
const notes: [string, Node][] = [
  [
    `<small><b style="color:var(--warn)">Said once.</b> Goal, timeline, decisions, dead ends, preferences and gotchas are true of the whole effort, so they live here and nowhere else.</small>`,
    { x: 10, y: 258, w: 236, h: 90 },
  ],
  [
    `<small><b style="color:var(--c4)">Said per slice.</b> State, files and next steps describe one stream's work, so each stream document holds its own, plus its own suggested skills, and opens by naming the shared file as the first read.</small>`,
    { x: 266, y: 204, w: 486, h: 70 },
  ],
];
const plainNotes: [string, Node][] = [
  [
    `<small><b style="color:var(--warn)">Lineage first.</b> Every document opens with the session it came from, so a successor can walk the chain back.</small>`,
    { x: 8, y: 40, w: 234, h: 70 },
  ],
  [
    `<small><b style="color:var(--warn)">Honest marks.</b> Anything inferred says (inferred). Anything verified on disk just now says (checked now). An empty section says none.</small>`,
    { x: 518, y: 40, w: 234, h: 90 },
  ],
];
secs += `<g id="plain-notes" class="sec">`;
for (const [html, n] of plainNotes) secs += labelBox(n, html, "nd");
secs += `</g>`;
secs += `<g id="split-notes" class="sec" style="opacity:0">`;
for (const [html, n] of notes) secs += labelBox(n, html, "nd");
secs += `</g>`;
for (const [i, it] of ITEMS.entries()) {
  secs +=
    `<g class="sec" id="row${i}" data-viz-id="row-${i}" data-label="${it.k} ${it.t}${it.copy ? " (stream copy)" : ""}">` +
    `<rect width="${RW}" height="${RH}" rx="6" fill-opacity="0.11" stroke-width="1.2"/>` +
    labelBox(
      { x: 0, y: 0, w: RW, h: RH },
      `<b style="font-size:11px;min-width:12px;text-align:center">${it.k}</b><span>${it.t}</span>`,
      "nd inl",
    ) +
    `</g>`;
}
const secsEl = $("#secs")!;
secsEl.innerHTML = secs;

const setMode = (split: boolean): void => {
  for (const [i, it] of ITEMS.entries()) {
    const g = $(`#row${i}`)!;
    const x = split ? DOCX[it.doc] : PLAINX;
    const y = rowY(split ? it.slot : it.plain);
    g.style.transform = `translate(${x}px, ${y}px)`;
    g.style.opacity = !split && it.copy ? "0" : "1";
    const c = tone(it, split);
    const r = g.querySelector("rect")!;
    r.setAttribute("fill", c);
    r.setAttribute("stroke", c);
    const b = g.querySelector("b")!;
    b.style.color = c;
  }
  const show = (id: string, on: boolean): void => {
    $(`#${id}`)!.style.opacity = on ? "1" : "0";
  };
  show("f-plain", !split);
  show("plain-notes", !split);
  for (const id of ["f-shared", "f-a", "f-b", "split-notes"]) show(id, split);
  $("#seclede")!.innerHTML = split
    ? "<b>Split.</b> Six sections stay whole in the shared document. The four that describe a slice are written once per stream, and every document carries the lineage line, so any one of them can walk the chain back on its own."
    : "<b>One document.</b> The lineage line, nine sections and the suggested-skills section the first block asks for. The purple rows are the ones that describe a slice of the remaining work; the amber ones are true of the whole effort.";
  for (const [id, on] of [
    ["m-plain", !split],
    ["m-split", split],
  ] as const)
    $(`#${id}`)!.setAttribute("aria-pressed", String(on));
};
$("#m-plain")!.addEventListener("click", () => setMode(false));
$("#m-split")!.addEventListener("click", () => setMode(true));
setMode(false);

// ── Figure 2: the rescue pipeline ───────────────────────────────────────────
const SY = 64;
const stage = (i: number, w = 300): Node => ({ x: 190 - w / 2, y: 8 + i * SY, w, h: 44 });
interface Stage {
  n: Node;
  b: string;
  s: string;
  note: string;
  model?: boolean;
}
const ST: Stage[] = [
  {
    n: stage(0),
    b: "target",
    s: "tab label · tab/pane id · session id",
    note: "<b>You name it</b> any way you can: a herdr tab label (a substring works), a tab or pane id, or the session id.",
  },
  {
    n: stage(1),
    b: "resolve.py",
    s: "one session as JSON",
    note: "A session-id pattern skips herdr. Else it matches <code>herdr agent list</code>. Not Claude: refuse. 0 or 2+ matches: print candidates, stop.",
  },
  {
    n: stage(2),
    b: "transcript .jsonl",
    s: "~/.claude/projects/*/&lt;id&gt;.jsonl",
    note: "Found by glob. The session is <b>never resumed</b>, so its expired prompt cache is never rewritten.",
  },
  {
    n: stage(3),
    b: "digest.py",
    s: "",
    note: "Keeps user messages, assistant text (clipped), one line per tool call, tool errors, the last 8 turns. Drops tool results and thinking.",
  },
  {
    n: stage(4, 110),
    b: "digest.md",
    s: "~30k tokens",
    note: "The docstring's example: 8.6 MB of transcript becomes roughly 30k tokens, small enough for one agent to read whole.",
  },
  {
    n: stage(5),
    b: "subagent",
    s: "general-purpose · one file only",
    note: "Reads the digest in full; greps the transcript only for facts it leaves open, and <b>counts the lookups</b>. Read-only, one file written.",
    model: true,
  },
  {
    n: stage(6),
    b: "handoff-&lt;slug&gt;-&lt;id8&gt;.md",
    s: "in the OS temp dir",
    note: "You get back the path, a 4-line summary, the lookup count and where the digest fell short, in under 200 words.",
  },
];
let rs = arrowMarkers();
for (let i = 0; i < ST.length - 1; i++)
  rs += `<path d="${connect(ST[i]!.n, ST[i + 1]!.n)}" stroke="var(--muted)" stroke-width="1.5" fill="none" marker-end="url(#ah)"/>`;
for (const [i, st] of ST.entries()) {
  const { n } = st;
  const col = st.model ? "var(--warn)" : "var(--border)";
  if (i === 3) {
    // the funnel: 300 wide in, 90 wide out
    const d = `M ${n.x} ${n.y} L ${n.x + n.w} ${n.y} L ${n.x + n.w / 2 + 55} ${n.y + n.h} L ${n.x + n.w / 2 - 55} ${n.y + n.h} Z`;
    rs += `<g data-viz-id="stage-funnel" data-label="digest.py: the funnel from transcript to digest"><path d="${d}" fill="color-mix(in srgb, var(--good) 11%, var(--panel))" stroke="var(--good)" stroke-width="1.4" stroke-linejoin="round"/></g>`;
    rs += labelBox(
      { x: n.x + 60, y: n.y, w: 180, h: n.h },
      `<b style="color:#fff;font-size:12.5px">digest.py · no model</b>`,
      "nd",
    );
  } else {
    rs += `<g data-viz-id="stage-${i}" data-label="${st.b}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="9" fill="${st.model ? "color-mix(in srgb, var(--warn) 13%, transparent)" : "var(--panel)"}" stroke="${col}" stroke-width="1.4"/></g>`;
    rs += labelBox(n, `<b>${st.b}</b>${st.s ? `<small>${st.s}</small>` : ""}`, "nd");
  }
  rs += labelBox({ x: 372, y: n.y - 8, w: 380, h: 56 }, `<small>${st.note}</small>`, "nd");
}
rs += `<g data-viz-id="legend-model-swatch" data-label="amber swatch"><rect x="40" y="444" width="10" height="10" rx="2" fill="color-mix(in srgb, var(--warn) 40%, transparent)" stroke="var(--warn)"/></g><g data-viz-id="legend-model" data-label="amber means a model runs here"><text x="56" y="453" font-family="var(--mono)" font-size="10.5" fill="var(--muted)">a model runs here · everything else is plain code</text></g>`;
$("#rescue")!.innerHTML = rs;
vizAudit(document);

// ── Figure 3: digest.py, one rule at a time ─────────────────────────────────
type Kind = "keep" | "drop" | "err";
interface Ev {
  role: string;
  txt: string;
  rev: number;
  kind: Kind;
  out: string;
}
const EV: Ev[] = [
  {
    role: "USER",
    txt: "split the importer so the parser is its own module",
    rev: 0,
    kind: "keep",
    out: "kept · up to 1200 chars, head and tail",
  },
  {
    role: "ASSISTANT",
    txt: "I'll read the importer and its tests first, then…",
    rev: 1,
    kind: "keep",
    out: "kept · up to 450 chars",
  },
  {
    role: "TOOLS",
    txt: "Read: /repo/src/importer.py",
    rev: 2,
    kind: "keep",
    out: "one line per call · up to 110 chars",
  },
  {
    role: "tool result",
    txt: "(1,240 lines of file contents)",
    rev: 3,
    kind: "drop",
    out: "dropped",
  },
  { role: "thinking", txt: "(a reasoning block)", rev: 3, kind: "drop", out: "dropped" },
  {
    role: "tool error",
    txt: "ModuleNotFoundError: No module named 'parser'",
    rev: 4,
    kind: "err",
    out: "→ “Tool errors”, last 25, up to 240 chars",
  },
  {
    role: "USER",
    txt: "&lt;system-reminder&gt;…&lt;/system-reminder&gt; ok, try the other approach",
    rev: 5,
    kind: "keep",
    out: "reminder stripped, your words kept",
  },
  {
    role: "last 8 turns",
    txt: "(the end of the session)",
    rev: 6,
    kind: "keep",
    out: "near-verbatim · up to 3500 chars each",
  },
];
interface Step {
  t: string;
  code: string;
  lede: string;
}
const ln = (n: number | string): string => `<span class="ln">${String(n).padStart(2, " ")}</span> `;
const S: Step[] = [
  {
    t: "USER MESSAGES SURVIVE",
    code: `${ln(56)}lim = … <span class="o">1200 if role == "USER"</span>\n${ln(12)}clip(s, n): head + " …[clipped]… " + tail\n\nNo user message is dropped. A long one keeps both ends.`,
    lede: "Every thing you said is the spine of the document, so every user message is kept. Over 1200 characters it keeps the head and the tail and marks the cut.",
  },
  {
    t: "ASSISTANT TEXT, SHORTER",
    code: `${ln(56)}… else <span class="o">450</span>\n\nFor the assistant's own words the budget is a little over a third of yours. What it decided matters; how it phrased it mostly does not.`,
    lede: "The assistant's prose is clipped much harder than yours. The decisions are what carry over; the narration is not.",
  },
  {
    t: "A TOOL CALL BECOMES ONE LINE",
    code: `${ln(19)}tool_line(x):\n${ln(21)}key = file_path or command or\n       pattern or prompt or description\n${ln(22)}f"{name}: {clip(key, 110)}"\n\nNewlines inside become “ ⏎ ”.`,
    lede: "What the assistant did survives as a trail, one line per call, with the file, command or pattern it chose. Not what came back.",
  },
  {
    t: "RESULTS AND THINKING ARE DROPPED",
    code: `${ln(17)}text_of(c): only blocks where\n       <span class="o">type == "text"</span>\n\nA tool_result body and a thinking block\nnever enter the turn list.`,
    lede: "This is where the megabytes go. File contents, command output and reasoning blocks never reach the digest, which is why a lookup in the full transcript exists for the facts that lived only there.",
  },
  {
    t: "ERRORS ARE THE EXCEPTION",
    code: `${ln(40)}if x.type == "tool_result"\n       and x.is_error:\n${ln(41)}  errors.append(clip(…, 240))\n${ln(59)}for … in <span class="o">errors[-25:]</span>`,
    lede: "A failed tool call is the one kind of result worth keeping, because a dead end's exact symptom is what template section 6 asks for. They are collected at the end, last 25 only.",
  },
  {
    t: "HARNESS NOISE IS STRIPPED",
    code: `${ln(9)}SR = &lt;system-reminder&gt;…  |\n       &lt;task-notification&gt;…\n${ln(10)}SKIP_PREFIX = ("Base directory for\n  this skill", "Caveat:", "&lt;command-",\n  "[Request interrupted")\n${ln(43)}drop meta and SKIP_PREFIX messages`,
    lede: "Injected reminders and slash-command scaffolding are not the conversation. They are removed from your messages, and messages that are only scaffolding are skipped.",
  },
  {
    t: "THE TAIL IS NEAR-VERBATIM",
    code: `${ln(8)}TAIL = <span class="o">8</span>\n${ln(54)}cut = len(turns) - TAIL\n${ln(56)}lim = <span class="o">3500</span> if k &gt;= cut …\n\nWhere the session ended is where the next one starts.`,
    lede: "The last 8 turns get a budget of 3500 characters each, nearly whole. That is the state at the end, and it is almost always the part the successor needs most.",
  },
];

const dgStage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  const rows = EV.map((e, k) => {
    const cls = e.rev === i ? "now" : e.rev < i ? "seen" : "";
    const out =
      e.rev <= i
        ? `<div class="out ${e.kind}">${e.kind === "drop" ? "✗" : "✓"} ${e.out}</div>`
        : "";
    return `<div class="ev ${cls}" data-viz-id="ev-${k}" data-label="${e.role}"><span class="role">${e.role}</span><span class="txt">${e.txt}</span>${out}</div>`;
  }).join("");
  dgStage.innerHTML = `<div><div class="hdr">${i + 1} · ${s.t}</div>${rows}</div><div class="code">${s.code}</div>`;
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3400, hashKey: "digest" });
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
