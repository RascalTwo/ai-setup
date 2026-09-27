// grill-voice.js — speak your answers: a dock pinned to the bottom of a grill-me-viz page.
//
// Mic → pause detection → each stretch of speech is transcribed in the browser by Parakeet
// (parakeet-worker.js, WebGPU; the model is cached per browser after one ~2.4 GB download)
// → one `speech` line in _log/grill via window.grill.log, tagged with the question the mouse
// was over (a hint, not a rule). Audio never leaves the tab and is never saved.
//
// The mic starts only on a click of Start voice, then listens while the tab is focused (or
// always, with "keep on") until Pause. Each line has a trash button: deleting a line logs a
// `retract` for it. Send cuts the current stretch and waits for its text before the send
// line is written (grill.js awaits it), then pauses the mic until you click Resume.
// Load after grill.js: <script src="grill-voice.js" type="module"></script>

const dock = document.createElement("div");
dock.className = "voice-dock";
dock.innerHTML = `
  <button class="mic" type="button">🎙 Start voice</button>
  <button class="pause" type="button" hidden>⏸ Pause</button>
  <span class="state">loading speech model…</span>
  <label class="keep"><input type="checkbox"> keep on when I leave the tab</label>
  <div class="lines"></div>`;
document.body.append(dock);
// The dock grows as lines arrive; pad the page by its height so it never covers content.
const fit = () => (document.body.style.paddingBottom = `calc(40vh + ${dock.offsetHeight}px)`); // 40vh: room to scroll a new round to the top
new ResizeObserver(fit).observe(dock);
const $ = (s) => dock.querySelector(s);
const round = () => +([...document.querySelectorAll("[data-round]")].pop()?.dataset.round ?? 0);

// ---- model ----
const worker = new Worker(new URL("parakeet-worker.js", import.meta.url), { type: "module" });
let modelReady = false, seq = 0;
const waiting = new Map(); // id -> handler for its transcript
const inflight = new Set(); // stretches not yet logged; Send waits on these
worker.onmessage = ({ data }) => {
  if (data.type === "progress" && data.total) $(".state").textContent = `loading speech model: ${Math.round((100 * data.loaded) / data.total)}%`;
  if (data.type === "ready") { modelReady = true; render(); }
  if (data.type === "error") $(".state").textContent = "speech model failed: " + data.message;
  if (data.type === "text") waiting.get(data.id)?.(data), waiting.delete(data.id);
};
navigator.storage?.persist?.(); // ask Chrome not to evict the cached model under disk pressure

// ---- which question you're talking about (hint) ----
let hovered = null;
document.addEventListener("mouseover", (e) => {
  const q = e.target.closest(".q:not(.original .q)");
  if (q) hovered = q.querySelector("h3 .n")?.textContent.trim() ?? hovered;
});

// ---- mic + pause detection ----
let ctx, listening = false, started = false, paused = false;
const keep = () => $(".keep input").checked;
const wanted = () => started && !paused && (document.hasFocus() || keep());

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(1024, 1, 1); // 64 ms frames
  src.connect(proc);
  proc.connect(ctx.destination);
  proc.onaudioprocess = (ev) => listening && frame(new Float32Array(ev.inputBuffer.getChannelData(0)));
  started = true;
  sync();
}

// Speech = a frame well above the learned noise floor; a stretch ends after PAUSE ms of quiet.
// 300 ms before speech is kept so first words aren't clipped. (Tested by hand: 300–1000 ms all felt fine.)
const PAUSE = 700, RATE = 16000;
let floor = 0.01, speaking = false, quietMs = 0, buf = [], pre = [], tags = new Set();
function frame(f) {
  let rms = 0;
  for (const v of f) rms += v * v;
  rms = Math.sqrt(rms / f.length);
  if (!speaking) floor = floor * 0.97 + rms * 0.03;
  const loud = rms > Math.max(0.012, floor * 3);
  if (loud) {
    if (!speaking) (speaking = true), (buf = [...pre]), (tags = new Set());
    quietMs = 0;
  }
  if (speaking) {
    buf.push(f);
    if (hovered) tags.add(hovered);
    if (!loud) quietMs += (f.length / RATE) * 1000;
    if (quietMs >= PAUSE || length() > RATE * 25) cut();
  } else {
    pre.push(f);
    if (pre.length > 5) pre.shift();
  }
}
const length = () => buf.reduce((a, b) => a + b.length, 0);

