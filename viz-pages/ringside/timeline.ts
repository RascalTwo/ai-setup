// timeline.ts — draws the swimlane timeline and the overview strip under it, and wires zooming and panning.
import { $, esc } from "@viz/kit";
import {
  LANES,
  agentId,
  clip,
  helperTree,
  brushRange,
  clampRange,
  idleSpan,
  panBy,
  zoomAround,
  type Range,
  waitingSpans,
  timeScale,
  type TimeScale,
  type HelperNode,
  type Call,
} from "./model.js";
import {
  state,
  persist,
  dur,
  clock,
  colorOf,
  isLive,
  tNow,
  isSub,
  finishedTurn,
  labelOf,
  targetEl,
  roundStart,
} from "./store.js";

/** The round the panel shows: the picked one, or the latest. `to` is the next prompt, null for the latest. */
export function shownRound(): { n: number; from: number; to: number | null } {
  const total = state.prompts.length;
  const n = Math.min(state.round ?? total, total);
  return {
    n,
    from: state.prompts[n - 1]?.at ?? roundStart(),
    to: state.prompts[n]?.at ?? null,
  };
}

// ── render: timeline ──────────────────────────────────────────────────────────
const STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((s) => s * 1000);
export function tickStep(span: number, want = 8): number {
  return STEPS.find((s) => span / s <= want) ?? 14_400_000;
}

/** When anything first happened. */
function firstTime(end: number): number {
  const t = Math.min(
    ...state.order.map((c) => c.start),
    ...state.prompts.map((p) => p.at),
    ...state.says.map((s) => s.at),
  );
  return Number.isFinite(t) ? t : end;
}

function windowRange(): [number, number] {
  const end = tNow();
  if (state.view) {
    const to = state.view.end ?? end;
    return [to - state.view.span, to];
  }
  if (state.win === "last") return [end - state.mins * 60_000, end];
  if (state.win === "all") return [firstTime(end), end];
  const { from, to } = shownRound();
  return [from, to ?? end];
}

/** The range the timeline shows. */
export function viewRange(): Range {
  const [t0, t1] = windowRange();
  return { t0, t1: Math.max(t1, t0 + 10_000) };
}

/** Everything the session has done, up to now: what the overview shows and zooming is limited to. */
const dataRange = (): Range => {
  const end = tNow();
  return { t0: firstTime(end), t1: end };
};

const MINI = 12;
let ov: { W: number; scale: TimeScale } = {
  W: 1000,
  scale: timeScale(0, 1, 1, [], Infinity, 0),
};
interface Drag {
  kind: "pan" | "brush";
  startPx: number;
  endPx: number;
  range: Range;
  scale: TimeScale;
  moved: boolean;
}
let drag: Drag | null = null;
type OvKind = "win" | "l" | "r" | "brush";
let ovDrag: (Omit<Drag, "kind"> & { kind: OvKind }) | null = null;
const GAP_MS = 5 * 60_000;
const BREAK_PX = 30;
/** Keeps a running bar's pulse in step across the redraws, which would otherwise restart it. */
const pulse = (): string => `animation-delay:-${Date.now() % 1600}ms`;

interface Row {
  node: HelperNode;
  y: number;
  open: boolean;
  calls: Call[];
  parent: Call | undefined;
  /** The helper's transcript ends on a final reply. */
  final: boolean;
}

/** Where each helper's rows sit below the six lanes: a summary row, plus mini lanes when open. */
function layoutRows(top: number): { rows: Row[]; bottom: number } {
  // One row per lane, then the "You" row, then the helpers.
  let y = top + (LANES.length + 1) * ROW;
  const rows = helperTree([...state.agents.values()], state.order).map((node): Row => {
    const open = state.open.has(node.id);
    const row = {
      node,
      y,
      open,
      calls: state.order.filter((c) => agentId(c.agent) === node.id && isSub(c)),
      parent: state.calls.get(state.agents.get(node.id)?.toolUseId ?? ""),
      final: state.agents.get(node.id)?.final === true,
    };
    y += ROW + (open ? MINI * LANES.length + 4 : 0);
    return row;
  });
  return { rows, bottom: y };
}

