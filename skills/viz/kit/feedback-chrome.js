// GENERATED from kit/src/feedback-chrome.ts by `bun run sync:kit` — edit that file, not this one.
// feedback-chrome.js — the widget's small floating parts: the pill (built here), its mic and count, the note
// beside the pill, the "Copied" flash, and the Alt/Option-click box that types a line.
import { nameOf } from "@viz/kit/feedback-text.js";
import { detach, el, newId, placeNear } from "@viz/kit/feedback-dom.js";
export function closeBubble(w) {
    w.bubble?.remove();
    w.bubble = null;
    window.__vizResume?.();
}
// A note by the pill: what the mic can't do here, or the Parakeet offer (with a Download button).
export function notice(w, text, hint, go) {
    closeBubble(w);
    const bubble = (w.bubble = el("div", { class: "vf-bubble" }));
    bubble.append(el("div", { class: "vf-offer" }, text), el("div", { class: "vf-hint" }, hint));
    const row = el("div", { class: "vf-row" });
    const no = el("button", { class: "vf-btn", type: "button" }, go ? "Not now" : "OK");
    no.addEventListener("click", () => closeBubble(w));
    row.append(no);
    if (go) {
        const yes = el("button", { class: "vf-btn primary", type: "button" }, "Download");
        yes.addEventListener("click", () => {
            closeBubble(w);
            go();
        });
        row.append(yes);
    }
    bubble.append(row);
    w.layer.append(bubble);
    const r = w.pill.getBoundingClientRect();
    placeNear(bubble, r.right - 340, r.top - 190);
}
export function flash(w, text) {
    const f = el("div", { class: "vf-flash" }, text);
    w.layer.append(f);
    const r = w.pill.getBoundingClientRect();
    f.style.right = innerWidth - r.right + "px";
    f.style.bottom = innerHeight - r.top + 8 + "px";
    setTimeout(() => f.remove(), 2200);
}
export function renderPill(w) {
    const loading = w.engine === "parakeet" && !!w.worker && !w.modelReady && !w.micErr;
    w.micBtn.className =
        "mic" +
            (w.listening ? " on" : w.started && w.paused ? " paused" : "") +
            (w.engine === "none" ? " off" : "") +
            (loading ? " loading" : "");
    w.micBtn.innerHTML = "🎙";
    if (loading)
        w.micBtn.append(el("span", { class: "spin" }));
    if (w.loadPct !== null)
        w.micBtn.append(el("span", { class: "pct" }, w.loadPct + "%"));
    w.micBtn.title =
        w.micErr ||
            (loading
                ? "Loading the speech model…"
                : w.engine === "none"
                    ? "No on-device speech in this browser: Alt-click anything to type"
                    : !w.started
                        ? "Talk while pointing (speech stays on this device)"
                        : w.paused
                            ? "Resume listening"
                            : w.listening
                                ? "Listening: click to pause"
                                : "Paused: this tab isn't focused");
    const open = w.act.fold().lines.filter((l) => !l.done).length;
    w.countBtn.textContent = `💬 ${open}`;
    w.countBtn.classList.toggle("unsent", w.dirty);
}
// ---- Alt/Option-click → "Provide feedback here" ----------------------------
// Capture phase + stop/prevent so it beats the viz's own click handlers.
export function installAltClick(w) {
    document.addEventListener("click", (e) => {
        if (!e.altKey || w.layer.hidden)
            return;
        const node = e.target;
        if (!(node instanceof Element) || w.layer.contains(node))
            return;
        if (w.root && !w.root.contains(node))
            return;
        e.preventDefault();
        e.stopPropagation();
        closeBubble(w);
        window.__vizPause?.(); // hold an animated target still while typing
        const anchor = w.act.captureAnchor(node), where = w.act.whereAt(e.clientX, e.clientY);
        const bubble = (w.bubble = el("div", { class: "vf-bubble" }));
        const ta = el("textarea", { placeholder: "Provide feedback here" });
        const ok = el("button", { class: "vf-btn primary", type: "button" }, "Save");
        const cancel = el("button", { class: "vf-btn", type: "button" }, "Cancel");
        const row = el("div", { class: "vf-row" });
        row.append(cancel, ok);
        bubble.append(ta, el("div", { class: "vf-hint" }, "↳ " + nameOf(anchor)), row);
        w.layer.append(bubble);
        placeNear(bubble, e.clientX, e.clientY);
        ta.focus();
        const submit = () => {
            const text = ta.value.trim();
            if (!text)
                return ta.focus();
            detach(w.act.log({ type: "comment", id: newId(), text, anchor, where }));
            closeBubble(w);
        };
        cancel.addEventListener("click", () => closeBubble(w));
        ok.addEventListener("click", submit);
        ta.addEventListener("keydown", (ev) => {
            ev.stopPropagation();
            if (ev.key === "Escape")
                closeBubble(w);
            if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter")
                submit();
        });
    }, true);
}
/** The pill (mic and count), the pointer dot and the layer holding them, on the page. */
export function mountParts(root) {
    const layer = el("div", { id: "viz-feedback" });
    const pill = el("div", { class: "vf-pill" });
    const micBtn = el("button", { class: "mic", type: "button" });
    const countBtn = el("button", {
        class: "count",
        type: "button",
        title: "Everything you said, picked and pointed at: preview, Copy, Send",
    });
    pill.append(micBtn, countBtn);
    // A built page's "Save a copy" button owns the very corner; sit beside it.
    if (!root && document.querySelector("#__viz_dl"))
        pill.style.right = "58px";
    const dot = el("div", { class: "vf-dot" });
    layer.append(pill, dot);
    document.documentElement.append(layer);
    // <meta name="viz:feedback" content="hidden"> starts it hidden; Alt+Shift+F shows or hides it on
    // any page. e.code, because macOS Option turns e.key into "Ï".
    layer.hidden = !!document.querySelector('meta[name="viz:feedback"][content="hidden"]');
    addEventListener("keydown", (e) => {
        if (!e.altKey || !e.shiftKey || e.code !== "KeyF")
            return;
        e.preventDefault();
        layer.hidden = !layer.hidden;
    });
    return { layer, pill, micBtn, countBtn, dot };
}
