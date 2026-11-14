// Exhibit 7: one ladder becomes two axes. The same five chips morph from a single "most real first"
// ladder (with a unit test wedged in at rung 4) into a scope × stand-in grid where the unit test
// has a home of its own. Two buttons toggle between the two states.
import { attrs, ease, lerp, optLabel, pressOne, q, reduced, SVGNS } from "./util.js";

interface Chip {
  id: string;
  label: string;
  label2: string;
  hue: string;
  // ladder pose, then grid pose
  a: { x: number; y: number; w: number };
  b: { x: number; y: number; w: number };
}
const H = 46;
const col = (i: number): number => 200 + i * 150;
const CHIPS: Chip[] = [
  {
    id: "real",
    label: "1 · Real, end to end",
    label2: "Real",
    hue: "var(--good)",
    a: { x: 40, y: 56, w: 300 },
    b: { x: col(0), y: 44, w: 140 },
  },
  {
    id: "emu",
    label: "2 · Emulated",
    label2: "Emulated",
    hue: "var(--c5)",
    a: { x: 40, y: 120, w: 300 },
    b: { x: col(1), y: 44, w: 140 },
  },
  {
    id: "fake",
    label: "3 · Fake",
    label2: "Fake",
    hue: "var(--warn)",
    a: { x: 40, y: 184, w: 300 },
    b: { x: col(2), y: 44, w: 140 },
  },
  {
    id: "unit",
    label: "4 · Unit test",
    label2: "Function scope",
    hue: "var(--c4)",
    a: { x: 40, y: 248, w: 300 },
    b: { x: col(0), y: 290, w: 590 },
  },
  {
    id: "mock",
    label: "5 · Mock",
    label2: "Mock",
    hue: "var(--danger)",
    a: { x: 40, y: 312, w: 300 },
    b: { x: col(3), y: 44, w: 140 },
  },
];
const ROWS = [
  { name: "Journey", sub: "a user's workflow", y: 132 },
  { name: "Service", sub: "one deployable", y: 220 },
];
const CELLS: string[][] = [
  ["real environment", "emulated services", "hand-made fakes", "last resort"],
  ["real database", "API from a spec", "in-memory repo", "last resort"],
];

