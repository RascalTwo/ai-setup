// feedback-engine.js — the mic button's speech engine. Pick one (Parakeet if this browser already
// holds the model, else the browser's own on-device recognizer, else the Parakeet offer, else typing
// only), run it, and keep it listening only while the tab has focus.
// Parakeet: mic → pause detection (feedback-capture.js) → parakeet-worker.js → text. Browser: the
// browser's on-device recognizer splits and transcribes; each of its results is one line.

import type { Began, Caption, Engine, RecognizerClass, Widget } from "@viz/kit/feedback-types.js";
import { detach } from "@viz/kit/feedback-dom.js";

const LANG = navigator.language || "en-US";
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- window.SpeechRecognition is not in lib.dom; RecognizerClass is the slice used here
const Rec = (window as unknown as { SpeechRecognition?: RecognizerClass }).SpeechRecognition;

/** Whether parakeet.js already holds the model in this origin's IndexedDB. Never opens a
 *  database that isn't there: an empty one would skip parakeet.js's own store setup. */
async function parakeetCached(): Promise<boolean> {
  const NAME = "parakeet-cache-db";
  if (!(await indexedDB.databases?.())?.some((d) => d.name === NAME)) return false;
  return new Promise((done) => {
    const req = indexedDB.open(NAME);
    req.addEventListener("error", () => {
      done(false);
    });
    req.addEventListener("success", () => {
      const db = req.result;
      try {
        const keys = db.transaction("file-store").objectStore("file-store").getAllKeys();
        keys.addEventListener("success", () => {
          done(
            keys.result.some((k) => typeof k === "string" && k.endsWith("encoder-model.onnx.data")),
          );
          db.close();
        });
        keys.addEventListener("error", () => {
          done(false);
          db.close();
        });
      } catch {
        done(false);
        db.close();
      }
    });
  });
}
export async function pickEngine(): Promise<Engine> {
  if (await parakeetCached()) return "parakeet";
  const want = { langs: [LANG], processLocally: true };
  const state = (await Rec?.available?.(want).catch(() => "")) ?? "";
  if (state === "available") return "browser";
  if ((state === "downloadable" || state === "downloading") && (await Rec?.install?.(want)))
    return "browser";
  return "gpu" in navigator ? "offer" : "none";
}

/** What parakeet-worker.js posts back: model progress, ready, an error, or one transcript. */
interface WorkerMessage {
  type: string;
  id: number;
  text: string;
  loaded: number;
  total: number;
  message: string;
}
export function loadModel(w: Widget): void {
  // Published builds inline this path as a data: URL (inline.ts); a worker from one has an
  // opaque origin and no model cache, so it runs from a same-origin blob instead.
  const src: string = "/_kit/parakeet-worker.js";
  const url = src.startsWith("data:")
    ? URL.createObjectURL(
        new Blob([atob(src.slice(src.indexOf(",") + 1))], { type: "text/javascript" }),
      )
    : src;
  const worker = (w.worker = new Worker(url, { type: "module" }));
  worker.addEventListener("message", ({ data }: MessageEvent<WorkerMessage>) => {
    if (data.type === "progress" && data.total)
      w.loadPct = Math.round((100 * data.loaded) / data.total);
    if (data.type === "ready") {
      w.modelReady = true;
      w.loadPct = null;
      sync(w);
    }
    if (data.type === "error") w.micErr = "speech model failed: " + data.message;
    if (data.type === "text") {
      w.waiting.get(data.id)?.(data.text);
      w.waiting.delete(data.id);
    }
    w.act.renderPill();
  });
  if (navigator.storage?.persist) detach(navigator.storage.persist()); // ask Chrome not to evict the cached model under disk pressure
  w.act.renderPill(); // show "loading" now, not on the worker's first message (a cached load sends no progress)
}

export async function startEngine(w: Widget, e: "parakeet" | "browser"): Promise<void> {
  w.engine = e;
  if (!w.host?.shoot) detach(w.drawer()); // warm the page drawer (and its fonts) before the first crop
  if (e === "browser") startBrowser(w);
  else {
    if (!w.worker) loadModel(w);
    if (!w.ctx) await startMic(w);
  }
  w.started = true;
  sync(w);
}