/** When a helper last did anything. A background helper's launching call returns at once, so its end says nothing about the helper. */
const helperLast = (row: Row): number =>
  Math.max(row.parent?.end ?? 0, ...row.calls.map((c) => c.end ?? c.start));

/** A helper with no activity for this long is finished, whatever its last call says. */
const HELPER_QUIET_MS = 120_000;

function helperStatus(row: Row): "running" | "done" | "failed" {
  const idle = Date.now() - helperLast(row);
  // Finished once its transcript ends on a final reply or it has gone quiet; otherwise busy while a
  // call is open or it did something in the last 30s.
  const busy =
    !row.final &&
    idle < HELPER_QUIET_MS &&
    (row.calls.some((c) => c.end === null) || idle < 30_000);
  if (isLive() && busy) return "running";
  return row.parent?.error ? "failed" : "done";
}

function helperElapsed(row: Row, status: string): string {
  return dur((status === "running" ? tNow() : helperLast(row)) - row.node.start);
}

const TOP = 26;
const ROW = 28;

/** A dashed elbow from the bar that launched each helper to that helper's row. */
function connectors(rows: Row[], x: (t: number) => number, L: number, W: number): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const parent = row.parent;
    if (!parent) continue;
    // The connector leaves the bar that launched the helper: a main lane, or a mini lane or
    // summary row of the helper that launched it.
    const owner = rows.find((r) => r.node.id === agentId(parent.agent));
    const lane = LANES.findIndex((l) => l.id === parent.lane);
    const py = !owner
      ? TOP + lane * ROW + ROW - 5
      : owner.open
        ? owner.y + ROW + lane * MINI + MINI - 2
        : owner.y + ROW - 6;
    const px = Math.min(Math.max(L, x(parent.start)) + 3, W - 10);
    const sx = Math.min(Math.max(L, x(row.node.start)), W - 10);
    out.push(
      `<path class="link" d="M${px} ${py} V${row.y + ROW / 2} H${sx}" data-viz-id="link-${esc(row.node.id)}" data-label="Helper ${esc(row.node.name)} was sent from here"/>`,
    );
  }
  return out;
}

/** The narrow, labelled boxes that stand in for folded idle gaps. */
function breakParts(breaks: TimeScale["breaks"], L: number, H: number): string[] {
  const out: string[] = [];
  for (const [i, b] of breaks.entries()) {
    const cx = L + (b.x0 + b.x1) / 2;
    out.push(
      `<rect class="gap" x="${L + b.x0}" y="${TOP - 4}" width="${BREAK_PX}" height="${H - TOP}" data-viz-id="gap-${i + 1}" data-label="${esc(idleSpan(b.to - b.from))} idle"/>`,
      `<text class="gap-label" transform="rotate(-90 ${cx} ${(TOP + H) / 2})" x="${cx}" y="${(TOP + H) / 2 + 4}" text-anchor="middle">⋯ ${esc(idleSpan(b.to - b.from))} idle</text>`,
    );
  }
  return out;
}

/** Gridlines and clock labels, skipping any that fall inside a folded gap. */
function tickParts(
  scale: TimeScale,
  t0: number,
  t1: number,
  x: (t: number) => number,
  H: number,
): string[] {
  const parts: string[] = [];
  const step = tickStep(scale.activeMs);
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    if (scale.breaks.some((b) => t > b.from && t < b.to)) continue;
    parts.push(
      `<line x1="${x(t)}" x2="${x(t)}" y1="${TOP - 4}" y2="${H - 4}" stroke="var(--border)"/>`,
      `<text class="tick" x="${x(t)}" y="${TOP - 10}" text-anchor="middle">${esc(step < 60_000 ? new Date(t).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }) : clock(t))}</text>`,
    );
  }
  return parts;
}

