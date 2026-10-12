import { stepper, arrowMarkers, connect, side, labelBox, esc, $ } from "@viz/kit";

type Node = { x: number; y: number; w: number; h: number };

// ── 1. life of an agent task ───────────────────────────────────────────────────
const life = {
  created: { x: 20, y: 28, w: 190, h: 74 },
  started: { x: 290, y: 28, w: 190, h: 74 },
  finished: { x: 570, y: 28, w: 170, h: 74 },
  stranded: { x: 290, y: 148, w: 190, h: 74 },
  reported: { x: 570, y: 148, w: 170, h: 74 },
} satisfies Record<string, Node>;

const lifeBox = (
  id: keyof typeof life,
  tone: string,
  head: string,
  sub: string,
  label: string,
): string => {
  const n: Node = life[id];
  return (
    `<g data-viz-id="life-${id}" data-label="${esc(label)}">` +
    `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="color-mix(in srgb, ${tone} 14%, #0e0c09)" stroke="${tone}" stroke-width="1.5"/>` +
    labelBox(
      n,
      `<div><b style="color:#fff;font-size:14px">${head}</b><br><span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${sub}</span></div>`,
    ) +
    `</g>`
  );
};

const edge = (
  a: Node,
  b: Node,
  color: string,
  marker: string,
  id: string,
  label: string,
  tx: number,
  ty: number,
  text: string,
): string =>
  `<g data-viz-id="${id}" data-label="${esc(label)}">` +
  `<path d="${connect(a, b)}" stroke="${color}" stroke-width="1.8" fill="none" marker-end="url(#${marker})"/>` +
  `<text x="${tx}" y="${ty}" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="${color}">${text}</text></g>`;

const mid = (a: Node, b: Node, dy: number): [number, number] => {
  const p = side(a, "right"),
    q = side(b, "left");
  return [(p.x + q.x) / 2, (p.y + q.y) / 2 + dy];
};

{
  const [x1, y1] = mid(life.created, life.started, -8);
  const [x2, y2] = mid(life.started, life.finished, -8);
  const [x3, y3] = mid(life.stranded, life.reported, -8);
  const a = side(life.started, "bottom"),
    b = side(life.stranded, "top");
  $("#life")!.innerHTML =
    arrowMarkers() +
    `<text x="20" y="16" font-family="var(--mono)" font-size="10.5" letter-spacing="1.4" fill="var(--faint)">AN AGENT TASK, FROM CREATION</text>` +
    lifeBox(
      "created",
      "var(--c5)",
      "created",
      `shape: "ai" · noQueue: true`,
      "created: flagged as machine-made, kept out of your capacity",
    ) +
    lifeBox(
      "started",
      "var(--accent)",
      "started",
      "sessions[0].start set",
      "started: the agent's claim on the task",
    ) +
    lifeBox(
      "finished",
      "var(--good)",
      "finished",
      "done: true · stop stamped",
      "finished: the task is done and stamped",
    ) +
    lifeBox(
      "stranded",
      "var(--warn)",
      "in flight, nobody home",
      "started · not done",
      "stranded: started, never finished, session gone",
    ) +
    lifeBox(
      "reported",
      "var(--warn)",
      "reported",
      "named in the next hook",
      "reported: the next session's hook lists it",
    ) +
    edge(
      life.created,
      life.started,
      "var(--c5)",
      "ah",
      "edge-start",
      "start, before the work",
      x1,
      y1,
      "start",
    ) +
    edge(
      life.started,
      life.finished,
      "var(--good)",
      "ah-good",
      "edge-finish",
      "finish, after the work",
      x2,
      y2,
      "finish",
    ) +
    edge(
      life.stranded,
      life.reported,
      "var(--warn)",
      "ah-warn",
      "edge-report",
      "SessionStart reads the plan",
      x3,
      y3,
      "hook runs",
    ) +
    `<g data-viz-id="edge-dies" data-label="the session dies before finishing"><path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" stroke="var(--warn)" stroke-width="1.8" stroke-dasharray="5 4" fill="none" marker-end="url(#ah-warn)"/>` +
    `<text x="${a.x + 12}" y="${(a.y + b.y) / 2 + 4}" font-family="var(--mono)" font-size="11" fill="var(--warn)">terminal closes, context runs out</text></g>`;
}