async function startMic(w: Widget): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  w.ctx = new AudioContext({ sampleRate: 16000 });
  const src = w.ctx.createMediaStreamSource(stream);
  // oxlint-disable-next-line typescript/no-deprecated -- ScriptProcessor feeds pause detection 64 ms frames on the main thread; the AudioWorklet replacement is a rewrite of this path
  const proc = w.ctx.createScriptProcessor(1024, 1, 1); // 64 ms frames
  src.connect(proc);
  proc.connect(w.ctx.destination);
  proc.addEventListener("audioprocess", (ev) => {
    if (!w.listening || w.engine !== "parakeet") return;
    // oxlint-disable-next-line typescript/no-deprecated -- the same ScriptProcessor's event: its buffer is read here
    w.act.frame(new Float32Array(ev.inputBuffer.getChannelData(0)));
  });
}

/** One browser-engine result as it comes in: its words, and the pointer where it began. */
type Heard = Began & { cap: Caption };
/** A browser-engine result, interim or final: show its words live, and land it once final. */
function onBrowserResult(
  w: Widget,
  heard: Map<number, Heard>,
  e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> },
): void {
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i]!,
      text = r[0].transcript.trim();
    let b = heard.get(i);
    if (!b && text) {
      const start = w.act.begin(w.mx, w.my);
      b = { ...start, cap: w.act.caption(start.anchor, start.where, "…") };
      heard.set(i, b);
      w.dot.classList.add("on");
    }
    if (!b) continue;
    if (!r.isFinal) {
      b.cap.live(text);
      continue;
    }
    heard.delete(i);
    if (heard.size === 0) w.dot.classList.remove("on");
    const { anchor, where } = w.act.pointAt(w.mx, w.my);
    const done = w.act.land(text, b, anchor, where, w.act.shoot(anchor, w.mx, w.my), b.cap, null);
    w.inflight.add(done);
    detach(
      done.then(() => {
        w.inflight.delete(done);
      }),
    );
  }
}

function startBrowser(w: Widget): void {
  if (!Rec) return;
  const rec = (w.rec = new Rec());
  rec.lang = LANG;
  rec.continuous = true;
  rec.interimResults = true;
  rec.processLocally = true;
  let heard = new Map<number, Heard>();
  rec.addEventListener("start", () => {
    heard = new Map(); // result indexes restart with each session
  });
  rec.addEventListener("result", (e) => {
    onBrowserResult(w, heard, e);
  });
  rec.addEventListener("error", (e) => {
    if (e.error !== "no-speech" && e.error !== "aborted") {
      w.micErr = "speech: " + e.error;
      w.act.renderPill();
    }
  });
  rec.addEventListener("end", () => {
    w.onEnd?.();
    w.onEnd = null;
    if (w.listening) w.rec?.start(); // the browser ends sessions on its own; keep going
  });
}

export function sync(w: Widget): void {
  const was = w.listening;
  const ready = w.engine === "browser" || w.modelReady;
  w.listening = w.started && !w.paused && ready && document.hasFocus();
  if (w.listening && !was) {
    if (w.engine === "browser") w.rec?.start();
    else if (w.ctx) detach(w.ctx.resume());
  }
  if (was && !w.listening) {
    if (w.engine === "browser") w.rec?.stop(); // stop, not abort: what was said still lands
    else if (w.speaking) detach(w.act.cut()); // leaving mid-sentence still keeps what you said
  }
  w.act.renderPill();
}

// In place of the mic when the browser can't transcribe on-device; behind ⬆ when it can.
export function offerParakeet(w: Widget): void {
  w.act.notice(
    w.engine === "browser"
      ? "Switch to Parakeet, the speech model the skill itself uses?"
      : "This browser has no on-device speech recognition. Download Parakeet, the speech model the skill uses?",
    "2.4 GB, once: about 1–7 minutes on a 50–300 Mbps line, then cached in this browser. Needs WebGPU. Your audio still never leaves this device.",
    () => {
      w.rec?.abort();
      w.rec = null;
      if (w.engine === "browser") {
        w.started = false;
        w.listening = false;
      }
      startEngine(w, "parakeet").catch((err: unknown) => {
        w.micErr = "mic unavailable: " + (err instanceof Error ? err.message : String(err));
        w.act.renderPill();
      });
    },
  );
}
