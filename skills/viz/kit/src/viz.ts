// viz.js — shared helpers for /viz pages. Load with:
//   <script type="module">
//     import { arrowMarkers, connect, side, labelBox, vizAudit, $, $$, esc, saveHash, loadHash, vizEnv } from "@viz/kit";
//   </script>
// Served by the viz server at /_kit/viz.js from the skill's own kit/ dir, so it's
// one source of truth across every viz. Pairs with /_kit/viz-kit.css.

export const SVGNS = "http://www.w3.org/2000/svg";

/** A node: where it is and how big. Everything else in a diagram is computed from it. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export type Side = "top" | "bottom" | "left" | "right";

/** What a film registers on `window.__viz.timeline`, and what `narrate()` reads. */
export interface Timeline {
  at(): number;
  /** Playback speed; film() has a selector. Clips follow it. */
  readonly rate?: number;
  total?: number;
  seek?(t: number): void;
  play?(): void;
  pause?(): void;
  chapters?: { n: number; title: string; t0: number; dur: number }[];
}

/** One placed clip in `.tts/manifest.json` (compiled by `viz verify` / `viz render`). */
export interface Cue {
  at?: string | number;
  t: number;
  dur: number;
  slotDur?: number;
  src: string;
  gain?: number;
  text?: string;
  caption?: boolean;
  words?: [string, number, number][];
}
export interface Manifest {
  cues: Cue[];
  tracks?: { id: string; label: string; cues: Cue[] }[];
  warnings?: string[];
}

declare global {
  interface Window {
    /** Stamped by `viz publish` into a self-contained build: no server, ever. */
    __VIZ_STATIC__?: boolean;
    /** A published build's narration manifest, inlined (clips as data: URLs). */
    __vizTts?: Manifest;
    __viz?: { timeline?: Timeline };
  }
}

// ---------------------------------------------------------------------------
// SVG diagrams — geometry first.
//
// The recurring rework in boxes-and-arrows diagrams comes from typing label and
// arrow coordinates as independent literals: a box gets resized or moved, but the
// arrow endpoint and the label position were guessed against the *old* geometry,
// so the arrow now points at empty space (or the wrong box) and the label spills
// out. The fix is to never hand-place those: define each node ONCE as {x,y,w,h}
// and compute everything else from it.
// ---------------------------------------------------------------------------

// Default arrowhead palette, keyed to the viz-kit intent tokens. SVG markers can't
// inherit the stroke color of the line that uses them, so you genuinely need one
// marker per color — this emits them all with stable ids so you stop re-deriving
// the same <marker> block per diagram. Reference as marker-end="url(#ah-accent)".
//
// These are var() references, not hexes, ON PURPOSE: a page that overrides the
// tokens (see kit/README.md) re-themes its arrowheads for free. Hardcoding the
// hexes here would silently strand every marker at the default palette.
const DEFAULT_MARKERS: Record<string, string> = {
  ah: "var(--muted)", // the default edge
  "ah-accent": "var(--accent)",
  "ah-good": "var(--good)",
  "ah-warn": "var(--warn)",
  "ah-danger": "var(--danger)",
};

// Returns a <defs>…</defs> string. Drop it once at the top of your <svg>.
export function arrowMarkers(palette: Record<string, string> = DEFAULT_MARKERS): string {
  const markers = Object.entries(palette)
    .map(
      ([id, fill]) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" ` +
        `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`,
    )
    .join("");
  return `<defs>${markers}</defs>`;
}

// A node is just {x, y, w, h}. center() and side() derive connection points from
// it, so an edge stays attached to the box no matter how the box changes.
export const center = (n: Box): Point => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

export const side = (n: Box, where: Side): Point =>
  ({
    top: { x: n.x + n.w / 2, y: n.y },
    bottom: { x: n.x + n.w / 2, y: n.y + n.h },
    left: { x: n.x, y: n.y + n.h / 2 },
    right: { x: n.x + n.w, y: n.y + n.h / 2 },
  })[where];

