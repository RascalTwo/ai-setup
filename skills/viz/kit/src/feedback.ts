// feedback.js — the /viz feedback widget (client overlay).
//
// Injected LIVE-ONLY by the viz server next to the hot-reload script (never in frozen or
// published builds). One pill in the bottom-right corner collects feedback two ways:
//   speak : 🎙 → each stretch of speech (split at pauses) is transcribed in the browser by
//           Parakeet (parakeet-worker.js, WebGPU; ~2.4 GB, cached per browser after one
//           download, loaded on the first mic click) and anchored to what the mouse is
//           over when the stretch ENDS — so you can talk, then aim.
//   type  : Alt/Option-click any element → "Provide feedback here".
// Audio never leaves the tab and is never saved.
//
// Everything is one append-only log, <viz>/.viz-data/feedback.jsonl, through the page data
// route (ADR 0019). Line types: speech/comment (a line), edit (new text, latest wins),
// retract (the user deleted or cleared it), resolve (Claude did it, + note), clear (every
// earlier line leaves the page; the agent writes it after consuming a grill round), send
// (the user is done; Claude waits on it with a grep), pick (grill-me-viz). The agent side
// is `viz feedback <viz>`.
//
// Anchor: nearest [data-viz-id], else nearest <section>, else the page. The selector is
// stable across reloads; a requestAnimationFrame loop re-reads getBoundingClientRect()
// every frame so a pin follows its element even while the viz animates it.

/** What a line is attached to: a selector that survives reloads, plus how to name it to a person. */
interface Anchor { selector: string; label?: string; text?: string }
/** Where the pointer and the page were when a line was made. `exact` is the element under the pointer when the anchor climbed. */
interface Where { x: number; y: number; w: number; h: number; sx: number; sy: number; hash: string; exact?: string }
/** One entry of .viz-data/feedback.jsonl. `pick` and anything else a page logs pass through unread. */
type Entry =
  | { type: "speech" | "comment"; id: string; text: string; anchor: Anchor | null; where: Where; secs?: number }
  | { type: "edit"; id: string; text: string }
  | { type: "retract"; id: string }
  | { type: "resolve"; id: string; note?: string }
  | { type: "clear" }
  | { type: "send"; round?: number };
type Line = { id: string; type: "speech" | "comment"; text: string; anchor: Anchor | null; where: Where; done: boolean; note?: string | undefined };

declare global {
  interface Window {
    /** `log` for pages that add their own lines (grill-me-viz picks); `say` is a test hook. */
    vizFeedback?: { log(e: Entry | { type: string; [k: string]: unknown }): Promise<void>; send(extra?: { round?: number }): Promise<void>; say(pcm: Float32Array, x?: number, y?: number): Promise<void> };
    /** A page that animates can hold still while someone types feedback on it. */
    __vizPause?: () => void;
    __vizResume?: () => void;
  }
}

