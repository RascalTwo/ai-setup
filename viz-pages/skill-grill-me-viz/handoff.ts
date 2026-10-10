// Exhibit 4: "At what context size does a handoff become due?" A threshold slider over two charts:
// the cumulative-cost lines that cross at break-even, and the sweep that shows where handing off
// pays best. Every number is synthetic: invented prices and an invented week of sessions, run
// through one small cost model so the curves are computed, not drawn.
import { attrs, optLabel, pressOne, q, SVGNS } from "./util.js";

export type Weight = "full" | "mid" | "low";
export const CRW: Record<Weight, number> = { full: 1, mid: 0.4, low: 0.2 };
const LABEL: Record<Weight, string> = {
  full: "full price (1.0)",
  mid: "discounted (0.4)",
  low: "heavily discounted (0.2)",
};
// invented unit prices ($ per million tokens): cached read, fresh write, output
const RD = 0.3;
const W1 = 3.75;
const OUT = 15;
const NEW_CTX = 100e3; // context after a handoff restart
const MORE = 96; // invented: a session that crosses the line runs this many more requests
const SPREAD = 110e3; // invented: how fast sessions thin out above the threshold

export function costs(
  t: number,
  w: Weight,
): { handoff: number; restart: number; keep: number; ho: number; fixed: number; be: number } {
  const crw = CRW[w];
  const handoff = (3 * t * RD * crw + 8e3 * OUT) / 1e6;
  const restart = (101e3 * W1 + 10 * 70e3 * RD * crw) / 1e6;
  const keep = (t * RD * crw) / 1e6;
  const ho = (NEW_CTX * RD * crw) / 1e6;
  return {
    handoff,
    restart,
    keep,
    ho,
    fixed: handoff + restart,
    be: (handoff + restart) / (keep - ho),
  };
}
/** Net saving per 100 sessions when the handoff line sits at `t`. */
export function saved(t: number, w: Weight): number {
  const c = costs(t, w);
  const net = (c.keep - c.ho) * MORE - c.fixed;
  return 100 * Math.exp(-(t - 100e3) / SPREAD) * net;
}
const GRID: number[] = Array.from({ length: 66 }, (_, i) => (150 + i * 10) * 1e3);
export function best(w: Weight): { t: number; v: number } {
  let b = { t: GRID[0] ?? 0, v: -Infinity };
  for (const t of GRID) {
    const v = saved(t, w);
    if (v > b.v) b = { t, v };
  }
  return b;
}

