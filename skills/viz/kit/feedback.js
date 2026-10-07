// GENERATED from kit/src/feedback.ts by `bun run sync:kit` — edit that file, not this one.
// feedback.js — the /viz feedback widget (client overlay).
//
// Injected LIVE-ONLY by the viz server next to the hot-reload script. A page can also load it
// itself and set window.vizFeedbackHost first (see FeedbackHost): then it runs with no server,
// in published builds too, scoped to one element, writing to the page instead of the log.
// One pill collects feedback two ways:
//   speak : 🎙 → each stretch of speech is transcribed on this device and anchored to what the
//           mouse is over when the stretch ENDS — so you can talk, then aim. The engine, first
//           that works: Parakeet if this browser already downloaded it (parakeet-worker.js,
//           WebGPU, 2.4 GB, cached); the browser's own on-device speech, with ⬆ offering the
//           Parakeet download; offering that download outright; else typing only.
//   type  : Alt/Option-click any element → "Provide feedback here".
// Audio never leaves the device and is never saved.
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
// Start once every deferred script has run, so a page module that sets vizFeedbackHost is in
// place whichever of the two scripts comes first.
if (document.readyState === "complete")
    start();
else
    document.addEventListener("DOMContentLoaded", start, { once: true });
function start() {
    const host = window.vizFeedbackHost;
    const root = host?.root;
    const vizId = document.querySelector("script[data-viz-feedback]")?.dataset["vizFeedback"];
    if (!host && !vizId)
        return; // neither injected by the viz server nor hosted by the page
    if (document.getElementById("viz-feedback"))
        return; // already running
    const LOG = `/${vizId}/_log/feedback`, FILES = `/${vizId}/_files/`;
    // ---- The log, folded into lines ------------------------------------------
    const lines = new Map();
    let dirty = false; // something changed since the last send
    function apply(e) {
        const l = "id" in e && e.id ? lines.get(e.id) : undefined;
        const x = e;
        if (x.type === "speech" || x.type === "comment")
            lines.set(x.id, { ...x, done: false });
        else if (x.type === "edit" && l)
            l.text = x.text;
        else if (x.type === "retract")
            lines.delete(x.id);
        else if (x.type === "resolve" && l)
            ((l.done = true), (l.note = x.note));
        else if (e.type === "clear")
            lines.clear();
        if (e.type === "send")
            dirty = false;
        else if (e.type !== "resolve" && e.type !== "clear")
            dirty = true;
    }
    async function log(e) {
        apply(e);
        render();
        if (host)
            return host.log(e);
        await fetch(LOG, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(e),
        }).catch(() => { });
    }
    const newId = () => Math.random().toString(36).slice(2, 10);
    // ---- DOM scaffolding -------------------------------------------------------
    const layer = el("div", { id: "viz-feedback" });
    const pill = el("div", { class: "vf-pill" });
    const micBtn = el("button", { class: "mic", type: "button" });
    const keepBtn = el("button", {
        class: "keep",
        type: "button",
        title: "Keep listening when you leave the tab",
        "aria-pressed": "false",
    }, "📌");
    const countBtn = el("button", {
        class: "count",
        type: "button",
        title: "All feedback on this page",
    });
    const sendBtn = el("button", { class: "send", type: "button", title: "Tell Claude you're done" }, "Send");
    const upBtn = el("button", { class: "up", type: "button", title: "Switch to Parakeet, the model the skill uses" }, "⬆");
    pill.append(micBtn, upBtn, keepBtn, countBtn, sendBtn);
    const dot = el("div", { class: "vf-dot" });
    layer.append(pill, dot);
    document.documentElement.appendChild(layer);
    // ---- Selectors and anchors -------------------------------------------------
    // Prefer a stable identity (id → data-viz-id → other data-*/aria-label/name), falling
    // back to a structural :nth-of-type path. Works on SVG nodes too.
    const isUnique = (sel) => {
        try {
            return document.querySelectorAll(sel).length === 1;
        }
        catch {
            return false;
        }
    };
    const escAttr = (s) => String(s).replace(/(["\\])/g, "\\$1");
    function uniqueSelector(node) {
        if (node.id && isUnique(`#${CSS.escape(node.id)}`))
            return `#${CSS.escape(node.id)}`;
        const tag = node.tagName.toLowerCase();
        for (const a of ["data-viz-id", "data-label", "aria-label", "name", "data-id"]) {
            const v = node.getAttribute(a);
            if (v && isUnique(`${tag}[${a}="${escAttr(v)}"]`))
                return `${tag}[${a}="${escAttr(v)}"]`;
        }
        const parts = [];
        for (let cur = node; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
            let part = cur.tagName.toLowerCase();
            const v = cur.getAttribute("data-viz-id");
            if (v)
                part += `[data-viz-id="${escAttr(v)}"]`;
            else {
                const tagName = cur.tagName;
                const sames = [...(cur.parentNode?.children ?? [])].filter((c) => c.tagName === tagName);
                if (sames.length > 1)
                    part += `:nth-of-type(${sames.indexOf(cur) + 1})`;
            }
            parts.unshift(part);
            if (isUnique(parts.join(" > ")))
                break;
        }
        return parts.join(" > ");
    }
    function captureAnchor(node) {
        const anchor = { selector: uniqueSelector(node) };
        const label = node.getAttribute("data-label") ||
            node.getAttribute("data-viz-id") ||
            node.getAttribute("aria-label");
        if (label)
            anchor.label = label;
        const text = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
        if (text)
            anchor.text = text;
        return anchor;
    }
    const whereAt = (x, y) => ({
        x,
        y,
        w: innerWidth,
        h: innerHeight,
        sx: Math.round(scrollX),
        sy: Math.round(scrollY),
        hash: location.hash,
    });
    // What a spoken line belongs to: what's under the pointer, climbed to something named.
    function pointAt(x, y) {
        const hit = x < 0 ? null : document.elementFromPoint(x, y);
        const under = hit && !layer.contains(hit) && (!root || root.contains(hit)) ? hit : null;
        const node = under?.closest("[data-viz-id]") ?? under?.closest("section") ?? root ?? null;
        const where = whereAt(x, y);
        if (under && node !== under)
            where.exact = uniqueSelector(under); // the anchor climbed
        return { anchor: node ? captureAnchor(node) : null, where };
    }
    const safeQuery = (sel) => {
        try {
            return sel ? document.querySelector(sel) : null;
        }
        catch {
            return null;
        }
    };
    const nameOf = (a) => a ? a.label || (a.text ? `"${a.text.slice(0, 40)}"` : a.selector) : "page";
    const LANG = navigator.language || "en-US";
    const Rec = window.SpeechRecognition;
    let engine = null;
    /** Whether parakeet.js already holds the model in this origin's IndexedDB. Never opens a
     *  database that isn't there: an empty one would skip parakeet.js's own store setup. */
    async function parakeetCached() {
        const NAME = "parakeet-cache-db";
        if (!(await indexedDB.databases?.())?.some((d) => d.name === NAME))
            return false;
        return new Promise((done) => {
            const req = indexedDB.open(NAME);
            req.onerror = () => done(false);
            req.onsuccess = () => {
                const db = req.result;
                try {
                    const keys = db.transaction("file-store").objectStore("file-store").getAllKeys();
                    keys.onsuccess = () => (done(keys.result.some((k) => String(k).endsWith("encoder-model.onnx.data"))),
                        db.close());
                    keys.onerror = () => (done(false), db.close());
                }
                catch {
                    (done(false), db.close());
                }
            };
        });
    }
    async function pickEngine() {
        if (await parakeetCached())
            return "parakeet";
        const want = { langs: [LANG], processLocally: true };
        const state = (await Rec?.available?.(want).catch(() => "")) ?? "";
        if (state === "available")
            return "browser";
        if ((state === "downloadable" || state === "downloading") && (await Rec?.install?.(want)))
            return "browser";
        return "gpu" in navigator ? "offer" : "none";
    }
    let worker = null, modelReady = false, loadPct = null, micErr = "", seq = 0;
    const waiting = new Map(); // worker job id -> handler for its transcript
    const inflight = new Set(); // stretches not yet logged; Send waits on these
    function loadModel() {
        // Published builds inline this path as a data: URL (inline.ts); a worker from one has an
        // opaque origin and no model cache, so it runs from a same-origin blob instead.
        const src = "/_kit/parakeet-worker.js";
        const url = src.startsWith("data:")
            ? URL.createObjectURL(new Blob([atob(src.slice(src.indexOf(",") + 1))], { type: "text/javascript" }))
            : src;
        worker = new Worker(url, { type: "module" });
        worker.onmessage = ({ data, }) => {
            if (data.type === "progress" && data.total)
                loadPct = Math.round((100 * data.loaded) / data.total);
            if (data.type === "ready")
                ((modelReady = true), (loadPct = null), sync());
            if (data.type === "error")
                micErr = "speech model failed: " + data.message;
            if (data.type === "text")
                (waiting.get(data.id)?.(data.text), waiting.delete(data.id));
            renderPill();
        };
        navigator.storage?.persist?.(); // ask Chrome not to evict the cached model under disk pressure
        renderPill(); // show "loading" now, not on the worker's first message (a cached load sends no progress)
    }
    let ctx, rec = null, onEnd = null, started = false, paused = false, listening = false, keep = false;
    async function startEngine(e) {
        engine = e;
        if (!host?.shoot)
            startShots().catch(() => { }); // pictures are a bonus: a refused prompt just means none
        if (e === "browser")
            startBrowser();
        else {
            if (!worker)
                loadModel();
            if (!ctx)
                await startMic();
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
        proc.onaudioprocess = (ev) => listening &&
            engine === "parakeet" &&
            frame(new Float32Array(ev.inputBuffer.getChannelData(0)));
    }
    function startBrowser() {
        if (!Rec)
            return;
        rec = new Rec();
        rec.lang = LANG;
        rec.continuous = true;
        rec.interimResults = true;
        rec.processLocally = true;
        let began = new Map();
        rec.onstart = () => (began = new Map()); // result indexes restart with each session
        rec.onresult = (e) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i], text = r[0].transcript.trim();
                let b = began.get(i);
                if (!b && text) {
                    const start = begin(mx, my);
                    b = { ...start, cap: caption(start.anchor, start.where, "…") };
                    began.set(i, b);
                    dot.classList.add("on");
                }
                if (!b)
                    continue;
                if (!r.isFinal) {
                    b.cap.live(text);
                    continue;
                }
                began.delete(i);
                if (!began.size)
                    dot.classList.remove("on");
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
            if (listening)
                rec?.start(); // the browser ends sessions on its own; keep going
        };
    }
    function sync() {
        const was = listening;
        const ready = engine === "browser" || modelReady;
        listening = started && !paused && ready && (document.hasFocus() || keep);
        if (listening && !was)
            engine === "browser" ? rec?.start() : ctx?.resume();
        if (was && !listening) {
            if (engine === "browser")
                rec?.stop(); // stop, not abort: what was said still lands
            else if (speaking)
                cut(); // leaving mid-sentence still keeps what you said
        }
        renderPill();
    }
    // A note by the pill: what the mic can't do here, or the Parakeet offer (with a Download button).
    function notice(text, hint, go) {
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
        notice(engine === "browser"
            ? "Switch to Parakeet, the speech model the skill itself uses?"
            : "This browser has no on-device speech recognition. Download Parakeet, the speech model the skill uses?", "2.4 GB, once: about 1–7 minutes on a 50–300 Mbps line, then cached in this browser. Needs WebGPU. Your audio still never leaves this device.", () => {
            rec?.abort();
            rec = null;
            if (engine === "browser")
                ((started = false), (listening = false));
            startEngine("parakeet").catch((err) => ((micErr = "mic unavailable: " + err.message), renderPill()));
        });
    }
    // ---- Screenshots: a crop around the pointer as speech starts and as it ends ----
    // Needs the one-time "share this tab" prompt (getDisplayMedia, asked on the first mic click);
    // without it lines simply have no pictures. A host with `shoot` draws its own instead, no prompt.
    // The crop is the anchored element plus 24 px, or 400x300 around the pointer when there is none
    // or it is bigger than 600x400, so the pointer is always inside.
    let video;
    async function startShots() {
        const opts = { video: true, preferCurrentTab: true };
        video = el("video");
        video.muted = true;
        video.srcObject = await navigator.mediaDevices.getDisplayMedia(opts);
        await video.play();
    }
    function shoot(anchor, x, y) {
        if (!host?.shoot && !video?.videoWidth)
            return Promise.resolve(null);
        const r = safeQuery(anchor?.selector)?.getBoundingClientRect();
        const fit = !!r && r.width + 48 <= 600 && r.height + 48 <= 400;
        const w = Math.min(fit ? r.width + 48 : r ? 600 : 400, innerWidth);
        const h = Math.min(fit ? r.height + 48 : r ? 400 : 300, innerHeight);
        const left = Math.max(0, Math.min(fit ? r.left - 24 : x - w / 2, innerWidth - w));
        const top = Math.max(0, Math.min(fit ? r.top - 24 : y - h / 2, innerHeight - h));
        if (host?.shoot)
            return Promise.resolve(host.shoot({ left, top, width: w, height: h }, x, y));
        const k = video.videoWidth / innerWidth; // video pixels per CSS pixel
        const c = el("canvas");
        c.width = w * k;
        c.height = h * k;
        c.getContext("2d")?.drawImage(video, left * k, top * k, w * k, h * k, 0, 0, c.width, c.height);
        return new Promise((done) => c.toBlob(done, "image/png"));
    }
    const begin = (x, y) => {
        const at = pointAt(x, y);
        return { ...at, shot: shoot(at.anchor, x, y) };
    };
    /** Save one crop as _files/fb-<line>-<start|end>.png (a host's crop is already a URL); resolves to its [key, name] or null. */
    async function upload(id, key, shot) {
        const body = await shot, name = `fb-${id}-${key}.png`;
        if (typeof body === "string")
            return [key, body];
        const ok = body &&
            (await fetch(FILES + name, { method: "PUT", body }).then((r) => r.ok, () => false));
        return ok ? [key, name] : null;
    }
    let mx = -1, my = -1;
    addEventListener("pointermove", (e) => {
        mx = e.clientX;
        my = e.clientY;
        dot.style.left = mx + "px";
        dot.style.top = my + "px";
    }, { passive: true });
    // Speech = a frame well above the learned noise floor; a stretch ends after PAUSE ms of
    // quiet. 300 ms before speech is kept so first words aren't clipped. (Tested by hand in
    // grill-me-viz: 300–1000 ms all felt fine.)
    const PAUSE = 700, RATE = 16000;
    let floor = 0.01, speaking = false, quietMs = 0, began, // the pointer as this stretch began
    buf = [], pre = [];
    function frame(f) {
        let rms = 0;
        for (const v of f)
            rms += v * v;
        rms = Math.sqrt(rms / f.length);
        if (!speaking)
            floor = floor * 0.97 + rms * 0.03;
        const loud = rms > Math.max(0.012, floor * 3);
        if (loud) {
            if (!speaking)
                ((speaking = true), (began = begin(mx, my)), (buf = [...pre]), dot.classList.add("on"));
            quietMs = 0;
        }
        if (speaking) {
            buf.push(f);
            if (!loud)
                quietMs += (f.length / RATE) * 1000;
            if (quietMs >= PAUSE || length() > RATE * 25)
                cut();
        }
        else {
            pre.push(f);
            if (pre.length > 5)
                pre.shift();
        }
    }
    const length = () => buf.reduce((a, b) => a + b.length, 0);
    // End the current stretch: anchor it NOW (where the mouse is as you stop), show "…" there,
    // and transcribe. Resolves once its line is logged (or dropped as noise).
    function cut() {
        const len = length(), frames = buf;
        speaking = false;
        buf = [];
        quietMs = 0;
        dot.classList.remove("on");
        if (len < RATE * 0.4)
            return Promise.resolve();
        const pcm = new Float32Array(len);
        let o = 0;
        for (const f of frames)
            (pcm.set(f, o), (o += f.length));
        const { anchor, where } = pointAt(mx, my);
        const start = began ?? { anchor, where, shot: Promise.resolve(null) };
        began = undefined;
        const endShot = shoot(anchor, mx, my);
        const cap = caption(anchor, where, "…");
        const job = ++seq;
        const done = new Promise((resolve) => {
            waiting.set(job, (text) => land(text, start, anchor, where, endShot, cap, +(len / RATE).toFixed(1)).then(resolve));
            worker.postMessage({ id: job, pcm }, [pcm.buffer]); // cut() only runs once loadModel() has
        });
        inflight.add(done);
        done.then(() => inflight.delete(done));
        return done;
    }
    /** One transcribed stretch → its pictures and its log line (empty text is noise: dropped). */
    async function land(text, start, anchor, where, endShot, cap, secs) {
        text = text.trim();
        if (!text)
            return cap.remove();
        cap.set(text);
        const id = newId();
        const { shot: startShot, ...from } = start;
        const got = await Promise.all([upload(id, "start", startShot), upload(id, "end", endShot)]);
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
    }
    // A caption over the anchor (or the pointer, for the page): "…", then the text, then gone.
    function caption(anchor, where, text) {
        const c = el("div", { class: "vf-caption" }, text);
        const r = safeQuery(anchor?.selector)?.getBoundingClientRect();
        c.style.left = (r ? r.left + r.width / 2 : where.x) + "px";
        c.style.top = Math.max(40, r ? r.top : where.y) + "px";
        layer.appendChild(c);
        const remove = () => c.remove();
        return {
            remove,
            live: (t) => (c.textContent = t), // the browser engine's words as they come
            set: (t) => {
                c.textContent = t;
                setTimeout(() => (c.style.opacity = "0"), 2500);
                setTimeout(remove, 3000);
            },
        };
    }
    // ---- Send: cut what's being said now, and write `send` only after every line lands ----
    async function send(extra = {}) {
        if (speaking)
            cut();
        // The browser engine hands over its last words only as it stops: wait for that (or 2 s).
        const ended = engine === "browser" && listening
            ? new Promise((r) => ((onEnd = r), setTimeout(r, 2000)))
            : null;
        if (started)
            ((paused = true), sync()); // no listening while Claude works; Resume is manual
        await ended;
        await Promise.all([...inflight]);
        const entry = { type: "send" };
        const round = extra.round ??
            +([...document.querySelectorAll("[data-round]")].pop()?.dataset["round"] ?? 0);
        if (round)
            entry.round = round; // grill-me-viz waits on {"type":"send","round":N}
        await log(entry);
        dispatchEvent(new CustomEvent("viz-feedback:sent", { detail: { round } }));
    }
    // ---- Pins: one per anchored element, a stack when it holds several lines ----
    const pins = new Map(); // anchor selector -> pin element
    const groups = () => {
        const g = new Map();
        for (const l of lines.values()) {
            const k = l.anchor?.selector ?? "";
            const list = g.get(k) ?? [];
            list.push(l);
            g.set(k, list);
        }
        return g;
    };
    function renderPins(g) {
        for (const [k, pin] of pins)
            if (!g.has(k))
                (pin.remove(), pins.delete(k));
        for (const [k, ls] of g) {
            if (!k)
                continue; // page-level lines live only in the list
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
            pin.title = ls.map((l) => l.text).join("\n");
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
    // ---- A line: click its text to edit, 🗑 to delete, ✓ to clear once resolved ----
    function lineEl(l) {
        const row = el("div", { class: "vf-line" + (l.done ? " done" : "") });
        const body = el("div", { style: "flex:1" });
        const t = el("span", {
            class: "t",
            contenteditable: "plaintext-only",
            spellcheck: "false",
            title: "Click to edit",
        }, l.text);
        t.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey)
                (e.preventDefault(), t.blur());
            if (e.key === "Escape")
                ((t.textContent = l.text), t.blur());
            e.stopPropagation(); // the viz's own shortcuts shouldn't fire while typing
        });
        t.addEventListener("blur", () => {
            const v = (t.textContent ?? "").trim();
            if (v && v !== l.text)
                log({ type: "edit", id: l.id, text: v });
            else
                t.textContent = l.text;
        });
        body.append(t);
        if (l.note)
            body.append(el("span", { class: "note" }, "✓ " + l.note));
        const del = el("button", { type: "button", title: l.done ? "Looks good: clear it" : "Delete this line" }, l.done ? "✓" : "🗑");
        del.addEventListener("click", () => log({ type: "retract", id: l.id }));
        row.append(body, del);
        return row;
    }
    // ---- The pin card and the full list ----------------------------------------
    let card = null, cardKey = null, panel = null;
    function closeCard() {
        card?.remove();
        card = cardKey = null;
    }
    function openCard(k) {
        closeCard();
        const ls = groups().get(k);
        if (!ls)
            return;
        cardKey = k;
        card = el("div", { class: "vf-card" });
        card.append(el("div", { class: "vf-where" }, nameOf(ls[0]?.anchor)), ...ls.map(lineEl));
        layer.appendChild(card);
        const r = (pins.get(k) ?? pill).getBoundingClientRect();
        placeNear(card, r.left, r.bottom);
    }
    function setPanel(open) {
        panel?.remove();
        panel = null;
        if (!open)
            return;
        panel = el("div", { class: "vf-panel" });
        const g = groups();
        panel.append(el("h3", {}, `${lines.size} line${lines.size === 1 ? "" : "s"} of feedback`));
        if (!lines.size)
            panel.append(el("div", { class: "vf-empty" }, "Click 🎙 and talk while pointing, or Alt-click anything to type."));
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
    let bubble = null;
    function closeBubble() {
        bubble?.remove();
        bubble = null;
        window.__vizResume?.();
    }
    document.addEventListener("click", (e) => {
        if (!e.altKey)
            return;
        const node = e.target;
        if (!(node instanceof Element) || layer.contains(node))
            return;
        if (root && !root.contains(node))
            return;
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
            if (!text)
                return ta.focus();
            log({ type: "comment", id: newId(), text, anchor, where });
            closeBubble();
        };
        cancel.addEventListener("click", closeBubble);
        save.addEventListener("click", submit);
        ta.addEventListener("keydown", (ev) => {
            ev.stopPropagation();
            if (ev.key === "Escape")
                closeBubble();
            if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter")
                submit();
        });
    }, true);
    // ---- Rendering ------------------------------------------------------------
    function renderPill() {
        const loading = engine === "parakeet" && !!worker && !modelReady && !micErr;
        micBtn.className =
            "mic" +
                (listening ? " on" : started && paused ? " paused" : "") +
                (engine === "none" ? " off" : "") +
                (loading ? " loading" : "");
        micBtn.innerHTML = "🎙";
        if (loading)
            micBtn.append(el("span", { class: "spin" }));
        if (loadPct != null)
            micBtn.append(el("span", { class: "pct" }, loadPct + "%"));
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
                                    : "Paused: this tab isn't focused (📌 keeps it on)");
        upBtn.hidden = !(engine === "browser" && "gpu" in navigator);
        keepBtn.setAttribute("aria-pressed", String(keep));
        const open = [...lines.values()].filter((l) => !l.done).length;
        countBtn.textContent = `💬 ${open}`;
        sendBtn.hidden = !dirty;
    }
    function render() {
        renderPins(groups());
        renderPill();
        // Rebuild what's open, unless the user is typing in it.
        if (panel && !panel.contains(document.activeElement))
            setPanel(true);
        if (card && !card.contains(document.activeElement))
            cardKey && groups().has(cardKey) ? openCard(cardKey) : closeCard();
    }
    micBtn.addEventListener("click", async () => {
        if (started)
            return ((paused = !paused), sync());
        engine ??= await pickEngine();
        if (engine === "offer")
            return offerParakeet();
        if (engine === "none")
            return notice("This browser can't turn speech into text on this device.", "Alt/Option-click anything to type instead. (Chrome on a desktop can do both.)");
        startEngine(engine).catch((e) => ((micErr = "mic unavailable: " + e.message), renderPill()));
    });
    upBtn.addEventListener("click", offerParakeet);
    keepBtn.addEventListener("click", () => ((keep = !keep), sync()));
    countBtn.addEventListener("click", () => setPanel(!panel));
    sendBtn.addEventListener("click", () => send());
    addEventListener("focus", sync);
    addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    setInterval(sync, 1000); // focus events miss some app switches; a cheap re-check covers them
    // Close popovers on an outside click or Escape (but not while Alt-clicking to add).
    document.addEventListener("click", (e) => {
        if (e.altKey || layer.contains(e.target))
            return;
        closeCard();
        setPanel(false);
    }, true);
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape")
            return;
        closeCard();
        setPanel(false);
    });
    // ---- Helpers ----------------------------------------------------------------
    function el(tag, attrs = {}, text) {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs))
            n.setAttribute(k, v);
        if (text != null)
            n.textContent = text;
        return n;
    }
    function placeNear(node, x, y) {
        const w = node.offsetWidth || 300, h = node.offsetHeight || 140;
        node.style.left = Math.max(8, Math.min(x + 12, innerWidth - w - 8)) + "px";
        node.style.top = Math.max(8, Math.min(y + 12, innerHeight - h - 8)) + "px";
    }
    // ---- Go ------------------------------------------------------------------
    // `log` for pages that add their own lines (grill-me-viz picks); `say` is a test hook that
    // transcribes a 16 kHz clip as if it had just been spoken with the pointer at (x, y).
    window.vizFeedback = {
        log,
        send,
        say: (pcm, x = mx, y = my, from) => {
            if (!worker)
                loadModel();
            if (from)
                began = begin(...from);
            ((mx = x), (my = y), (buf = [pcm]));
            return cut();
        },
    };
    if (!host)
        fetch(LOG)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])
            .then((all) => {
            all.forEach(apply);
            render();
        });
    render();
    requestAnimationFrame(tick);
}
export {};
