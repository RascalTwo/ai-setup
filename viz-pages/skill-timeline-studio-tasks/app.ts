import { arrowMarkers, connect, side, labelBox, esc, $ } from "@viz/kit";

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
      "read back",
      "when you ask the skill",
      "read back: the plan still shows it when you ask",
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
      "you ask what is in flight",
      x3,
      y3,
      "you ask",
    ) +
    `<g data-viz-id="edge-dies" data-label="the session dies before finishing"><path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" stroke="var(--warn)" stroke-width="1.8" stroke-dasharray="5 4" fill="none" marker-end="url(#ah-warn)"/>` +
    `<text x="${a.x + 12}" y="${(a.y + b.y) / 2 + 4}" font-family="var(--mono)" font-size="11" fill="var(--warn)">terminal closes, context runs out</text></g>`;
}