export function initHandoff(): void {
  const root = q<HTMLElement>(document, "#ex4-stage");
  root.innerHTML = `
    <div class="sub-h">hand off when the context reaches…  <b>the bars show what each choice saves</b> (a synthetic week of sessions)</div>
    <svg id="bars" viewBox="0 0 880 300" role="img" aria-label="Savings from handing off at each threshold, as bars" data-viz-id="bars" data-label="savings bars by threshold"></svg>
    <div class="sliderrow" style="margin-top:6px">
      <label for="thr">Handoff due at</label>
      <input type="range" id="thr" min="150" max="800" step="50" value="400" data-viz-id="threshold" data-label="threshold slider" />
      <output id="thrv">400k</output>
      <span style="margin-left:10px">usage meter counts cached reads at</span>
      <span class="row" id="wts" style="margin:0">
        ${(["full", "mid", "low"] as const).map((w) => `<button class="btn" data-w="${w}" aria-pressed="false" data-viz-id="w-${w}" data-label="weighting ${LABEL[w]}">${LABEL[w]}</button>`).join("")}
      </span>
    </div>
    <div class="row" style="margin:4px 0 10px"><span class="lbl">the options on the table</span>
      <span class="btn" style="cursor:default">${optLabel("A", "300k")}</span>
      <span class="btn" style="cursor:default">${optLabel("B", "400k, forced by 500k")}</span>
      <span class="btn" style="cursor:default">${optLabel("C", "500k or more")}</span>
    </div>
    <div class="two">
      <div>
        <div class="sub-h"><b>keep going</b> vs <b>hand off</b>: cost of the requests after the line</div>
        <svg id="be" viewBox="0 0 480 270" role="img" aria-label="Cumulative cost after the threshold: keep going versus hand off"></svg>
      </div>
      <div>
        <div class="legend" style="flex-direction:column;gap:6px;margin-top:22px"><span><i style="background:var(--danger)"></i>keep going: every request re-reads the big context</span><span><i style="background:var(--good)"></i>hand off: pay once to restart near 100k, then each request is cheap</span><span><i style="background:var(--accent)"></i>where they cross, the handoff has paid for itself</span></div>
        <p class="out" id="hout" aria-live="polite"></p>
      </div>
    </div>`;
  const be = q<SVGSVGElement>(root, "#be");
  const sw = q<SVGSVGElement>(root, "#bars");
  const thr = q<HTMLInputElement>(root, "#thr");
  const thrv = q<HTMLElement>(root, "#thrv");
  const hout = q<HTMLElement>(root, "#hout");
  const wbtns = [...root.querySelectorAll<HTMLElement>("#wts .btn")];
  let w: Weight = "mid";

  const mk = (
    svg: SVGSVGElement,
    tag: string,
    a: Record<string, string | number>,
    text?: string,
  ): SVGElement => {
    const el = attrs(document.createElementNS(SVGNS, tag), a);
    if (text !== undefined) el.textContent = text;
    svg.append(el);
    return el;
  };
  const grid = (svg: SVGSVGElement, x0: number, x1: number, y0: number, y1: number): void => {
    mk(svg, "line", { x1: x0, x2: x1, y1: y0, y2: y0, stroke: "var(--border)" });
    mk(svg, "line", { x1: x0, x2: x0, y1: y0, y2: y1, stroke: "var(--border)" });
  };

  function drawBE(t: number): void {
    be.replaceChildren();
    const c = costs(t, w);
    const N = 200;
    const X0 = 56,
      X1 = 466,
      Y0 = 220,
      Y1 = 14;
    const ymax = Math.max(c.keep * N, c.fixed + c.ho * N) * 1.06;
    const sx = (n: number): number => X0 + (n / N) * (X1 - X0);
    const sy = (v: number): number => Y0 - (v / ymax) * (Y0 - Y1);
    grid(be, X0, X1, Y0, Y1);
    for (let n = 0; n <= N; n += 50)
      mk(
        be,
        "text",
        { x: sx(n), y: Y0 + 16, "text-anchor": "middle", fill: "var(--faint)", "font-size": 11.5 },
        String(n),
      );
    for (let k = 0; k <= 4; k++)
      mk(
        be,
        "text",
        {
          x: X0 - 6,
          y: sy((ymax * k) / 4) + 4,
          "text-anchor": "end",
          fill: "var(--faint)",
          "font-size": 11.5,
        },
        `$${((ymax * k) / 4).toFixed(1)}`,
      );
    mk(
      be,
      "text",
      { x: (X0 + X1) / 2, y: 252, "text-anchor": "middle", fill: "var(--muted)", "font-size": 12 },
      "requests after crossing the line",
    );
    for (const [n, lab] of [
      [29, "a short session"],
      [96, "median session"],
    ] as const) {
      mk(be, "line", {
        x1: sx(n),
        x2: sx(n),
        y1: Y0,
        y2: Y1 + 12,
        stroke: "var(--faint)",
        "stroke-dasharray": "3 4",
      });
      mk(be, "text", { x: sx(n) + 4, y: Y1 + 10, fill: "var(--faint)", "font-size": 11.5 }, lab);
    }
    mk(be, "path", {
      d: `M${sx(0)},${sy(0)} L${sx(N)},${sy(c.keep * N)}`,
      stroke: "var(--danger)",
      "stroke-width": 3,
      fill: "none",
      "data-viz-id": "line-keep",
      "data-label": "keep going: cumulative cost",
    });
    mk(be, "path", {
      d: `M${sx(0)},${sy(c.fixed)} L${sx(N)},${sy(c.fixed + c.ho * N)}`,
      stroke: "var(--good)",
      "stroke-width": 3,
      fill: "none",
      "data-viz-id": "line-handoff",
      "data-label": "hand off: cumulative cost",
    });
    if (c.be < N) {
      mk(be, "circle", {
        cx: sx(c.be),
        cy: sy(c.keep * c.be),
        r: 6,
        fill: "var(--accent)",
        "data-viz-id": "breakeven",
        "data-label": `break-even at ${c.be.toFixed(0)} requests`,
      });
      mk(
        be,
        "text",
        { x: X0 + 10, y: Y1 + 34, fill: "var(--accent)", "font-size": 13, "font-weight": 700 },
        `● break-even: ${c.be.toFixed(0)} requests`,
      );
    } else
      mk(
        be,
        "text",
        { x: X0 + 12, y: Y1 + 34, fill: "var(--danger)", "font-size": 12.5 },
        "never breaks even in 200 requests",
      );
  }

  function drawSweep(t: number): void {
    sw.replaceChildren();
    const X0 = 56;
    const X1 = 868;
    const Y0 = 232;
    const Y1 = 30;
    const TS = Array.from({ length: 14 }, (_, i) => 150 + i * 50);
    const top = best(w).v;
    const lo = -0.3;
    const sy = (v: number): number => Y0 - ((Math.max(lo, v) - lo) / (1 - lo)) * (Y0 - Y1);
    const slot = (X1 - X0) / TS.length;
    mk(sw, "line", { x1: X0, x2: X1, y1: sy(0), y2: sy(0), stroke: "var(--faint)" });
    for (const v of [0.5, 1]) {
      mk(sw, "line", {
        x1: X0,
        x2: X1,
        y1: sy(v),
        y2: sy(v),
        stroke: "var(--border)",
        "stroke-dasharray": "2 5",
      });
      mk(
        sw,
        "text",
        { x: X0 - 8, y: sy(v) + 4, "text-anchor": "end", fill: "var(--faint)", "font-size": 12 },
        `${v * 100}%`,
      );
    }
    mk(
      sw,
      "text",
      { x: X0 - 8, y: sy(0) + 4, "text-anchor": "end", fill: "var(--faint)", "font-size": 12 },
      "0",
    );
    const letter: Record<number, string> = { 300: "A", 400: "B", 500: "C" };
    TS.forEach((k, i) => {
      const v = saved(k * 1e3, w) / top;
      const x = X0 + i * slot + slot * 0.14;
      const bw = slot * 0.72;
      const on = k === t / 1e3;
      const y = sy(Math.max(v, 0));
      const h = Math.max(2, Math.abs(sy(v) - sy(0)));
      mk(sw, "rect", {
        x,
        y: v >= 0 ? y : sy(0),
        width: bw,
        height: h,
        rx: 4,
        fill:
          v < 0
            ? "var(--danger)"
            : k === 250
              ? "var(--good)"
              : on
                ? "var(--accent)"
                : "color-mix(in srgb, var(--accent) 38%, var(--panel-2))",
        stroke: on ? "#fff" : "none",
        "stroke-width": 2,
        "data-viz-id": `bar-${k}`,
        "data-label": `hand off at ${k}k: saves ${(Math.max(0, v) * 100).toFixed(0)}% of the best`,
      });
      mk(
        sw,
        "text",
        {
          x: x + bw / 2,
          y: Y0 + 20,
          "text-anchor": "middle",
          fill: on ? "#fff" : "var(--muted)",
          "font-size": 12.5,
          "font-weight": on ? 700 : 400,
        },
        `${k}k`,
      );
      if (v > 0.02)
        mk(
          sw,
          "text",
          {
            x: x + bw / 2,
            y: y - 6,
            "text-anchor": "middle",
            fill: on ? "#fff" : "var(--faint)",
            "font-size": 11.5,
          },
          `${(v * 100).toFixed(0)}%`,
        );
      const l = letter[k];
      if (l)
        mk(
          sw,
          "text",
          {
            x: x + bw / 2,
            y: Y0 + 42,
            "text-anchor": "middle",
            fill: "var(--accent)",
            "font-size": 13,
            "font-weight": 700,
          },
          `option ${l}`,
        );
    });
    mk(
      sw,
      "text",
      { x: X1, y: 16, "text-anchor": "end", fill: "var(--muted)", "font-size": 12.5 },
      "bar height = share of the best possible saving for this weighting; green = ~250k",
    );
  }

  function update(): void {
    const t = Number(thr.value) * 1e3;
    thrv.textContent = `${thr.value}k`;
    pressOne(wbtns, wbtns.find((b) => b.dataset["w"] === w) ?? null);
    drawBE(t);
    drawSweep(t);
    const c = costs(t, w);
    const bst = best(w);
    const share = Math.max(0, saved(t, w) / bst.v);
    hout.innerHTML =
      `At <b>${thr.value}k</b>: hand off pays for itself after <b>${c.be.toFixed(0)}</b> requests (a median session has 96 more), and the week keeps <b>${(share * 100).toFixed(0)}%</b> of the best possible saving.` +
      ` The best line for this weighting is <b>${(bst.t / 1e3).toFixed(0)}k</b>; ` +
      (Math.abs(t - 400e3) < 1
        ? `the old guess of 400k leaves <b>${((1 - share) * 100).toFixed(0)}%</b> on the table.`
        : `the old guess of 400k keeps ${(Math.max(0, saved(400e3, w) / bst.v) * 100).toFixed(0)}%.`) +
      ` <span style="color:var(--faint)">(Invented prices and sessions: the shape is the point, not the numbers.)</span>`;
  }
  thr.addEventListener("input", update);
  sw.addEventListener("click", (e) => {
    const id = e.target instanceof SVGElement ? e.target.dataset["vizId"] : undefined;
    if (id !== undefined && id.startsWith("bar-")) {
      thr.value = id.slice(4);
      update();
    }
  });
  root.querySelector("#wts")?.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-w]") : null;
    if (!b) return;
    const k = b.dataset["w"];
    w = k === "full" || k === "low" ? k : "mid";
    update();
  });
  update();
}