// Straight edge between two nodes, auto-picking the facing sides based on their
// relative position. Returns an SVG path "d" string; set the marker yourself via
// the element's marker-end attribute. For >5 nodes with crossing edges, reach for
// a layout engine (dagre / d3-dag / mermaid) instead of placing nodes by hand —
// that's the point where manual coordinates stop being worth it.
export function connect(a: Box, b: Box): string {
  const ca = center(a),
    cb = center(b);
  const horiz = Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y);
  const pa = horiz
    ? side(a, cb.x > ca.x ? "right" : "left")
    : side(a, cb.y > ca.y ? "bottom" : "top");
  const pb = horiz
    ? side(b, cb.x > ca.x ? "left" : "right")
    : side(b, cb.y > ca.y ? "top" : "bottom");
  return `M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`;
}

// A label that CANNOT overflow its box. <foreignObject> lets the browser wrap and
// ellipsize HTML natively, unlike raw <text> which you'd have to measure by hand
// (and historically guessed wrong). Use this for any multi-word label inside a
// fixed-width box. Style via the .vsvg-label class in viz-kit.css.
export function labelBox(node: Box, html: string, cls = ""): string {
  return (
    `<foreignObject x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="vsvg-label ${cls}">${html}</div>` +
    `</foreignObject>`
  );
}