/** A line and a P# tag for each prompt inside the range. */
function promptParts(t0: number, t1: number, x: (t: number) => number, H: number): string[] {
  const parts: string[] = [];
  state.prompts.forEach((p, i) => {
    if (p.at < t0 || p.at > t1) return;
    parts.push(
      `<line class="prompt-line" x1="${x(p.at)}" x2="${x(p.at)}" y1="${TOP - 2}" y2="${H - 4}"/>`,
      `<text class="prompt-tag" x="${x(p.at) + 3}" y="${H - 8}" data-viz-id="prompt-${i + 1}" data-turn="${i + 1}" data-label="Prompt ${i + 1}"><title>${esc(p.text)}</title>P${i + 1}</text>`,
    );
  });
  return parts;
}

const L = 124;
/** The drawing width the timeline and the overview share. */
function drawWidth(): number {
  /* c8 ignore next -- clientWidth is only 0 for a hidden svg, which this page never has */
  return Math.max(600, $("#timeline")!.clientWidth || 1000);
}

/** Spans of activity: what folding looks at, and what the overview draws. */
const busySpans = (now: number): [number, number][] => [
  ...state.order.map((c): [number, number] => [c.start, c.end ?? now]),
  ...state.prompts.map((p): [number, number] => [p.at, p.at]),
  ...state.says.map((s): [number, number] => [s.at, s.at]),
];

/** What the timeline last drew with, so a drag can turn pixels back into time. */
let geom: { W: number; scale: TimeScale } = {
  W: 1000,
  scale: timeScale(0, 1, 1, [], Infinity, 0),
};

/** The "You" row: when Claude had finished and was waiting on a person. Also the running-bar stripes. */
function youParts(
  t0: number,
  t1: number,
  x: (t: number) => number,
  W: number,
  now: number,
): string[] {
  const parts: string[] = [];
  const youY = TOP + LANES.length * ROW;
  parts.push(
    `<defs><pattern id="run-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--text)" opacity=".45"/></pattern></defs>`,
    `<rect x="${L}" y="${youY + 2}" width="${W - L - 10}" height="${ROW - 4}" fill="var(--panel-2)" opacity=".45" rx="3"/>`,
    `<text class="lane-label" x="8" y="${youY + ROW / 2 + 4}"><title>Claude finished and was waiting on you</title>You</text>`,
  );
  const open = finishedTurn() && isLive() ? now : null;
  for (const [a, b] of waitingSpans(state.prompts, state.says, state.order, open)) {
    if (b < t0 || a > t1) continue;
    const bx = Math.max(L, x(a));
    const w = Math.max(3, x(b) - bx);
    parts.push(
      `<rect class="you" data-viz-id="you-${a}" data-label="Waiting on you, ${esc(dur(b - a))}" x="${bx}" y="${youY + 5}" width="${w}" height="${ROW - 10}" rx="2"><title>Waiting on you · ${esc(dur(b - a))}</title></rect>`,
      // Shown only where the bar has room for it.
      `<text class="you-label" x="${bx + 5}" y="${youY + ROW / 2 + 4}" opacity="${Number(w > 60)}">you · ${esc(dur(b - a))}</text>`,
    );
  }
  return parts;
}

