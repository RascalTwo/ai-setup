// comments.js — the /viz anchored review layer (client overlay).
//
// Injected LIVE-ONLY by the viz server next to the hot-reload script (never in
// frozen/published builds). Lets the user Alt/Option-click any element to drop a
// comment that the agent (Claude) later reads, addresses, and resolves. The whole
// thing is local-first and dependency-free: comments persist to comments.json
// beside the viz via the server's /<id>/_comments route.
//
// Lifecycle (each actor owns exactly one transition):
//   user  : create (Alt-click + bubble)  →  status "open"
//   agent : PATCH status → "resolved" (+ optional `resolution` note)
//   user  : delete (reviews the resolved pin, approves)
// The agent never deletes; the user never resolves.
//
// Anchoring: each comment stores a robust CSS selector (works for HTML *and* SVG),
// the element's text, and its data-* attrs. A requestAnimationFrame loop re-reads
// getBoundingClientRect() every frame so a pin TRACKS its element even as the viz
// animates it across the screen.

(() => {
  const script = document.querySelector("script[data-viz-comments]");
  const vizId = script?.dataset.vizComments;
  if (!vizId) return; // not injected by the viz server — bail silently
  const API = `/${vizId}/_comments`;

  // ---- State -------------------------------------------------------------
  let comments = []; // the comments.json array, as served
  const pinEls = new Map(); // comment id -> pin element
  let activeId = null; // comment whose card is open
  let panelOpen = false;

  // ---- DOM scaffolding ---------------------------------------------------
  const layer = el("div", { id: "viz-comments" });
  const toggle = el("button", { class: "vc-toggle", title: "Comments — Alt-click any element to add" });
  toggle.innerHTML = `💬 <span class="count zero">0</span>`;
  toggle.addEventListener("click", () => setPanel(!panelOpen));
  layer.appendChild(toggle);
  document.documentElement.appendChild(layer);

  // ---- Selector builder (the anchor's backbone) --------------------------
  // Prefer a stable identity (id → data-viz-id → other data-*/aria-label/name),
  // falling back to a structural :nth-of-type path. Returns the SHORTEST selector
  // that uniquely resolves. Works on SVG nodes too (they're Elements in the DOM).
  const isUnique = (sel) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const escId = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));
  const escAttr = (s) => String(s).replace(/(["\\])/g, "\\$1");

  function uniqueSelector(node) {
    if (!(node instanceof Element)) return null;
    if (node.id) {
      const s = `#${escId(node.id)}`;
      if (isUnique(s)) return s;
    }
    const tag = node.tagName.toLowerCase();
    const vizAttr = node.getAttribute("data-viz-id");
    if (vizAttr) {
      const s = `${tag}[data-viz-id="${escAttr(vizAttr)}"]`;
      if (isUnique(s)) return s;
    }
    for (const a of ["data-label", "aria-label", "name", "data-id"]) {
      const v = node.getAttribute(a);
      if (v) {
        const s = `${tag}[${a}="${escAttr(v)}"]`;
        if (isUnique(s)) return s;
      }
    }
    return structuralPath(node);
  }

  function structuralPath(node) {
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      const vizAttr = cur.getAttribute && cur.getAttribute("data-viz-id");
      if (vizAttr) {
        part += `[data-viz-id="${escAttr(vizAttr)}"]`;
      } else {
        const parent = cur.parentNode;
        if (parent && parent.children) {
          const sames = [...parent.children].filter((c) => c.tagName === cur.tagName);
          if (sames.length > 1) part += `:nth-of-type(${sames.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(part);
      if (isUnique(parts.join(" > "))) break;
      cur = cur.parentNode;
    }
    return parts.join(" > ");
  }

  // Build the stored anchor: selector + (optional) text + (optional) data-* map.
  function captureAnchor(node) {
    const anchor = { selector: uniqueSelector(node) };
    const text = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (text) anchor.text = text;
    const dataAttrs = {};
    for (const a of node.attributes || []) {
      if (a.name.startsWith("data-")) dataAttrs[a.name.slice(5)] = a.value;
    }
    if (Object.keys(dataAttrs).length) anchor.dataAttrs = dataAttrs;
    return anchor;
  }

  // ---- Alt/Option-click → open the capture bubble ------------------------
  // Capture phase + stop/prevent so we beat the viz's own click handlers and a
  // comment-drop never doubles as a viz interaction.
  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey) return;
      const node = e.target;
      if (!(node instanceof Element) || layer.contains(node)) return;
      e.preventDefault();
      e.stopPropagation();
      openBubble(node, e.clientX, e.clientY);
    },
    true,
  );

  // ---- The capture bubble (type or speak) --------------------------------
  let bubble = null;
  function closeBubble() {
    bubble?.remove();
    bubble = null;
    stopMic();
    window.__vizResume?.(); // hand animation back to the viz
  }

  function openBubble(node, x, y) {
    closeBubble();
    window.__vizPause?.(); // freeze the target so it doesn't drift while composing

    const anchor = captureAnchor(node);
    bubble = el("div", { class: "vc-bubble" });
    const ta = el("textarea", { placeholder: "Comment… (Alt-click is how you got here)" });
    const hint = el("div", { class: "vc-anchor-hint" });
    hint.textContent = "↳ " + anchorLabel(anchor);

    const mic = el("button", { class: "vc-btn icon", title: "Dictate (on-device)" });
    mic.textContent = "🎙";
    const spacer = el("div", { class: "spacer" });
    const cancel = el("button", { class: "vc-btn" });
    cancel.textContent = "Cancel";
    const save = el("button", { class: "vc-btn primary" });
    save.textContent = "Comment";

    const row = el("div", { class: "vc-row" });
    row.append(mic, spacer, cancel, save);
    bubble.append(ta, hint, row);
    layer.appendChild(bubble);
    placeNear(bubble, x, y);
    ta.focus();

    setupMic(mic, ta);

    const submit = async () => {
      const text = ta.value.trim();
      if (!text) return ta.focus();
      save.disabled = true;
      await post({ text, vizState: location.hash, anchor });
      closeBubble();
    };
    cancel.addEventListener("click", closeBubble);
    save.addEventListener("click", submit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeBubble();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
    });
  }

  // ---- On-device speech (Web Speech API, processLocally) -----------------
  // Chrome 139+ runs recognition on-device when processLocally is set, so no audio
  // leaves the machine. If the on-device model isn't available, the mic is hidden.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  let micWanted = false; // user intent — keep listening across pauses until an explicit stop
  async function setupMic(mic, ta) {
    if (!SR) return mic.remove();
    // available() is the on-device capability probe (Chrome 139+). Without it we
    // can't guarantee local processing, so we hide the mic rather than risk egress.
    if (typeof SR.available !== "function") return mic.remove();
    let status;
    try {
      status = await SR.available({ langs: ["en-US"], processLocally: true });
    } catch {
      return mic.remove();
    }
    if (status === "unavailable") return mic.remove();

    mic.addEventListener("click", async () => {
      if (micWanted) return stopMic(); // a second click toggles it off
      if (status !== "available") {
        // Model is downloadable/downloading — kick the install and tell the user.
        try {
          SR.install?.({ langs: ["en-US"], processLocally: true });
        } catch {}
        mic.title = "Downloading on-device voice model — try again shortly";
        return;
      }
      recog = new SR();
      recog.lang = "en-US";
      recog.processLocally = true;
      recog.interimResults = true;
      recog.continuous = true; // don't end on a natural pause while the user is thinking
      let base = ta.value ? ta.value.replace(/\s+$/, "") + " " : "";
      recog.onresult = (ev) => {
        let s = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) s += ev.results[i][0].transcript;
        ta.value = base + s;
        if (ev.results[ev.results.length - 1].isFinal) base = ta.value + " ";
      };
      recog.onerror = (e) => {
        // Permission/service denials are fatal — give up so we don't spin restarting.
        // Transient ones ("no-speech", "aborted", "network") fall through to onend.
        if (e.error === "not-allowed" || e.error === "service-not-allowed") micWanted = false;
      };
      recog.onend = () => {
        // The engine still ends itself after enough silence even with continuous set
        // (notably the on-device model). While the user still wants it on, restart —
        // so the mic stops on intent (mic toggle / Cancel / Comment), not on silence.
        if (micWanted) {
          setTimeout(() => {
            if (micWanted && recog) {
              try {
                recog.start();
              } catch {}
            }
          }, 120);
          return;
        }
        mic.classList.remove("recording");
        recog = null;
      };
      micWanted = true;
      try {
        recog.start();
      } catch {}
      mic.classList.add("recording");
    });
  }
  function stopMic() {
    // Clear intent FIRST so onend won't auto-restart; keep `recog` until onend fires
    // (onend drops the "recording" state and nulls it out).
    micWanted = false;
    try {
      recog?.stop();
    } catch {}
  }

  // ---- Pins + the rAF follow loop ----------------------------------------
  function ensurePin(c) {
    let pin = pinEls.get(c.id);
    if (!pin) {
      pin = el("div", { class: "vc-pin" });
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        openCard(c.id);
      });
      layer.appendChild(pin);
      pinEls.set(c.id, pin);
    }
    pin.className = "vc-pin" + (c.status === "resolved" ? " resolved" : "");
    pin.textContent = pinNumber(c.id);
    pin.title = c.text;
    return pin;
  }
  const pinNumber = (id) => String(comments.findIndex((c) => c.id === id) + 1);

  function tick() {
    for (const c of comments) {
      const pin = pinEls.get(c.id);
      if (!pin) continue;
      const node = c.anchor && c.anchor.selector ? safeQuery(c.anchor.selector) : null;
      if (!node) {
        // Anchor no longer resolves. Full re-resolution is Phase 2; for now park the
        // pin top-right and mark it detached so nothing silently vanishes.
        pin.classList.add("detached");
        pin.style.left = "auto";
        pin.style.right = "12px";
        pin.style.top = 56 + detachedSlot(c.id) * 26 + "px";
        continue;
      }
      pin.classList.remove("detached");
      pin.style.right = "auto";
      const r = node.getBoundingClientRect();
      pin.style.left = r.left + r.width / 2 + "px";
      pin.style.top = r.top + "px";
    }
    requestAnimationFrame(tick);
  }
  const safeQuery = (sel) => {
    try {
      return document.querySelector(sel);
    } catch {
      return null;
    }
  };
  const detachedSlot = (id) =>
    comments.filter((c) => !safeQuery(c.anchor?.selector)).findIndex((c) => c.id === id);

  // ---- The per-pin read card --------------------------------------------
  let card = null;
  function closeCard() {
    card?.remove();
    card = null;
    activeId = null;
    pinEls.forEach((p) => p.classList.remove("active"));
  }
  function openCard(id) {
    closeCard();
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    activeId = id;
    const pin = pinEls.get(id);
    pin?.classList.add("active");

    card = el("div", { class: "vc-card" });
    card.appendChild(renderBody(c));
    card.appendChild(renderActions(c));
    layer.appendChild(card);
    const r = (pin || document.body).getBoundingClientRect();
    placeNear(card, r.left, r.bottom);
  }

  function renderBody(c) {
    const wrap = el("div");
    const meta = el("div", { class: "vc-meta" });
    const state = c.anchor && safeQuery(c.anchor.selector) ? c.status : "detached";
    meta.appendChild(badge(state));
    if (c.vizState && c.vizState !== location.hash) {
      const go = el("button", { class: "vc-btn", title: "Jump the viz to this comment's state" });
      go.style.cssText = "font-size:11px;padding:2px 7px";
      go.textContent = "⤺ state";
      go.addEventListener("click", () => (location.hash = c.vizState));
      meta.appendChild(go);
    }
    wrap.appendChild(meta);
    const text = el("div", { class: "vc-text" });
    text.textContent = c.text;
    wrap.appendChild(text);
    if (c.resolution) {
      const res = el("div", { class: "vc-resolution" });
      res.innerHTML = `<b>resolved:</b> `;
      res.appendChild(document.createTextNode(c.resolution));
      wrap.appendChild(res);
    }
    return wrap;
  }

  // User owns only create + delete. Open → 🗑 retract; resolved → ✓ approve&clear.
  // Both are DELETE; the label just reflects intent. (Resolve is the agent's PATCH.)
  function renderActions(c) {
    const row = el("div", { class: "vc-actions" });
    if (c.status === "resolved") {
      const ok = el("button", { class: "vc-btn good" });
      ok.textContent = "✓ Approve & clear";
      ok.addEventListener("click", () => remove(c.id));
      row.appendChild(ok);
    } else {
      const del = el("button", { class: "vc-btn danger" });
      del.textContent = "🗑 Delete";
      del.addEventListener("click", () => remove(c.id));
      row.appendChild(del);
    }
    return row;
  }

  const badge = (state) => {
    const b = el("span", { class: `vc-badge ${state}` });
    b.textContent = state;
    return b;
  };

  // ---- The browse panel (corner toggle) ----------------------------------
  let panel = null;
  function setPanel(open) {
    panelOpen = open;
    if (panel) {
      panel.remove();
      panel = null;
    }
    if (!open) return;
    panel = el("div", { class: "vc-panel" });
    panel.appendChild(el("h3", {}, `${comments.length} comment${comments.length === 1 ? "" : "s"}`));
    if (!comments.length) {
      panel.appendChild(el("div", { class: "vc-empty" }, "Alt-click any element to leave a comment."));
    }
    comments.forEach((c) => {
      const detached = !safeQuery(c.anchor?.selector);
      const item = el("div", {
        class: "vc-item " + (detached ? "detached" : c.status === "resolved" ? "resolved" : ""),
      });
      const num = el("span", { class: "vc-badge " + (detached ? "detached" : c.status) });
      num.textContent = `#${pinNumber(c.id)}`;
      const meta = el("div", { class: "vc-meta" });
      meta.append(num, badge(detached ? "detached" : c.status));
      const txt = el("div", { class: "vc-text" });
      txt.textContent = c.text;
      item.append(meta, txt);
      if (c.resolution) {
        const res = el("div", { class: "vc-resolution" });
        res.innerHTML = `<b>resolved:</b> `;
        res.appendChild(document.createTextNode(c.resolution));
        item.appendChild(res);
      }
      item.appendChild(renderActions(c));
      item.addEventListener("click", (e) => {
        if (e.target.closest(".vc-btn")) return; // let action buttons act
        openCard(c.id);
      });
      panel.appendChild(item);
    });
    layer.appendChild(panel);
  }

  // ---- Server I/O --------------------------------------------------------
  async function load() {
    try {
      comments = await (await fetch(API)).json();
    } catch {
      comments = [];
    }
    sync();
  }
  async function post(payload) {
    try {
      await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
    await load();
  }
  async function remove(id) {
    try {
      await fetch(`${API}/${id}`, { method: "DELETE" });
    } catch {}
    if (activeId === id) closeCard();
    await load();
  }

  // Reconcile pins + chrome with the current `comments` array.
  function sync() {
    for (const [id, pin] of pinEls) {
      if (!comments.find((c) => c.id === id)) {
        pin.remove();
        pinEls.delete(id);
      }
    }
    comments.forEach(ensurePin);
    const count = toggle.querySelector(".count");
    const open = comments.filter((c) => c.status !== "resolved").length;
    count.textContent = String(open);
    count.classList.toggle("zero", open === 0);
    if (panelOpen) setPanel(true);
    if (activeId && !comments.find((c) => c.id === activeId)) closeCard();
  }

  // ---- Helpers -----------------------------------------------------------
  function el(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  }
  function anchorLabel(a) {
    if (a.text) return `"${a.text}"`;
    if (a.dataAttrs) {
      const k = a.dataAttrs["viz-id"] || a.dataAttrs["label"] || Object.values(a.dataAttrs)[0];
      if (k) return k;
    }
    return a.selector || "element";
  }
  // Keep a floating widget inside the viewport.
  function placeNear(node, x, y) {
    node.style.left = "0px";
    node.style.top = "0px";
    const w = node.offsetWidth || 280;
    const h = node.offsetHeight || 140;
    node.style.left = Math.max(8, Math.min(x + 12, innerWidth - w - 8)) + "px";
    node.style.top = Math.max(8, Math.min(y + 12, innerHeight - h - 8)) + "px";
  }

  // Close popovers on outside click / Escape (but not while Alt-clicking to add).
  document.addEventListener(
    "click",
    (e) => {
      if (e.altKey) return;
      if (card && !card.contains(e.target) && !e.target.closest(".vc-pin")) closeCard();
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCard();
      if (panelOpen) setPanel(false);
    }
  });

  // ---- Go ----------------------------------------------------------------
  load();
  requestAnimationFrame(tick);
})();
