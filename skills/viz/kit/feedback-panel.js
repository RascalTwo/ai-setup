// GENERATED from kit/src/feedback-panel.ts by `bun run sync:kit` — edit that file, not this one.
// feedback-panel.js — the panel the 💬 button opens (every line, pick and crop, folded by what it's
// about; Copy, Text only and Send at its foot), and what leaves it: Send (tell a waiting agent you're
// done) and Copy (everything as text, with the crops attached).
import { feedbackText, nameOf } from "@viz/kit/feedback-text.js";
import { dataUrl, detach, el, escHtml, safeQuery } from "@viz/kit/feedback-dom.js";
import { flash } from "@viz/kit/feedback-chrome.js";
// Header: counts and the rare switches. Middle: one row per element, folded once there are
// many lines, scrolling. Foot: Copy, Text only, Send, always in view.
export function setPanel(w, open) {
    const scroll = w.panel?.querySelector(".vf-body")?.scrollTop ?? 0;
    w.panel?.remove();
    w.panel = null;
    if (!open)
        return;
    const { lines, picks } = w.act.fold();
    const panel = (w.panel = el("div", { class: "vf-panel" }));
    const head = panelHead(w, lines, picks);
    const body = panelBody(w, lines, picks);
    const foot = panelFoot(w);
    panel.append(head, body, foot);
    w.layer.append(panel);
    body.scrollTop = scroll;
}
function panelHead(w, lines, picks) {
    const crops = lines.reduce((n, l) => n + Object.keys(l.shots ?? {}).length, 0);
    const head = el("div", { class: "vf-head" });
    const np = Object.keys(picks).length;
    head.append(el("h3", {}, [
        `${lines.length} line${lines.length === 1 ? "" : "s"}`,
        np ? `${np} pick${np === 1 ? "" : "s"}` : "",
        crops ? `${crops} crop${crops === 1 ? "" : "s"}` : "",
    ]
        .filter(Boolean)
        .join(" · ")));
    if (w.engine === "browser" && "gpu" in navigator) {
        const up = el("button", { class: "vf-mini", type: "button", title: "Switch to Parakeet, the model the skill uses" }, "⬆ Parakeet");
        up.addEventListener("click", () => {
            w.act.offerParakeet();
        });
        head.append(up);
    }
    dispatchEvent(new CustomEvent("viz:panel", { detail: head })); // presence.js adds Invite here
    return head;
}
function panelBody(w, lines, picks) {
    const body = el("div", { class: "vf-body" });
    if (Object.keys(picks).length > 0)
        body.append(el("div", { class: "vf-picks" }, "Picks: " +
            Object.entries(picks)
                .map(([q, o]) => `${q}:${o}`)
                .join("  ")));
    if (lines.length === 0)
        body.append(el("div", { class: "vf-empty" }, "Click 🎙 and talk while pointing, or Alt-click anything to type."));
    const foldAll = lines.length > 8;
    for (const [k, ls] of w.act.groups(lines)) {
        const isOpen = foldAll ? w.opened.has(k) : !w.folded.has(k);
        const grp = el("div", { class: "vf-group" + (isOpen ? " open" : "") });
        const where = el("div", { class: "vf-where", title: isOpen ? "Fold" : "Unfold" }, `${isOpen ? "▾" : "▸"} ${nameOf(ls[0]?.anchor)} · ${ls.length} line${ls.length === 1 ? "" : "s"}`);
        where.addEventListener("click", () => {
            const set = foldAll ? w.opened : w.folded;
            if (set.has(k))
                set.delete(k);
            else
                set.add(k);
            if (foldAll ? w.opened.has(k) : !w.folded.has(k))
                safeQuery(k)?.scrollIntoView({ block: "center", behavior: "smooth" });
            setPanel(w, true);
        });
        grp.append(where);
        if (isOpen)
            grp.append(...ls.map((l) => w.act.lineEl(l)));
        body.append(grp);
    }
    return body;
}
function panelFoot(w) {
    const foot = el("div", { class: "vf-foot" });
    const copyBtn = el("button", {
        class: "vf-btn primary",
        type: "button",
        title: "All the text, the crops, and one numbered picture of them",
    }, "📋 Copy");
    const textBtn = el("button", {
        class: "vf-btn",
        type: "button",
        title: "Just the text (Slack keeps only the picture from Copy)",
    }, "Text only");
    const sendBtn = el("button", { class: "vf-btn", type: "button", title: "Tell a waiting agent you're done" }, "Send");
    copyBtn.addEventListener("click", () => {
        detach(w.act.copy(true));
    });
    textBtn.addEventListener("click", () => {
        detach(w.act.copy(false));
    });
    sendBtn.addEventListener("click", () => {
        detach(w.act.send());
    });
    sendBtn.disabled = !w.dirty;
    foot.append(copyBtn, textBtn, sendBtn);
    if (!w.vizId && !w.host && w.entries.length > 0) {
        const clear = el("button", { class: "vf-btn", type: "button", title: "Empty this page's feedback in this browser" }, "Clear");
        clear.addEventListener("click", () => {
            detach(w.act.log({ type: "clear" }));
        });
        foot.append(clear);
    }
    return foot;
}
// Send: cut what's being said now, and write `send` only after every line lands.
export async function send(w, extra = {}) {
    if (w.speaking)
        detach(w.act.cut());
    // The browser engine hands over its last words only as it stops: wait for that (or 2 s).
    const ended = w.engine === "browser" && w.listening
        ? new Promise((r) => {
            w.onEnd = r;
            setTimeout(r, 2000);
        })
        : null;
    if (w.started) {
        w.paused = true; // no listening while Claude works; Resume is manual
        w.act.sync();
    }
    await ended;
    await Promise.all(w.inflight);
    const entry = { type: "send", at: new Date().toISOString() };
    const round = extra.round ??
        +([...document.querySelectorAll("[data-round]")].pop()?.dataset["round"] ?? 0);
    if (round)
        entry.round = round; // grill-me-viz waits on {"type":"send","round":N}
    await w.act.log(entry);
    dispatchEvent(new CustomEvent("viz-feedback:sent", { detail: { round } }));
    // A live page closes once the server holds the send (append swallows failures, so read it back);
    // the agent reopens the URL for the next round. Exports and hosted pages have no agent to reopen them.
    if (!w.vizId || !(await w.store.load()).some((e) => e.type === "send" && e.at === entry.at))
        return;
    setTimeout(() => {
        close();
        // Still here: the browser only lets a page close a tab nothing navigated (history length 1).
        setTimeout(() => flash(w, "Sent ✓ — you can close this tab"), 300);
    }, 600); // a beat to see "Sent ✓"
}
// ---- Copy: everything as text, plus the crops as HTML and one numbered contact sheet ----
// One click carries three formats and each app keeps the one it understands: Slack keeps the
// picture, a notes app or an email keeps text with every crop, an agent's prompt keeps the text.
export async function copy(w, withImages) {
    if (w.speaking)
        detach(w.act.cut());
    await Promise.all(w.inflight);
    const { lines, picks } = w.act.fold();
    const crops = [];
    const num = new Map();
    if (withImages)
        for (const l of lines)
            for (const name of Object.values(l.shots ?? {})) {
                // oxlint-disable-next-line no-await-in-loop -- crops are numbered in the order they are read: one at a time
                const png = await w.store.get(name).catch(() => null);
                if (png)
                    num.set(name, crops.push(png));
            }
    const at = location.protocol === "file:" ? location.pathname.split("/").pop() : location.href;
    const text = [
        `Feedback on "${document.title}"`,
        `${at} · page stamp ${w.stamp || "none"} · copied ${new Date().toISOString()}`,
        ...feedbackText(lines, picks, true, (f, k) => {
            const n = num.get(f);
            return n ? `crop ${n} (${k})` : `${k} crop not copied`;
        }),
        ...(crops.length > 0
            ? ["", `${crops.length} crop(s): see the attached image, numbered to match`]
            : []),
    ].join("\n");
    const item = { "text/plain": new Blob([text], { type: "text/plain" }) };
    if (crops.length > 0) {
        const imgs = await Promise.all(crops.map(async (c, i) => `<p><b>crop ${i + 1}</b><br><img src="${await dataUrl(c)}"></p>`));
        item["text/html"] = new Blob([`<pre>${escHtml(text)}</pre>${imgs.join("")}`], {
            type: "text/html",
        });
        const png = await sheet(crops);
        if (png)
            item["image/png"] = png;
    }
    try {
        await navigator.clipboard.write([new ClipboardItem(item)]);
        w.act.flash(crops.length > 0 ? `Copied: text and ${crops.length} crop(s)` : "Copied: text");
    }
    catch {
        // Copying blocked (an old browser, or no permission): hand over the text to copy by hand.
        w.act.notice("Copying was blocked here. Select this text and copy it yourself:", "");
        const ta = el("textarea", { readonly: "" });
        ta.value = text;
        w.bubble?.insertBefore(ta, w.bubble.lastChild);
        ta.select();
    }
}
/** Every crop on one numbered sheet: a clipboard reliably holds one image per copy. */
async function sheet(crops) {
    // oxlint-disable-next-line typescript/promise-function-async -- hands each bitmap's promise straight to Promise.all
    const pics = await Promise.all(crops.map((c) => createImageBitmap(c)));
    const W = 360, PAD = 12, LAB = 22, cols = Math.min(3, pics.length);
    const hs = pics.map((p) => Math.round((p.height * W) / p.width));
    const rows = [];
    for (let i = 0; i < pics.length; i += cols)
        rows.push(Math.max(...hs.slice(i, i + cols)));
    const c = el("canvas");
    c.width = PAD + cols * (W + PAD);
    c.height = PAD + rows.reduce((a, h) => a + h + LAB + PAD, 0);
    const g = c.getContext("2d");
    if (!g)
        return null;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    let y = PAD;
    for (const [i, p] of pics.entries()) {
        const col = i % cols, x = PAD + col * (W + PAD);
        g.fillStyle = "#1b1b1f";
        g.font = "bold 14px system-ui, sans-serif";
        g.fillText(`crop ${i + 1}`, x, y + 15);
        g.drawImage(p, x, y + LAB, W, hs[i]);
        g.strokeStyle = "#ccc";
        g.strokeRect(x + 0.5, y + LAB + 0.5, W - 1, hs[i] - 1);
        if (col === cols - 1)
            y += rows[Math.floor(i / cols)] + LAB + PAD;
    }
    return new Promise((done) => {
        c.toBlob(done, "image/png");
    });
}
