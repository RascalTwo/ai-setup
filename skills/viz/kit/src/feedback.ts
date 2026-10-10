// feedback.js — the /viz feedback widget (client overlay).
//
// On every page: the viz server injects it into live pages, and every self-contained build
// (export, publish) carries it unless the page opts out with <meta name="viz:feedback"
// content="off"> (ADR 0026). Where it saves depends on where the page is:
//   live    : the viz server's page data route, <viz>/.viz-data/feedback.jsonl (ADR 0019)
//   local   : no server (a downloaded file, a published page): this browser's IndexedDB, kept
//             per page stamp (a hash of the page's source) so a newer page starts clean
//   hosted  : a page that sets window.vizFeedbackHost first (the grill-me-viz poster's demo):
//             scoped to one element, writing to the page instead
// The pill is two buttons:
//   🎙 : each stretch of speech is transcribed on this device and anchored to what the mouse
//        is over when the stretch ENDS — so you can talk, then aim. The engine, first that
//        works: Parakeet if this browser already downloaded it (parakeet-worker.js, WebGPU,
//        2.4 GB, cached); the browser's own on-device speech, with ⬆ (in the panel) offering
//        the Parakeet download; offering that download outright; else typing only.
//   💬 : the panel — every line, pick and crop, folded by what it's about; Copy, Text only
//        and Send at its foot.
// Alt/Option-click any element types a line instead. Audio never leaves the device.
//
// Crops are drawn from the page itself (kit/screenshot.js, loaded on first use), so there is
// no screen-share prompt. Video frames are drawn directly; another site's frame can't be read
// by any page and becomes a labelled placeholder (a known limit, reference/review-layer.md).
//
// Everything is one append-only log. Line types: speech/comment (a line), edit (new text,
// latest wins), retract (deleted or cleared), resolve (Claude did it, + note), clear (every
// earlier line leaves the page), send (the user is done; Claude waits on it with a grep),
// pick (grill-me-viz). It folds exactly as `viz feedback` folds it (kit/feedback-text.js).
//
// Anchor: nearest [data-viz-id], else nearest <section>, else the page. The selector is
// stable across reloads; a requestAnimationFrame loop re-reads getBoundingClientRect()
// every frame so a pin follows its element even while the viz animates it.

import {
  byNote,
  feedbackText,
  foldFeedback,
  nameOf,
  type Entry,
  type Line,
} from "/_kit/feedback-text.js";
import { uniqueSelector } from "/_kit/anchor.js";

/** What a line is attached to: a selector that survives reloads, plus how to name it to a person. */
interface Anchor {
  selector: string;
  label?: string;
  text?: string;
}
/** Where the pointer and the page were when a line was made. `exact` is the element under the pointer when the anchor climbed. */
interface Where {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  hash: string;
  exact?: string;
}
type Box = { left: number; top: number; width: number; height: number };

