// film-frame.ts — one frame of the film, as a pure function of t (no CSS transitions), so
// `viz render` — seek, then shoot — is exactly as smooth as live playback.
//
// data-h="b:d:xb:xd;…" — highlight intervals: --h rises at beat b + d seconds, falls at beat xb
// + xd. Several intervals take the max, so a line said twice lights up twice.

import { chapterAt, ease, fmt, type Chapter } from "@viz/kit/film-shared.js";
import { $$ } from "@viz/kit";

type Animated = {
  el: HTMLElement;
  b: number | null;
  d: number;
  x: number | null;
  fx: number | null;
  fd: number;
  h: [number, number, number, number][] | null;
};

const num = (v: string | undefined) => (v ? +v : null);
const scan = (root: HTMLElement): Animated[] =>
  $$("[data-b],[data-fx],[data-h]", root).map((el) => ({
    el,
    b: num(el.dataset["b"]),
    d: +(el.dataset["d"] ?? 0),
    x: num(el.dataset["x"]),
    fx: num(el.dataset["fx"]),
    fd: +(el.dataset["fd"] ?? 0),
    h: el.dataset["h"]
      ? el.dataset["h"].split(";").map((iv): [number, number, number, number] => {
          const [b = 0, d = 0, xb = 0, xd = 0] = iv.split(":").map(Number);
          return [b, d, xb, xd];
        })
      : null,
  }));

/** What a frame draws onto: the stage, its scenes, the chapter bar and the controls' readouts. */
export interface FrameView {
  root: HTMLElement;
  scenes: HTMLElement[];
  chapters: Chapter[];
  segs: HTMLElement[];
  clock: HTMLElement;
  scrub: HTMLInputElement;
  ctlPos: HTMLElement;
  start: (b: number) => number;
  total: number;
  drawCursor: (time: number) => void;
}

/** Sets --p / --q / --h on every animated element from t. */
function drawElements(els: Animated[], start: (b: number) => number, t: number) {
  for (const e of els) {
    if (e.b !== null) {
      let p = ease((t - start(e.b) - e.d) / 0.5);
      if (e.x !== null) p *= 1 - ease((t - start(e.x)) / 0.4);
      e.el.style.setProperty("--p", p.toFixed(3));
    }
    if (e.fx !== null)
      e.el.style.setProperty("--q", ease((t - start(e.fx) - e.fd) / 0.7).toFixed(3));
    if (e.h)
      e.el.style.setProperty(
        "--h",
        Math.max(
          ...e.h.map(
            ([b, d, xb, xd]) =>
              ease((t - start(b) - d) / 0.2) * (1 - ease((t - start(xb) - xd) / 0.3)),
          ),
        ).toFixed(3),
      );
  }
}

/** Cross-fades the scenes: only the chapter `t` is in shows. */
function drawScenes(v: FrameView, t: number) {
  v.scenes.forEach((s, i) => {
    const c = v.chapters[i];
    if (!c) return;
    const fin = i === 0 ? 1 : ease((t - c.t0) / 0.4);
    const fout = i === v.chapters.length - 1 ? 1 : 1 - ease((t - (c.t0 + c.dur - 0.35)) / 0.35);
    const o = t >= c.t0 - 0.01 && t < c.t0 + c.dur + 0.01 ? fin * fout : 0;
    s.style.opacity = String(o);
    s.style.visibility = o > 0 ? "visible" : "hidden";
  });
  v.segs.forEach((s, i) => {
    const c = v.chapters[i];
    if (c) s.style.setProperty("--f", String(Math.min(1, Math.max(0, (t - c.t0) / c.dur))));
  });
}

export function createFrame(v: FrameView): { draw: (t: number) => void; rescan: () => void } {
  let els = scan(v.root);
  function draw(t: number) {
    drawElements(els, v.start, t);
    drawScenes(v, t);
    v.drawCursor(t);
    // Canvas/WebGL scenes draw here, synchronously, from t alone — a rAF loop can't be seeked.
    v.root.dispatchEvent(new CustomEvent("viz-frame", { detail: { t, start: v.start } }));
    const ci = chapterAt(v.chapters, t);
    for (const el of $$(".pos", v.root.parentNode ?? document))
      el.textContent = `${ci + 1} / ${v.chapters.length}`;
    v.clock.textContent = `${fmt(t)} / ${fmt(v.total)}`;
    v.scrub.value = String(Math.round((t / v.total) * 1000));
    v.ctlPos.textContent = `${ci + 1}/${v.chapters.length} · ${fmt(t)}/${fmt(v.total)}`;
  }
  return {
    draw,
    rescan: () => {
      els = scan(v.root);
    },
  };
}