export function renderTimeline(): void {
  const svg = $<SVGSVGElement>("#timeline")!;
  const W = drawWidth();
  const { rows, bottom } = layoutRows(TOP);
  const H = bottom + 6;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", String(H));
  const { t0, t1 } = viewRange();
  const now = tNow();
  // In the whole-session view and in any zoomed view, quiet gaps over five minutes fold into
  // narrow labelled breaks.
  const fold = state.view || state.win === "all" ? GAP_MS : Infinity;
  const scale = timeScale(t0, t1, W - L - 10, busySpans(now), fold, BREAK_PX);
  geom = { W, scale };
  const x = (t: number): number => L + scale.x(t);
  const parts: string[] = [];
  LANES.forEach((l, i) => {
    const y = TOP + i * ROW;
    parts.push(
      `<rect x="${L}" y="${y + 2}" width="${W - L - 10}" height="${ROW - 4}" fill="var(--panel-2)" opacity=".45" rx="3"/>`,
      `<text class="lane-label" x="8" y="${y + ROW / 2 + 4}"><title>${esc(l.hint)}</title>${esc(l.name)}</text>`,
    );
  });
  parts.push(...youParts(t0, t1, x, W, now));
  const bar = (c: Call, y: number, h: number): string => {
    const end = c.end ?? now;
    const bx = Math.max(L, x(c.start));
    const cls = [
      "call",
      c.end === null ? "run" : "",
      c.error ? "err" : "",
      c.id === state.sel ? "sel" : "",
    ].join(" ");
    const w = Math.max(3, x(end) - bx);
    const rect = `<rect class="${cls}" data-id="${esc(c.id)}" data-viz-id="call-${esc(c.id)}" data-label="${esc(labelOf(c))}" x="${bx}" y="${y}" width="${w}" height="${h}" rx="2" fill="${colorOf(c.lane)}" opacity="${c.end === null ? 0.6 : 0.9}"${c.end === null ? ` style="${pulse()}"` : ""}/>`;
    // Running: stripes and a dashed edge, so it reads as unfinished even with motion turned off.
    return c.end === null
      ? `${rect}<rect class="run-stripes" x="${bx}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#run-stripes)"/>`
      : rect;
  };
  const seen = (c: Call): boolean => (c.end ?? now) >= t0 && c.start <= t1;
  for (const row of rows) {
    const status = helperStatus(row);
    const mid = row.y + ROW / 2;
    const name = `${esc(row.node.name)} (helper ${esc(row.node.id)})`;
    parts.push(
      `<rect class="helper-row" data-agent="${esc(row.node.id)}" data-viz-id="helper-${esc(row.node.id)}" data-label="${name}" x="${L}" y="${row.y + 2}" width="${W - L - 10}" height="${ROW - 4}" fill="var(--panel-2)" opacity=".3" rx="3" stroke="var(--border)" stroke-dasharray="3 3"/>`,
      `<text class="lane-label helper-row" data-agent="${esc(row.node.id)}" x="${8 + (row.node.depth - 1) * 10}" y="${mid + 4}"><title>${name}</title>${row.open ? "▾" : "▸"} ${esc(clip(row.node.name, 13 - row.node.depth))}</text>`,
    );
    if (!row.open)
      for (const c of row.calls.filter(seen))
        parts.push(
          `<rect class="spark${c.end === null ? " run" : ""}"${c.end === null ? ` style="${pulse()}"` : ""} x="${Math.max(L, x(c.start))}" y="${mid - 4}" width="${Math.max(2, x(c.end ?? now) - Math.max(L, x(c.start)))}" height="8" rx="1" fill="${colorOf(c.lane)}" opacity=".85"/>`,
        );
    parts.push(
      `<rect x="${W - 132}" y="${mid - 9}" width="120" height="18" rx="9" fill="var(--panel)" opacity=".92"/>`,
      `<text class="helper-status ${status}" x="${W - 20}" y="${mid + 4}" text-anchor="end">${status} · ${esc(helperElapsed(row, status))}</text>`,
    );
    if (row.open)
      for (const [j, l] of LANES.entries()) {
        const y = row.y + ROW + j * MINI;
        parts.push(
          `<rect x="${L}" y="${y}" width="${W - L - 10}" height="${MINI - 1}" fill="var(--panel-2)" opacity=".2"/>`,
          `<text class="mini-label" x="${24 + (row.node.depth - 1) * 10}" y="${y + 9}">${esc(l.name)}</text>`,
          ...row.calls
            .filter((c) => c.lane === l.id && seen(c))
            .map((c) => bar(c, y + 1, MINI - 3)),
        );
      }
  }
  parts.push(
    ...breakParts(scale.breaks, L, H),
    ...tickParts(scale, t0, t1, x, H),
    ...promptParts(t0, t1, x, H),
  );
  for (const c of state.order.filter((k) => !isSub(k) && seen(k)))
    parts.push(bar(c, TOP + LANES.findIndex((l) => l.id === c.lane) * ROW + 5, ROW - 10));
  parts.push(...connectors(rows, x, L, W));
  if (isLive())
    parts.push(
      `<line x1="${x(now)}" x2="${x(now)}" y1="${TOP - 4}" y2="${H - 4}" stroke="var(--good)" stroke-width="2"/>`,
    );
  if (drag?.kind === "brush" && drag.moved)
    parts.push(
      `<rect class="brush" x="${L + Math.min(drag.startPx, drag.endPx)}" y="${TOP - 4}" width="${Math.abs(drag.endPx - drag.startPx)}" height="${H - TOP}"/>`,
    );
  svg.innerHTML = parts.join("");
  for (const b of $("#window")!.querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(!state.view && b.dataset["w"] === state.win));
}

