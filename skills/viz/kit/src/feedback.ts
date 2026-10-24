// feedback.js — the /viz feedback widget (client overlay).
//
// On every page: the viz server injects it into live pages, and every self-contained build
// (export, publish) carries it unless the page opts out with <meta name="viz:feedback"
// content="off"> (ADR 0026); content="hidden" keeps it but starts it hidden.
// Alt+Shift+F shows or hides it on any page. Where it saves depends on where the page is:
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

import { foldFeedback, type Entry } from "@viz/kit/feedback-text.js";
import type { Actions, Store, Widget } from "@viz/kit/feedback-types.js";
import { detach } from "@viz/kit/feedback-dom.js";
import { localStore, hostStore, serverStore } from "@viz/kit/feedback-store.js";
import { fontCss, shoot } from "@viz/kit/feedback-crop.js";
import {
  begin,
  caption,
  captureAnchor,
  cut,
  frame,
  landFor,
  pointAt,
  whereAt,
} from "@viz/kit/feedback-capture.js";
import {
  loadModel,
  offerParakeet,
  pickEngine,
  startEngine,
  sync,
} from "@viz/kit/feedback-engine.js";
import {
  flash,
  installAltClick,
  mountParts,
  notice,
  renderPill,
} from "@viz/kit/feedback-chrome.js";
import {
  closeCard,
  groups,
  installViewKeys,
  lineEl,
  openCard,
  openView,
  renderPins,
  tick,
} from "@viz/kit/feedback-pins.js";
import { copy, send, setPanel } from "@viz/kit/feedback-panel.js";

// Start once every deferred script has run, so a page module that sets vizFeedbackHost is in
// place whichever of the two scripts comes first.
if (document.readyState === "complete") start();
else document.addEventListener("DOMContentLoaded", start, { once: true });

// kit/screenshot.js (modern-screenshot) and the page's fonts, fetched once, on first use.
let drawing: Promise<[typeof import("@viz/kit/screenshot.js"), string]> | null = null;
// By its alias, not /_kit/: a build gives it its own import-map entry rather than nesting it,
// base64 inside base64, in this file (inline.ts).
// oxlint-disable-next-line typescript/promise-function-async -- hands every caller the one cached promise, not a new promise each time
const drawer = () => (drawing ??= Promise.all([import("@viz/kit/screenshot.js"), fontCss()]));

function start() {
  if (document.querySelector("#viz-feedback")) return; // already running
  const host = window.vizFeedbackHost;
  const root = host?.root;
  // The live server names the viz on its <script>; the shim in <head> carries the page stamp.
  const vizId = document.querySelector<HTMLElement>("script[data-viz-feedback]")?.dataset[
    "vizFeedback"
  ];
  const stamp =
    document.querySelector<HTMLElement>("script[data-viz-stamp]")?.dataset["vizStamp"] ?? "";
  const store: Store = host ? hostStore(host) : vizId ? serverStore(vizId) : localStore(stamp);
  const parts = mountParts(root);
  const w: Widget = {
    host,
    root,
    vizId,
    stamp,
    store,
    ...parts,
    ...idleState(),
    drawer,
    act: actionsFor(() => w),
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      w.mx = e.clientX;
      w.my = e.clientY;
      w.dot.style.left = w.mx + "px";
      w.dot.style.top = w.my + "px";
    },
    { passive: true },
  );
  installViewKeys(w);
  installAltClick(w);
  wireControls(w);

  const ready = w.store.load().then(
    (all) => {
      all.forEach((e) => {
        apply(w, e);
      });
      render(w);
      return w.entries;
    },
    () => w.entries,
  );
  exposeApi(w, ready);
  detach(
    ready.then((all) => {
      dispatchEvent(new CustomEvent("viz-feedback:ready", { detail: { entries: all } }));
    }),
  );
  render(w);
  requestAnimationFrame(() => tick(w));
}

/** A widget with nothing logged, no engine chosen and nothing open. */
const idleState = () => ({
  // The log
  entries: [] as Entry[],
  dirty: false, // something changed since the last send
  // Speech
  engine: null,
  worker: null,
  modelReady: false,
  loadPct: null,
  micErr: "",
  seq: 0,
  waiting: new Map<number, (text: string) => void>(), // worker job id -> handler for its transcript
  inflight: new Set<Promise<void>>(), // stretches not yet logged; Send waits on these
  ctx: undefined,
  rec: null,
  onEnd: null,
  started: false,
  paused: false,
  listening: false,
  mx: -1,
  my: -1,
  floor: 0.01,
  speaking: false,
  quietMs: 0,
  began: undefined,
  buf: [] as Float32Array[],
  pre: [] as Float32Array[],
  // What is open
  bubble: null,
  card: null,
  cardKey: null,
  panel: null,
  view: null,
  pins: new Map<string, HTMLElement>(), // anchor selector -> pin element
  opened: new Set<string>(), // panel groups the user unfolded (or folded: see `folded`)
  folded: new Set<string>(),
  thumbs: new Map<string, Promise<string | null>>(), // crop name -> displayable URL
});

