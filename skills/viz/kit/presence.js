// GENERATED from kit/src/presence.ts by `bun run sync:kit` — edit that file, not this one.
// presence.js — everyone on the same viz, live: cursors, click pings, messages and ink. No server.
//
// On every page the feedback widget is on (lib/server/feedback-page.ts), unless the page opts out
// with <meta name="viz:presence" content="off">. Browsers find each other through public Nostr
// relays (kit/trystero.js) and then talk directly over WebRTC; nothing is stored anywhere.
//   lobby : everyone reading the same viz (its viz:uid, else its path), joined quietly on load
//   room  : ?room=three-word-code, made by Invite (in the feedback panel, or the people panel)
// Nothing shows while you're alone in the lobby; when someone is here, a people button joins the
// feedback pill. You start private: you see whoever has joined, nobody sees you, and your page is
// your own. Join (in the people panel) shares your cursor, your clicks and the page itself.
// A ?room= link starts you joined. Gestures: move = cursor · click or tap = a ping on the element you hit · "/" = a
// message at your cursor · hold Ctrl and move = ink · the widget's 🎙 lines go out as messages.
// Ink and bubbles fade; the session's messages are listed in the people panel.
// When a direct connection fails, TURN relays help: <meta name="viz:turn" content='[{"urls":…}]'>.
import { joinRoom, selfId } from "/_kit/trystero.js";
import { uniqueSelector } from "/_kit/anchor.js";
const off = document.querySelector('meta[name="viz:presence"][content="off"]') || navigator.webdriver; // renders and verify runs stay out
if (!off)
    start();
