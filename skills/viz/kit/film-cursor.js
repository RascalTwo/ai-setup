// GENERATED from kit/src/film-cursor.ts by `bun run sync:kit` — edit that file, not this one.
// film-cursor.ts — the film's cursor: ui-narration's arrow, so a film points the way a recording
// does. Hidden until a page gives it keyframes (setCursor).
import { ease, must } from "@viz/kit/film-shared.js";
import { $ } from "@viz/kit";
const GLIDE = 0.95; // ui-narration's glide (950ms): slower drags, faster loses the eye
export function createCursor(root) {
    root.insertAdjacentHTML("beforeend", `<div id="film-cursor" style="opacity:0"><svg width="30" height="30" viewBox="0 0 26 26"><path d="M3 2 L3 20 L8 15 L11 22 L14.5 20.5 L11.5 14 L18 14 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`);
    const cursor = must($("#film-cursor", root), "#film-cursor");
    let cursorFrames = []; // in stage px, sorted by t
    const place = (x, y) => (cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`); // the tip sits at (3,2) in the svg
    function draw(time) {
        const i = cursorFrames.findLastIndex((f) => f.t <= time);
        const f = cursorFrames[i];
        if (!f || time > f.until) {
            cursor.style.opacity = f ? Math.max(0, 1 - (time - f.until) / 0.3).toFixed(2) : "0";
            if (f)
                place(f.x, f.y);
            return;
        }
        const prev = cursorFrames[i - 1];
        // Glide from the previous point when it was still showing; otherwise fade in at this one.
        const from = prev && prev.until >= f.t - 0.5 ? prev : null;
        const k = from ? ease((time - f.t) / GLIDE) : 1;
        place(from ? from.x + (f.x - from.x) * k : f.x, from ? from.y + (f.y - from.y) * k : f.y);
        cursor.style.opacity = from ? "1" : Math.min(1, (time - f.t) / 0.25).toFixed(2);
    }
    return {
        draw,
        set: (frames) => {
            cursorFrames = frames.toSorted((a, b) => a.t - b.t);
        },
    };
}
