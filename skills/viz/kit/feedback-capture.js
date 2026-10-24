// GENERATED from kit/src/feedback-capture.ts by `bun run sync:kit` — edit that file, not this one.
// feedback-capture.js — turning what a person says into lines. What a line is about (the element
// under the pointer, where the pointer was, the caption shown there); a stretch of speech found in the
// mic's frames and cut when it ends; and the step that turns a transcribed stretch into a log line.
// Speech = a frame well above the learned noise floor; a stretch ends after PAUSE ms of
// quiet. 300 ms before speech is kept so first words aren't clipped. (Tested by hand in
// grill-me-viz: 300–1000 ms all felt fine.)
import { uniqueSelector } from "@viz/kit/anchor.js";
import { detach, el, newId, safeQuery } from "@viz/kit/feedback-dom.js";
export function captureAnchor(node) {
    const anchor = { selector: uniqueSelector(node) };
    const label = ["data-label", "data-viz-id", "aria-label"]
        .map((a) => node.getAttribute(a))
        .find(Boolean);
    if (label)
        anchor.label = label;
    const text = (node.textContent ?? "").trim().replaceAll(/\s+/gu, " ").slice(0, 80);
    if (text)
        anchor.text = text;
    return anchor;
}
export const whereAt = (x, y) => ({
    x,
    y,
    w: innerWidth,
    h: innerHeight,
    sx: Math.round(scrollX),
    sy: Math.round(scrollY),
    hash: location.hash,
});
// What a spoken line belongs to: what's under the pointer, climbed to something named.
export function pointAt(w, x, y) {
    const hit = x < 0 ? null : document.elementFromPoint(x, y);
    const under = hit && !w.layer.contains(hit) && (!w.root || w.root.contains(hit)) ? hit : null;
    const node = under?.closest("[data-viz-id]") ?? under?.closest("section") ?? w.root ?? null;
    const where = whereAt(x, y);
    if (under && node !== under)
        where.exact = uniqueSelector(under); // the anchor climbed
    return { anchor: node ? captureAnchor(node) : null, where };
}
export const begin = (w, x, y) => {
    const at = pointAt(w, x, y);
    return { ...at, shot: w.act.shoot(at.anchor, x, y) };
};
/** Save one crop as fb-<line>-<start|end>.png (a host's crop is already a URL); resolves to its [key, name] or null. */
async function save(w, id, key, shot) {
    const body = await shot;
    if (typeof body === "string")
        return [key, body];
    const name = body && (await w.store.put(`fb-${id}-${key}.png`, body).catch(() => null));
    return name ? [key, name] : null;
}
/** One transcribed stretch → its pictures and its log line (empty text is noise: dropped). */
export const landFor = (w) => async (said, start, anchor, where, endShot, cap, secs) => {
    const text = said.trim();
    if (!text)
        return cap.remove();
    cap.set(text);
    const id = newId();
    const { shot: startShot, ...from } = start;
    const got = await Promise.all([save(w, id, "start", startShot), save(w, id, "end", endShot)]);
    const shots = Object.fromEntries(got.filter((g) => g !== null));
    await w.act.log({
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
};
// A caption over the anchor (or the pointer, for the page): "…", then the text, then gone.
export function caption(w, anchor, where, text) {
    const c = el("div", { class: "vf-caption" }, text);
    const r = safeQuery(anchor?.selector)?.getBoundingClientRect();
    c.style.left = (r ? r.left + r.width / 2 : where.x) + "px";
    c.style.top = Math.max(40, r ? r.top : where.y) + "px";
    w.layer.append(c);
    const remove = () => c.remove();
    return {
        remove,
        live: (t) => {
            c.textContent = t; // the browser engine's words as they come
        },
        set: (t) => {
            c.textContent = t;
            setTimeout(() => {
                c.style.opacity = "0";
            }, 2500);
            setTimeout(remove, 3000);
        },
    };
}
const PAUSE = 700, RATE = 16000;
const length = (w) => w.buf.reduce((a, b) => a + b.length, 0);
/** One 64 ms mic frame: start a stretch when it turns loud, end it after a pause. */
export function frame(w, f) {
    let rms = 0;
    for (const v of f)
        rms += v * v;
    rms = Math.sqrt(rms / f.length);
    if (!w.speaking)
        w.floor = w.floor * 0.97 + rms * 0.03;
    const loud = rms > Math.max(0.012, w.floor * 3);
    if (loud) {
        if (!w.speaking) {
            w.speaking = true;
            w.began = w.act.begin(w.mx, w.my);
            w.buf = [...w.pre];
            w.dot.classList.add("on");
        }
        w.quietMs = 0;
    }
    if (w.speaking) {
        w.buf.push(f);
        if (!loud)
            w.quietMs += (f.length / RATE) * 1000;
        if (w.quietMs >= PAUSE || length(w) > RATE * 25)
            detach(w.act.cut());
    }
    else {
        w.pre.push(f);
        if (w.pre.length > 5)
            w.pre.shift();
    }
}
// End the current stretch: anchor it NOW (where the mouse is as you stop), show "…" there,
// and transcribe. Resolves once its line is logged (or dropped as noise).
// oxlint-disable-next-line typescript/promise-function-async -- hands back the one promise it registered in `inflight`, which Send and Copy wait on
export function cut(w) {
    const len = length(w), frames = w.buf;
    w.speaking = false;
    w.buf = [];
    w.quietMs = 0;
    w.dot.classList.remove("on");
    if (len < RATE * 0.4)
        return Promise.resolve();
    const pcm = new Float32Array(len);
    let o = 0;
    for (const f of frames) {
        pcm.set(f, o);
        o += f.length;
    }
    const { anchor, where } = w.act.pointAt(w.mx, w.my);
    const start = w.began ?? { anchor, where, shot: Promise.resolve(null) };
    w.began = undefined;
    const endShot = w.act.shoot(anchor, w.mx, w.my);
    const cap = w.act.caption(anchor, where, "…");
    const job = ++w.seq;
    const done = new Promise((resolve) => {
        w.waiting.set(job, (text) => {
            detach(w.act
                .land(text, start, anchor, where, endShot, cap, +(len / RATE).toFixed(1))
                .then(resolve));
        });
        w.worker.postMessage({ id: job, pcm }, [pcm.buffer]); // cut() only runs once loadModel() has
    });
    w.inflight.add(done);
    detach(done.then(() => {
        w.inflight.delete(done);
    }));
    return done;
}