// Verification backstop. If you DO hand-roll <text>, call this once after render:
// it outlines (in red) any <text> whose bounding box spills past the <rect> in its
// group, and drops a fixed banner so an overflow is impossible to miss in the open
// browser — or in any screenshot you take to verify the page. Returns the list of
// offending strings (empty = clean). The rect-in-same-<g> pairing is a heuristic;
// it catches the common case where each box+label live in one <g>.
export function vizAudit(root: ParentNode = document): (string | null)[] {
  const bad: (string | null)[] = [];
  for (const t of root.querySelectorAll("text")) {
    const rect = t.closest("g")?.querySelector("rect");
    if (!rect) continue;
    const tb = t.getBBox();
    const rb = rect.getBBox();
    const spills =
      tb.x < rb.x - 1 ||
      tb.y < rb.y - 1 ||
      tb.x + tb.width > rb.x + rb.width + 1 ||
      tb.y + tb.height > rb.y + rb.height + 1;
    if (spills) {
      t.style.outline = "1px solid #f85149";
      bad.push(t.textContent);
    }
  }
  if (bad.length) {
    console.error("[vizAudit] text overflow:", bad);
    const banner = document.createElement("div");
    banner.textContent = `⚠ ${bad.length} text overflow(s) — see red outlines`;
    banner.style.cssText =
      "position:fixed;left:8px;bottom:8px;z-index:9999;background:#f85149;color:#fff;" +
      "font:12px/1 sans-serif;padding:6px 10px;border-radius:6px";
    document.body.appendChild(banner);
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Small utilities that every viz re-derives.
// ---------------------------------------------------------------------------

// `$` and `$$` type like querySelector: a tag name gives that element's type, anything
// else an Element you narrow yourself. `$` can miss, so it can be null.
export function $<K extends keyof HTMLElementTagNameMap>(
  sel: K,
  root?: ParentNode,
): HTMLElementTagNameMap[K] | null;
export function $<K extends keyof SVGElementTagNameMap>(
  sel: K,
  root?: ParentNode,
): SVGElementTagNameMap[K] | null;
export function $<E extends Element = HTMLElement>(sel: string, root?: ParentNode): E | null;
export function $(sel: string, root: ParentNode = document): Element | null {
  return root.querySelector(sel);
}
export function $$<K extends keyof HTMLElementTagNameMap>(
  sel: K,
  root?: ParentNode,
): HTMLElementTagNameMap[K][];
export function $$<K extends keyof SVGElementTagNameMap>(
  sel: K,
  root?: ParentNode,
): SVGElementTagNameMap[K][];
export function $$<E extends Element = HTMLElement>(sel: string, root?: ParentNode): E[];
export function $$(sel: string, root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(sel)];
}

// Escape before injecting text into innerHTML.
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

// Hot-reload (and every save) does a full page refresh, so in-page state is wiped.
// Persist anything you want to survive — open panel, selected step, active filters —
// to the URL hash. Bonus: the URL becomes shareable/deep-linkable for free.
// Round-trips a plain object. Say what your hash holds: `loadHash<{ step: number }>()` —
// every key may be missing (a fresh URL, an old link), so each comes back optional.
export const saveHash = (obj: object): void =>
  location.replace("#" + encodeURIComponent(JSON.stringify(obj)));

export const loadHash = <T extends object = Record<string, unknown>>(): Partial<T> => {
  try {
    return JSON.parse(decodeURIComponent(location.hash.slice(1)) || "{}") as Partial<T>;
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Stepped walkthroughs — the second-most re-derived thing after SVG geometry.
//
// ~20 vizzes hand-rolled arrow-key stepping and each got a different subset
// right: some called preventDefault (so the page didn't also scroll), some
// clamped at the ends, some wrapped, some left an autoplay timer running after
// the user manually navigated. This is that logic once, with the URL-hash
// round-trip wired in so a step survives hot-reload.
//
//   const s = stepper({ n: STEPS.length, onStep: i => render(i) });
//
// Binds ←/→/↑/↓, Space, PageUp/Down, Home/End on the document. Autoplay pauses
// on any manual navigation. Returns handles so you can drive it from buttons too.
export interface StepperOptions {
  /** How many steps. */
  n: number;
  onStep?: (i: number) => void;
  autoplayMs?: number;
  hashKey?: string;
  target?: EventTarget;
}
export interface Stepper {
  go(to: number, manual?: boolean): void;
  next(): void;
  prev(): void;
  play(): void;
  pause(): void;
  readonly current: number;
}

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

export function stepper({
  n,
  onStep,
  autoplayMs = 0,
  hashKey = "step",
  target = document,
}: StepperOptions): Stepper {
  let i = Math.min(Math.max(Number(loadHash()[hashKey] ?? 0), 0), n - 1);
  let timer: ReturnType<typeof setInterval> | null = null;

  const emit = () => {
    saveHash({ ...loadHash(), [hashKey]: i });
    onStep?.(i);
  };
  const go = (to: number, manual = true) => {
    const next = Math.min(Math.max(to, 0), n - 1);
    if (manual) pause(); // a manual nav always wins over autoplay
    if (next === i) return;
    i = next;
    emit();
  };
  const play = () => {
    if (timer || !autoplayMs) return;
    timer = setInterval(() => {
      if (i >= n - 1) return pause();
      go(i + 1, false);
    }, autoplayMs);
  };
  const pause = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const KEYS: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    PageDown: 1,
    " ": 1,
    ArrowLeft: -1,
    ArrowUp: -1,
    PageUp: -1,
  };
  target.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) return;
    const d = KEYS[e.key];
    if (d !== undefined) {
      e.preventDefault(); // else Space/PageDown scrolls the page too
      go(i + d);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(n - 1);
    }
  });

  emit();
  if (autoplayMs) play();

  return {
    go,
    next: () => go(i + 1),
    prev: () => go(i - 1),
    play,
    pause,
    get current() {
      return i;
    },
  };
}

// ---------------------------------------------------------------------------
// Direct manipulation — drag the artwork, not a slider.
//
// The best interactive explainers on the web (Ciechanowski's, notably) contain
// almost zero <input type="range">. Instead you drag the figure ITSELF, and one
// pointer drag drives two parameters at once. A slider puts a strip of UI chrome
// between the reader and the phenomenon; dragging the thing removes it.
//
//   twoAxis(svg, {
//     x: [0, 1], y: [-90, 90],          // clamped ranges
//     onChange: (x, y) => redraw(x, y),
//   });
//
// Uses pointer events + setPointerCapture, so mouse/touch/pen all work and a drag
// that leaves the element still tracks. Set `speed` to tune sensitivity.
export type Range = readonly [lo: number, hi: number];
export interface TwoAxisOptions {
  x?: Range;
  y?: Range;
  start?: readonly [number, number];
  onChange?: (x: number, y: number) => void;
  speed?: number;
}
export interface TwoAxis {
  set(x: number, y: number): void;
  readonly value: [number, number];
}