const OV_LANE = 5;
const OV_H = LANES.length * OV_LANE + 8;

/** The whole session in miniature, with the part the timeline shows as a draggable window. */
export function renderOverview(): void {
  const svg = $<SVGSVGElement>("#overview")!;
  const W = drawWidth();
  const full = dataRange();
  const now = tNow();
  const scale = timeScale(full.t0, full.t1, W - L - 10, busySpans(now), GAP_MS, BREAK_PX);
  ov = { W, scale };
  svg.setAttribute("viewBox", `0 0 ${W} ${OV_H}`);
  svg.setAttribute("height", String(OV_H));
  const parts: string[] = [];
  for (const [i, l] of LANES.entries())
    parts.push(
      `<rect x="${L}" y="${4 + i * OV_LANE}" width="${W - L - 10}" height="${OV_LANE - 1}" fill="var(--panel-2)" opacity=".5"/>`,
      ...state.order
        .filter((c) => c.lane === l.id)
        .map(
          (c) =>
            `<rect class="ov-call" x="${L + scale.x(c.start)}" y="${4 + i * OV_LANE}" width="${Math.max(1.5, scale.x(c.end ?? now) - scale.x(c.start))}" height="${OV_LANE - 1}" fill="${l.color}"/>`,
        ),
    );
  for (const b of scale.breaks)
    parts.push(
      `<rect class="ov-gap" x="${L + b.x0}" y="2" width="${BREAK_PX}" height="${OV_H - 4}"/>`,
    );
  const { t0, t1 } = viewRange();
  const left = Math.max(L, L + scale.x(t0));
  const right = Math.min(W - 10, L + scale.x(t1));
  parts.push(
    `<rect class="ov-win" data-ov="win" x="${left}" y="1" width="${Math.max(4, right - left)}" height="${OV_H - 2}" rx="3"/>`,
    `<rect class="ov-h" data-ov="l" x="${left - 2}" y="1" width="5" height="${OV_H - 2}" rx="2"/>`,
    `<rect class="ov-h" data-ov="r" x="${right - 3}" y="1" width="5" height="${OV_H - 2}" rx="2"/>`,
  );
  if (ovDrag?.kind === "brush" && ovDrag.moved)
    parts.push(
      `<rect class="brush" x="${L + Math.min(ovDrag.startPx, ovDrag.endPx)}" y="1" width="${Math.abs(ovDrag.endPx - ovDrag.startPx)}" height="${OV_H - 2}"/>`,
    );
  svg.innerHTML = parts.join("");
}

const NEAR_NOW = 1000;
const tl = $<SVGSVGElement>("#timeline")!;
const overview = $<SVGSVGElement>("#overview")!;

/** Sets the visible range (kept inside the session). One reaching "now" stays pinned to it. */
function setRange(wanted: Range): void {
  const r = clampRange(wanted, dataRange());
  state.view = {
    span: Math.round(r.t1 - r.t0),
    end: r.t1 >= tNow() - NEAR_NOW ? null : Math.round(r.t1),
  };
  persist();
  redraw();
}

function resetView(): void {
  state.view = null;
  persist();
  redraw();
}

/** A pointer's offset along an svg's drawing area, in drawing pixels. */
const along = (svg: SVGSVGElement, e: MouseEvent, w: number): number => {
  const box = svg.getBoundingClientRect();
  return Math.min(Math.max(((e.clientX - box.left) * w) / box.width - L, 0), w - L - 10);
};