/** What the modules ask of each other (see Actions in feedback-types.js), bound to this widget. */
function actionsFor(widget: () => Widget): Actions {
  /* oxlint-disable typescript/promise-function-async -- each of these hands its promise straight on, as the function it wraps does */
  return {
    fold: () => foldFeedback(widget().entries),
    log: (e) => log(widget(), e),
    renderPill: () => renderPill(widget()),
    sync: () => sync(widget()),
    cut: () => cut(widget()),
    frame: (f) => frame(widget(), f),
    shoot: (anchor, x, y) => shoot(widget(), anchor, x, y),
    captureAnchor,
    whereAt,
    pointAt: (x, y) => pointAt(widget(), x, y),
    begin: (x, y) => begin(widget(), x, y),
    caption: (anchor, where, text) => caption(widget(), anchor, where, text),
    land: (...args) => landFor(widget())(...args),
    notice: (text, hint, go) => notice(widget(), text, hint, go),
    flash: (text) => flash(widget(), text),
    offerParakeet: () => offerParakeet(widget()),
    openView: (shots, i) => openView(widget(), shots, i),
    lineEl: (l) => lineEl(widget(), l),
    groups,
    send: (extra) => send(widget(), extra),
    copy: (withImages) => copy(widget(), withImages),
  };
  /* oxlint-enable typescript/promise-function-async */
}

// ---- The log, folded into lines ------------------------------------------
function apply(w: Widget, e: Entry) {
  w.entries.push(e);
  if (e.type === "send") w.dirty = false;
  else if (e.type !== "resolve" && e.type !== "clear") w.dirty = true;
}
async function log(w: Widget, entry: Entry) {
  if (window.vizPresence?.replaying) return; // someone else's click, replayed here: their page logs it
  const me = window.vizPresence?.me;
  const by =
    me && (entry.type === "speech" || entry.type === "comment")
      ? { by: { name: me.name, color: me.color } }
      : {};
  const e = { at: new Date().toISOString(), ...by, ...entry }; // the server keeps it; Copy shows it
  apply(w, e);
  render(w);
  await w.store.append(e).catch(() => null);
}

// ---- Rendering ------------------------------------------------------------
function render(w: Widget) {
  renderPins(w, groups(foldFeedback(w.entries).lines));
  renderPill(w);
  // Rebuild what's open, unless the user is typing in it.
  if (w.panel && !w.panel.contains(document.activeElement)) setPanel(w, true);
  if (w.card && !w.card.contains(document.activeElement)) {
    if (w.cardKey && groups(foldFeedback(w.entries).lines).has(w.cardKey)) openCard(w, w.cardKey);
    else closeCard(w);
  }
}

/** The mic button: pause or resume once started; else pick an engine and start it, or say why not. */
async function micClick(w: Widget): Promise<void> {
  if (w.started) {
    w.paused = !w.paused;
    sync(w);
    return;
  }
  w.engine ??= await pickEngine();
  if (w.engine === "offer") {
    offerParakeet(w);
    return;
  }
  if (w.engine === "none") {
    notice(
      w,
      "This browser can't turn speech into text on this device.",
      "Alt/Option-click anything to type instead. (Chrome on a desktop can do both.)",
    );
    return;
  }
  startEngine(w, w.engine).catch((e: unknown) => {
    w.micErr = "mic unavailable: " + (e instanceof Error ? e.message : String(e));
    renderPill(w);
  });
}

/** The pill's two buttons, the focus checks that keep the mic honest, and closing popovers. */
function wireControls(w: Widget) {
  w.micBtn.addEventListener("click", () => {
    detach(micClick(w));
  });
  w.countBtn.addEventListener("click", () => {
    setPanel(w, !w.panel);
  });
  addEventListener("focus", () => sync(w));
  addEventListener("blur", () => sync(w));
  document.addEventListener("visibilitychange", () => sync(w));
  setInterval(() => sync(w), 1000); // focus events miss some app switches; a cheap re-check covers them

  // Close popovers on an outside click or Escape (but not while Alt-clicking to add).
  document.addEventListener(
    "click",
    (e) => {
      if (e.altKey || (e.target instanceof Node && w.layer.contains(e.target))) return;
      closeCard(w);
      setPanel(w, false);
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeCard(w);
    setPanel(w, false);
  });
}

// ---- Go ------------------------------------------------------------------
// `log` for pages that add their own lines (grill-me-viz picks); `say` is a test hook that
// transcribes a 16 kHz clip (or takes the words as text) as if just spoken with the pointer at (x, y).
function exposeApi(w: Widget, ready: Promise<Entry[]>) {
  /* oxlint-disable typescript/promise-function-async -- the page's hooks hand back the promise of the function they wrap */
  window.vizFeedback = {
    log: (e) => log(w, e),
    send: (extra) => send(w, extra),
    ready,
    say: (pcm: Float32Array | string, x = w.mx, y = w.my, from?: [number, number]) => {
      if (typeof pcm === "string") {
        // Already words: skip the model, keep everything after it (anchors, crops, the log).
        const [fx, fy] = from ?? [x, y];
        const began = begin(w, fx, fy);
        const { anchor, where } = pointAt(w, x, y);
        return landFor(w)(
          pcm,
          began,
          anchor,
          where,
          shoot(w, anchor, x, y),
          caption(w, anchor, where, "…"),
          null,
        );
      }
      if (!w.worker) loadModel(w);
      if (from) w.began = begin(w, from[0], from[1]);
      w.mx = x;
      w.my = y;
      w.buf = [pcm];
      return cut(w);
    },
  };
  /* oxlint-enable typescript/promise-function-async */
}
