// GENERATED from kit/src/feedback-crop.ts by `bun run sync:kit` — edit that file, not this one.
// feedback-crop.js — crops of the page, drawn as speech starts and as it ends.
// The crop is the anchored element plus 24 px, or 400x300 around the pointer when there is none
// or it is bigger than 600x400, so the pointer is always inside. A host with `shoot` draws its own.
import { dataUrl, el, safeQuery } from "@viz/kit/feedback-dom.js";
/** A crop of the page around `anchor` (or the pointer at (x, y)): a PNG, a host's image URL, or null. */
// oxlint-disable-next-line typescript/promise-function-async -- every path hands back a promise it already holds; none awaits
export function shoot(w, anchor, x, y) {
    const r = safeQuery(anchor?.selector)?.getBoundingClientRect();
    const fit = !!r && r.width + 48 <= 600 && r.height + 48 <= 400;
    const bw = Math.min(fit ? r.width + 48 : r ? 600 : 400, innerWidth);
    const bh = Math.min(fit ? r.height + 48 : r ? 400 : 300, innerHeight);
    const left = Math.max(0, Math.min(fit ? r.left - 24 : x - bw / 2, innerWidth - bw));
    const top = Math.max(0, Math.min(fit ? r.top - 24 : y - bh / 2, innerHeight - bh));
    const box = { left, top, width: bw, height: bh };
    if (w.host?.shoot)
        return Promise.resolve(w.host.shoot(box, x, y));
    if (x < 0)
        return Promise.resolve(null); // the pointer never entered the page
    return draw(w, box, x, y, scrollX, scrollY).catch(() => null); // pictures are a bonus
}
/** Every @font-face the page uses, with its font files as data: URLs. A stylesheet from another
 *  site (Google Fonts) can't be read through the CSSOM, so it is fetched; without this, crops
 *  fall back to a system font. */
export async function fontCss() {
    const blocks = [];
    for (const sheet of document.styleSheets) {
        let rules = null;
        try {
            rules = sheet.cssRules;
        }
        catch {
            /* another site's stylesheet: fetched below */
        }
        let css = [];
        if (rules)
            css = [...rules].filter((r) => r instanceof CSSFontFaceRule).map((r) => r.cssText);
        else if (sheet.href) {
            // oxlint-disable-next-line no-await-in-loop -- one sheet at a time, in document order: the fonts keep their cascade order
            const text = await fetch(sheet.href).then(async (r) => {
                const body = r.ok ? await r.text() : "";
                return body;
            }, () => "");
            css = text.match(/@font-face\s*\{[^}]*\}/gu) ?? [];
        }
        for (const block of css) {
            let out = block;
            for (const [, ref] of block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gu)) {
                if (!ref || ref.startsWith("data:"))
                    continue;
                // oxlint-disable-next-line no-await-in-loop -- one font file at a time, in the order the rule names them
                const data = await fetch(new URL(ref, sheet.href ?? location.href)).then(async (r) => (r.ok ? dataUrl(await r.blob()) : null), () => null);
                if (data)
                    out = out.replace(ref, data);
            }
            blocks.push(out);
        }
    }
    return blocks.join("\n");
}
/** Draw the viewport box (at the scroll it was taken at) to a PNG, with the pointer marked. */
async function draw(w, box, x, y, sx, sy) {
    const [{ domToCanvas }, fonts] = await w.drawer();
    const k = Math.min(devicePixelRatio || 1, 2);
    // By tag and id, not instanceof: a same-site iframe's nodes come from another window.
    const isEl = (n) => n.nodeType === 1;
    const isFrame = (e) => e.tagName === "IFRAME";
    const frame = (e) => {
        if (!isFrame(e))
            return false;
        try {
            return !e.contentDocument; // another site's frame: no page can read it
        }
        catch {
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
        filter: (n) => !(isEl(n) &&
            (n.id === "viz-feedback" || n.id === "__viz_dl" || n.tagName === "VIDEO" || frame(n))),
        font: fonts ? { cssText: fonts } : false,
    });
    const g = full.getContext("2d");
    // Videos and other sites' frames were left out of the drawing; put them back on top.
    for (const n of document.querySelectorAll("video, iframe")) {
        const r = n.getBoundingClientRect();
        if (!g || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight)
            continue;
        if (n instanceof HTMLVideoElement && drawable(n)) {
            g.drawImage(n, r.left * k, r.top * k, r.width * k, r.height * k);
            continue;
        }
        if (n instanceof HTMLVideoElement || frame(n)) {
            g.fillStyle = "#e9e9ee";
            g.fillRect(r.left * k, r.top * k, r.width * k, r.height * k);
            g.fillStyle = "#555";
            g.font = `${12 * k}px system-ui, sans-serif`;
            const what = n instanceof HTMLIFrameElement
                ? `embedded ${hostOf(n.src)}: can't be drawn`
                : "video from another site: can't be drawn";
            g.fillText(what, (r.left + 8) * k, (r.top + 20) * k, (r.width - 16) * k);
        }
    }
    const c = el("canvas");
    c.width = box.width * k;
    c.height = box.height * k;
    const o = c.getContext("2d");
    if (!o)
        return null;
    o.drawImage(full, box.left * k, box.top * k, c.width, c.height, 0, 0, c.width, c.height);
    // The pointer, as a red dot with a white ring, where it was.
    o.beginPath();
    o.arc((x - box.left) * k, (y - box.top) * k, 7 * k, 0, 2 * Math.PI);
    o.fillStyle = "#e5484d";
    o.strokeStyle = "#ffffffcc";
    o.lineWidth = 3 * k;
    o.fill();
    o.stroke();
    return new Promise((done) => {
        c.toBlob(done, "image/png");
    });
}
/** A video whose current frame this page may read (same site, or the other site allows it). */
function drawable(v) {
    if (v.readyState < 2)
        return false;
    try {
        const t = el("canvas");
        t.width = t.height = 1;
        const g = t.getContext("2d");
        g?.drawImage(v, 0, 0, 1, 1);
        g?.getImageData(0, 0, 1, 1);
        return true;
    }
    catch {
        return false;
    }
}
const hostOf = (u) => {
    try {
        return new URL(u).host || "page";
    }
    catch {
        return "page";
    }
};
