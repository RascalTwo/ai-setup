// viz.js — shared helpers for /viz pages. Load with:
//   <script type="module">
//     import { arrowMarkers, connect, side, labelBox, vizAudit, $, $$, esc, saveHash, loadHash, vizEnv } from "/_kit/viz.js";
//   </script>
// Served by the viz server at /_kit/viz.js from the skill's own kit/ dir, so it's
// one source of truth across every viz. Pairs with /_kit/viz-kit.css.

export const SVGNS = "http://www.w3.org/2000/svg";

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
const DEFAULT_MARKERS = {
  ah: "var(--muted)", // the default edge
  "ah-accent": "var(--accent)",
  "ah-good": "var(--good)",
  "ah-warn": "var(--warn)",
  "ah-danger": "var(--danger)",
};

// Returns a <defs>…</defs> string. Drop it once at the top of your <svg>.
export function arrowMarkers(palette = DEFAULT_MARKERS) {
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
export const center = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

export const side = (n, where) =>
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
export function connect(a, b) {
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
export function labelBox(node, html, cls = "") {
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
export function vizAudit(root = document) {
  const bad = [];
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

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Escape before injecting text into innerHTML.
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// Hot-reload (and every save) does a full page refresh, so in-page state is wiped.
// Persist anything you want to survive — open panel, selected step, active filters —
// to the URL hash. Bonus: the URL becomes shareable/deep-linkable for free.
// Round-trips a plain object.
export const saveHash = (obj) =>
  location.replace("#" + encodeURIComponent(JSON.stringify(obj)));

export const loadHash = () => {
  try {
    return JSON.parse(decodeURIComponent(location.hash.slice(1)) || "{}");
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
export function stepper({ n, onStep, autoplayMs = 0, hashKey = "step", target = document } = {}) {
  let i = Math.min(Math.max(loadHash()[hashKey] ?? 0, 0), n - 1);
  let timer = null;

  const emit = () => {
    saveHash({ ...loadHash(), [hashKey]: i });
    onStep?.(i);
  };
  const go = (to, manual = true) => {
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
    clearInterval(timer);
    timer = null;
  };

  const KEYS = {
    ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1,
    ArrowLeft: -1, ArrowUp: -1, PageUp: -1,
  };
  target.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key in KEYS) {
      e.preventDefault(); // else Space/PageDown scrolls the page too
      go(i + KEYS[e.key]);
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
export function twoAxis(el, { x: xr = [0, 1], y: yr = [0, 1], start, onChange, speed = 1 } = {}) {
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  const span = (r) => r[1] - r[0];
  let x = start ? start[0] : (xr[0] + xr[1]) / 2;
  let y = start ? start[1] : (yr[0] + yr[1]) / 2;
  let px = null, py = null;

  el.style.touchAction = "none"; // else the browser scrolls instead of dragging
  el.style.cursor = "grab";

  el.addEventListener("pointerdown", (e) => {
    px = e.clientX; py = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = "grabbing";
  });
  el.addEventListener("pointermove", (e) => {
    if (px === null) return;
    const r = el.getBoundingClientRect();
    // Normalize by element size so sensitivity doesn't depend on render scale.
    x = clamp(x + ((e.clientX - px) / r.width) * span(xr) * speed, xr);
    y = clamp(y + ((e.clientY - py) / r.height) * span(yr) * speed, yr);
    px = e.clientX; py = e.clientY;
    onChange?.(x, y);
  });
  const end = () => {
    px = py = null;
    el.style.cursor = "grab";
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  onChange?.(x, y);
  return {
    set: (nx, ny) => {
      x = clamp(nx, xr); y = clamp(ny, yr);
      onChange?.(x, y);
    },
    get value() {
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
export function figureLifecycle(figures, { root = null } = {}) {
  const seen = new Map();

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

  let activeF = null;
  function pickActive() {
    const mid = window.innerHeight / 2;
    let best = null, bestD = Infinity;
    for (const f of figures) {
      if (!seen.get(f)) continue;
      const r = f.el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) { bestD = d; best = f; }
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
    requestAnimationFrame(() => { queued = false; pickActive(); });
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    for (const f of figures) f.setVisible?.(!document.hidden && !!seen.get(f));
  });

  pickActive();
  return {
    get active() { return activeF; },
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
//               one this session; build.ts stamps window.__VIZ_STATIC__ into the
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
let _vizEnvP;
export function vizEnv() {
  return (_vizEnvP ??= (async () => {
    if (typeof window !== "undefined" && window.__VIZ_STATIC__) return "static";
    try {
      const r = await fetch("/_health", { cache: "no-store" });
      return r.ok ? "live" : "offline";
    } catch {
      return "offline";
    }
  })());
}