// ── 2. the hook, step by step ──────────────────────────────────────────────────
const flowNodes = {
  open: { x: 4, y: 24, w: 130, h: 56 },
  gate: { x: 154, y: 24, w: 130, h: 56 },
  get: { x: 304, y: 24, w: 130, h: 56 },
  pick: { x: 454, y: 24, w: 150, h: 56 },
  quiet: { x: 350, y: 150, w: 150, h: 56 },
  report: { x: 536, y: 150, w: 150, h: 56 },
  model: { x: 712, y: 150, w: 94, h: 56 },
} satisfies Record<string, Node>;
type NodeId = keyof typeof flowNodes;
const FLOW_IDS: NodeId[] = ["open", "gate", "get", "pick", "quiet", "report", "model"];

const flowLabels: Record<NodeId, [string, string]> = {
  open: ["SessionStart", "startup|resume"],
  gate: ["agent_id?", "subagent: stop"],
  get: ["GET /api/plan", "2 s timeout"],
  pick: ["shape ai, began,", "not ended, not done"],
  quiet: ["none in flight", "print nothing"],
  report: ["build report", "rows + last activity"],
  model: ["model", "context"],
};

type Line = [number | null, string];
interface Step {
  t: string;
  on: NodeId[];
  fence?: boolean;
  code: Line[];
  lede: string;
}