export function twoAxis(
  el: HTMLElement | SVGElement,
  { x: xr = [0, 1], y: yr = [0, 1], start, onChange, speed = 1 }: TwoAxisOptions = {},
): TwoAxis {
  const clamp = (v: number, [lo, hi]: Range) => Math.min(hi, Math.max(lo, v));
  const span = (r: Range) => r[1] - r[0];
  let x = start ? start[0] : (xr[0] + xr[1]) / 2;
  let y = start ? start[1] : (yr[0] + yr[1]) / 2;
  let px: number | null = null,
    py: number | null = null;

  // HTML and SVG elements share one set of pointer events, but TypeScript can't merge the two
  // typed addEventListener overloads of the union, so type against the shared map directly.
  const on = <K extends keyof GlobalEventHandlersEventMap>(
    type: K,
    f: (e: GlobalEventHandlersEventMap[K]) => void,
  ) => el.addEventListener(type, f as EventListener);

  el.style.touchAction = "none"; // else the browser scrolls instead of dragging
  el.style.cursor = "grab";

  on("pointerdown", (e) => {
    px = e.clientX;
    py = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = "grabbing";
  });
  on("pointermove", (e) => {
    if (px === null || py === null) return;
    const r = el.getBoundingClientRect();
    // Normalize by element size so sensitivity doesn't depend on render scale.
    x = clamp(x + ((e.clientX - px) / r.width) * span(xr) * speed, xr);
    y = clamp(y + ((e.clientY - py) / r.height) * span(yr) * speed, yr);
    px = e.clientX;
    py = e.clientY;
    onChange?.(x, y);
  });
  const end = () => {
    px = py = null;
    el.style.cursor = "grab";
  };
  on("pointerup", end);
  on("pointercancel", end);

  onChange?.(x, y);
  return {
    set: (nx, ny) => {
      x = clamp(nx, xr);
      y = clamp(ny, yr);
      onChange?.(x, y);
    },
    get value(): [number, number] {
      return [x, y];
    },
  };
}

// ---------------------------------------------------------------------------
// Figure lifecycle — only render what's on screen, and give ONE figure focus.
//
// A long explainer with many animated figures will melt a laptop if they all run
// at once. Two separate signals fix it, and the second is a narrative device as
// much as a perf one:
//   visible — is this figure on screen at all?  → stop drawing when it isn't
//   active  — is this the figure the reader is LOOKING at (most centered)?
//             → exactly one at a time; use it to run the "hero" animation, show
//               controls, or start audio, so the page tells you where to look.
//
//   figureLifecycle([{ el, setVisible, setActive }, ...]);
//
// Also pauses everything when the tab is hidden — background tabs throttle
// requestAnimationFrame to ~1fps, which silently stalls animation loops.
export interface Figure {
  el: Element;
  setVisible?: (visible: boolean) => void;
  setActive?: (active: boolean) => void;
}