export function initLadder(): void {
  const root = q<HTMLElement>(document, "#ex7-stage");
  root.innerHTML = `
    <div class="row">
      <span class="lbl">Q12: one list, or two things?</span>
      <button class="btn" id="l-one" data-viz-id="l-one" data-label="show one ladder" aria-pressed="false">${optLabel("B", "one ladder")}</button>
      <button class="btn" id="l-two" data-viz-id="l-two" data-label="show two axes" aria-pressed="false">${optLabel("A", "two axes: scope × stand-in")}</button>
    </div>
    <svg id="ladder" viewBox="0 0 820 400" role="img" aria-label="A single ladder of test stand-ins morphing into a grid of scope by stand-in" data-viz-id="ladder-svg" data-label="ladder to grid morph"></svg>`;
  const svg = q<SVGSVGElement>(root, "#ladder");
  const one = q<HTMLElement>(root, "#l-one");
  const two = q<HTMLElement>(root, "#l-two");

  const mk = (
    tag: string,
    a: Record<string, string | number>,
    text?: string,
    parent: Element = svg,
  ): SVGElement => {
    const el = attrs(document.createElementNS(SVGNS, tag), a);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  };

  // static layers, created once; draw(t) only moves and fades them
  const axisLadder = mk("g", {});
  mk(
    "text",
    { x: 40, y: 34, fill: "var(--muted)", "font-size": 13 },
    "most real first ↓",
    axisLadder,
  );
  mk(
    "path",
    { d: "M 24 56 L 24 354", stroke: "var(--muted)", "stroke-width": 2, "marker-end": "url(#arr)" },
    undefined,
    axisLadder,
  );
  const why = mk("g", {});
  mk(
    "text",
    { x: 360, y: 270, fill: "var(--danger)", "font-size": 14, "font-weight": 700 },
    "← why is this one here?",
    why,
  );
  mk(
    "text",
    { x: 360, y: 290, fill: "var(--muted)", "font-size": 12.5 },
    "It doesn't compete with a mock: it's a different question.",
    why,
  );
  const gridLayer = mk("g", {});
  mk(
    "text",
    { x: 200, y: 26, fill: "var(--muted)", "font-size": 13 },
    "stand-in for what the test doesn't own  →  less real",
    gridLayer,
  );
  ROWS.forEach((r, i) => {
    mk(
      "text",
      { x: 14, y: r.y + 4, fill: "var(--text)", "font-size": 14, "font-weight": 700 },
      r.name,
      gridLayer,
    );
    mk("text", { x: 14, y: r.y + 22, fill: "var(--muted)", "font-size": 12 }, r.sub, gridLayer);
    CELLS[i]?.forEach((txt, c) => {
      mk(
        "rect",
        {
          x: col(c),
          y: r.y - 28,
          width: 140,
          height: 76,
          rx: 9,
          fill: `color-mix(in srgb, ${c === 3 ? "var(--danger)" : "var(--good)"} ${c === 3 ? 22 : 40 - c * 10}%, var(--panel-2))`,
          "data-viz-id": `cell-${i}-${c}`,
          "data-label": `${r.name} × ${CHIPS[c === 3 ? 4 : c]?.label2}`,
        },
        undefined,
        gridLayer,
      );
      mk(
        "text",
        {
          x: col(c) + 70,
          y: r.y + 14,
          "text-anchor": "middle",
          fill: "var(--text)",
          "font-size": 12.5,
        },
        txt,
        gridLayer,
      );
    });
  });
  mk(
    "text",
    { x: 14, y: 314, fill: "var(--text)", "font-size": 14, "font-weight": 700 },
    "Function",
    gridLayer,
  );
  mk(
    "text",
    { x: 14, y: 332, fill: "var(--muted)", "font-size": 12 },
    "complex pure logic",
    gridLayer,
  );
  mk(
    "text",
    { x: col(0) + 295, y: 366, "text-anchor": "middle", fill: "var(--muted)", "font-size": 12.5 },
    "no dependencies to stand in for: call it, check the output",
    gridLayer,
  );
  const defs = mk("defs", {});
  defs.innerHTML = `<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"/></marker>`;

  const chipEls = CHIPS.map((c) => {
    const g = mk("g", { "data-viz-id": `chip-${c.id}`, "data-label": c.label2 });
    const r = mk(
      "rect",
      {
        height: H,
        rx: 10,
        fill: `color-mix(in srgb, ${c.hue} 26%, var(--panel))`,
        stroke: c.hue,
        "stroke-width": 2,
      },
      undefined,
      g,
    );
    const t = mk(
      "text",
      { "font-size": 14, "font-weight": 700, fill: "#fff", "text-anchor": "middle" },
      c.label,
      g,
    );
    return { c, g, r, t };
  });

  let t = 0;
  function draw(v: number): void {
    t = v;
    const e = ease(v);
    axisLadder.setAttribute("opacity", String(1 - e));
    why.setAttribute("opacity", String(Math.max(0, 1 - e * 2.2)));
    gridLayer.setAttribute("opacity", String(Math.max(0, e * 2 - 1)));
    for (const { c, g, r, t: tx } of chipEls) {
      const x = lerp(c.a.x, c.b.x, e);
      const y = lerp(c.a.y, c.b.y, e);
      const w = lerp(c.a.w, c.b.w, e);
      attrs(r, { x: 0, y: 0, width: w });
      g.setAttribute("transform", `translate(${x} ${y})`);
      attrs(tx, { x: w / 2, y: H / 2 + 5 });
      tx.textContent = e > 0.5 ? c.label2 : c.label;
    }
    pressOne([one, two], v < 0.02 ? one : v > 0.98 ? two : null);
  }

  let raf = 0;
  function go(to: number): void {
    cancelAnimationFrame(raf);
    if (reduced()) return draw(to);
    const from = t;
    const t0 = performance.now();
    const dur = 1500 * Math.abs(to - from);
    const tick = (now: number): void => {
      const k = dur === 0 ? 1 : Math.min((now - t0) / dur, 1);
      draw(lerp(from, to, k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  one.addEventListener("click", () => go(0));
  two.addEventListener("click", () => go(1));
  draw(0);
}