(() => {
  const script = document.querySelector("script[data-viz-feedback]");
  const vizId = (script as HTMLElement | null)?.dataset["vizFeedback"];
  if (!vizId) return; // not injected by the viz server — bail silently
  const LOG = `/${vizId}/_log/feedback`;

  // ---- The log, folded into lines ------------------------------------------
  const lines = new Map<string, Line>();
  let dirty = false; // something changed since the last send
  function apply(e: Entry | { type: string; id?: string }) {
    const l = "id" in e && e.id ? lines.get(e.id) : undefined;
    const x = e as Entry;
    if (x.type === "speech" || x.type === "comment") lines.set(x.id, { ...x, done: false });
    else if (x.type === "edit" && l) l.text = x.text;
    else if (x.type === "retract") lines.delete(x.id);
    else if (x.type === "resolve" && l) (l.done = true), (l.note = x.note);
    else if (e.type === "clear") lines.clear();
    if (e.type === "send") dirty = false;
    else if (e.type !== "resolve" && e.type !== "clear") dirty = true;
  }
  async function log(e: Entry | { type: string; [k: string]: unknown }) {
    apply(e);
    render();
    await fetch(LOG, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e) }).catch(() => {});
  }
  const newId = () => Math.random().toString(36).slice(2, 10);

  // ---- DOM scaffolding -------------------------------------------------------
  const layer = el("div", { id: "viz-feedback" });
  const pill = el("div", { class: "vf-pill" });
  const micBtn = el("button", { class: "mic", type: "button" });
  const keepBtn = el("button", { class: "keep", type: "button", title: "Keep listening when you leave the tab", "aria-pressed": "false" }, "📌");
  const countBtn = el("button", { class: "count", type: "button", title: "All feedback on this page" });
  const sendBtn = el("button", { class: "send", type: "button", title: "Tell Claude you're done" }, "Send");
  pill.append(micBtn, keepBtn, countBtn, sendBtn);
  const dot = el("div", { class: "vf-dot" });
  layer.append(pill, dot);
  document.documentElement.appendChild(layer);

  // ---- Selectors and anchors -------------------------------------------------
  // Prefer a stable identity (id → data-viz-id → other data-*/aria-label/name), falling
  // back to a structural :nth-of-type path. Works on SVG nodes too.
  const isUnique = (sel: string) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const escAttr = (s: string) => String(s).replace(/(["\\])/g, "\\$1");
  function uniqueSelector(node: Element): string {
    if (node.id && isUnique(`#${CSS.escape(node.id)}`)) return `#${CSS.escape(node.id)}`;
    const tag = node.tagName.toLowerCase();
    for (const a of ["data-viz-id", "data-label", "aria-label", "name", "data-id"]) {
      const v = node.getAttribute(a);
      if (v && isUnique(`${tag}[${a}="${escAttr(v)}"]`)) return `${tag}[${a}="${escAttr(v)}"]`;
    }
    const parts: string[] = [];
    for (let cur: Element | null = node; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
      let part = cur.tagName.toLowerCase();
      const v = cur.getAttribute("data-viz-id");
      if (v) part += `[data-viz-id="${escAttr(v)}"]`;
      else {
        const tagName = cur.tagName;
        const sames = [...(cur.parentNode?.children ?? [])].filter((c) => c.tagName === tagName);
        if (sames.length > 1) part += `:nth-of-type(${sames.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      if (isUnique(parts.join(" > "))) break;
    }
    return parts.join(" > ");
  }
  function captureAnchor(node: Element): Anchor {
    const anchor: Anchor = { selector: uniqueSelector(node) };
    const label = node.getAttribute("data-label") || node.getAttribute("data-viz-id") || node.getAttribute("aria-label");
    if (label) anchor.label = label;
    const text = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (text) anchor.text = text;
    return anchor;
  }
  const whereAt = (x: number, y: number): Where => ({ x, y, w: innerWidth, h: innerHeight, sx: Math.round(scrollX), sy: Math.round(scrollY), hash: location.hash });
  // What a spoken line belongs to: what's under the pointer, climbed to something named.
  function pointAt(x: number, y: number) {
    const hit = x < 0 ? null : document.elementFromPoint(x, y);
    const under = hit && !layer.contains(hit) ? hit : null;
    const node = under?.closest("[data-viz-id]") ?? under?.closest("section") ?? null;
    const where = whereAt(x, y);
    if (under && node !== under) where.exact = uniqueSelector(under); // the anchor climbed
    return { anchor: node ? captureAnchor(node) : null, where };
  }
  const safeQuery = (sel: string | null | undefined) => { try { return sel ? document.querySelector(sel) : null; } catch { return null; } };
  const nameOf = (a: Anchor | null | undefined) => (a ? a.label || (a.text ? `"${a.text.slice(0, 40)}"` : a.selector) : "page");

  // ---- Speech: mic → pause detection → Parakeet → a line ---------------------
  let worker: Worker | null = null, modelReady = false, loadPct: number | null = null, micErr = "", seq = 0;
  const waiting = new Map<number, (text: string) => void>(); // worker job id -> handler for its transcript
  const inflight = new Set<Promise<void>>(); // stretches not yet logged; Send waits on these
  function loadModel() {
    worker = new Worker("/_kit/parakeet-worker.js", { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ type: string; id: number; text: string; loaded: number; total: number; message: string }>) => {
      if (data.type === "progress" && data.total) loadPct = Math.round((100 * data.loaded) / data.total);
      if (data.type === "ready") (modelReady = true), (loadPct = null), sync();
      if (data.type === "error") micErr = "speech model failed: " + data.message;
      if (data.type === "text") waiting.get(data.id)?.(data.text), waiting.delete(data.id);
      renderPill();
    };
    navigator.storage?.persist?.(); // ask Chrome not to evict the cached model under disk pressure
    renderPill(); // show "loading" now, not on the worker's first message (a cached load sends no progress)
  }

  let ctx: AudioContext | undefined, started = false, paused = false, listening = false, keep = false;
  async function startMic() {
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
  function sync() {
    const was = listening;
    listening = started && !paused && modelReady && (document.hasFocus() || keep);
    if (listening) ctx?.resume();
    if (was && !listening && speaking) cut(); // leaving mid-sentence still keeps what you said
    renderPill();
  }

  let mx = -1, my = -1;
  addEventListener("pointermove", (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.left = mx + "px"; dot.style.top = my + "px";
  }, { passive: true });

  // Speech = a frame well above the learned noise floor; a stretch ends after PAUSE ms of
  // quiet. 300 ms before speech is kept so first words aren't clipped. (Tested by hand in
  // grill-me-viz: 300–1000 ms all felt fine.)
  const PAUSE = 700, RATE = 16000;
  let floor = 0.01, speaking = false, quietMs = 0, buf: Float32Array[] = [], pre: Float32Array[] = [];
  function frame(f: Float32Array) {
    let rms = 0;
    for (const v of f) rms += v * v;
    rms = Math.sqrt(rms / f.length);
    if (!speaking) floor = floor * 0.97 + rms * 0.03;
    const loud = rms > Math.max(0.012, floor * 3);
    if (loud) {
      if (!speaking) (speaking = true), (buf = [...pre]), dot.classList.add("on");
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
    const len = length(), frames = buf;
    speaking = false; buf = []; quietMs = 0;
    dot.classList.remove("on");
    if (len < RATE * 0.4) return Promise.resolve();
    const pcm = new Float32Array(len);
    let o = 0;
    for (const f of frames) pcm.set(f, o), (o += f.length);
    const { anchor, where } = pointAt(mx, my);
    const cap = caption(anchor, where, "…");
    const job = ++seq;
    const done = new Promise<void>((resolve) => {
      waiting.set(job, async (text: string) => {
        text = text.trim();
        if (!text) return cap.remove(), resolve(); // noise
        cap.set(text);
        await log({ type: "speech", id: newId(), text, anchor, where, secs: +(len / RATE).toFixed(1) });
        resolve();
      });
      worker!.postMessage({ id: job, pcm }, [pcm.buffer]); // cut() only runs once loadModel() has
    });
    inflight.add(done);
    done.then(() => inflight.delete(done));
    return done;
  }

  // A caption over the anchor (or the pointer, for the page): "…", then the text, then gone.
  function caption(anchor: Anchor | null, where: Where, text: string) {
    const c = el("div", { class: "vf-caption" }, text);
    const r = safeQuery(anchor?.selector)?.getBoundingClientRect();
    c.style.left = (r ? r.left + r.width / 2 : where.x) + "px";
    c.style.top = Math.max(40, r ? r.top : where.y) + "px";
    layer.appendChild(c);
    const remove = () => c.remove();
    return { remove, set: (t: string) => { c.textContent = t; setTimeout(() => (c.style.opacity = "0"), 2500); setTimeout(remove, 3000); } };
  }

  // ---- Send: cut what's being said now, and write `send` only after every line lands ----
  async function send(extra: { round?: number } = {}) {
    if (speaking) cut();
    if (started) (paused = true), sync(); // no listening while Claude works; Resume is manual
    await Promise.all([...inflight]);
    const entry: { type: "send"; round?: number } = { type: "send" };
    const round = extra.round ?? +([...document.querySelectorAll<HTMLElement>("[data-round]")].pop()?.dataset["round"] ?? 0);
    if (round) entry.round = round; // grill-me-viz waits on {"type":"send","round":N}
    await log(entry);
    dispatchEvent(new CustomEvent("viz-feedback:sent", { detail: { round } }));
  }

  // ---- Pins: one per anchored element, a stack when it holds several lines ----
  const pins = new Map<string, HTMLElement>(); // anchor selector -> pin element
  const groups = () => {
    const g = new Map<string, Line[]>();
    for (const l of lines.values()) {
      const k = l.anchor?.selector ?? "";
      const list = g.get(k) ?? [];
      list.push(l);
      g.set(k, list);
    }
    return g;
  };
  function renderPins(g: Map<string, Line[]>) {
    for (const [k, pin] of pins) if (!g.has(k)) pin.remove(), pins.delete(k);
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
      pin.textContent = done && done < ls.length ? `✓${done}/${ls.length}` : ls.length > 1 ? `×${ls.length}` : done ? "✓" : "";
      pin.title = ls.map((l) => l.text).join("\n");
    }
  }
  function tick() {
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

  // ---- A line: click its text to edit, 🗑 to delete, ✓ to clear once resolved ----
  function lineEl(l: Line) {
    const row = el("div", { class: "vf-line" + (l.done ? " done" : "") });
    const body = el("div", { style: "flex:1" });
    const t = el("span", { class: "t", contenteditable: "plaintext-only", spellcheck: "false", title: "Click to edit" }, l.text);
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) e.preventDefault(), t.blur();
      if (e.key === "Escape") (t.textContent = l.text), t.blur();
      e.stopPropagation(); // the viz's own shortcuts shouldn't fire while typing
    });
    t.addEventListener("blur", () => {
      const v = (t.textContent ?? "").trim();
      if (v && v !== l.text) log({ type: "edit", id: l.id, text: v });
      else t.textContent = l.text;
    });
    body.append(t);
    if (l.note) body.append(el("span", { class: "note" }, "✓ " + l.note));
    const del = el("button", { type: "button", title: l.done ? "Looks good: clear it" : "Delete this line" }, l.done ? "✓" : "🗑");
    del.addEventListener("click", () => log({ type: "retract", id: l.id }));
    row.append(body, del);
    return row;
  }

  // ---- The pin card and the full list ----------------------------------------
  let card: HTMLElement | null = null, cardKey: string | null = null, panel: HTMLElement | null = null;
  function closeCard() { card?.remove(); card = cardKey = null; }
  function openCard(k: string) {
    closeCard();
    const ls = groups().get(k);
    if (!ls) return;
    cardKey = k;
    card = el("div", { class: "vf-card" });
    card.append(el("div", { class: "vf-where" }, nameOf(ls[0]?.anchor)), ...ls.map(lineEl));
    layer.appendChild(card);
    const r = (pins.get(k) ?? pill).getBoundingClientRect();
    placeNear(card, r.left, r.bottom);
  }
  function setPanel(open: boolean) {
    panel?.remove();
    panel = null;
    if (!open) return;
    panel = el("div", { class: "vf-panel" });
    const g = groups();
    panel.append(el("h3", {}, `${lines.size} line${lines.size === 1 ? "" : "s"} of feedback`));
    if (!lines.size) panel.append(el("div", { class: "vf-empty" }, "Click 🎙 and talk while pointing, or Alt-click anything to type."));
    for (const [k, ls] of g) {
      const where = el("div", { class: "vf-where", title: "Show it" }, nameOf(ls[0]?.anchor));
      where.addEventListener("click", () => safeQuery(k)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      const grp = el("div", { class: "vf-group" });
      grp.append(where, ...ls.map(lineEl));
      panel.append(grp);
    }
    layer.appendChild(panel);
  }

  // ---- Alt/Option-click → "Provide feedback here" ----------------------------
  // Capture phase + stop/prevent so it beats the viz's own click handlers.
  let bubble: HTMLElement | null = null;
  function closeBubble() { bubble?.remove(); bubble = null; window.__vizResume?.(); }
  document.addEventListener("click", (e) => {
    if (!e.altKey) return;
    const node = e.target;
    if (!(node instanceof Element) || layer.contains(node)) return;
    e.preventDefault();
    e.stopPropagation();
    closeBubble();
    window.__vizPause?.(); // hold an animated target still while typing
    const anchor = captureAnchor(node), where = whereAt(e.clientX, e.clientY);
    bubble = el("div", { class: "vf-bubble" });
    const ta = el("textarea", { placeholder: "Provide feedback here" });
    const save = el("button", { class: "vf-btn primary", type: "button" }, "Save");
    const cancel = el("button", { class: "vf-btn", type: "button" }, "Cancel");
    const row = el("div", { class: "vf-row" });
    row.append(cancel, save);
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
    save.addEventListener("click", submit);
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") closeBubble();
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") submit();
    });
  }, true);

  // ---- Rendering ------------------------------------------------------------
  function renderPill() {
    const loading = !!worker && !modelReady && !micErr;
    micBtn.className = "mic" + (listening ? " on" : started && paused ? " paused" : "") + (loading ? " loading" : "");
    micBtn.innerHTML = "🎙";
    if (loading) micBtn.append(el("span", { class: "spin" }));
    if (loadPct != null) micBtn.append(el("span", { class: "pct" }, loadPct + "%"));
    micBtn.title = micErr || (loading ? "Loading the speech model…" : !started ? "Talk while pointing (speech stays in this browser)"
      : paused ? "Resume listening" : listening ? "Listening: click to pause" : "Paused: this tab isn't focused (📌 keeps it on)");
    keepBtn.setAttribute("aria-pressed", String(keep));
    const open = [...lines.values()].filter((l) => !l.done).length;
    countBtn.textContent = `💬 ${open}`;
    sendBtn.hidden = !dirty;
  }
  function render() {
    renderPins(groups());
    renderPill();
    // Rebuild what's open, unless the user is typing in it.
    if (panel && !panel.contains(document.activeElement)) setPanel(true);
    if (card && !card.contains(document.activeElement)) cardKey && groups().has(cardKey) ? openCard(cardKey) : closeCard();
  }

  micBtn.addEventListener("click", () => {
    if (!worker) loadModel();
    if (!started) return void startMic().catch((e: unknown) => ((micErr = "mic unavailable: " + (e as Error).message), renderPill()));
    paused = !paused;
    sync();
  });
  keepBtn.addEventListener("click", () => ((keep = !keep), sync()));
  countBtn.addEventListener("click", () => setPanel(!panel));
  sendBtn.addEventListener("click", () => send());
  addEventListener("focus", sync);
  addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
  setInterval(sync, 1000); // focus events miss some app switches; a cheap re-check covers them

  // Close popovers on an outside click or Escape (but not while Alt-clicking to add).
  document.addEventListener("click", (e) => {
    if (e.altKey || layer.contains(e.target as Node | null)) return;
    closeCard();
    setPanel(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeCard();
    setPanel(false);
  });

  // ---- Helpers ----------------------------------------------------------------
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string | null): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  }
  function placeNear(node: HTMLElement, x: number, y: number) {
    const w = node.offsetWidth || 300, h = node.offsetHeight || 140;
    node.style.left = Math.max(8, Math.min(x + 12, innerWidth - w - 8)) + "px";
    node.style.top = Math.max(8, Math.min(y + 12, innerHeight - h - 8)) + "px";
  }

  // ---- Go ------------------------------------------------------------------
  // `log` for pages that add their own lines (grill-me-viz picks); `say` is a test hook that
  // transcribes a 16 kHz clip as if it had just been spoken with the pointer at (x, y).
  window.vizFeedback = {
    log, send,
    say: (pcm: Float32Array, x = mx, y = my) => { if (!worker) loadModel(); (mx = x), (my = y), (buf = [pcm]); return cut(); },
  };
  fetch(LOG).then((r) => (r.ok ? (r.json() as Promise<Entry[]>) : [])).catch((): Entry[] => []).then((all) => {
    all.forEach(apply);
    render();
  });
  requestAnimationFrame(tick);
})();
