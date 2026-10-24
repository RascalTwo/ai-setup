// film.js — a narrated, timed film on a fixed 1920×1080 stage (reference/timeline.md).
//
// Markup drives it. Scenes are chapters; a scene lists the narration beats it plays:
//   <div id="stage">
//     <section class="scene" data-title="The problem" data-beats="1-4"> … </section>
//   </div>
// Inside, anything with data-b="N" appears when beat N starts (data-d="1.2" delays it,
// data-x="M" fades it out when beat M starts); data-fx="N" drives a second 0→1 value, --q,
// for effects (a strike-through, an expanding box); data-h="b:d:xb:xd;…" drives --h up and back
// down — a highlight while the narration talks about the element. Animate with var(--p) /
// var(--q) / var(--h) in CSS. setCursor() adds a gliding cursor (ui-narration's arrow).
//
// Timing comes from narration.json + the compiled .tts/manifest.json: a beat lasts as long as
// its spoken line plus a breath, so the picture waits for the voice by construction. Before the
// first `viz verify` compiles the clips, it estimates from word count.
//
// Every frame is a pure function of t (no CSS transitions), so `viz render` — seek, then shoot
// — is exactly as smooth as live playback, and window.__viz.timeline is registered for it.
// Motion CSS can't express (a WebGL camera) listens for "viz-frame" on the stage: every draw
// dispatches it with { t, start } (start(b) = beat b's start time) and it must render right then.
//   import { film } from "@viz/kit/film.js";
//   const f = await film();          // → { timeline, chapters, beats }

import { $, $$, narrate, saveHash, loadHash } from "@viz/kit";
import {
  chapterAt,
  must,
  type CursorFrame,
  type Film,
  type FilmOptions,
  type FilmTimeline,
} from "@viz/kit/film-shared.js";
import { loadTimings } from "@viz/kit/film-timing.js";
import { createCursor } from "@viz/kit/film-cursor.js";
import { createFrame } from "@viz/kit/film-frame.js";
import { buildBar, buildControls, createRate, wireControls } from "@viz/kit/film-controls.js";

export type {
  Beat,
  Chapter,
  CursorFrame,
  Film,
  FilmOptions,
  FilmTimeline,
} from "@viz/kit/film-shared.js";

const CSS = `
html, body { margin: 0; height: 100%; background: #05070a; overflow: hidden; }
#stage { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; overflow: hidden;
  background: radial-gradient(1400px 700px at 70% -10%, #13233a 0%, var(--bg) 60%); color: var(--text); font: 30px/1.35 var(--sans); }
#stage [data-b] { opacity: var(--p, 0); transform: translateY(calc((1 - var(--p, 0)) * 18px)); }
#stage [data-b].still { transform: none; }
#stage .scene { position: absolute; left: 80px; right: 80px; top: 70px; bottom: 110px; }
#stage .scene[data-zoom] { zoom: var(--z); }
#film-bar { position: absolute; left: 80px; right: 80px; bottom: 40px; }
#film-bar .segs { display: flex; gap: 6px; height: 12px; }
#film-bar .segs div { position: relative; background: #1d2530; border-radius: 3px; overflow: hidden; }
#film-bar .segs i { position: absolute; inset: 0; width: calc(var(--f, 0) * 100%); background: var(--accent); }
#film-bar .meta { display: flex; justify-content: space-between; margin-top: 10px; font: 18px var(--mono); color: var(--faint); }
#film-controls { position: fixed; left: 14px; bottom: 14px; display: flex; gap: 8px; align-items: center;
  background: rgba(22,27,34,.92); border: 1px solid var(--border); border-radius: 12px; padding: 8px 12px; z-index: 10; font: 13px var(--mono); color: var(--muted); }
#film-controls button, #film-controls select { font: 600 14px var(--mono); background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 7px; padding: 6px 10px; cursor: pointer; }
#film-controls input { width: 360px; }
:root { --viz-captions-bottom: 84px; } /* narrate()'s captions start above the controls */
#film-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; pointer-events: none; z-index: 20; filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }`;

