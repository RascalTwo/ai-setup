// GENERATED from kit/src/presence-sync.ts by `bun run sync:kit` — edit that file, not this one.
// presence-sync.ts — one page for everyone: what one person changes, changes on every screen.
//
// Two channels. "act" replays what you did on the same element (a click, a key, typing), so the
// page's own code runs on every screen. "st" carries what that left on the page (open, classes,
// hidden, aria-*): last writer wins per element and attribute, and a newcomer gets every change
// since load. Only real (trusted) events are sent, so a replay never echoes. A newcomer first
// replays the oldest peer's log of acts, which rebuilds state the page keeps only in JS.
// ponytail: state held only in JS (canvas, 3D, a variable) syncs only through the replayed events; a page that reacts differently to the same event drifts.
import { uniqueSelector } from "@viz/kit/anchor.js";
import { startDrag } from "@viz/kit/presence-drag.js";
import { find, fire, mine, typing } from "@viz/kit/presence-shared.js";
const field = (t) => t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
    ? t
    : null;
const ticks = (t) => t instanceof HTMLInputElement && /^(checkbox|radio)$/u.test(t.type);
const driving = (e) => e.isTrusted && e.target instanceof Element && !mine(e.target);
const leaves = (t) => {
    const a = t.closest("a[href]");
    if (!(a instanceof HTMLAnchorElement))
        return false;
    const u = new URL(a.href);
    return u.origin + u.pathname + u.search !== location.origin + location.pathname + location.search;
};
const newer = (a, b) => !b || a[3] > b[3] || (a[3] === b[3] && a[4] > b[4]);
/** Replays a click or a key on `t`, or sets a field to the value a peer left it with. */
function playOn(t, a) {
    if (a.k === "click") {
        const r = t.getBoundingClientRect();
        const at = {
            clientX: r.left + (a.fx ?? 0.5) * r.width,
            clientY: r.top + (a.fy ?? 0.5) * r.height,
        };
        t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, ...at }));
    }
    else if (a.k === "key") {
        const init = {
            key: a.key ?? "",
            code: a.code ?? "",
            bubbles: true,
            cancelable: true,
        };
        t.dispatchEvent(new KeyboardEvent("keydown", init));
        t.dispatchEvent(new KeyboardEvent("keyup", init));
    }
    else {
        const f = field(t);
        if (!f)
            return;
        const now = ticks(f) ? f.checked : f.value;
        if (now === a.v)
            return; // the replayed click already did it
        if (ticks(f))
            f.checked = Boolean(a.v);
        else
            f.value = String(a.v);
        f.dispatchEvent(new Event(a.k, { bubbles: true }));
    }
}
/** What I did, sent on the "act" channel: clicks, keys and field values (drags are presence-drag.js). */
function sendActs(drive) {
    addEventListener("click", (e) => {
        const t = e.target;
        if (!driving(e) || !(t instanceof Element) || e.altKey || e.ctrlKey || e.metaKey || leaves(t))
            return;
        const r = t.getBoundingClientRect();
        drive({
            sel: uniqueSelector(t),
            k: "click",
            fx: (e.clientX - r.left) / (r.width || 1),
            fy: (e.clientY - r.top) / (r.height || 1),
        });
    }, true);
    window.addEventListener("keydown", (e) => {
        const t = e.target;
        if (!driving(e) || !(t instanceof Element) || typing(t) || e.ctrlKey || e.metaKey || e.altKey)
            return;
        const { key, code } = e;
        if (key === "/" || /^(Shift|Control|Alt|Meta)$/u.test(key))
            return;
        drive({ sel: uniqueSelector(t), k: "key", key, code });
    }, true);
    const sendValue = (e) => {
        const t = field(e.target);
        if (!t || !driving(e))
            return;
        const v = ticks(t) ? t.checked : t.value;
        drive({ sel: uniqueSelector(t), k: e.type === "change" ? "change" : "input", v });
    };
    addEventListener("input", sendValue, true);
    addEventListener("change", sendValue, true);
}
const OBSERVED = [
    "open",
    "class",
    "hidden",
    "aria-expanded",
    "aria-selected",
    "aria-pressed",
    "aria-checked",
    "data-state",
];
export function startSync(ctx, selfId) {
    const { net, s } = ctx;
    const state = new Map(); // `${sel} ${attr}` → the latest write
    const log = [];
    const remember = (a) => {
        // A field's latest value is all a newcomer needs; clicks and keys keep their order.
        const i = a.v === undefined ? -1 : log.findIndex((h) => h.k === a.k && h.sel === a.sel);
        if (i >= 0)
            log.splice(i, 1);
        log.push(a);
        // ponytail: capped at 5000 acts; a long session past that rebuilds a newcomer only from "st".
        if (log.length > 5000)
            log.shift();
    };
    // Until the first log arrives, what peers send waits, so a replayed history never undoes it.
    const later = (fn) => {
        if (s.waiting)
            s.waiting.push(fn);
        else
            fn();
    };
    const replay = (fn) => {
        ctx.shared.replaying = true;
        try {
            fn();
        }
        finally {
            ctx.shared.replaying = false;
        }
    };
    // Kept even while private or alone: whoever joins after you rebuilds your page from it.
    const drive = (a) => {
        remember(a);
        if (s.joined && ctx.anyone())
            fire(net.act.send(a));
    };
    sendActs(drive);
    const drag = startDrag({ drive, driving, replay, field });
    const play = (a) => {
        if (a.k === "down" || a.k === "move" || a.k === "up")
            return drag.play(a);
        const t = find(a.sel);
        if (!t)
            return;
        replay(() => playOn(t, a));
    };
    net.hist.onMessage = (h) => {
        if (!s.waiting || !s.joined)
            return;
        const queued = s.waiting;
        s.waiting = null;
        if (h.since < s.since) {
            s.since = h.since;
            for (const a of h.acts) {
                remember(a);
                play(a);
            }
        }
        queued.forEach((fn) => fn());
    };
    net.act.onMessage = (a) => {
        if (s.joined)
            later(() => {
                remember(a);
                play(a);
            });
    };
    new MutationObserver((records) => {
        const out = [];
        const seen = new Set();
        for (const r of records) {
            const t = r.target;
            if (!(t instanceof Element))
                continue;
            const attr = r.attributeName ?? "";
            if (mine(t) || t.closest("[data-viz-chrome]"))
                continue;
            const sel = uniqueSelector(t);
            const k = `${sel} ${attr}`;
            if (seen.has(k))
                continue;
            seen.add(k);
            const v = t.getAttribute(attr);
            if (state.get(k)?.[2] === v)
                continue; // what a peer just set, or no change
            const written = [sel, attr, v, ++s.clock, selfId];
            state.set(k, written);
            out.push(written);
        }
        if (out.length > 0 && ctx.anyone() && s.joined)
            fire(net.st.send(out));
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: OBSERVED });
    net.st.onMessage = (list) => {
        if (!s.joined)
            return;
        later(() => {
            for (const w of list) {
                s.clock = Math.max(s.clock, w[3]);
                const k = `${w[0]} ${w[1]}`;
                if (!newer(w, state.get(k)))
                    continue;
                state.set(k, w);
                const t = find(w[0]);
                if (!t || t.getAttribute(w[1]) === w[2])
                    continue;
                replay(() => (w[2] === null ? t.removeAttribute(w[1]) : t.setAttribute(w[1], w[2])));
            }
        });
    };
    return {
        catchUp(id) {
            fire(net.hist.send({ since: s.since, acts: log }, { target: id })); // the newcomer replays it, then corrects with:
            if (state.size > 0)
                fire(net.st.send([...state.values()], { target: id })); // every attribute changed since load
        },
    };
}