function start() {
    const ADJ = "teal amber coral indigo olive plum rust sage slate ivory ochre cobalt crimson jade lilac maroon mint navy peach pearl ruby sand scarlet silver smoky sunny tawny violet wheat azure bronze copper".split(" ");
    const ANIMAL = "otter heron lynx badger finch koala marten newt puffin quokka raven tapir bison crane dingo egret ferret gecko ibis jackal lemur moose narwhal ocelot panda quail robin seal toucan walrus yak zebra".split(" ");
    const THING = "lamp kite anchor lantern compass harbor meadow pebble ribbon summit tundra willow canyon delta ember fjord glacier hollow island jetty lagoon mesa orchard prairie quarry reef spire thicket valley wharf beacon cove".split(" ");
    const COLORS = [
        "#4cc9f0",
        "#f72585",
        "#ffb703",
        "#80ed99",
        "#c77dff",
        "#ff7b54",
        "#2ec4b6",
        "#e9ff70",
    ];
    const any = (a) => a[Math.floor(Math.random() * a.length)] ?? "";
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    // ---- Who I am (kept for every viz on this site) ----------------------------------------
    const KEY = "viz-presence-me";
    const saved = (() => {
        try {
            return JSON.parse(localStorage.getItem(KEY) ?? "{}");
        }
        catch {
            return {};
        }
    })();
    const me = {
        name: saved.name ?? `${cap(any(ADJ))} ${cap(any(ANIMAL))}`,
        color: saved.color ?? any(COLORS),
    };
    const keepMe = () => localStorage.setItem(KEY, JSON.stringify(me));
    keepMe();
    const shared = { me, replaying: false }; // the feedback widget signs each line with me, and logs nothing a replay did
    window.vizPresence = shared;
    // ---- The room ----------------------------------------------------------------------------
    const code = new URLSearchParams(location.search).get("room");
    const uid = document.querySelector('meta[name="viz:uid"]')?.content;
    const where = code ? `room:${code}` : `lobby:${uid ?? location.pathname}`;
    const JOINED = `viz-presence-joined:${where}`; // this tab, this viz: survives a reload
    let joined = (sessionStorage.getItem(JOINED) ?? (code ? "1" : "0")) === "1";
    const turn = (() => {
        try {
            const raw = document.querySelector('meta[name="viz:turn"]')?.content;
            return raw
                ? JSON.parse(raw)
                : undefined;
        }
        catch {
            return undefined;
        }
    })();
    const room = joinRoom({
        appId: "rascaltwo-viz",
        ...(code ? { password: code } : {}),
        ...(turn ? { turnConfig: turn } : {}),
    }, where);
    addEventListener("pagehide", () => void room.leave());
    const hi = room.makeAction("hi");
    const cur = room.makeAction("cur");
    const ping = room.makeAction("ping");
    const say = room.makeAction("say");
    const ink = room.makeAction("ink");
    const peers = new Map();
    const live = () => [...peers.values()].filter((p) => p.joined);
    const anyone = () => peers.size > 0;
    const hiNow = () => ({ ...me, joined, away: document.hidden, hash: location.hash });
    const announce = () => void hi.send(hiNow());
    room.onPeerJoin = (id) => {
        void hi.send(hiNow(), { target: id });
        if (!joined)
            return; // a private page is nobody else's to copy
        void hist.send({ since, acts: log }, { target: id }); // the newcomer replays it, then corrects with:
        if (state.size)
            void st.send([...state.values()], { target: id }); // every attribute changed since load
    };
    room.onPeerLeave = (id) => {
        peers.get(id)?.el.remove();
        peers.delete(id);
        render();
    };
    addEventListener("visibilitychange", announce);
    addEventListener("hashchange", () => (announce(), peers.forEach(place)));
    // ---- The layer: absolute in page coordinates, so it scrolls with the page ----------------
    // ponytail: a viz that scrolls an inner element rather than the page gets cursors that drift; anchor to that scroller if one ever matters.
    const style = document.createElement("style");
    style.textContent = `
#viz-presence{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none;font:12px/1.3 var(--sans,system-ui,sans-serif)}
#viz-presence .vp-cur{position:absolute;transition:left .08s linear,top .08s linear}
#viz-presence .vp-cur svg{display:block}
#viz-presence .vp-name{position:absolute;left:14px;top:14px;white-space:nowrap;padding:1px 6px;border-radius:8px;color:#0d1117;font-weight:600}
#viz-presence .vp-cur.elsewhere{opacity:.35}
#viz-presence .vp-cur.elsewhere .vp-name{pointer-events:auto;cursor:pointer}
#viz-presence .vp-bubble{position:absolute;left:14px;top:34px;max-width:260px;padding:4px 9px;border-radius:10px;color:#0d1117;animation:vp-fade 6s forwards}
#viz-presence .vp-ring{position:absolute;border:3px solid;border-radius:6px;animation:vp-fade 3s forwards}
#viz-presence .vp-dot{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border:3px solid;border-radius:50%;animation:vp-fade 3s forwards}
#viz-presence svg.vp-ink{position:absolute;left:0;top:0;overflow:visible}
#viz-presence .vp-ink polyline{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;animation:vp-fade 4s forwards}
#viz-presence input.vp-say{position:absolute;pointer-events:auto;width:220px;padding:4px 8px;border-radius:10px;border:2px solid;background:#0d1117;color:#fff;font:inherit}
@keyframes vp-fade{0%,70%{opacity:1}100%{opacity:0}}
.vp-btn{all:unset;cursor:pointer;padding:0 8px;font:600 12px var(--sans,system-ui);color:var(--text,#e6edf3)}
.vp-panel{position:fixed;right:14px;bottom:60px;width:280px;max-height:60vh;overflow:auto;z-index:2147483001;background:var(--panel,#161b22);color:var(--text,#e6edf3);border:1px solid var(--border,#30363d);border-radius:10px;padding:10px;font:13px/1.4 var(--sans,system-ui);box-shadow:0 8px 30px #0008}
.vp-panel h4{margin:8px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#8b949e)}
.vp-row{display:flex;align-items:center;gap:6px;padding:2px 0}
.vp-row .vp-sw{width:10px;height:10px;border-radius:50%;flex:none}
.vp-row .vp-who{flex:1;cursor:pointer}
.vp-row.away .vp-who{opacity:.45}
.vp-panel button{font:inherit;color:inherit;background:var(--panel-2,#21262d);border:1px solid var(--border,#30363d);border-radius:6px;padding:2px 8px;cursor:pointer}
.vp-panel input[type=color]{width:22px;height:22px;padding:0;border:none;background:none}
.vp-panel input[type=text]{width:100%;box-sizing:border-box;background:var(--bg,#0d1117);color:inherit;border:1px solid var(--border,#30363d);border-radius:6px;padding:4px 6px;font:inherit}
.vp-log{max-height:140px;overflow:auto;font-size:12px}
.vp-panel button.vp-switch{position:relative;flex:none;width:30px;height:16px;padding:0;border-radius:8px}
.vp-switch::after{content:"";position:absolute;left:2px;top:2px;width:10px;height:10px;border-radius:50%;background:var(--muted,#8b949e);transition:left .15s}
.vp-switch[aria-checked=true]::after{left:16px;background:#3fb950}
.vp-solo{position:fixed;right:14px;bottom:14px;z-index:2147483000;background:var(--panel,#161b22);border:1px solid var(--border,#30363d);border-radius:16px;padding:4px 2px}`;
    document.head.append(style);
    const layer = el("div", { id: "viz-presence", "data-viz-chrome": "" });
    const inkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    inkSvg.classList.add("vp-ink");
    layer.append(inkSvg);
    document.documentElement.append(layer);
    const toPage = ([fx, y]) => ({ left: fx * document.documentElement.scrollWidth, top: y });
    const fromEvent = (e) => [
        e.pageX / document.documentElement.scrollWidth,
        e.pageY,
    ];
    const mine = (t) => t instanceof Element && !!t.closest("#viz-presence,.vp-panel,#viz-feedback,.vp-solo");
    // ---- Peers' cursors ---------------------------------------------------------------------------
    hi.onMessage = (d, { peerId }) => {
        let p = peers.get(peerId);
        if (!p) {
            const node = el("div", { class: "vp-cur" });
            node.innerHTML = `<svg width="18" height="20" viewBox="0 0 18 20"><path d="M1 1l6 17 2.5-7L17 8z" stroke="#0d1117" stroke-width="1.5"/></svg>`;
            node.append(el("span", { class: "vp-name" }));
            layer.append(node);
            p = { ...d, el: node, at: null, muted: false };
            peers.set(peerId, p);
        }
        else
            Object.assign(p, d);
        const name = p.el.querySelector(".vp-name");
        const arrow = p.el.querySelector("path");
        if (name)
            name.style.background = p.color;
        arrow?.setAttribute("fill", p.color);
        place(p);
        render();
    };
    function place(p) {
        const show = !!p.at && p.joined && !p.away && !p.muted;
        p.el.style.display = show ? "" : "none";
        if (!show || !p.at)
            return;
        const { left, top } = toPage(p.at);
        p.el.style.left = `${left}px`;
        p.el.style.top = `${top}px`;
        const elsewhere = p.hash !== location.hash; // on another step: what's under my cursor isn't on their screen
        p.el.classList.toggle("elsewhere", elsewhere);
        const name = p.el.querySelector(".vp-name");
        if (!name)
            return;
        name.textContent = elsewhere ? `${p.name} · elsewhere ↗` : p.name;
        name.title = elsewhere ? "On another step of this viz. Click to go there." : "";
        name.onclick = elsewhere ? () => ((location.hash = p.hash), location.reload()) : null;
    }
    cur.onMessage = (at, { peerId }) => {
        const p = peers.get(peerId);
        if (p)
            ((p.at = at), place(p));
    };
    // My cursor: sent on a timer, not rAF, so it keeps flowing while the page is busy.
    let last = null;
    let sent = null;
    addEventListener("pointermove", (e) => {
        last = fromEvent(e);
        if (inking)
            stroke.push(last);
    });
    setInterval(() => {
        if (!anyone() || !joined)
            return;
        if (last && last !== sent)
            void cur.send((sent = last));
        if (stroke.length > 1) {
            void ink.send(stroke);
            drawInk(stroke, me.color);
            stroke = [stroke[stroke.length - 1] ?? [0, 0]];
        }
    }, 50);
    // ---- Pings: what you clicked, wherever it sits on their screen --------------------------------
    addEventListener("click", (e) => {
        if (!anyone() || !joined || mine(e.target) || !(e.target instanceof Element))
            return;
        const node = e.target.closest("[data-viz-id]") ?? e.target;
        const r = node.getBoundingClientRect();
        const [x, y] = fromEvent(e);
        const p = {
            sel: uniqueSelector(node),
            fx: (e.clientX - r.left) / (r.width || 1),
            fy: (e.clientY - r.top) / (r.height || 1),
            x,
            y,
        };
        void ping.send(p);
        showPing(p, me.color);
    }, true);
    ping.onMessage = (p, { peerId }) => {
        const peer = peers.get(peerId);
        if (peer && !peer.muted)
            showPing(p, peer.color);
    };
    function showPing(p, color) {
        let node = null;
        try {
            node = document.querySelector(p.sel);
        }
        catch { }
        const dot = el("div", { class: "vp-dot" });
        dot.style.borderColor = color;
        if (node) {
            const r = node.getBoundingClientRect();
            const ring = el("div", { class: "vp-ring" });
            Object.assign(ring.style, {
                left: `${r.left + scrollX - 3}px`,
                top: `${r.top + scrollY - 3}px`,
                width: `${r.width}px`,
                height: `${r.height}px`,
                borderColor: color,
            });
            layer.append(ring);
            setTimeout(() => ring.remove(), 3000);
            Object.assign(dot.style, {
                left: `${r.left + scrollX + p.fx * r.width}px`,
                top: `${r.top + scrollY + p.fy * r.height}px`,
            });
        }
        else {
            const { left, top } = toPage([p.x, p.y]);
            Object.assign(dot.style, { left: `${left}px`, top: `${top}px` });
        }
        layer.append(dot);
        setTimeout(() => dot.remove(), 3000);
    }
    const act = room.makeAction("act");
    const st = room.makeAction("st");
    const hist = room.makeAction("hist");
    const state = new Map(); // `${sel} ${attr}` → the latest write
    let clock = 0;
    let since = Date.now(); // when this page's history began: its load, or the log it adopted
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
    let waiting = [];
    const later = (fn) => void (waiting ? waiting.push(fn) : fn());
    hist.onMessage = (h) => {
        if (!waiting || !joined)
            return;
        const queued = waiting;
        waiting = null;
        if (h.since < since) {
            since = h.since;
            for (const a of h.acts)
                (remember(a), play(a));
        }
        queued.forEach((fn) => fn());
    };
    const find = (sel) => {
        try {
            return document.querySelector(sel);
        }
        catch {
            return null;
        }
    };
    const replay = (fn) => {
        shared.replaying = true;
        try {
            fn();
        }
        finally {
            shared.replaying = false;
        }
    };
    const driving = (e) => e.isTrusted && e.target instanceof Element && !mine(e.target);
    // Kept even while private or alone: whoever joins after you rebuilds your page from it.
    const drive = (a) => (remember(a), joined && anyone() && void act.send(a));
    const leaves = (t) => {
        const a = t.closest("a[href]");
        if (!(a instanceof HTMLAnchorElement))
            return false;
        const u = new URL(a.href);
        return (u.origin + u.pathname + u.search !== location.origin + location.pathname + location.search);
    };
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
    addEventListener("keydown", (e) => {
        if (!driving(e) || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey)
            return;
        if (e.key === "/" || /^(Shift|Control|Alt|Meta)$/u.test(e.key))
            return;
        drive({
            sel: uniqueSelector(e.target),
            k: "key",
            key: e.key,
            code: e.code,
        });
    }, true);
    const field = (t) => t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
        ? t
        : null;
    const ticks = (t) => t instanceof HTMLInputElement && /^(checkbox|radio)$/u.test(t.type);
    const sendValue = (e) => {
        const t = field(e.target);
        if (!t || !driving(e))
            return;
        const v = ticks(t) ? t.checked : t.value;
        drive({ sel: uniqueSelector(t), k: e.type, v });
    };
    addEventListener("input", sendValue, true);
    addEventListener("change", sendValue, true);
    // Drags: the press, moves while held, the release. Positions are fractions of the pressed
    // element's box at the press, so a drag lands right on a screen of another size.
    let held = null;
    const frac = (e, r) => ({
        fx: (e.clientX - r.left) / (r.width || 1),
        fy: (e.clientY - r.top) / (r.height || 1),
    });
    addEventListener("pointerdown", (e) => {
        if (!driving(e) || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey)
            return;
        if (field(e.target) || typing(e.target))
            return; // a form field syncs its value instead
        const t = e.target;
        held = { sel: uniqueSelector(t), r: t.getBoundingClientRect(), last: e.timeStamp };
        drive({ sel: held.sel, k: "down", ...frac(e, held.r) });
    }, true);
    addEventListener("pointermove", (e) => {
        if (!held || !e.isTrusted || e.timeStamp - held.last < 30)
            return;
        held.last = e.timeStamp;
        drive({ sel: held.sel, k: "move", ...frac(e, held.r) });
    }, true);
    addEventListener("pointerup", (e) => {
        if (!held || !e.isTrusted)
            return;
        drive({ sel: held.sel, k: "move", ...frac(e, held.r) }); // the last move may have been throttled away
        drive({ sel: held.sel, k: "up", ...frac(e, held.r) });
        held = null;
    }, true);
    // A replayed press has no real pointer behind it, so the browser refuses to capture it. Pretend
    // it did, and send the moves where a real capture would. Real pointers pass straight through.
    const REPLAY = 999_999;
    let captor = null;
    const { setPointerCapture, hasPointerCapture, releasePointerCapture } = Element.prototype;
    Element.prototype.setPointerCapture = function (id) {
        if (id === REPLAY)
            captor = this;
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
        if (a.k === "up")
            ((pressed = null), (captor = null));
    }
    act.onMessage = (a) => void (joined && later(() => (remember(a), play(a))));
    function play(a) {
        if (a.k === "down" || a.k === "move" || a.k === "up")
            return replay(() => drag(a));
        const t = find(a.sel);
        if (!t)
            return;
        replay(() => {
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
        });
    }
    const newer = (a, b) => !b || a[3] > b[3] || (a[3] === b[3] && a[4] > b[4]);
    new MutationObserver((records) => {
        const out = [];
        const seen = new Set();
        for (const r of records) {
            const t = r.target;
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
            const s = [sel, attr, v, ++clock, selfId];
            state.set(k, s);
            out.push(s);
        }
        if (out.length && anyone() && joined)
            void st.send(out);
    }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: [
            "open",
            "class",
            "hidden",
            "aria-expanded",
            "aria-selected",
            "aria-pressed",
            "aria-checked",
            "data-state",
        ],
    });
    st.onMessage = (list) => void (joined &&
        later(() => {
            for (const s of list) {
                clock = Math.max(clock, s[3]);
                const k = `${s[0]} ${s[1]}`;
                if (!newer(s, state.get(k)))
                    continue;
                state.set(k, s);
                const t = find(s[0]);
                if (!t || t.getAttribute(s[1]) === s[2])
                    continue;
                replay(() => (s[2] === null ? t.removeAttribute(s[1]) : t.setAttribute(s[1], s[2])));
            }
        }));
    // ---- Messages: "/" types one, the 🎙 says one; a bubble at the cursor, then the log -------------
    const history = [];
    function bubble(text, name, color, at) {
        history.push({ name, color, text });
        if (history.length > 50)
            history.shift();
        const b = el("div", { class: "vp-bubble" }, text);
        b.style.background = color;
        if (at instanceof HTMLElement)
            at.append(b);
        else if (at) {
            const holder = el("div", { class: "vp-cur" });
            const { left, top } = toPage(at);
            Object.assign(holder.style, { left: `${left}px`, top: `${top}px` });
            holder.append(b);
            layer.append(holder);
            setTimeout(() => holder.remove(), 6000);
        }
        setTimeout(() => b.remove(), 6000);
        render();
    }
    const speak = (text) => {
        if (!anyone() || !joined || !text.trim())
            return;
        void say.send(text);
        bubble(text, me.name, me.color, last);
    };
    say.onMessage = (text, { peerId }) => {
        const p = peers.get(peerId);
        if (p && !p.muted)
            bubble(String(text).slice(0, 500), p.name, p.color, p.el);
    };
    addEventListener("viz:said", (e) => speak(String(e.detail)));
    const typing = (t) => t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(t.tagName));
    addEventListener("keydown", (e) => {
        if (e.key === "Control")
            inking = anyone() && joined;
        if (e.key !== "/" || typing(e.target) || !anyone() || !joined)
            return;
        e.preventDefault();
        const input = el("input", { class: "vp-say", placeholder: "Say something · Enter" });
        const { left, top } = toPage(last ?? [0.5, scrollY + innerHeight / 2]);
        Object.assign(input.style, {
            left: `${left + 14}px`,
            top: `${top + 30}px`,
            borderColor: me.color,
        });
        layer.append(input);
        input.focus();
        input.addEventListener("keydown", (k) => {
            k.stopPropagation();
            if (k.key === "Enter")
                speak(input.value);
            if (k.key === "Enter" || k.key === "Escape")
                input.remove();
        });
        input.addEventListener("blur", () => input.remove());
    });
    // ---- Ink: hold Ctrl and move; every stroke fades ------------------------------------------------
    let inking = false;
    let stroke = [];
    addEventListener("keyup", (e) => {
        if (e.key === "Control")
            ((inking = false), (stroke = []));
    });
    addEventListener("blur", () => ((inking = false), (stroke = [])));
    ink.onMessage = (pts, { peerId }) => {
        const p = peers.get(peerId);
        if (p && !p.muted)
            drawInk(pts, p.color);
    };
    function drawInk(pts, color) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("points", pts
            .map((pt) => {
            const { left, top } = toPage(pt);
            return `${left},${top}`;
        })
            .join(" "));
        line.setAttribute("stroke", color);
        inkSvg.append(line);
        setTimeout(() => line.remove(), 4000);
    }
    // ---- The people button and panel ------------------------------------------------------------------
    const words = () => `${any(ADJ)}-${any(ANIMAL)}-${any(THING)}`;
    function invite() {
        const url = new URL(location.href);
        url.searchParams.set("room", code ?? words());
        void navigator.clipboard?.writeText(url.href).catch(() => { });
        if (code)
            return void flash("Link copied");
        location.href = url.href; // join the new room; the link is on the clipboard
    }
    const toast = el("div", { class: "vp-solo" });
    function flash(text) {
        toast.textContent = text;
        toast.style.padding = "6px 12px";
        toast.style.bottom = "60px";
        document.body.append(toast);
        setTimeout(() => toast.remove(), 2000);
    }
    addEventListener("viz:panel", (e) => {
        const head = e.detail;
        const b = el("button", { class: "vf-mini", type: "button", title: "Start a private room and copy its link" }, "🔗 Invite");
        b.addEventListener("click", invite);
        head.append(b);
    });
    const btn = el("button", { class: "vp-btn", type: "button", title: "Who's here" });
    btn.addEventListener("click", () => ((open = !open), render()));
    let open = false;
    let panel = null;
    function join(on) {
        sessionStorage.setItem(JOINED, on ? "1" : "0");
        if (on && live().length)
            return location.reload(); // catch up with them, like any newcomer
        joined = on;
        if (on)
            waiting = null; // nobody joined to catch up with: whoever joins next starts from this page
        announce();
        render();
    }
    function render() {
        const shown = live();
        const quiet = peers.size - shown.length;
        const want = anyone() || !!code; // alone in the lobby: nothing on screen
        if (!want)
            btn.remove();
        else {
            btn.textContent = `👥 ${peers.size + 1}`;
            btn.title = `${peers.size + 1} here · ${shown.length + (joined ? 1 : 0)} joined`;
            btn.style.color = joined ? me.color : ""; // at a glance: am I sharing?
            const pill = document.querySelector("#viz-feedback .vf-pill");
            if (pill)
                pill.prepend(btn);
            else {
                const solo = document.querySelector(".vp-solo:not(:empty)") ?? el("div", { class: "vp-solo" });
                if (!solo.isConnected)
                    document.body.append(solo);
                solo.append(btn);
            }
        }
        panel?.remove();
        panel = null;
        if (!open || !want)
            return;
        const p = el("div", { class: "vp-panel", "data-viz-chrome": "" });
        p.append(el("h4", {}, code ? `Room ${code}` : "Here now"));
        const sw = el("button", {
            class: "vp-switch",
            type: "button",
            role: "switch",
            "aria-checked": String(joined),
        });
        sw.addEventListener("click", () => join(!joined));
        const toggle = el("label", { class: "vp-row" });
        toggle.append(sw, joined ? "Joined: your cursor and clicks are shared" : "Join: share your cursor and clicks");
        p.append(toggle);
        const self = el("div", { class: "vp-row" });
        const color = el("input", { type: "color", value: me.color, title: "Your colour" });
        color.addEventListener("change", () => ((me.color = color.value), keepMe(), announce()));
        const rename = el("button", { type: "button", title: "Rename yourself" }, `${me.name} (you)`);
        rename.addEventListener("click", () => {
            const n = prompt("Your name", me.name)?.trim();
            if (n)
                ((me.name = n.slice(0, 40)), keepMe(), announce(), render());
        });
        self.append(color, rename);
        p.append(self);
        for (const peer of shown) {
            const row = el("div", { class: "vp-row" + (peer.away ? " away" : "") });
            const sw = el("span", { class: "vp-sw" });
            sw.style.background = peer.color;
            const who = el("span", { class: "vp-who", title: "Jump to their cursor" }, peer.name + (peer.away ? " · away" : ""));
            who.addEventListener("click", () => peer.el.scrollIntoView({ block: "center", behavior: "smooth" }));
            const hide = el("button", { type: "button", title: peer.muted ? "Show this person" : "Hide this person" }, peer.muted ? "show" : "hide");
            hide.addEventListener("click", () => ((peer.muted = !peer.muted), place(peer), render()));
            row.append(sw, who, hide);
            p.append(row);
        }
        if (quiet)
            p.append(el("div", { class: "vp-row" }, `+${quiet} browsing privately`));
        p.append(el("h4", {}, "Messages"));
        const log = el("div", { class: "vp-log" });
        for (const h of history) {
            const line = el("div", {}, `${h.name}: ${h.text}`);
            line.style.borderLeft = `3px solid ${h.color}`;
            line.style.paddingLeft = "6px";
            log.append(line);
        }
        const chat = el("input", {
            type: "text",
            placeholder: joined ? "Message everyone · Enter" : "Join to message everyone",
        });
        chat.disabled = !joined;
        chat.addEventListener("keydown", (k) => {
            k.stopPropagation();
            if (k.key === "Enter")
                (speak(chat.value), (chat.value = ""));
        });
        p.append(log, chat);
        const foot = el("div", { class: "vp-row" });
        const ib = el("button", { type: "button" }, code ? "🔗 Copy invite link" : "🔗 Invite to a private room");
        ib.addEventListener("click", invite);
        foot.append(ib);
        if (code) {
            const leave = el("button", { type: "button" }, "Leave room");
            leave.addEventListener("click", () => {
                const url = new URL(location.href);
                url.searchParams.delete("room");
                location.href = url.href;
            });
            foot.append(leave);
        }
        p.append(foot);
        document.body.append(p);
        panel = p;
        log.scrollTop = log.scrollHeight;
    }
    render();
}
function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs))
        node.setAttribute(k, v);
    if (text !== undefined)
        node.textContent = text;
    return node;
}