const S: Step[] = [
  {
    t: "A SESSION OPENS",
    on: ["open", "gate"],
    code: [
      [59, '    raw = sys.stdin.read() if not sys.stdin.isatty() else ""'],
      [60, '    if raw.strip() and json.loads(raw).get("agent_id"):'],
      [61, "        return"],
    ],
    lede: "Claude Code runs the hook and feeds it a JSON payload. <b>Every subagent spawn fires it too</b>, and a subagent sent to grep three files should not hear about interrupted work it was never asked to resume. <code>agent_id</code> on the payload is the tell, so a subagent returns here, silently.",
  },
  {
    t: "FIND THE PLAN",
    on: ["get"],
    code: [
      [29, "TIMEOUT_S = 2.0"],
      [63, "    with open(CONFIG) as fh:"],
      [64, "        cfg = json.load(fh)"],
      [65, "    req = urllib.request.Request("],
      [66, '        cfg["base"].rstrip("/") + "/api/plan",'],
      [67, '        headers={"x-timeline-token": cfg["token"]},'],
      [69, '    doc = json.load(urllib.request.urlopen(req, timeout=TIMEOUT_S))["doc"]'],
    ],
    lede: "<code>CONFIG</code> is <code>~/.config/timeline-studio/config.json</code>. The token goes in a header, never a URL. One request, two seconds, then give up: a hook that hangs a session because a container stopped would be a self-inflicted outage.",
  },
  {
    t: "PICK OUT AGENT WORK",
    on: ["pick"],
    code: [
      [79, "    def began(t):"],
      [80, '        ss = t.get("sessions") or []'],
      [81, '        return ss[0]["start"] if ss else t.get("actualStart")'],
      [82, "    def ended(t):"],
      [
        84,
        '        return (ss[-1].get("stop") if t.get("done") else None) if "actualEnd" not in t else t["actualEnd"]',
      ],
      [85, '    mine = [t for t in doc.get("tasks", []) if t.get("shape") == "ai"]'],
      [
        86,
        '    flying = [t for t in mine if began(t) is not None and ended(t) is None and not t.get("done")]',
      ],
    ],
    lede: 'Only the agent\'s own tasks (<code>shape == "ai"</code>), and only those that <b>began and have not ended</b>. Your tasks are never in this list; the hook has no opinion on your backlog.',
  },
  {
    t: "THE NORMAL CASE: SILENCE",
    on: ["quiet"],
    code: [
      [87, "    if not flying:"],
      [88, "        return  # THE NORMAL CASE. Say nothing at all."],
    ],
    lede: "Most sessions end here. Printing nothing is the design: the hook's value is that <b>when it speaks, it means something</b>. A hook whose ordinary output is a list gets tuned out inside a week.",
  },
  {
    t: "ASK THE WHOLE CHANNEL",
    on: ["report"],
    code: [
      [94, "    stamps = [at(v) for t in mine for v in (began(t), ended(t)) if v is not None]"],
      [null, "    ⋯"],
      [103, "    if stamps:"],
      [
        105,
        '        lines.append(f"Last agent activity anywhere in the plan: {humanise(max(stamps), now)}.")',
      ],
    ],
    lede: "The task in flight can sit untouched for an hour while its siblings move, so one row's age is a poor witness. The freshest stamp <b>anywhere in the agent's work</b> is the real answer to \"is anyone still working\".",
  },
  {
    t: "WRITE THE REPORT",
    on: ["report"],
    code: [
      [96, "    lines = ["],
      [97, '        "Agent work in Timeline Studio was started and never finished.",'],
      [null, "    ⋯"],
      [101, "    for t in sorted(flying, key=began, reverse=True):"],
      [
        102,
        "        lines.append(f\"  • {t.get('label') or t['id']}  ({t['id']})  — started {humanise(at(began(t)), now)}\")",
      ],
    ],
    lede: "Newest first, one bullet per task: title, id, and <b>how long ago it started</b>. The id is what a resuming session sends commands against; the title is for the human. The closing lines say another session may still be on these, and not to pick one up unless deliberately resuming.",
  },
  {
    t: "HAND IT TO THE MODEL",
    on: ["report", "model"],
    code: [
      [117, '    sys.stdout.write(json.dumps({"hookSpecificOutput": {'],
      [118, '        "hookEventName": "SessionStart",'],
      [119, '        "additionalContext": "\\n".join(lines),'],
      [120, "    }}))"],
    ],
    lede: "The structured form the hook reference documents for adding context at session start. The install is meant to be verified end to end rather than trusted, because <b>a hook that silently injects nothing is the exact failure</b> this arrangement exists to prevent.",
  },
  {
    t: "FAIL OPEN, ALWAYS",
    on: [],
    fence: true,
    code: [
      [123, 'if __name__ == "__main__":'],
      [124, "    try:"],
      [125, "        main()"],
      [126, "    except Exception:"],
      [null, "    ⋯"],
      [129, "        pass"],
      [130, "    sys.exit(0)"],
    ],
    lede: "No config, plan store down, bad token, a malformed document: all of it lands in a deliberately bare <code>except</code> and exits 0 with no output. There is no failure here worth interrupting a session for, and no diagnostic worth printing into somebody's context.",
  },
];

const stage = $("#flow")!;
const code = $("#code")!;
const lede = $("#lede")!;
const pos = $("#pos")!;

const flowEdges: [NodeId, NodeId, string][] = [
  ["open", "gate", "ah"],
  ["gate", "get", "ah"],
  ["get", "pick", "ah"],
  ["pick", "quiet", "ah-warn"],
  ["pick", "report", "ah-accent"],
  ["report", "model", "ah-accent"],
];