let redraw: () => void = renderTimeline;
/** Attaches the pointer, wheel and key handlers; `onView` redraws everything that depends on the range. */
export function wireTimeline(onView: () => void): void {
  redraw = onView;

  tl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = viewRange();
      const room = geom.W - L - 10;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY))
        setRange(panBy(r, (e.deltaX / room) * (r.t1 - r.t0)));
      else
        setRange(
          zoomAround(
            r,
            geom.scale.t(along(tl, e, geom.W)),
            Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
          ),
        );
    },
    { passive: false },
  );

  // Dragging empty space pans; shift-dragging brushes a range to zoom into. A drag starts only off
  // the bars, helper rows and P# tags, and the browser sends no click after a captured drag, so a
  // drag never picks anything.
  tl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (targetEl(e)?.closest("[data-id], [data-agent], [data-turn]") && !e.shiftKey) return;
    const px = along(tl, e, geom.W);
    drag = {
      kind: e.shiftKey ? "brush" : "pan",
      startPx: px,
      endPx: px,
      range: viewRange(),
      scale: geom.scale,
      moved: false,
    };
    tl.setPointerCapture(e.pointerId);
  });
  tl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.endPx = along(tl, e, geom.W);
    if (!drag.moved && Math.abs(drag.endPx - drag.startPx) < 4) return;
    drag.moved = true;
    if (drag.kind === "pan")
      setRange(panBy(drag.range, drag.scale.t(drag.startPx) - drag.scale.t(drag.endPx)));
    else renderTimeline();
  });
  tl.addEventListener("pointerup", () => {
    if (!drag) return;
    const done = drag;
    drag = null;
    if (done.moved && done.kind === "brush")
      setRange(brushRange(done.scale.t(done.startPx), done.scale.t(done.endPx)));
    else renderTimeline();
  });
  tl.addEventListener("keydown", (e) => {
    const r = viewRange();
    const span = r.t1 - r.t0;
    const mid = r.t0 + span / 2;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => {
        setRange(panBy(r, -span * 0.1));
      },
      ArrowRight: () => {
        setRange(panBy(r, span * 0.1));
      },
      "+": () => {
        setRange(zoomAround(r, mid, 0.8));
      },
      "=": () => {
        setRange(zoomAround(r, mid, 0.8));
      },
      "-": () => {
        setRange(zoomAround(r, mid, 1.25));
      },
      "0": resetView,
    };
    const act = actions[e.key];
    if (!act) return;
    e.preventDefault();
    act();
  });

  // The overview: drag the window to pan, its edges to set the start or end, anywhere else to brush.
  const ovKinds: Record<string, OvKind> = { win: "win", l: "l", r: "r" };
  overview.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const px = along(overview, e, ov.W);
    const kind =
      ovKinds[targetEl(e)?.closest<SVGElement>("[data-ov]")?.dataset["ov"] ?? ""] ?? "brush";
    ovDrag = { kind, startPx: px, endPx: px, range: viewRange(), scale: ov.scale, moved: false };
    overview.setPointerCapture(e.pointerId);
  });
  overview.addEventListener("pointermove", (e) => {
    if (!ovDrag) return;
    ovDrag.endPx = along(overview, e, ov.W);
    if (!ovDrag.moved && Math.abs(ovDrag.endPx - ovDrag.startPx) < 4) return;
    ovDrag.moved = true;
    const { kind, range, scale, startPx, endPx } = ovDrag;
    const t = scale.t(endPx);
    if (kind === "win") setRange(panBy(range, t - scale.t(startPx)));
    else if (kind === "l") setRange(brushRange(t, range.t1));
    else if (kind === "r") setRange(brushRange(range.t0, t));
    else renderOverview();
  });
  overview.addEventListener("pointerup", () => {
    if (!ovDrag) return;
    const done = ovDrag;
    ovDrag = null;
    if (done.moved && done.kind === "brush")
      setRange(brushRange(done.scale.t(done.startPx), done.scale.t(done.endPx)));
    else renderOverview();
  });

  $("#reset-view")!.addEventListener("click", resetView);
  $("#jump-now")!.addEventListener("click", () => {
    const r = viewRange();
    setRange({ t0: tNow() - (r.t1 - r.t0), t1: tNow() });
  });
}
