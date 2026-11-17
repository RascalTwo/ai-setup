// Injected at document start into every page viz-overlay shows (after window.__overlayInit).
// Defines window.overlay (the page contract, reference/contract.md), reports the [data-overlay-hit]
// regions that take clicks, draws the ✕ that always closes the overlay, and asks for key focus
// while a text field has focus.
(() => {
  const init = window.__overlayInit;
  const post = (m) => window.webkit.messageHandlers.overlay.postMessage(m);
  const on = { target: new Set(), visibility: new Set(), display: new Set(), data: new Set() };
  const tracks = new Map();
  const pending = new Map();
  let n = 0;
  const fire = (event, value) => on[event].forEach((cb) => { try { cb(value); } catch (e) { console.error(e); } });

  const overlay = {
    title: init.title,
    origin: init.origin,
    display: init.display,
    visible: init.visible,
    target: null,
    shown: null,
    data: null,
    track(spec, cb) {
      const id = `t${++n}`;
      tracks.set(id, cb);
      post({ kind: "track", id, spec });
      return () => { tracks.delete(id); post({ kind: "untrack", id }); };
    },
    elements(app, opts = {}) {
      const id = `e${++n}`;
      post({ kind: "elements", id, app, match: opts.match ?? null, role: opts.role ?? null, web: Boolean(opts.web) });
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    send(text) { post({ kind: "send", text: String(text) }); },
    close() { post({ kind: "close" }); },
    on(event, cb) {
      if (!on[event]) throw new Error(`overlay.on: unknown event ${event} (target, visibility, display, data)`);
      on[event].add(cb);
      const now = { target: overlay.target, visibility: overlay.shown === null ? null : { visible: overlay.shown, reason: "current" }, display: overlay, data: overlay.data }[event];
      if (now !== null && now !== undefined) queueMicrotask(() => cb(now));
      return () => on[event].delete(cb);
    },
    _recv(m) {
      if (m.kind === "state" && m.id === "target") { overlay.target = m.state; fire("target", m.state); }
      else if (m.kind === "state") tracks.get(m.id)?.(m.state);
      else if (m.kind === "data") { overlay.data = m.value; fire("data", m.value); }
      else if (m.kind === "visibility") { overlay.shown = m.visible; fire("visibility", m); }
      else if (m.kind === "display") { Object.assign(overlay, { origin: m.origin, display: m.display, visible: m.visible }); placeClose(); fire("display", overlay); }
      else if (m.kind === "elements") {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p?.reject(new Error(m.error)); else p?.resolve(m.result);
      }
    },
  };
  window.overlay = overlay;
  document.documentElement.dataset.overlay = "";
  const style = document.createElement("style");
  style.textContent = "html,body{background:transparent!important}";
  document.documentElement.appendChild(style);

  // The ✕: bottom-right of the visible area, always there, closes the overlay.
  const closeHost = document.createElement("div");
  closeHost.dataset.overlayHit = "";
  closeHost.style.cssText = "position:fixed;z-index:2147483647;margin:0;padding:0";
  const shadow = closeHost.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>button{all:unset;cursor:pointer;display:flex;gap:6px;align-items:center;font:500 12px -apple-system,system-ui,sans-serif;color:#e8e8ea;background:rgba(28,28,32,.88);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:5px 11px 5px 9px;box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button:hover{background:rgba(190,40,40,.92)}b{font-weight:700}</style><button title="Close this overlay"><b>✕</b><span></span></button>`;
  shadow.querySelector("span").textContent = init.title;
  shadow.querySelector("button").addEventListener("click", () => overlay.close());
  function placeClose() {
    const v = overlay.visible;
    closeHost.style.left = "auto";
    closeHost.style.top = "auto";
    closeHost.style.right = `${Math.max(0, window.innerWidth - (v.x + v.width)) + 12}px`;
    closeHost.style.bottom = `${Math.max(0, window.innerHeight - (v.y + v.height)) + 12}px`;
  }
  const mount = () => { if (init.close !== false) document.documentElement.appendChild(closeHost); placeClose(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  addEventListener("resize", placeClose);

  // Hit regions: the host takes clicks only over these, everything else passes through to the apps below.
  // shortcut: polls every frame; switch to Resize/MutationObservers if a page has thousands of hit elements.
  let last = "";
  const report = () => {
    const rects = [...document.querySelectorAll("[data-overlay-hit]")]
      .filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      .map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })
      .filter((r) => r[2] > 0 && r[3] > 0);
    // Iframes in hit regions: focus inside one (another origin) never reaches this page, so the host takes the keyboard on a click there.
    const keys = [...document.querySelectorAll("[data-overlay-hit] iframe, iframe[data-overlay-hit]")]
      .filter((el) => el.checkVisibility())
      .map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    const key = JSON.stringify([rects, keys]);
    if (key !== last) { last = key; post({ kind: "hits", rects, keys }); }
    requestAnimationFrame(report);
  };
  requestAnimationFrame(report);

  // Typing: a focused text field takes key focus (the app below stays active); Esc gives it back (the host catches Esc).
  const typing = (el) => el instanceof HTMLElement && (el.matches("input:not([type=button],[type=checkbox],[type=radio],[type=submit],[type=range]),textarea,select") || el.isContentEditable);
  // Only right after a click: a page focusing a field by itself (autofocus, a select on load) must not take the keyboard from your app.
  let pressed = 0;
  addEventListener("pointerdown", () => (pressed = Date.now()), true);
  // Only the field that took the keyboard gives it back: a field losing focus to an iframe (which took it on the click) must not.
  let holder = null;
  addEventListener("focusin", (e) => { if (typing(e.target) && Date.now() - pressed < 1000) (holder = e.target), post({ kind: "key", on: true }); }, true);
  addEventListener("focusout", (e) => { if (e.target === holder) (holder = null), post({ kind: "key", on: false }); }, true);
  // An overlay has no console in sight: page errors go to the overlay's log.
  addEventListener("error", (e) => post({ kind: "pageError", message: `${e.message} (${e.filename}:${e.lineno})` }));
  addEventListener("unhandledrejection", (e) => post({ kind: "pageError", message: String(e.reason?.stack ?? e.reason) }));
  post({ kind: "hello" });
})();