export function figureLifecycle<F extends Figure>(
  figures: F[],
  { root = null }: { root?: Element | Document | null } = {},
): { readonly active: F | null; destroy(): void } {
  const seen = new Map<F, boolean>();

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const f = figures.find((f) => f.el === e.target);
        if (!f) continue;
        seen.set(f, e.isIntersecting);
        f.setVisible?.(e.isIntersecting && !document.hidden);
      }
      pickActive();
    },
    { root, threshold: 0 },
  );
  figures.forEach((f) => io.observe(f.el));

  let activeF: F | null = null;
  function pickActive() {
    const mid = window.innerHeight / 2;
    let best: F | null = null,
      bestD = Infinity;
    for (const f of figures) {
      if (!seen.get(f)) continue;
      const r = f.el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (best === activeF) return;
    activeF?.setActive?.(false);
    activeF = best;
    activeF?.setActive?.(true);
  }

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      pickActive();
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    for (const f of figures) f.setVisible?.(!document.hidden && !!seen.get(f));
  });

  pickActive();
  return {
    get active() {
      return activeF;
    },
    destroy() {
      io.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime environment — is there a live viz server behind this page?
//
// A viz can run in three worlds, and live-data UI needs to know which:
//   "static"  — a published/inlined build. There is NO server and never will be
//               one this session; viz publish stamps window.__VIZ_STATIC__ into the
//               self-contained HTML it emits.
//   "live"    — served by the viz dev server, and it answers (fetch api/* will work).
//   "offline" — served as if by a server, but it isn't answering right now (dev
//               server stopped, opened from disk, etc.) — treat like static.
//
// Probes the server-global /_health once and caches the promise. Use it to gate
// anything that fetches api/*: render real data only on "live", otherwise show a
// "run me locally for live data" placeholder instead of spinning forever.
//   const env = await vizEnv();
//   if (env !== "live") { showPlaceholder(); return; }
export type VizEnv = "static" | "live" | "offline";
let _vizEnvP: Promise<VizEnv> | undefined;
export function vizEnv(): Promise<VizEnv> {
  return (_vizEnvP ??= (async (): Promise<VizEnv> => {
    if (typeof window !== "undefined" && window.__VIZ_STATIC__) return "static";
    try {
      const r = await fetch("/_health", { cache: "no-store" });
      return r.ok ? "live" : "offline";
    } catch {
      return "offline";
    }
  })());
}

// ---------------------------------------------------------------------------
// Narration — play a film's narration.json in sync with its timeline.
//
// `viz verify` / `viz render` compile narration.json into .tts/manifest.json (Kokoro
// clips + your audio/ files, each placed at a time). This plays the same clips at the
// same moments, so stepping the page sounds like the rendered video. Captions show
// on the page behind a CC toggle; `viz render` hides them (the mp4 carries a subtitle
// track instead). Call once, after registering the timeline:
//   window.__viz = { timeline: { total, seek, play, pause, at, chapters } };
//   narrate(window.__viz.timeline);
// It only reads timeline.at(): the playhead creeping forward frame to frame is "playing";
// standing still or jumping (a seek, a step) is not. So it needs no hooks into the film,
// and a film that autoplays, loops or ends on its own still sounds right.
export async function narrate(
  timeline: Timeline,
  {
    manifest = ".tts/manifest.json",
    controls = null,
  }: { manifest?: string; controls?: Element | null } = {},
): Promise<void> {
  // A published build inlines the manifest (clips as data: URLs); a live page fetches it.
  const data: Manifest | null =
    window.__vizTts ??
    (await fetch(manifest).then(
      (r) => (r.ok ? (r.json() as Promise<Manifest>) : null),
      () => null,
    ));
  if (!data)
    return console.info(
      "[viz narration] no .tts/manifest.json yet — `viz verify` compiles narration.json",
    );
  for (const w of data.warnings ?? []) console.warn(`[viz narration] ${w}`);

  const tracks = (
    data.tracks?.length ? data.tracks : [{ id: "default", label: "Default", cues: data.cues }]
  ).map((track) => ({
    ...track,
    cues: track.cues.map((c) => ({
      ...c,
      el: Object.assign(new Audio(c.src), {
        preload: "auto",
        volume: Math.min(1, 10 ** ((c.gain ?? 0) / 20)),
      }),
    })),
  }));
  let selected = tracks.findIndex((track) => track.id === localStorage.getItem("viz-voice"));
  if (selected < 0) selected = 0;
  // Captions: bottom-centre by default; drag them anywhere (remembered per page), double-click
  // to put them back. #viz-captions is hidden in renders — the mp4 carries a subtitle track.
  const box = document.createElement("div");
  box.id = "viz-captions";
  const text = document.createElement("p");
  text.hidden = true;
  text.title = "drag to move · double-click to reset";
  box.append(text);
  box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000";
  text.style.cssText =
    "position:fixed;margin:0;max-width:min(80ch,90vw);padding:6px 12px;border-radius:6px;background:rgba(0,0,0,.75);color:#fff;font:500 20px/1.35 system-ui,sans-serif;text-align:center;pointer-events:auto;cursor:grab;user-select:none;touch-action:none";
  document.body.append(box);
  const posKey = `viz-cc-pos:${location.pathname}`;
  const place = (p: Point | null) => {
    if (p)
      Object.assign(text.style, {
        left: p.x * innerWidth + "px",
        top: p.y * innerHeight + "px",
        bottom: "",
        transform: "translate(-50%,-50%)",
      });
    else
      Object.assign(text.style, {
        left: "50%",
        top: "",
        bottom: "var(--viz-captions-bottom,24px)",
        transform: "translateX(-50%)",
      });
  };
  place(JSON.parse(localStorage.getItem(posKey) ?? "null") as Point | null);
  text.addEventListener("pointerdown", (e) => {
    text.setPointerCapture(e.pointerId);
    text.style.cursor = "grabbing";
    const move = (ev: PointerEvent) =>
      place({ x: ev.clientX / innerWidth, y: ev.clientY / innerHeight });
    const up = (ev: PointerEvent) => {
      text.removeEventListener("pointermove", move);
      text.style.cursor = "grab";
      localStorage.setItem(
        posKey,
        JSON.stringify({ x: ev.clientX / innerWidth, y: ev.clientY / innerHeight }),
      );
    };
    text.addEventListener("pointermove", move);
    text.addEventListener("pointerup", up, { once: true });
  });
  text.addEventListener("dblclick", () => {
    localStorage.removeItem(posKey);
    place(null);
  });

  // CC toggle: inside the page's own controls when it has them (film() passes its bar), else
  // bottom-left — bottom-right belongs to the viz comment bubble.
  const cc = Object.assign(document.createElement("button"), {
    type: "button",
    title: "Captions (c)",
    textContent: "CC",
  });
  cc.setAttribute("aria-pressed", "true");
  if (controls) controls.append(cc);
  else {
    cc.style.cssText =
      "position:fixed;left:12px;bottom:12px;font:600 11px ui-monospace,monospace;padding:3px 7px;border-radius:4px;border:1px solid var(--border,#30363d);background:var(--panel,#161b22);color:var(--text,#e6edf3);cursor:pointer;z-index:2147483000";
    document.body.append(cc);
  }
  cc.dataset["vizChrome"] = "";

  if (tracks.length > 1 && controls) {
    const voice = document.createElement("select");
    voice.setAttribute("aria-label", "Narration voice");
    voice.title = "Narration voice";
    voice.dataset["vizChrome"] = "";
    voice.innerHTML = tracks
      .map(
        (track, i) =>
          `<option value="${i}">${track.label.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)}</option>`,
      )
      .join("");
    voice.value = String(selected);
    voice.onchange = () => {
      for (const track of tracks) for (const cue of track.cues) cue.el.pause();
      selected = +voice.value;
      localStorage.setItem("viz-voice", tracks[selected]!.id);
    };
    controls.append(voice);
  }

  let on = localStorage.getItem("viz-cc") !== "0";
  const show = () => {
    cc.setAttribute("aria-pressed", String(on));
    cc.style.opacity = on ? "1" : ".5";
  };
  const toggle = () => {
    on = !on;
    localStorage.setItem("viz-cc", on ? "1" : "0");
    show();
  };
  show();
  cc.onclick = toggle;
  addEventListener("keydown", (e) => {
    if (
      e.key === "c" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !(e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))
    )
      toggle();
  });

  let last = timeline.at();
  (function loop() {
    const t = timeline.at();
    const step = t - last;
    last = t;
    const playing = step > 0 && step < 0.25; // forward by about a frame; bigger jumps are seeks
    const rate = timeline.rate ?? 1; // film() has a speed control; the clips follow it
    for (const c of tracks[selected]!.cues) {
      if (c.el.playbackRate !== rate) c.el.playbackRate = rate;
      const into = t - c.t;
      if (playing && into >= 0 && into < c.dur) {
        // Start, or pull back into sync if the film and the clip have drifted apart.
        if (c.el.paused || Math.abs(c.el.currentTime - into) > 0.3) {
          c.el.currentTime = into;
          c.el.play().catch(() => {});
        }
      } else if (!c.el.paused) c.el.pause();
    }
    const said = on && tracks[selected]!.cues.find((c) => c.text && t >= c.t && t < c.t + c.dur);
    text.textContent = said ? (said.text ?? "") : "";
    text.hidden = !said;
    requestAnimationFrame(loop);
  })();
}