const drawFlow = (i: number): void => {
  const s = S[i]!;
  const on = new Set<NodeId>(s.on);
  const nodes = FLOW_IDS.map((id) => {
    const n: Node = flowNodes[id];
    const [h, sub] = flowLabels[id];
    const lit = on.has(id);
    const outside = id === "open" || id === "model";
    return (
      `<g data-viz-id="flow-${id}" data-label="${esc(h)} ${esc(sub)}">` +
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="9" fill="${lit ? "color-mix(in srgb, var(--accent) 22%, #0e0c09)" : "#15120e"}" stroke="${lit ? "var(--accent)" : outside ? "var(--faint)" : "var(--border)"}" stroke-width="${lit ? 2 : 1.2}"/>` +
      labelBox(
        n,
        `<div><b style="color:${lit ? "#fff" : "var(--text)"};font-size:12.5px">${esc(h)}</b><br><span style="font-family:var(--mono);font-size:10.5px;color:var(--muted)">${esc(sub)}</span></div>`,
      ) +
      `</g>`
    );
  }).join("");
  const edges = flowEdges
    .map(
      ([a, b, m]) =>
        `<path d="${connect(flowNodes[a], flowNodes[b])}" stroke="var(--muted)" stroke-width="1.4" fill="none" marker-end="url(#${m})" opacity=".85"/>`,
    )
    .join("");
  const fence =
    `<g data-viz-id="flow-fence" data-label="fail-open boundary: any exception exits 0 silently">` +
    `<rect x="144" y="8" width="556" height="224" rx="14" fill="none" stroke="${s.fence ? "var(--accent)" : "var(--faint)"}" stroke-width="${s.fence ? 2.4 : 1}" stroke-dasharray="6 5"/>` +
    `<text x="156" y="224" font-family="var(--mono)" font-size="10" fill="${s.fence ? "var(--accent)" : "var(--faint)"}" letter-spacing=".6">ANY EXCEPTION → exit 0, no output</text></g>`;
  stage.innerHTML = arrowMarkers() + fence + edges + nodes;
};

const render = (i: number): void => {
  const s = S[i]!;
  drawFlow(i);
  code.innerHTML = s.code
    .map(([n, t]) => `<div${n === null ? ' class="cm"' : ""}><i>${n ?? ""}</i>${esc(t)}</div>`)
    .join("");
  lede.innerHTML = `<span style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent)">${i + 1} · ${s.t}</span><br>${s.lede}`;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 4200, hashKey: "hook" });
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

// ── 3. humanise(): real outputs, captured by running inflight.py's own function ─
// "now" is fixed at 16:00 on a made-up day; each row is what humanise() returned.
interface Age {
  ago: string;
  out: string;
  rule: string;
  read: string;
}
const AGES: Age[] = [
  { ago: "30 s", out: "just now", rule: "secs < 90 (line 36)", read: "alive" },
  { ago: "4 min", out: "4 minutes ago", rule: "mins < 60 (line 39)", read: "alive" },
  { ago: "55 min", out: "55 minutes ago", rule: "mins < 60 (line 39)", read: "probably alive" },
  {
    ago: "3 h",
    out: "3 hours ago",
    rule: "hours < 8 (line 42)",
    read: "plausibly one long sitting",
  },
  {
    ago: "7 h 59",
    out: "7 hours ago",
    rule: "hours < 8 (line 42)",
    read: "the last minute of 'one sitting'",
  },
  {
    ago: "8 h 30",
    out: "today, 07:30",
    rule: "same date (line 46)",
    read: "abandoned: a clock time means a different sitting",
  },
  { ago: "26 h", out: "yesterday, 14:00", rule: "previous date (line 48)", read: "abandoned" },
  { ago: "5 d", out: "Oct 1, 16:00", rule: "anything older (line 50)", read: "abandoned, and old" },
];
const ages = $("#ages")!;
const readout = $("#readout")!;
const pick = (i: number): void => {
  const a = AGES[i]!;
  readout.innerHTML =
    `started <span class="v">${esc(a.ago)}</span> before it is 16:00<br>` +
    `hook prints: <span class="v">started ${esc(a.out)}</span><br>` +
    `branch: ${esc(a.rule)} · reads as: <span class="v">${esc(a.read)}</span>`;
  ages
    .querySelectorAll("button")
    .forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
};
ages.innerHTML = AGES.map(
  (a, i) =>
    `<button data-viz-id="age-${i}" data-label="started ${esc(a.ago)} ago">${esc(a.ago)}</button>`,
).join("");
ages.querySelectorAll("button").forEach((b, i) => b.addEventListener("click", () => pick(i)));
pick(6);
