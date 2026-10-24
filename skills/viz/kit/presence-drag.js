// GENERATED from kit/src/presence-drag.ts by `bun run sync:kit` — edit that file, not this one.
// presence-drag.ts — drags in the shared page: the press, moves while held, the release, sent from
// here and replayed from a peer as real pointer events.
import { uniqueSelector } from "@viz/kit/anchor.js";
import { find, typing } from "@viz/kit/presence-shared.js";
// A replayed press has no real pointer behind it, so the browser refuses to capture it. Pretend
// it did, and send the moves where a real capture would. Real pointers pass straight through.
const REPLAY = 999_999;
/** Wires drags both ways; returns what plays a peer's drag act here. */
export function startDrag(d) {
    // Drags: the press, moves while held, the release. Positions are fractions of the pressed
    // element's box at the press, so a drag lands right on a screen of another size.
    let held = null;
    const frac = (e, r) => ({
        fx: (e.clientX - r.left) / (r.width || 1),
        fy: (e.clientY - r.top) / (r.height || 1),
    });
    addEventListener("pointerdown", (e) => {
        if (!d.driving(e) || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey)
            return;
        if (d.field(e.target) || typing(e.target))
            return; // a form field syncs its value instead
        const t = e.target;
        if (!(t instanceof Element))
            return;
        held = { sel: uniqueSelector(t), r: t.getBoundingClientRect(), last: e.timeStamp };
        d.drive({ sel: held.sel, k: "down", ...frac(e, held.r) });
    }, true);
    addEventListener("pointermove", (e) => {
        if (!held || !e.isTrusted || e.timeStamp - held.last < 30)
            return;
        held.last = e.timeStamp;
        d.drive({ sel: held.sel, k: "move", ...frac(e, held.r) });
    }, true);
    addEventListener("pointerup", (e) => {
        if (!held || !e.isTrusted)
            return;
        d.drive({ sel: held.sel, k: "move", ...frac(e, held.r) }); // the last move may have been throttled away
        d.drive({ sel: held.sel, k: "up", ...frac(e, held.r) });
        held = null;
    }, true);
    let captor = null;
    const hold = (t) => {
        captor = t;
    };
    // oxlint-disable-next-line typescript/unbound-method -- patching a prototype: the originals are called back with the element they were called on
    const { setPointerCapture, hasPointerCapture, releasePointerCapture } = Element.prototype;
    Element.prototype.setPointerCapture = function (id) {
        if (id === REPLAY)
            hold(this);
        else
            setPointerCapture.call(this, id);
    };
    Element.prototype.hasPointerCapture = function (id) {
        return id === REPLAY ? captor === this : hasPointerCapture.call(this, id);
    };
    Element.prototype.releasePointerCapture = function (id) {
        if (id !== REPLAY)
            releasePointerCapture.call(this, id);
        else if (captor === this)
            captor = null;
    };
    let pressed = null; // ponytail: one remote drag at a time; two people dragging at once interleave
    function drag(a) {
        const t = a.k === "down" ? find(a.sel) : pressed?.t;
        if (!t)
            return;
        if (a.k === "down")
            pressed = { t, r: t.getBoundingClientRect() };
        const r = pressed.r;
        const clientX = r.left + (a.fx ?? 0.5) * r.width;
        const clientY = r.top + (a.fy ?? 0.5) * r.height;
        const to = a.k === "down"
            ? t
            : (captor ?? (t.isConnected ? t : document.elementFromPoint(clientX, clientY)));
        if (!to)
            return;
        const init = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            pointerId: REPLAY,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons: a.k === "up" ? 0 : 1,
        };
        to.dispatchEvent(new PointerEvent(`pointer${a.k}`, init));
        to.dispatchEvent(new MouseEvent(`mouse${a.k}`, init));
        if (a.k === "up") {
            pressed = null;
            captor = null;
        }
    }
    return { play: (a) => d.replay(() => drag(a)) };
}