export async function film({
  stage = "#stage",
  pad = 0.5,
  gap = 0.4,
  script = "narration.json",
  manifest = ".tts/manifest.json",
}: FilmOptions = {}): Promise<Film> {
  document.head.insertAdjacentHTML("afterbegin", `<style>${CSS}</style>`); // first, so page CSS wins
  const root: HTMLElement = must($(stage), `stage element "${stage}"`);
  const scenes = $$(".scene", root);

  const { chapters, beats, total, start } = await loadTimings(scenes, {
    pad,
    gap,
    script,
    manifest,
  });

  const { segs, clock } = buildBar(root, chapters);
  const cursor = createCursor(root);
  // Controls: for a person in the browser; `viz render` hides [data-viz-chrome].
  const controls = buildControls();
  const { ctl, scrub, playBtn, ctlPos, rateSel } = controls;
  const { draw, rescan } = createFrame({
    root,
    scenes,
    chapters,
    segs,
    clock,
    scrub,
    ctlPos,
    start,
    total,
    drawCursor: cursor.draw,
  });

  // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- the link's JSON is not trusted to hold a number
  let cur = Math.min(total, Math.max(0, +(loadHash<{ t: number }>().t ?? 0))),
    playing = false,
    last = 0;
  const rate = createRate(rateSel);
  const seek = (t: number) => {
    cur = Math.min(total, Math.max(0, t));
    draw(cur);
  };
  const timeline: FilmTimeline = {
    total,
    seek,
    play() {
      if (cur >= total) cur = 0;
      playing = true;
      last = performance.now();
      playBtn.textContent = "⏸";
    },
    pause() {
      playing = false;
      playBtn.textContent = "▶";
      saveHash({ ...loadHash(), t: +cur.toFixed(2) });
    },
    at: () => cur,
    get rate() {
      return rate.value;
    },
    chapters: chapters.map(({ n, title, t0, dur }) => ({ n, title, t0, dur })),
    beats,
  };
  window.__viz = { ...window.__viz, timeline };

  (function tick(now: number) {
    if (playing) {
      cur += ((now - last) / 1000) * rate.value;
      last = now;
      if (cur >= total) {
        cur = total;
        timeline.pause();
      }
      draw(cur);
    }
    requestAnimationFrame(tick);
  })(performance.now());

  const fit = () => {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    root.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - 1080 * k) / 2}px) scale(${k})`;
  };
  addEventListener("resize", fit);
  fit();

  const go = (d: number) => {
    const n = Math.min(chapters.length - 1, Math.max(0, chapterAt(chapters, cur + 0.3) + d));
    seek(chapters[n]?.t0 ?? 0);
    saveHash({ ...loadHash(), t: +cur.toFixed(2) });
  };
  const toggle = () => (playing ? timeline.pause() : timeline.play());
  wireControls(controls, { go, toggle, seek, total, rate });

  draw(cur);
  // oxlint-disable-next-line typescript/no-floating-promises -- failures should surface as an unhandled rejection, where verify records it
  narrate(timeline, { manifest, controls: ctl }); // its CC toggle joins these controls
  // rescan(): pick up [data-b]/[data-fx]/[data-h] elements a page added after start — e.g.
  // highlights it could only measure once the stage was laid out.
  // setCursor([{ t, until, x, y }]): the cursor glides to (x, y) — stage px — at time t and stays
  // until `until`; consecutive points glide, a gap fades out and back in.
  const setCursor = (frames: CursorFrame[]) => {
    cursor.set(frames);
    draw(cur);
  };
  return {
    timeline,
    chapters: timeline.chapters,
    beats,
    seek,
    rescan: () => {
      rescan();
      draw(cur);
    },
    setCursor,
  };
}