/** A page that runs the widget itself (the grill-me-viz poster's demo). */
interface FeedbackHost {
  /** Only this element counts: the pill docks in its corner, pointing elsewhere anchors to it, Alt-click works only inside it. */
  root: Element;
  /** Every log line goes here instead of the server. */
  log(e: Entry): void;
  /** A crop of `box` (viewport px) with the pointer at (x, y), as an image URL; replaces page drawing. */
  shoot?(box: Box, x: number, y: number): string | null | Promise<string | null>;
}
/** Where the log and its crops live: the viz server, this browser, or a hosting page. */
interface Store {
  load(): Promise<Entry[]>;
  append(e: Entry): Promise<void>;
  /** Save a crop; resolves to the name it's logged under, or null. */
  put(name: string, png: Blob): Promise<string | null>;
  /** A saved crop, for the panel and for Copy. */
  get(name: string): Promise<Blob | null>;
}
/** The parts of on-device SpeechRecognition used here; lib.dom does not have them all yet. */
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
}
interface RecognizerClass {
  new (): Recognizer;
  available?(o: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(o: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

declare global {
  interface Window {
    vizFeedbackHost?: FeedbackHost;
    /** Set by the presence layer (presence.js): who this browser is, so a line can say who said it. */
    vizPresence?: { me: { name: string; color: string }; replaying: boolean };
    /** `log` for pages that add their own lines (grill-me-viz picks); `ready` resolves to the log once loaded; `say` is a test hook. */
    vizFeedback?: {
      log(e: Entry): Promise<void>;
      send(extra?: { round?: number }): Promise<void>;
      ready: Promise<Entry[]>;
      say(
        pcm: Float32Array | string,
        x?: number,
        y?: number,
        from?: [number, number],
      ): Promise<void>;
    };
    /** A page that animates can hold still while someone types feedback on it. */
    __vizPause?: () => void;
    __vizResume?: () => void;
  }
  interface WindowEventMap {
    "viz-feedback:ready": CustomEvent<{ entries: Entry[] }>;
  }
}

// Start once every deferred script has run, so a page module that sets vizFeedbackHost is in
// place whichever of the two scripts comes first.
if (document.readyState === "complete") start();
else document.addEventListener("DOMContentLoaded", start, { once: true });

function start() {
  if (document.getElementById("viz-feedback")) return; // already running
  const host = window.vizFeedbackHost;
  const root = host?.root;
  // The live server names the viz on its <script>; the shim in <head> carries the page stamp.
  const vizId = document.querySelector<HTMLElement>("script[data-viz-feedback]")?.dataset[
    "vizFeedback"
  ];
  const stamp =
    document.querySelector<HTMLElement>("script[data-viz-stamp]")?.dataset["vizStamp"] ?? "";
  const store: Store = host ? hostStore(host) : vizId ? serverStore(vizId) : localStore(stamp);

  // ---- The log, folded into lines ------------------------------------------
  const entries: Entry[] = [];
  const fold = () => foldFeedback(entries);
  let dirty = false; // something changed since the last send
  function apply(e: Entry) {
    entries.push(e);
    if (e.type === "send") dirty = false;
    else if (e.type !== "resolve" && e.type !== "clear") dirty = true;
  }
  async function log(entry: Entry) {
    if (window.vizPresence?.replaying) return; // someone else's click, replayed here: their page logs it
    const me = window.vizPresence?.me;
    const by =
      me && (entry.type === "speech" || entry.type === "comment")
        ? { by: { name: me.name, color: me.color } }
        : {};
    const e = { at: new Date().toISOString(), ...by, ...entry }; // the server keeps it; Copy shows it
    apply(e);
    render();
    await store.append(e).catch(() => {});
  }
  const newId = () => Math.random().toString(36).slice(2, 10);

  // ---- DOM scaffolding -------------------------------------------------------
  const layer = el("div", { id: "viz-feedback" });
  const pill = el("div", { class: "vf-pill" });
  const micBtn = el("button", { class: "mic", type: "button" });
  const countBtn = el("button", {
    class: "count",
    type: "button",
    title: "Everything you said, picked and pointed at: preview, Copy, Send",
  });
  pill.append(micBtn, countBtn);
  // A built page's "Save a copy" button owns the very corner; sit beside it.
  if (!root && document.getElementById("__viz_dl")) pill.style.right = "58px";
  const dot = el("div", { class: "vf-dot" });
  layer.append(pill, dot);
  document.documentElement.appendChild(layer);

  // ---- Selectors and anchors -------------------------------------------------
  function captureAnchor(node: Element): Anchor {
    const anchor: Anchor = { selector: uniqueSelector(node) };
    const label =
      node.getAttribute("data-label") ||
      node.getAttribute("data-viz-id") ||
      node.getAttribute("aria-label");
    if (label) anchor.label = label;
    const text = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (text) anchor.text = text;
    return anchor;
  }
  const whereAt = (x: number, y: number): Where => ({
    x,
    y,
    w: innerWidth,
    h: innerHeight,
    sx: Math.round(scrollX),
    sy: Math.round(scrollY),
    hash: location.hash,
  });
  // What a spoken line belongs to: what's under the pointer, climbed to something named.
  function pointAt(x: number, y: number) {
    const hit = x < 0 ? null : document.elementFromPoint(x, y);
    const under = hit && !layer.contains(hit) && (!root || root.contains(hit)) ? hit : null;
    const node = under?.closest("[data-viz-id]") ?? under?.closest("section") ?? root ?? null;
    const where = whereAt(x, y);
    if (under && node !== under) where.exact = uniqueSelector(under); // the anchor climbed
    return { anchor: node ? captureAnchor(node) : null, where };
  }
  const safeQuery = (sel: string | null | undefined) => {
    try {
      return sel ? document.querySelector(sel) : null;
    } catch {
      return null;
    }
  };

  // ---- Speech: pick an engine, then speech → a line ------------------------------
  // Parakeet: mic → pause detection here → parakeet-worker.js → text. Browser: the browser's
  // on-device recognizer splits and transcribes; each of its results is one line.
  type Engine = "parakeet" | "browser" | "offer" | "none";
  const LANG = navigator.language || "en-US";
  const Rec = (window as unknown as { SpeechRecognition?: RecognizerClass }).SpeechRecognition;
  let engine: Engine | null = null;
  /** Whether parakeet.js already holds the model in this origin's IndexedDB. Never opens a
   *  database that isn't there: an empty one would skip parakeet.js's own store setup. */
  async function parakeetCached(): Promise<boolean> {
    const NAME = "parakeet-cache-db";
    if (!(await indexedDB.databases?.())?.some((d) => d.name === NAME)) return false;
    return new Promise((done) => {
      const req = indexedDB.open(NAME);
      req.onerror = () => done(false);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const keys = db.transaction("file-store").objectStore("file-store").getAllKeys();
          keys.onsuccess = () => (
            done(keys.result.some((k) => String(k).endsWith("encoder-model.onnx.data"))),
            db.close()
          );
          keys.onerror = () => (done(false), db.close());
        } catch {
          (done(false), db.close());
        }
      };
    });
  }
  async function pickEngine(): Promise<Engine> {
    if (await parakeetCached()) return "parakeet";
    const want = { langs: [LANG], processLocally: true };
    const state = (await Rec?.available?.(want).catch(() => "")) ?? "";
    if (state === "available") return "browser";
    if ((state === "downloadable" || state === "downloading") && (await Rec?.install?.(want)))
      return "browser";
    return "gpu" in navigator ? "offer" : "none";
  }

  let worker: Worker | null = null,
    modelReady = false,
    loadPct: number | null = null,
    micErr = "",
    seq = 0;
  const waiting = new Map<number, (text: string) => void>(); // worker job id -> handler for its transcript
  const inflight = new Set<Promise<void>>(); // stretches not yet logged; Send waits on these
  function loadModel() {
    // Published builds inline this path as a data: URL (inline.ts); a worker from one has an
    // opaque origin and no model cache, so it runs from a same-origin blob instead.
    const src: string = "/_kit/parakeet-worker.js";
    const url = src.startsWith("data:")
      ? URL.createObjectURL(
          new Blob([atob(src.slice(src.indexOf(",") + 1))], { type: "text/javascript" }),
        )
      : src;
    worker = new Worker(url, { type: "module" });
    worker.onmessage = ({
      data,
    }: MessageEvent<{
      type: string;
      id: number;
      text: string;
      loaded: number;
      total: number;
      message: string;
    }>) => {
      if (data.type === "progress" && data.total)
        loadPct = Math.round((100 * data.loaded) / data.total);
      if (data.type === "ready") ((modelReady = true), (loadPct = null), sync());
      if (data.type === "error") micErr = "speech model failed: " + data.message;
      if (data.type === "text") (waiting.get(data.id)?.(data.text), waiting.delete(data.id));
      renderPill();
    };
    navigator.storage?.persist?.(); // ask Chrome not to evict the cached model under disk pressure
    renderPill(); // show "loading" now, not on the worker's first message (a cached load sends no progress)
  }

  let ctx: AudioContext | undefined,
    rec: Recognizer | null = null,
    onEnd: (() => void) | null = null,
    started = false,
    paused = false,
    listening = false;
  async function startEngine(e: "parakeet" | "browser") {
    engine = e;
    if (!host?.shoot) void drawer(); // warm the page drawer (and its fonts) before the first crop
    if (e === "browser") startBrowser();
    else {
      if (!worker) loadModel();
      if (!ctx) await startMic();
    }
    started = true;
    sync();
  }
  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(1024, 1, 1); // 64 ms frames
    src.connect(proc);
    proc.connect(ctx.destination);
    proc.onaudioprocess = (ev) =>
      listening &&
      engine === "parakeet" &&
      frame(new Float32Array(ev.inputBuffer.getChannelData(0)));
  }
  function startBrowser() {
    if (!Rec) return;
    rec = new Rec();
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.processLocally = true;
    let began = new Map<number, ReturnType<typeof begin> & { cap: Caption }>();
    rec.onstart = () => (began = new Map()); // result indexes restart with each session
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!,
          text = r[0].transcript.trim();
        let b = began.get(i);
        if (!b && text) {
          const start = begin(mx, my);
          b = { ...start, cap: caption(start.anchor, start.where, "…") };
          began.set(i, b);
          dot.classList.add("on");
        }
        if (!b) continue;
        if (!r.isFinal) {
          b.cap.live(text);
          continue;
        }
        began.delete(i);
        if (!began.size) dot.classList.remove("on");
        const { anchor, where } = pointAt(mx, my);
        const done = land(text, b, anchor, where, shoot(anchor, mx, my), b.cap, null);
        inflight.add(done);
        done.then(() => inflight.delete(done));
      }
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted")
        ((micErr = "speech: " + e.error), renderPill());
    };
    rec.onend = () => {
      onEnd?.();
      onEnd = null;
      if (listening) rec?.start(); // the browser ends sessions on its own; keep going
    };
  }
  function sync() {
    const was = listening;
    const ready = engine === "browser" || modelReady;
    listening = started && !paused && ready && document.hasFocus();
    if (listening && !was) engine === "browser" ? rec?.start() : ctx?.resume();
    if (was && !listening) {
      if (engine === "browser") rec?.stop(); // stop, not abort: what was said still lands
      else if (speaking) cut(); // leaving mid-sentence still keeps what you said
    }
    renderPill();
  }

  // A note by the pill: what the mic can't do here, or the Parakeet offer (with a Download button).
  function notice(text: string, hint: string, go?: () => void) {
    closeBubble();
    bubble = el("div", { class: "vf-bubble" });
    bubble.append(el("div", { class: "vf-offer" }, text), el("div", { class: "vf-hint" }, hint));
    const row = el("div", { class: "vf-row" });
    const no = el("button", { class: "vf-btn", type: "button" }, go ? "Not now" : "OK");
    no.addEventListener("click", closeBubble);
    row.append(no);
    if (go) {
      const yes = el("button", { class: "vf-btn primary", type: "button" }, "Download");
      yes.addEventListener("click", () => (closeBubble(), go()));
      row.append(yes);
    }
    bubble.append(row);
    layer.appendChild(bubble);
    const r = pill.getBoundingClientRect();
    placeNear(bubble, r.right - 340, r.top - 190);
  }
  // In place of the mic when the browser can't transcribe on-device; behind ⬆ when it can.
  function offerParakeet() {
    notice(
      engine === "browser"
        ? "Switch to Parakeet, the speech model the skill itself uses?"
        : "This browser has no on-device speech recognition. Download Parakeet, the speech model the skill uses?",
      "2.4 GB, once: about 1–7 minutes on a 50–300 Mbps line, then cached in this browser. Needs WebGPU. Your audio still never leaves this device.",
      () => {
        rec?.abort();
        rec = null;
        if (engine === "browser") ((started = false), (listening = false));
        startEngine("parakeet").catch(
          (err: unknown) => ((micErr = "mic unavailable: " + (err as Error).message), renderPill()),
        );
      },
    );
  }

  // ---- Crops: drawn from the page as speech starts and as it ends ----
  // The crop is the anchored element plus 24 px, or 400x300 around the pointer when there is none
  // or it is bigger than 600x400, so the pointer is always inside. A host with `shoot` draws its own.
  function shoot(anchor: Anchor | null, x: number, y: number): Promise<Blob | string | null> {
    const r = safeQuery(anchor?.selector)?.getBoundingClientRect();
    const fit = !!r && r.width + 48 <= 600 && r.height + 48 <= 400;
    const w = Math.min(fit ? r.width + 48 : r ? 600 : 400, innerWidth);
    const h = Math.min(fit ? r.height + 48 : r ? 400 : 300, innerHeight);
    const left = Math.max(0, Math.min(fit ? r.left - 24 : x - w / 2, innerWidth - w));
    const top = Math.max(0, Math.min(fit ? r.top - 24 : y - h / 2, innerHeight - h));
    const box = { left, top, width: w, height: h };
    if (host?.shoot) return Promise.resolve(host.shoot(box, x, y));
    if (x < 0) return Promise.resolve(null); // the pointer never entered the page
    return draw(box, x, y, scrollX, scrollY).catch(() => null); // pictures are a bonus
  }
  // kit/screenshot.js (modern-screenshot) and the page's fonts, fetched once, on first use.
  let drawing: Promise<[typeof import("@viz/kit/screenshot.js"), string]> | null = null;
  // By its alias, not /_kit/: a build gives it its own import-map entry rather than nesting it,
  // base64 inside base64, in this file (inline.ts).
  const drawer = () => (drawing ??= Promise.all([import("@viz/kit/screenshot.js"), fontCss()]));
  /** Every @font-face the page uses, with its font files as data: URLs. A stylesheet from another
   *  site (Google Fonts) can't be read through the CSSOM, so it is fetched; without this, crops
   *  fall back to a system font. */
  async function fontCss(): Promise<string> {
    const blocks: string[] = [];
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        /* another site's stylesheet: fetched below */
      }
      const css = rules
        ? [...rules].filter((r) => r instanceof CSSFontFaceRule).map((r) => r.cssText)
        : sheet.href
          ? ((
              await fetch(sheet.href).then(
                (r) => (r.ok ? r.text() : ""),
                () => "",
              )
            ).match(/@font-face\s*\{[^}]*\}/gu) ?? [])
          : [];
      for (const block of css) {
        let out = block;
        for (const [, ref] of block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gu)) {
          if (!ref || ref.startsWith("data:")) continue;
          const data = await fetch(new URL(ref, sheet.href ?? location.href)).then(
            async (r) => (r.ok ? dataUrl(await r.blob()) : null),
            () => null,
          );
          if (data) out = out.replace(ref, data);
        }
        blocks.push(out);
      }
    }
    return blocks.join("\n");
  }
  /** Draw the viewport box (at the scroll it was taken at) to a PNG, with the pointer marked. */
  async function draw(box: Box, x: number, y: number, sx: number, sy: number) {
    const [{ domToCanvas }, fonts] = await drawer();
    const k = Math.min(devicePixelRatio || 1, 2);
    // By tag and id, not instanceof: a same-site iframe's nodes come from another window.
    const isEl = (n: Node): n is Element => n.nodeType === 1;
    const isFrame = (e: Element): e is HTMLIFrameElement => e.tagName === "IFRAME";
    const frame = (e: Element) => {
      if (!isFrame(e)) return false;
      try {
        return !e.contentDocument; // another site's frame: no page can read it
      } catch {
        return true;
      }
    };
    // ponytail: the whole viewport is drawn and cut down; a crop of a huge page pays for the
    // whole visible DOM. Elements that are position:fixed land where the scrolled page puts them.
    const full = await domToCanvas(document.documentElement, {
      width: innerWidth,
      height: innerHeight,
      scale: k,
      style: { transform: `translate(${-sx}px, ${-sy}px)` },
      // Leave out the widget and "Save a copy" (this page's, and any embedded viz's), and
      // videos and other sites' frames, which are drawn on top below.
      filter: (n) =>
        !(
          isEl(n) &&
          (n.id === "viz-feedback" || n.id === "__viz_dl" || n.tagName === "VIDEO" || frame(n))
        ),
      font: fonts ? { cssText: fonts } : false,
    });
    const g = full.getContext("2d");
    // Videos and other sites' frames were left out of the drawing; put them back on top.
    for (const n of document.querySelectorAll("video, iframe")) {
      const r = n.getBoundingClientRect();
      if (!g || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
      if (n instanceof HTMLVideoElement && drawable(n)) {
        g.drawImage(n, r.left * k, r.top * k, r.width * k, r.height * k);
        continue;
      }
      if (n instanceof HTMLVideoElement || frame(n)) {
        g.fillStyle = "#e9e9ee";
        g.fillRect(r.left * k, r.top * k, r.width * k, r.height * k);
        g.fillStyle = "#555";
        g.font = `${12 * k}px system-ui, sans-serif`;
        const what =
          n instanceof HTMLIFrameElement
            ? `embedded ${hostOf(n.src)}: can't be drawn`
            : "video from another site: can't be drawn";
        g.fillText(what, (r.left + 8) * k, (r.top + 20) * k, (r.width - 16) * k);
      }
    }
    const c = el("canvas");
    c.width = box.width * k;
    c.height = box.height * k;
    const o = c.getContext("2d");
    if (!o) return null;
    o.drawImage(full, box.left * k, box.top * k, c.width, c.height, 0, 0, c.width, c.height);
    // The pointer, as a red dot with a white ring, where it was.
    o.beginPath();
    o.arc((x - box.left) * k, (y - box.top) * k, 7 * k, 0, 2 * Math.PI);
    o.fillStyle = "#e5484d";
    o.strokeStyle = "#ffffffcc";
    o.lineWidth = 3 * k;
    o.fill();
    o.stroke();
    return new Promise<Blob | null>((done) => c.toBlob(done, "image/png"));
  }
  /** A video whose current frame this page may read (same site, or the other site allows it). */
  function drawable(v: HTMLVideoElement) {
    if (v.readyState < 2) return false;
    try {
      const t = el("canvas");
      t.width = t.height = 1;
      const g = t.getContext("2d");
      g?.drawImage(v, 0, 0, 1, 1);
      g?.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  }
  const hostOf = (u: string) => {
    try {
      return new URL(u).host || "page";
    } catch {
      return "page";
    }
  };

  const begin = (x: number, y: number) => {
    const at = pointAt(x, y);
    return { ...at, shot: shoot(at.anchor, x, y) };
  };
  /** Save one crop as fb-<line>-<start|end>.png (a host's crop is already a URL); resolves to its [key, name] or null. */
  async function save(id: string, key: "start" | "end", shot: Promise<Blob | string | null>) {
    const body = await shot;
    if (typeof body === "string") return [key, body] as const;
    const name = body && (await store.put(`fb-${id}-${key}.png`, body).catch(() => null));
    return name ? ([key, name] as const) : null;
  }

  let mx = -1,
    my = -1;
  addEventListener(
    "pointermove",
    (e) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.left = mx + "px";
      dot.style.top = my + "px";
    },
    { passive: true },
  );

  // Speech = a frame well above the learned noise floor; a stretch ends after PAUSE ms of
  // quiet. 300 ms before speech is kept so first words aren't clipped. (Tested by hand in
  // grill-me-viz: 300–1000 ms all felt fine.)
  const PAUSE = 700,
    RATE = 16000;
  let floor = 0.01,
    speaking = false,
    quietMs = 0,
    began: (ReturnType<typeof pointAt> & { shot: Promise<Blob | string | null> }) | undefined, // the pointer as this stretch began
    buf: Float32Array[] = [],
    pre: Float32Array[] = [];
  function frame(f: Float32Array) {
    let rms = 0;
    for (const v of f) rms += v * v;
    rms = Math.sqrt(rms / f.length);
    if (!speaking) floor = floor * 0.97 + rms * 0.03;
    const loud = rms > Math.max(0.012, floor * 3);
    if (loud) {
      if (!speaking)
        ((speaking = true), (began = begin(mx, my)), (buf = [...pre]), dot.classList.add("on"));
      quietMs = 0;
    }
    if (speaking) {
      buf.push(f);
      if (!loud) quietMs += (f.length / RATE) * 1000;
      if (quietMs >= PAUSE || length() > RATE * 25) cut();
    } else {
      pre.push(f);
      if (pre.length > 5) pre.shift();
    }
  }
  const length = () => buf.reduce((a, b) => a + b.length, 0);

  // End the current stretch: anchor it NOW (where the mouse is as you stop), show "…" there,
  // and transcribe. Resolves once its line is logged (or dropped as noise).
  function cut(): Promise<void> {
    const len = length(),
      frames = buf;
    speaking = false;
    buf = [];
    quietMs = 0;
    dot.classList.remove("on");
    if (len < RATE * 0.4) return Promise.resolve();
    const pcm = new Float32Array(len);
    let o = 0;
    for (const f of frames) (pcm.set(f, o), (o += f.length));
    const { anchor, where } = pointAt(mx, my);
    const start = began ?? { anchor, where, shot: Promise.resolve(null) };
    began = undefined;
    const endShot = shoot(anchor, mx, my);
    const cap = caption(anchor, where, "…");
    const job = ++seq;
    const done = new Promise<void>((resolve) => {
      waiting.set(job, (text: string) =>
        land(text, start, anchor, where, endShot, cap, +(len / RATE).toFixed(1)).then(resolve),
      );
      worker!.postMessage({ id: job, pcm }, [pcm.buffer]); // cut() only runs once loadModel() has
    });
    inflight.add(done);
    done.then(() => inflight.delete(done));
    return done;
  }

  /** One transcribed stretch → its pictures and its log line (empty text is noise: dropped). */
  async function land(
    text: string,
    start: ReturnType<typeof pointAt> & { shot: Promise<Blob | string | null> },
    anchor: Anchor | null,
    where: Where,
    endShot: Promise<Blob | string | null>,
    cap: Caption,
    secs: number | null,
  ) {
    text = text.trim();
    if (!text) return cap.remove();
    cap.set(text);
    const id = newId();
    const { shot: startShot, ...from } = start;
    const got = await Promise.all([save(id, "start", startShot), save(id, "end", endShot)]);
    const shots = Object.fromEntries(got.filter((g) => g !== null));
    await log({
      type: "speech",
      id,
      text,
      anchor,
      where,
      from,
      ...(got.some(Boolean) ? { shots } : {}),
      ...(secs ? { secs } : {}),
    });
    // The presence layer (presence.js) sends what was said to everyone in the room.
    dispatchEvent(new CustomEvent("viz:said", { detail: text }));
  }

  // A caption over the anchor (or the pointer, for the page): "…", then the text, then gone.
  function caption(anchor: Anchor | null, where: Where, text: string) {
    const c = el("div", { class: "vf-caption" }, text);
    const r = safeQuery(anchor?.selector)?.getBoundingClientRect();
    c.style.left = (r ? r.left + r.width / 2 : where.x) + "px";
    c.style.top = Math.max(40, r ? r.top : where.y) + "px";
    layer.appendChild(c);
    const remove = () => c.remove();
    return {
      remove,
      live: (t: string) => (c.textContent = t), // the browser engine's words as they come
      set: (t: string) => {
        c.textContent = t;
        setTimeout(() => (c.style.opacity = "0"), 2500);
        setTimeout(remove, 3000);
      },
    };
  }

  type Caption = ReturnType<typeof caption>;

  // ---- Send: cut what's being said now, and write `send` only after every line lands ----
  async function send(extra: { round?: number } = {}) {
    if (speaking) cut();
    // The browser engine hands over its last words only as it stops: wait for that (or 2 s).
    const ended =
      engine === "browser" && listening
        ? new Promise<void>((r) => ((onEnd = r), setTimeout(r, 2000)))
        : null;
    if (started) ((paused = true), sync()); // no listening while Claude works; Resume is manual
    await ended;
    await Promise.all([...inflight]);
    const entry: Entry = { type: "send" };
    const round =
      extra.round ??
      +([...document.querySelectorAll<HTMLElement>("[data-round]")].pop()?.dataset["round"] ?? 0);
    if (round) entry.round = round; // grill-me-viz waits on {"type":"send","round":N}
    await log(entry);
    dispatchEvent(new CustomEvent("viz-feedback:sent", { detail: { round } }));
  }

  // ---- Copy: everything as text, plus the crops as HTML and one numbered contact sheet ----
  // One click carries three formats and each app keeps the one it understands: Slack keeps the
  // picture, a notes app or an email keeps text with every crop, an agent's prompt keeps the text.
  async function copy(withImages: boolean) {
    if (speaking) cut();
    await Promise.all([...inflight]);
    const { lines, picks } = fold();
    const crops: Blob[] = [];
    const num = new Map<string, number>();
    if (withImages)
      for (const l of lines)
        for (const name of Object.values(l.shots ?? {})) {
          const png = await store.get(name).catch(() => null);
          if (png) num.set(name, crops.push(png));
        }
    const at = location.protocol === "file:" ? location.pathname.split("/").pop() : location.href;
    const text = [
      `Feedback on "${document.title}"`,
      `${at} · page stamp ${stamp || "none"} · copied ${new Date().toISOString()}`,
      ...feedbackText(lines, picks, true, (f, k) => {
        const n = num.get(f);
        return n ? `crop ${n} (${k})` : `${k} crop not copied`;
      }),
      ...(crops.length
        ? ["", `${crops.length} crop(s): see the attached image, numbered to match`]
        : []),
    ].join("\n");
    const item: Record<string, Blob> = { "text/plain": new Blob([text], { type: "text/plain" }) };
    if (crops.length) {
      const imgs = await Promise.all(
        crops.map(async (c, i) => `<p><b>crop ${i + 1}</b><br><img src="${await dataUrl(c)}"></p>`),
      );
      item["text/html"] = new Blob([`<pre>${escHtml(text)}</pre>${imgs.join("")}`], {
        type: "text/html",
      });
      const png = await sheet(crops);
      if (png) item["image/png"] = png;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem(item)]);
      flash(crops.length ? `Copied: text and ${crops.length} crop(s)` : "Copied: text");
    } catch {
      // Copying blocked (an old browser, or no permission): hand over the text to copy by hand.
      notice("Copying was blocked here. Select this text and copy it yourself:", "");
      const ta = el("textarea", { readonly: "" });
      ta.value = text;
      bubble?.insertBefore(ta, bubble.lastChild);
      ta.select();
    }
  }
  /** Every crop on one numbered sheet: a clipboard reliably holds one image per copy. */
  async function sheet(crops: Blob[]): Promise<Blob | null> {
    const pics = await Promise.all(crops.map((c) => createImageBitmap(c)));
    const W = 360,
      PAD = 12,
      LAB = 22,
      cols = Math.min(3, pics.length);
    const hs = pics.map((p) => Math.round((p.height * W) / p.width));
    const rows: number[] = [];
    for (let i = 0; i < pics.length; i += cols) rows.push(Math.max(...hs.slice(i, i + cols)));
    const c = el("canvas");
    c.width = PAD + cols * (W + PAD);
    c.height = PAD + rows.reduce((a, h) => a + h + LAB + PAD, 0);
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    let y = PAD;
    for (const [i, p] of pics.entries()) {
      const col = i % cols,
        x = PAD + col * (W + PAD);
      g.fillStyle = "#1b1b1f";
      g.font = "bold 14px system-ui, sans-serif";
      g.fillText(`crop ${i + 1}`, x, y + 15);
      g.drawImage(p, x, y + LAB, W, hs[i]!);
      g.strokeStyle = "#ccc";
      g.strokeRect(x + 0.5, y + LAB + 0.5, W - 1, hs[i]! - 1);
      if (col === cols - 1) y += rows[Math.floor(i / cols)]! + LAB + PAD;
    }
    return new Promise((done) => c.toBlob(done, "image/png"));
  }

  // ---- Pins: one per anchored element, a stack when it holds several lines ----
  const pins = new Map<string, HTMLElement>(); // anchor selector -> pin element
  const groups = (lines: Line[]) => {
    const g = new Map<string, Line[]>();
    for (const l of lines) {
      const k = l.anchor?.selector ?? "";
      const list = g.get(k) ?? [];
      list.push(l);
      g.set(k, list);
    }
    return g;
  };
  function renderPins(g: Map<string, Line[]>) {
    for (const [k, pin] of pins) if (!g.has(k)) (pin.remove(), pins.delete(k));
    for (const [k, ls] of g) {
      if (!k) continue; // page-level lines live only in the list
      let pin = pins.get(k);
      if (!pin) {
        pin = el("div", { class: "vf-pin" });
        pin.addEventListener("click", (e) => (e.stopPropagation(), openCard(k)));
        layer.appendChild(pin);
        pins.set(k, pin);
      }
      const done = ls.filter((l) => l.done).length;
      pin.classList.toggle("stack", ls.length > 1);
      pin.classList.toggle("done", done === ls.length);
      pin.textContent =
        done && done < ls.length
          ? `✓${done}/${ls.length}`
          : ls.length > 1
            ? `×${ls.length}`
            : done
              ? "✓"
              : "";
      const who = byNote(fold().lines);
      const authors = new Set(ls.map((l) => who(l) && l.by?.color));
      const [color] = authors;
      pin.style.background = authors.size === 1 && color ? color : ""; // one author: their colour
      pin.title = ls.map((l) => who(l) + l.text).join("\n");
    }
  }
  function tick() {
    if (root) {
      // Docked in the root's bottom-right corner, and only while the root is on screen.
      const r = root.getBoundingClientRect();
      pill.style.display = r.bottom < 0 || r.top > innerHeight ? "none" : "";
      pill.style.right = Math.max(14, innerWidth - r.right + 10) + "px";
      pill.style.bottom = Math.max(14, innerHeight - r.bottom + 10) + "px";
    }
    let parked = 0;
    for (const [k, pin] of pins) {
      const node = safeQuery(k);
      pin.classList.toggle("detached", !node);
      if (!node) {
        // The anchor no longer resolves: park the pin top-right so nothing silently vanishes.
        pin.style.left = innerWidth - 30 + "px";
        pin.style.top = 70 + parked++ * 28 + "px";
        continue;
      }
      const r = node.getBoundingClientRect();
      pin.style.left = r.left + r.width / 2 + "px";
      pin.style.top = r.top + "px";
    }
    requestAnimationFrame(tick);
  }

  // ---- A line: click its text to edit, 🗑 to delete, ✓ to clear once resolved; its crops below ----
  function lineEl(l: Line) {
    const row = el("div", { class: "vf-line" + (l.done ? " done" : "") });
    const body = el("div", { style: "flex:1;min-width:0" });
    const t = el(
      "span",
      {
        class: "t",
        contenteditable: "plaintext-only",
        spellcheck: "false",
        title: "Click to edit",
      },
      l.text,
    );
    const who = byNote(fold().lines)(l);
    if (who && l.by) {
      const tag = el("b", { style: `color:${l.by.color}` }, who);
      body.append(tag);
    }
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), t.blur());
      if (e.key === "Escape") ((t.textContent = l.text), t.blur());
      e.stopPropagation(); // the viz's own shortcuts shouldn't fire while typing
    });
    t.addEventListener("blur", () => {
      const v = (t.textContent ?? "").trim();
      if (v && v !== l.text) log({ type: "edit", id: l.id, text: v });
      else t.textContent = l.text;
    });
    body.append(t);
    if (l.note) body.append(el("span", { class: "note" }, "✓ " + l.note));
    const shots = Object.entries(l.shots ?? {});
    if (shots.length && !host) {
      const thumbs = el("div", { class: "vf-thumbs" });
      for (const [i, [key, name]] of shots.entries()) {
        const img = el("img", { alt: `crop ${key}`, loading: "lazy", title: "View full size" });
        void thumb(name).then((u) => u && (img.src = u));
        img.addEventListener("click", (e) => (e.stopPropagation(), openView(shots, i)));
        thumbs.append(img);
      }
      body.append(thumbs);
    }
    const del = el(
      "button",
      { type: "button", title: l.done ? "Looks good: clear it" : "Delete this line" },
      l.done ? "✓" : "🗑",
    );
    del.addEventListener("click", () => log({ type: "retract", id: l.id }));
    row.append(body, del);
    return row;
  }
  const thumbs = new Map<string, Promise<string | null>>(); // crop name -> displayable URL
  const thumb = (name: string) => {
    let u = thumbs.get(name);
    if (!u) {
      u =
        name.startsWith("data:") || name.startsWith("blob:") || host
          ? Promise.resolve(host ? null : name) // a host's crops are its own business
          : store.get(name).then((b) => (b ? URL.createObjectURL(b) : null));
      thumbs.set(name, u);
    }
    return u;
  };

  // ---- A crop at full size: click a thumbnail; ← → step through the line's crops; Esc or a click closes ----
  let view: { node: HTMLElement; shots: [string, string][]; i: number } | null = null;
  function closeView() {
    view?.node.remove();
    view = null;
  }
  function openView(shots: [string, string][], i: number) {
    closeView();
    const [key, name] = shots[i]!;
    const node = el("div", { class: "vf-view", role: "dialog", "aria-label": "Crop at full size" });
    const img = el("img", { alt: `crop ${key}` });
    void thumb(name).then((u) => u && (img.src = u));
    const where = key === "start" ? "As you began" : key === "end" ? "As you stopped" : key;
    const step = shots.length > 1 ? `  ·  ${i + 1} of ${shots.length}, ← → to step` : "";
    node.append(
      img,
      el("div", { class: "vf-view-cap" }, `${where}${step}  ·  Esc or click to close`),
    );
    node.addEventListener("click", closeView);
    layer.appendChild(node);
    view = { node, shots, i };
  }
  // Ahead of the page's own keys (a stepper's arrows), and only while a crop is open.
  addEventListener(
    "keydown",
    (e) => {
      if (!view) return;
      const n = view.shots.length;
      if (e.key === "Escape") closeView();
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft")
        openView(view.shots, (view.i + (e.key === "ArrowRight" ? 1 : n - 1)) % n);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  // ---- The pin card and the panel ----------------------------------------
  let card: HTMLElement | null = null,
    cardKey: string | null = null,
    panel: HTMLElement | null = null;
  const opened = new Set<string>(); // panel groups the user unfolded (or folded: see `folded`)
  const folded = new Set<string>();
  function closeCard() {
    card?.remove();
    card = cardKey = null;
  }
  function openCard(k: string) {
    closeCard();
    const ls = groups(fold().lines).get(k);
    if (!ls) return;
    cardKey = k;
    card = el("div", { class: "vf-card" });
    card.append(el("div", { class: "vf-where" }, nameOf(ls[0]?.anchor)), ...ls.map(lineEl));
    layer.appendChild(card);
    const r = (pins.get(k) ?? pill).getBoundingClientRect();
    placeNear(card, r.left, r.bottom);
  }
  // Header: counts and the rare switches. Middle: one row per element, folded once there are
  // many lines, scrolling. Foot: Copy, Text only, Send, always in view.
  function setPanel(open: boolean) {
    const scroll = panel?.querySelector(".vf-body")?.scrollTop ?? 0;
    panel?.remove();
    panel = null;
    if (!open) return;
    const { lines, picks } = fold();
    const g = groups(lines);
    const crops = lines.reduce((n, l) => n + Object.keys(l.shots ?? {}).length, 0);
    panel = el("div", { class: "vf-panel" });
    const head = el("div", { class: "vf-head" });
    const np = Object.keys(picks).length;
    head.append(
      el(
        "h3",
        {},
        [
          `${lines.length} line${lines.length === 1 ? "" : "s"}`,
          np ? `${np} pick${np === 1 ? "" : "s"}` : "",
          crops ? `${crops} crop${crops === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    if (engine === "browser" && "gpu" in navigator) {
      const up = el(
        "button",
        { class: "vf-mini", type: "button", title: "Switch to Parakeet, the model the skill uses" },
        "⬆ Parakeet",
      );
      up.addEventListener("click", offerParakeet);
      head.append(up);
    }
    dispatchEvent(new CustomEvent("viz:panel", { detail: head })); // presence.js adds Invite here
    const body = el("div", { class: "vf-body" });
    if (np)
      body.append(
        el(
          "div",
          { class: "vf-picks" },
          "Picks: " +
            Object.entries(picks)
              .map(([q, o]) => `${q}:${o}`)
              .join("  "),
        ),
      );
    if (!lines.length)
      body.append(
        el(
          "div",
          { class: "vf-empty" },
          "Click 🎙 and talk while pointing, or Alt-click anything to type.",
        ),
      );
    const foldAll = lines.length > 8;
    for (const [k, ls] of g) {
      const isOpen = foldAll ? opened.has(k) : !folded.has(k);
      const grp = el("div", { class: "vf-group" + (isOpen ? " open" : "") });
      const where = el(
        "div",
        { class: "vf-where", title: isOpen ? "Fold" : "Unfold" },
        `${isOpen ? "▾" : "▸"} ${nameOf(ls[0]?.anchor)} · ${ls.length} line${ls.length === 1 ? "" : "s"}`,
      );
      where.addEventListener("click", () => {
        const set = foldAll ? opened : folded;
        set.has(k) ? set.delete(k) : set.add(k);
        if (foldAll ? opened.has(k) : !folded.has(k))
          safeQuery(k)?.scrollIntoView({ block: "center", behavior: "smooth" });
        setPanel(true);
      });
      grp.append(where);
      if (isOpen) grp.append(...ls.map(lineEl));
      body.append(grp);
    }
    const foot = el("div", { class: "vf-foot" });
    const copyBtn = el(
      "button",
      {
        class: "vf-btn primary",
        type: "button",
        title: "All the text, the crops, and one numbered picture of them",
      },
      "📋 Copy",
    );
    const textBtn = el(
      "button",
      {
        class: "vf-btn",
        type: "button",
        title: "Just the text (Slack keeps only the picture from Copy)",
      },
      "Text only",
    );
    const sendBtn = el(
      "button",
      { class: "vf-btn", type: "button", title: "Tell a waiting agent you're done" },
      "Send",
    );
    copyBtn.addEventListener("click", () => void copy(true));
    textBtn.addEventListener("click", () => void copy(false));
    sendBtn.addEventListener("click", () => void send());
    sendBtn.disabled = !dirty;
    foot.append(copyBtn, textBtn, sendBtn);
    if (!vizId && !host && entries.length) {
      const clear = el(
        "button",
        { class: "vf-btn", type: "button", title: "Empty this page's feedback in this browser" },
        "Clear",
      );
      clear.addEventListener("click", () => void log({ type: "clear" }));
      foot.append(clear);
    }
    panel.append(head, body, foot);
    layer.appendChild(panel);
    body.scrollTop = scroll;
  }
  function flash(text: string) {
    const f = el("div", { class: "vf-flash" }, text);
    layer.appendChild(f);
    const r = pill.getBoundingClientRect();
    f.style.right = innerWidth - r.right + "px";
    f.style.bottom = innerHeight - r.top + 8 + "px";
    setTimeout(() => f.remove(), 2200);
  }

  // ---- Alt/Option-click → "Provide feedback here" ----------------------------
  // Capture phase + stop/prevent so it beats the viz's own click handlers.
  let bubble: HTMLElement | null = null;
  function closeBubble() {
    bubble?.remove();
    bubble = null;
    window.__vizResume?.();
  }
  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey) return;
      const node = e.target;
      if (!(node instanceof Element) || layer.contains(node)) return;
      if (root && !root.contains(node)) return;
      e.preventDefault();
      e.stopPropagation();
      closeBubble();
      window.__vizPause?.(); // hold an animated target still while typing
      const anchor = captureAnchor(node),
        where = whereAt(e.clientX, e.clientY);
      bubble = el("div", { class: "vf-bubble" });
      const ta = el("textarea", { placeholder: "Provide feedback here" });
      const ok = el("button", { class: "vf-btn primary", type: "button" }, "Save");
      const cancel = el("button", { class: "vf-btn", type: "button" }, "Cancel");
      const row = el("div", { class: "vf-row" });
      row.append(cancel, ok);
      bubble.append(ta, el("div", { class: "vf-hint" }, "↳ " + nameOf(anchor)), row);
      layer.appendChild(bubble);
      placeNear(bubble, e.clientX, e.clientY);
      ta.focus();
      const submit = () => {
        const text = ta.value.trim();
        if (!text) return ta.focus();
        log({ type: "comment", id: newId(), text, anchor, where });
        closeBubble();
      };
      cancel.addEventListener("click", closeBubble);
      ok.addEventListener("click", submit);
      ta.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Escape") closeBubble();
        if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") submit();
      });
    },
    true,
  );

  // ---- Rendering ------------------------------------------------------------
  function renderPill() {
    const loading = engine === "parakeet" && !!worker && !modelReady && !micErr;
    micBtn.className =
      "mic" +
      (listening ? " on" : started && paused ? " paused" : "") +
      (engine === "none" ? " off" : "") +
      (loading ? " loading" : "");
    micBtn.innerHTML = "🎙";
    if (loading) micBtn.append(el("span", { class: "spin" }));
    if (loadPct != null) micBtn.append(el("span", { class: "pct" }, loadPct + "%"));
    micBtn.title =
      micErr ||
      (loading
        ? "Loading the speech model…"
        : engine === "none"
          ? "No on-device speech in this browser: Alt-click anything to type"
          : !started
            ? "Talk while pointing (speech stays on this device)"
            : paused
              ? "Resume listening"
              : listening
                ? "Listening: click to pause"
                : "Paused: this tab isn't focused");
    const open = fold().lines.filter((l) => !l.done).length;
    countBtn.textContent = `💬 ${open}`;
    countBtn.classList.toggle("unsent", dirty);
  }
  function render() {
    renderPins(groups(fold().lines));
    renderPill();
    // Rebuild what's open, unless the user is typing in it.
    if (panel && !panel.contains(document.activeElement)) setPanel(true);
    if (card && !card.contains(document.activeElement))
      cardKey && groups(fold().lines).has(cardKey) ? openCard(cardKey) : closeCard();
  }

  micBtn.addEventListener("click", async () => {
    if (started) return ((paused = !paused), sync());
    engine ??= await pickEngine();
    if (engine === "offer") return offerParakeet();
    if (engine === "none")
      return notice(
        "This browser can't turn speech into text on this device.",
        "Alt/Option-click anything to type instead. (Chrome on a desktop can do both.)",
      );
    startEngine(engine).catch(
      (e: unknown) => ((micErr = "mic unavailable: " + (e as Error).message), renderPill()),
    );
  });
  countBtn.addEventListener("click", () => setPanel(!panel));
  addEventListener("focus", sync);
  addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
  setInterval(sync, 1000); // focus events miss some app switches; a cheap re-check covers them

  // Close popovers on an outside click or Escape (but not while Alt-clicking to add).
  document.addEventListener(
    "click",
    (e) => {
      if (e.altKey || layer.contains(e.target as Node | null)) return;
      closeCard();
      setPanel(false);
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeCard();
    setPanel(false);
  });

  // ---- Helpers ----------------------------------------------------------------
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    text?: string | null,
  ): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  }
  function placeNear(node: HTMLElement, x: number, y: number) {
    const w = node.offsetWidth || 300,
      h = node.offsetHeight || 140;
    node.style.left = Math.max(8, Math.min(x + 12, innerWidth - w - 8)) + "px";
    node.style.top = Math.max(8, Math.min(y + 12, innerHeight - h - 8)) + "px";
  }

  // ---- Go ------------------------------------------------------------------
  // `log` for pages that add their own lines (grill-me-viz picks); `say` is a test hook that
  // transcribes a 16 kHz clip (or takes the words as text) as if just spoken with the pointer at (x, y).
  const ready = store.load().then(
    (all) => (all.forEach(apply), render(), entries),
    () => entries,
  );
  window.vizFeedback = {
    log,
    send,
    ready,
    say: (pcm: Float32Array | string, x = mx, y = my, from?: [number, number]) => {
      if (typeof pcm === "string") {
        // Already words: skip the model, keep everything after it (anchors, crops, the log).
        const start = begin(...(from ?? [x, y]));
        const { anchor, where } = pointAt(x, y);
        return land(
          pcm,
          start,
          anchor,
          where,
          shoot(anchor, x, y),
          caption(anchor, where, "…"),
          null,
        );
      }
      if (!worker) loadModel();
      if (from) began = begin(...from);
      ((mx = x), (my = y), (buf = [pcm]));
      return cut();
    },
  };
  void ready.then((all) =>
    dispatchEvent(new CustomEvent("viz-feedback:ready", { detail: { entries: all } })),
  );
  render();
  requestAnimationFrame(tick);
}

// ---- Stores ----------------------------------------------------------------------
/** The viz server's page data route: <viz>/.viz-data/feedback.jsonl and files/. */
function serverStore(vizId: string): Store {
  const LOG = `/${vizId}/_log/feedback`,
    FILES = `/${vizId}/_files/`;
  return {
    load: () =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the log is this page's own feedback.jsonl
      fetch(LOG).then((r) => (r.ok ? (r.json() as Promise<Entry[]>) : [])),
    append: (e) =>
      fetch(LOG, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(e),
      }).then(() => {}),
    put: (name, png) =>
      fetch(FILES + name, { method: "PUT", body: png }).then(
        (r) => (r.ok ? name : null),
        () => null,
      ),
    get: (name) => fetch(FILES + name).then((r) => (r.ok ? r.blob() : null)),
  };
}
/** No server: this browser's IndexedDB, one log per page stamp, its crops beside it. */
function localStore(stamp: string): Store {
  const db = new Promise<IDBDatabase>((done, fail) => {
    const req = indexedDB.open("viz-feedback", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("log"); // stamp -> Entry[]
      req.result.createObjectStore("files"); // stamp/name -> Blob
    };
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
  const run = <T>(
    name: "log" | "files",
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest,
  ) =>
    db.then(
      (d) =>
        new Promise<T>((done, fail) => {
          const req = op(d.transaction(name, mode).objectStore(name));
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- IndexedDB boundary: each key holds only what this store wrote
          req.onsuccess = () => done(req.result as T);
          req.onerror = () => fail(req.error);
        }),
    );
  let chain = Promise.resolve(); // appends read-modify-write the one array: one at a time
  return {
    load: () =>
      run<Entry[] | undefined>("log", "readonly", (s) => s.get(stamp)).then((l) => l ?? []),
    append: (e) =>
      (chain = chain.then(async () => {
        const all = (await run<Entry[] | undefined>("log", "readonly", (s) => s.get(stamp))) ?? [];
        all.push(e);
        await run("log", "readwrite", (s) => s.put(all, stamp));
      })),
    put: (name, png) =>
      run("files", "readwrite", (s) => s.put(png, `${stamp}/${name}`)).then(() => name),
    get: (name) =>
      run<Blob | undefined>("files", "readonly", (s) => s.get(`${stamp}/${name}`)).then(
        (b) => b ?? null,
      ),
  };
}
/** A hosting page keeps the log itself and draws its own crops. */
function hostStore(host: FeedbackHost): Store {
  return {
    load: () => Promise.resolve([]),
    append: (e) => Promise.resolve(host.log(e)),
    put: () => Promise.resolve(null),
    get: () => Promise.resolve(null),
  };
}

const dataUrl = (b: Blob) =>
  new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });
const escHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