// End the current stretch and transcribe it. Resolves once its line is logged (or skipped).
function cut() {
  const len = length(), frames = buf, q = hovered, qs = [...tags];
  speaking = false; buf = []; quietMs = 0;
  if (len < RATE * 0.4) return Promise.resolve();
  const pcm = new Float32Array(len);
  let o = 0;
  for (const f of frames) pcm.set(f, o), (o += f.length);
  const id = ++seq, r = round(), line = addLine(q), sid = Math.random().toString(36).slice(2, 10);
  const done = new Promise((resolve) => {
    waiting.set(id, async ({ text }) => {
      text = text.trim();
      if (!text || line.dataset.gone) line.remove(); // noise, or deleted while it was transcribing
      else {
        line.querySelector(".t").textContent = text;
        line.classList.remove("pending");
        line.dataset.sid = sid;
        await window.grill?.log({ type: "speech", id: sid, round: r, text, q, qs, secs: +(len / RATE).toFixed(1) });
      }
      resolve();
    });
    worker.postMessage({ id, pcm }, [pcm.buffer]);
  });
  inflight.add(done);
  done.then(() => inflight.delete(done));
  return done;
}

function addLine(q) {
  const el = document.createElement("div");
  el.className = "line pending";
  el.innerHTML = `<span class="chip"></span><span class="t">…</span><button class="del" type="button" title="delete this line">🗑</button>`;
  el.querySelector(".chip").textContent = q ?? "·";
  $(".lines").append(el);
  el.scrollIntoView({ block: "nearest" });
  $(".lines").scrollTop = 1e9;
  return el;
}

// ---- state ----
function sync() {
  const was = listening;
  listening = wanted() && modelReady;
  if (listening) ctx?.resume();
  if (was && !listening && speaking) cut(); // leaving mid-sentence still keeps what you said
  render();
}
function render() {
  const s = $(".state");
  dock.classList.toggle("on", listening);
  $(".mic").hidden = started;
  $(".pause").hidden = !started;
  $(".pause").textContent = paused ? "▶ Resume" : "⏸ Pause";
  if (!modelReady) return;
  s.textContent = !started ? "speak your answers" : paused ? "paused" : listening ? "● listening" : "paused: tab not focused";
}
$(".mic").onclick = () => start().catch((e) => ($(".state").textContent = "mic unavailable: " + e.message));
$(".pause").onclick = () => { paused = !paused; sync(); };
$(".lines").addEventListener("click", (e) => {
  const line = e.target.closest(".del") && e.target.closest(".line");
  if (!line) return;
  if (line.dataset.sid) window.grill?.log({ type: "retract", id: line.dataset.sid });
  line.dataset.gone = "1"; // a pending line is dropped when its text arrives
  line.remove();
  fit();
});
$(".keep input").onchange = sync;
addEventListener("focus", sync);
addEventListener("blur", sync);
document.addEventListener("visibilitychange", sync);
setInterval(sync, 1000); // focus events miss some app switches; a cheap re-check covers them

// Send: cut what's being said now and hold the send line until every stretch is logged.
addEventListener("grill:send", (e) => {
  if (speaking) cut();
  if (started) (paused = true), sync(); // no listening while the agent works; Resume is manual
  e.detail.waitUntil(Promise.all([...inflight]));
  $(".lines").replaceChildren(); // next round starts with an empty dock
});


// Test hook: transcribe a 16 kHz clip as if it had been spoken (no mic needed).
window.grillVoice = { say: (pcm) => ((buf = [pcm]), cut()) };
