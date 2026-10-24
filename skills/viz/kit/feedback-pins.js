// GENERATED from kit/src/feedback-pins.ts by `bun run sync:kit` — edit that file, not this one.
// feedback-pins.js — what the log looks like on the page: pins (one per anchored element, a stack
// when it holds several lines), the loop that keeps them on their elements, the card a pin opens,
// a line as a row (click its text to edit, 🗑 to delete, ✓ to clear once resolved; its crops
// below), and a crop at full size.
import { byNote, nameOf } from "@viz/kit/feedback-text.js";
import { detach, el, placeNear, safeQuery } from "@viz/kit/feedback-dom.js";
/** Lines by the element they are anchored to ('' for the page). */
export const groups = (lines) => {
    const g = new Map();
    for (const l of lines) {
        const k = l.anchor?.selector ?? "";
        const list = g.get(k) ?? [];
        list.push(l);
        g.set(k, list);
    }
    return g;
};
export function renderPins(w, g) {
    for (const [k, pin] of w.pins) {
        if (g.has(k))
            continue;
        pin.remove();
        w.pins.delete(k);
    }
    for (const [k, ls] of g) {
        if (!k)
            continue; // page-level lines live only in the list
        let pin = w.pins.get(k);
        if (!pin) {
            pin = el("div", { class: "vf-pin" });
            pin.addEventListener("click", (e) => {
                e.stopPropagation();
                openCard(w, k);
            });
            w.layer.append(pin);
            w.pins.set(k, pin);
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
        const who = byNote(w.act.fold().lines);
        const authors = new Set(ls.map((l) => who(l) && l.by?.color));
        const [color] = authors;
        pin.style.background = authors.size === 1 && color ? color : ""; // one author: their colour
        pin.title = ls.map((l) => who(l) + l.text).join("\n");
    }
}
export function tick(w) {
    if (w.root) {
        // Docked in the root's bottom-right corner, and only while the root is on screen.
        const r = w.root.getBoundingClientRect();
        w.pill.style.display = r.bottom < 0 || r.top > innerHeight ? "none" : "";
        w.pill.style.right = Math.max(14, innerWidth - r.right + 10) + "px";
        w.pill.style.bottom = Math.max(14, innerHeight - r.bottom + 10) + "px";
    }
    let parked = 0;
    for (const [k, pin] of w.pins) {
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
    requestAnimationFrame(() => tick(w));
}
export function closeCard(w) {
    w.card?.remove();
    w.card = w.cardKey = null;
}
export function openCard(w, k) {
    closeCard(w);
    const ls = groups(w.act.fold().lines).get(k);
    if (!ls)
        return;
    w.cardKey = k;
    const card = (w.card = el("div", { class: "vf-card" }));
    card.append(el("div", { class: "vf-where" }, nameOf(ls[0]?.anchor)), ...ls.map((l) => w.act.lineEl(l)));
    w.layer.append(card);
    const r = (w.pins.get(k) ?? w.pill).getBoundingClientRect();
    placeNear(card, r.left, r.bottom);
}
export function lineEl(w, l) {
    const row = el("div", { class: "vf-line" + (l.done ? " done" : "") });
    const body = el("div", { style: "flex:1;min-width:0" });
    const t = el("span", {
        class: "t",
        contenteditable: "plaintext-only",
        spellcheck: "false",
        title: "Click to edit",
    }, l.text);
    const who = byNote(w.act.fold().lines)(l);
    if (who && l.by) {
        const tag = el("b", { style: `color:${l.by.color}` }, who);
        body.append(tag);
    }
    t.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            t.blur();
        }
        if (e.key === "Escape") {
            t.textContent = l.text;
            t.blur();
        }
        e.stopPropagation(); // the viz's own shortcuts shouldn't fire while typing
    });
    t.addEventListener("blur", () => {
        const v = (t.textContent ?? "").trim();
        if (v && v !== l.text)
            detach(w.act.log({ type: "edit", id: l.id, text: v }));
        else
            t.textContent = l.text;
    });
    body.append(t);
    if (l.note)
        body.append(el("span", { class: "note" }, "✓ " + l.note));
    const shots = Object.entries(l.shots ?? {});
    if (shots.length > 0 && !w.host) {
        const thumbs = el("div", { class: "vf-thumbs" });
        for (const [i, [key, name]] of shots.entries()) {
            const img = el("img", { alt: `crop ${key}`, loading: "lazy", title: "View full size" });
            detach(thumb(w, name).then((u) => {
                if (u)
                    img.src = u;
            }));
            img.addEventListener("click", (e) => {
                e.stopPropagation();
                w.act.openView(shots, i);
            });
            thumbs.append(img);
        }
        body.append(thumbs);
    }
    const del = el("button", { type: "button", title: l.done ? "Looks good: clear it" : "Delete this line" }, l.done ? "✓" : "🗑");
    del.addEventListener("click", () => {
        detach(w.act.log({ type: "retract", id: l.id }));
    });
    row.append(body, del);
    return row;
}
// oxlint-disable-next-line typescript/promise-function-async -- hands every caller the one cached promise for a crop, not a new promise each time
export const thumb = (w, name) => {
    let u = w.thumbs.get(name);
    if (!u) {
        u =
            name.startsWith("data:") || name.startsWith("blob:") || w.host
                ? Promise.resolve(w.host ? null : name) // a host's crops are its own business
                : w.store.get(name).then((b) => (b ? URL.createObjectURL(b) : null));
        w.thumbs.set(name, u);
    }
    return u;
};
// ---- A crop at full size: click a thumbnail; ← → step through the line's crops; Esc or a click closes ----
export function closeView(w) {
    w.view?.node.remove();
    w.view = null;
}
export function openView(w, shots, i) {
    closeView(w);
    const [key, name] = shots[i];
    const node = el("div", { class: "vf-view", role: "dialog", "aria-label": "Crop at full size" });
    const img = el("img", { alt: `crop ${key}` });
    detach(thumb(w, name).then((u) => {
        if (u)
            img.src = u;
    }));
    const where = key === "start" ? "As you began" : key === "end" ? "As you stopped" : key;
    const step = shots.length > 1 ? `  ·  ${i + 1} of ${shots.length}, ← → to step` : "";
    node.append(img, el("div", { class: "vf-view-cap" }, `${where}${step}  ·  Esc or click to close`));
    node.addEventListener("click", () => closeView(w));
    w.layer.append(node);
    w.view = { node, shots, i };
}
// Ahead of the page's own keys (a stepper's arrows), and only while a crop is open.
export function installViewKeys(w) {
    addEventListener("keydown", (e) => {
        if (!w.view)
            return;
        const n = w.view.shots.length;
        if (e.key === "Escape")
            closeView(w);
        else if (e.key === "ArrowRight" || e.key === "ArrowLeft")
            openView(w, w.view.shots, (w.view.i + (e.key === "ArrowRight" ? 1 : n - 1)) % n);
        else
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);
}
