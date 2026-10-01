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
//   import { film } from "/_kit/film.js";
//   const f = await film();          // → { timeline, chapters, beats }

import { $, $$, narrate, saveHash, loadHash, type Manifest, type Timeline } from "/_kit/viz.js"; // absolute: the export import-map rewrites only /_kit/ specifiers

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

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** "1-4" / "5,6" / "7" → [1,2,3,4] … */
function beatList(spec: string): number[] {
  return String(spec).split(",").flatMap((part) => {
    const [a = 0, b] = part.split("-").map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
}

/** An element film() just created or cannot run without — missing means a broken page, said plainly. */
function must<E extends Element>(el: E | null, what: string): E {
  if (!el) throw new Error(`film(): no ${what}`);
  return el;
}

export interface FilmOptions { stage?: string; pad?: number; gap?: number; script?: string; manifest?: string }
export interface Chapter { n: number; title: string; t0: number; dur: number; beats: number[] }
export interface Beat { ci: number; t0: number; dur: number }
/** One cursor keyframe: glide to (x, y) — stage px — at time t, and stay until `until`. */
export interface CursorFrame { t: number; until: number; x: number; y: number }
export interface FilmTimeline extends Timeline { total: number; seek(t: number): void; play(): void; pause(): void; readonly rate: number; chapters: { n: number; title: string; t0: number; dur: number }[]; beats: Beat[] }
export interface Film { timeline: FilmTimeline; chapters: FilmTimeline["chapters"]; beats: Beat[]; seek(t: number): void; rescan(): void; setCursor(frames: CursorFrame[]): void }

/** narration.json as written: `at` is "beat:N" (or seconds, for a free cue). */
interface Narration { cues: { at: string | number; say?: string }[] }

export async function film({ stage = "#stage", pad = 0.5, gap = 0.4, script = "narration.json", manifest = ".tts/manifest.json" }: FilmOptions = {}): Promise<Film> {
  document.head.insertAdjacentHTML("afterbegin", `<style>${CSS}</style>`); // first, so page CSS wins
  const root = must($<HTMLElement>(stage), `stage element "${stage}"`);
  const scenes = $$<HTMLElement>(".scene", root);

  // A published single-file export inlines the manifest; the script is only needed for which
  // line belongs to which beat, so a missing script falls back to the manifest's own order.
  const narration: Narration = await fetch(script).then((r) => (r.ok ? (r.json() as Promise<Narration>) : { cues: [] }), () => ({ cues: [] }));
  const compiled: Manifest | null = window.__vizTts ?? (await fetch(manifest).then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null), () => null));
  const clip = new Map((compiled?.cues ?? []).filter((c) => c.text).map((c) => [c.text, c.dur]));
  const slot = new Map((compiled?.tracks ?? [{ cues: compiled?.cues ?? [] }]).flatMap((t) => t.cues)
    .filter((c) => c.at !== undefined).map((c) => [String(c.at), Math.max(c.slotDur ?? 0, c.dur)] as const)
    .reduce((rows, [at, dur]) => rows.set(at, Math.max(rows.get(at) ?? 0, dur)), new Map<string, number>()));
  const say = new Map(narration.cues.map((c) => [Number(String(c.at).split(":")[1]), c.say ?? ""]));

  const chapters: Chapter[] = [];
  const beats: Beat[] = [];
  let t = 0;
  scenes.forEach((s, ci) => {
    const c: Chapter = { n: ci + 1, title: s.dataset["title"] ?? `Chapter ${ci + 1}`, t0: t, dur: 0, beats: beatList(s.dataset["beats"] ?? "") };
    for (const b of c.beats) {
      const line = say.get(b) ?? "";
      const dur = (slot.get(`beat:${b}`) ?? clip.get(line) ?? Math.max(1.5, line.split(/\s+/).length / 2.6)) + pad;
      beats[b - 1] = { ci, t0: t, dur };
      t += dur;
    }
    t += gap;
    c.dur = t - c.t0;
    chapters.push(c);
  });
  const total = Math.round(t * 100) / 100;
  const start = (b: number) => beats[b - 1]?.t0 ?? Infinity;

  // data-h="b:d:xb:xd;…" — highlight intervals: --h rises at beat b + d seconds, falls at beat xb
  // + xd. Several intervals take the max, so a line said twice lights up twice.
  type Animated = { el: HTMLElement; b: number | null; d: number; x: number | null; fx: number | null; fd: number; h: [number, number, number, number][] | null };
  let els: Animated[] = [];
  const num = (v: string | undefined) => (v ? +v : null);
  const scan = () => (els = $$<HTMLElement>("[data-b],[data-fx],[data-h]", root).map((el) => ({
    el, b: num(el.dataset["b"]), d: +(el.dataset["d"] || 0), x: num(el.dataset["x"]),
    fx: num(el.dataset["fx"]), fd: +(el.dataset["fd"] || 0),
    h: el.dataset["h"] ? el.dataset["h"].split(";").map((iv): [number, number, number, number] => {
      const [b = 0, d = 0, xb = 0, xd = 0] = iv.split(":").map(Number);
      return [b, d, xb, xd];
    }) : null,
  })));
  scan();

  // Chapter bar: segment width = chapter length. Part of the picture, so it renders.
  root.insertAdjacentHTML("beforeend", `<div id="film-bar"><div class="segs">${chapters.map((c) => `<div style="flex:${c.dur}" title="${c.title}"><i></i></div>`).join("")}</div><div class="meta"><span class="pos"></span><span class="clock"></span></div></div>`);
  const segs = $$<HTMLElement>("#film-bar .segs div", root);
  // The cursor — ui-narration's arrow, so a film points the way a recording does. Hidden until
  // a page gives it keyframes (setCursor).
  root.insertAdjacentHTML("beforeend", `<div id="film-cursor" style="opacity:0"><svg width="30" height="30" viewBox="0 0 26 26"><path d="M3 2 L3 20 L8 15 L11 22 L14.5 20.5 L11.5 14 L18 14 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`);
  const cursor = must($<HTMLElement>("#film-cursor", root), "#film-cursor");
  let cursorFrames: CursorFrame[] = []; // in stage px, sorted by t
  const GLIDE = 0.95; // ui-narration's glide (950ms): slower drags, faster loses the eye
  function drawCursor(t: number) {
    const i = cursorFrames.findLastIndex((f) => f.t <= t);
    const f = cursorFrames[i];
    if (!f || t > f.until) { cursor.style.opacity = f ? Math.max(0, 1 - (t - f.until) / 0.3).toFixed(2) : "0"; if (f) place(f.x, f.y); return; }
    const prev = cursorFrames[i - 1];
    // Glide from the previous point when it was still showing; otherwise fade in at this one.
    const from = prev && prev.until >= f.t - 0.5 ? prev : null;
    const k = from ? ease((t - f.t) / GLIDE) : 1;
    place(from ? from.x + (f.x - from.x) * k : f.x, from ? from.y + (f.y - from.y) * k : f.y);
    cursor.style.opacity = from ? "1" : Math.min(1, (t - f.t) / 0.25).toFixed(2);
  }
  const place = (x: number, y: number) => (cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`); // the tip sits at (3,2) in the svg
  // Controls: for a person in the browser; `viz render` hides [data-viz-chrome].
  document.body.insertAdjacentHTML("beforeend", `<div id="film-controls" data-viz-chrome>
    <button data-go="-1" title="previous chapter (←)">⏮</button><button data-play title="play / pause (space)">▶</button>
    <button data-go="1" title="next chapter (→)">⏭</button><input type="range" min="0" max="1000" value="0" aria-label="position"><span class="pos"></span>
    <select data-rate title="speed (&lt; &gt;)" aria-label="playback speed">${RATES.map((r) => `<option value="${r}">${r}×</option>`).join("")}</select></div>`);
  const ctl = must($<HTMLElement>("#film-controls"), "#film-controls");
  const scrub = must($("input", ctl), "scrubber");
  const playBtn = must($<HTMLButtonElement>("[data-play]", ctl), "play button");
  const clock = must($<HTMLElement>("#film-bar .clock", root), "clock");
  const ctlPos = must($<HTMLElement>(".pos", ctl), "position readout");


  const chapterAt = (t: number) => Math.max(0, chapters.findLastIndex((c) => t >= c.t0 - 0.01));
  function draw(t: number) {
    for (const e of els) {
      if (e.b !== null) {
        let p = ease((t - start(e.b) - e.d) / 0.5);
        if (e.x !== null) p *= 1 - ease((t - start(e.x)) / 0.4);
        e.el.style.setProperty("--p", p.toFixed(3));
      }
      if (e.fx !== null) e.el.style.setProperty("--q", ease((t - start(e.fx) - e.fd) / 0.7).toFixed(3));
      if (e.h) e.el.style.setProperty("--h", Math.max(...e.h.map(([b, d, xb, xd]) =>
        ease((t - start(b) - d) / 0.2) * (1 - ease((t - start(xb) - xd) / 0.3)))).toFixed(3));
    }
    scenes.forEach((s, i) => {
      const c = chapters[i];
      if (!c) return;
      const fin = i === 0 ? 1 : ease((t - c.t0) / 0.4);
      const fout = i === chapters.length - 1 ? 1 : 1 - ease((t - (c.t0 + c.dur - 0.35)) / 0.35);
      const v = t >= c.t0 - 0.01 && t < c.t0 + c.dur + 0.01 ? fin * fout : 0;
      s.style.opacity = String(v);
      s.style.visibility = v > 0 ? "visible" : "hidden";
    });
    segs.forEach((s, i) => { const c = chapters[i]; if (c) s.style.setProperty("--f", String(Math.min(1, Math.max(0, (t - c.t0) / c.dur)))); });
    drawCursor(t);
    // Canvas/WebGL scenes draw here, synchronously, from t alone — a rAF loop can't be seeked.
    root.dispatchEvent(new CustomEvent("viz-frame", { detail: { t, start } }));
    const ci = chapterAt(t);
    for (const el of $$(".pos", root.parentNode ?? document)) el.textContent = `${ci + 1} / ${chapters.length}`;
    clock.textContent = `${fmt(t)} / ${fmt(total)}`;
    scrub.value = String(Math.round((t / total) * 1000));
    ctlPos.textContent = `${ci + 1}/${chapters.length} · ${fmt(t)}/${fmt(total)}`;
  }

  let cur = Math.min(total, Math.max(0, +(loadHash<{ t: number }>().t ?? 0))), playing = false, last = 0;
  // SPEED IS THE VIEWER'S, like the CC toggle: remembered in this browser, not in the link.
  // narrate() plays its clips at the same rate, so voice and picture stay together.
  const rateSel = must($<HTMLSelectElement>("[data-rate]", ctl), "speed selector");
  const stored = Number(localStorage.getItem("viz-rate"));
  let rate = RATES.includes(stored) ? stored : 1;
  const setRate = (r: number) => { rate = r; rateSel.value = String(r); localStorage.setItem("viz-rate", String(r)); };
  setRate(rate);
  rateSel.onchange = () => setRate(+rateSel.value);
  const seek = (t: number) => { cur = Math.min(total, Math.max(0, t)); draw(cur); };
  const timeline: FilmTimeline = {
    total, seek,
    play() { if (cur >= total) cur = 0; playing = true; last = performance.now(); playBtn.textContent = "⏸"; },
    pause() { playing = false; playBtn.textContent = "▶"; saveHash({ ...loadHash(), t: +cur.toFixed(2) }); },
    at: () => cur,
    get rate() { return rate; },
    chapters: chapters.map(({ n, title, t0, dur }) => ({ n, title, t0, dur })),
    beats,
  };
  window.__viz = { ...(window.__viz || {}), timeline };

  (function tick(now: number) {
    if (playing) { cur += ((now - last) / 1000) * rate; last = now; if (cur >= total) { cur = total; timeline.pause(); } draw(cur); }
    requestAnimationFrame(tick);
  })(performance.now());

  const fit = () => {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    root.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - 1080 * k) / 2}px) scale(${k})`;
  };
  addEventListener("resize", fit);
  fit();

  const go = (d: number) => {
    const n = Math.min(chapters.length - 1, Math.max(0, chapterAt(cur + 0.3) + d));
    seek(chapters[n]?.t0 ?? 0);
    saveHash({ ...loadHash(), t: +cur.toFixed(2) });
  };
  const toggle = () => (playing ? timeline.pause() : timeline.play());
  ctl.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button") : null;
    if (!b) return;
    if (b.dataset["go"]) go(+b.dataset["go"]); else toggle();
  });
  scrub.oninput = () => seek((+scrub.value / 1000) * total);

  addEventListener("keydown", (e) => {
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el && /INPUT|TEXTAREA/.test(el.tagName) && (el as HTMLInputElement).type !== "range") return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === ">" || e.key === "<") setRate(RATES[Math.min(RATES.length - 1, Math.max(0, RATES.indexOf(rate) + (e.key === ">" ? 1 : -1)))] ?? 1);
  });

  draw(cur);
  narrate(timeline, { manifest, controls: ctl }); // its CC toggle joins these controls
  // rescan(): pick up [data-b]/[data-fx]/[data-h] elements a page added after start — e.g.
  // highlights it could only measure once the stage was laid out.
  // setCursor([{ t, until, x, y }]): the cursor glides to (x, y) — stage px — at time t and stays
  // until `until`; consecutive points glide, a gap fades out and back in.
  const setCursor = (frames: CursorFrame[]) => { cursorFrames = [...frames].sort((a, b) => a.t - b.t); draw(cur); };
  return { timeline, chapters: timeline.chapters, beats, seek: timeline.seek, rescan: () => { scan(); draw(cur); }, setCursor };
}
