/*
 * ui-narration.js — the in-page visual layer that makes a browser interaction legible.
 *
 * Defines window.__narrate with a small API. It does NOT run a flow by itself — you drive it,
 * either from Node via a recorder's page.evaluate, from Chrome MCP's javascript_tool, or by
 * pasting it into a DevTools console and calling __narrate.* yourself.
 *
 * WHY: a browser has no click annotations of its own. The cursor, the highlight box and
 * the click pulse ARE the narration — without them a viewer cannot tell what was clicked
 * or when, and the interaction reads as things randomly happening. That is true whether
 * you are recording it, or a human is watching it live.
 *
 * API (all promises where they take time):
 *   __narrate.focusAndClick(hlEl, clickEl?)  frame hlEl, glide to clickEl, pulse, click
 *   __narrate.highlight(el) / __narrate.hideBox()
 *   __narrate.moveTo(x, y, dur) / __narrate.sleep(ms)
 *   __narrate.waitFor(fn, timeout?)          poll until fn() returns truthy, returns it
 *   __narrate.realClick(el)                  framework-safe click at the element's centre
 *   __narrate.CFG                            timings: { glide, hold, afterClick }
 */
(() => {
  const CFG = { glide: 950, hold: 550, afterClick: 1300 };

  // The overlay is built LAZILY, on first use. This matters: the recorder injects this kit
  // with page.evaluateOnNewDocument so it survives cross-document navigation, and that runs
  // at document-start — when document.body is still null. Touching body at top level would
  // throw here and window.__narrate would never get defined at all, on any page.
  let cur = null, box = null;
  function ensureOverlay() {
    if (cur && cur.isConnected && box && box.isConnected) return true;
    if (!document.body) return false; // too early; caller will retry
    cur = document.getElementById('__narrate_cur');
    box = document.getElementById('__narrate_box');
    if (!cur) {
      cur = document.createElement('div');
      cur.id = '__narrate_cur';
      cur.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))';
      cur.innerHTML = '<svg width="30" height="30" viewBox="0 0 26 26"><path d="M3 2 L3 20 L8 15 L11 22 L14.5 20.5 L11.5 14 L18 14 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.body.appendChild(cur);
    }
    if (!box) {
      box = document.createElement('div');
      box.id = '__narrate_box';
      // No opacity transition on purpose: the box must vanish INSTANTLY on click, or it ghosts
      // onto the next page for a frame or two and reads as a rendering bug.
      box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;opacity:0;border:3px solid #ff7a00;border-radius:14px;background:rgba(255,122,0,.10);box-shadow:0 0 0 3px rgba(255,122,0,.25),0 0 18px 2px rgba(255,122,0,.45)';
      document.body.appendChild(box);
    }
    setCur(cx, cy);
    return true;
  }
  // After a navigation the cursor should re-appear where it left off, so the glide reads as
  // continuous across pages rather than teleporting back to a corner.
  async function ready(timeout = 8000) {
    const t0 = Date.now();
    while (!ensureOverlay()) {
      if (Date.now() - t0 > timeout) throw new Error('__narrate: no document.body');
      await new Promise(r => setTimeout(r, 30));
    }
  }

  let cx = 120, cy = 120;
  const setCur = (x, y) => { if (cur) { cur.style.left = (x - 4) + 'px'; cur.style.top = (y - 2) + 'px'; } };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // Step with setTimeout, NOT requestAnimationFrame: rAF is throttled or paused in
  // headless and background tabs — exactly where this runs — so an rAF tween silently
  // stalls. Also don't use a CSS transition: it lags behind what it's chasing, so the
  // cursor and its ring visibly drift apart mid-glide.
  async function moveTo(tx, ty, dur = CFG.glide) {
    await ready();
    const sx = cx, sy = cy, t0 = performance.now();
    return new Promise((res) => {
      (function step() {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = easeInOut(k);
        cx = sx + (tx - sx) * e; cy = sy + (ty - sy) * e;
        setCur(cx, cy);
        k < 1 ? setTimeout(step, 16) : res();
      })();
    });
  }

  function highlight(el) {
    if (!ensureOverlay()) return;
    const r = el.getBoundingClientRect(), p = 8;
    box.style.left = (r.left - p) + 'px'; box.style.top = (r.top - p) + 'px';
    box.style.width = (r.width + 2 * p) + 'px'; box.style.height = (r.height + 2 * p) + 'px';
    const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12;
    box.style.borderRadius = (br + p) + 'px'; box.style.opacity = 1;
  }
  const hideBox = () => { if (box) box.style.opacity = 0; };

  // Click feedback fired at the exact instant of the click, so the timing is unmistakable.
  // Without it a viewer can't tell when the click landed and the video feels floaty.
  function clickPulse(x, y) {
    if (!document.body) return;
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;left:' + x + 'px;top:' + y + 'px;width:0;height:0;border-radius:50%;border:3px solid #ff7a00;transform:translate(-50%,-50%);opacity:.95';
    document.body.appendChild(ring);
    const t0 = performance.now(), dur = 420, maxR = 44;
    (function step() {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const d = 2 * (maxR * k);
      ring.style.width = d + 'px'; ring.style.height = d + 'px';
      ring.style.opacity = (0.95 * (1 - k)).toFixed(3);
      k < 1 ? setTimeout(step, 16) : ring.remove();
    })();
  }
  function cursorPress() {
    if (!cur) return;
    cur.style.transformOrigin = '4px 2px'; // near the arrow tip, so it dips where it points
    cur.style.transition = 'transform .09s ease-out';
    cur.style.transform = 'scale(0.7)';
    setTimeout(() => { cur.style.transform = 'scale(1)'; }, 110);
  }

  // Dispatch the full pointer/mouse sequence on whatever is topmost at the target's centre.
  // Component libraries (Joy/Material UI, Radix, …) nest the real interactive node inside
  // the element you matched, so a bare el.click() on the wrapper often does nothing at all.
  function realClick(el) {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y) || el;
    for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      hit.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    }
  }

  // Never assume the next page is ready — an early click is the most common way a take breaks.
  function waitFor(fn, timeout = 8000) {
    const t0 = performance.now();
    return new Promise((res, rej) => {
      (function poll() {
        const el = fn();
        if (el) return res(el);
        if (performance.now() - t0 > timeout) return rej(new Error('waitFor timeout'));
        setTimeout(poll, 120);
      })();
    });
  }

  // The main verb. Highlight hlEl but aim the cursor/click at clickEl — that split matters
  // more than it sounds: you often want to frame a whole card while clicking its title,
  // because the card's centre sits over some other control (an avatar, a menu).
  async function focusAndClick(hlEl, clickEl = hlEl) {
    await ready();
    const cr = clickEl.getBoundingClientRect();
    const x = cr.left + cr.width / 2, y = cr.top + cr.height / 2;
    highlight(hlEl);
    await moveTo(x, y, CFG.glide);
    await sleep(CFG.hold);
    hideBox();            // instant, BEFORE the click, so it can't ghost onto the next page
    clickPulse(x, y);
    cursorPress();
    realClick(clickEl);
    await sleep(CFG.afterClick);
  }

  // Smooth scroll — the thing a GIF recorder can never capture, and the cheapest way to
  // make a recording feel like a video rather than a slideshow.
  async function smoothScrollTo(targetY, dur = 1200) {
    await ready();
    const startY = window.scrollY, t0 = performance.now();
    return new Promise((res) => {
      (function step() {
        const k = Math.min(1, (performance.now() - t0) / dur);
        window.scrollTo(0, startY + (targetY - startY) * easeInOut(k));
        k < 1 ? setTimeout(step, 16) : res();
      })();
    });
  }

  // Drag, with the cursor riding the dragged element's LIVE rect rather than the straight
  // line from start to end. That distinction only shows up on curved gestures — a rotate
  // handle travels an ARC, and interpolating leaves the cursor visibly detached from the
  // thing it is supposed to be holding (chord-vs-arc error is about 0.29 x radius).
  //
  // pointerdown goes on the element; pointermove/up go on WINDOW, because that is where
  // drag implementations listen once a gesture has started.
  //
  // AIM ALONG THE ELEMENT'S OWN AXIS, not the screen's. A handle labelled "right edge"
  // is named in its element's frame: rotate that element 90 degrees and its "right edge"
  // sits at the BOTTOM, so dragging screen-right slides along the edge and resizes by
  // exactly zero pixels. Push away from the element's centre instead:
  //   const v = {x: hx - cx, y: hy - cy}, L = Math.hypot(v.x, v.y) || 1;
  //   await drag(handle, v.x / L * D, v.y / L * D);
  async function drag(el, dx, dy, { steps = 30, settle = 600, stepMs = 24 } = {}) {
    await ready();
    const r = el.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const ev = (type, x, y, target) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    }));
    await moveTo(x0, y0, 500);
    await sleep(200);
    ev('pointerdown', x0, y0, el);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, x = x0 + dx * k, y = y0 + dy * k;
      ev('pointermove', x, y, window);
      const live = el.isConnected ? el.getBoundingClientRect() : null;
      if (live && live.width) { cx = live.left + live.width / 2; cy = live.top + live.height / 2; setCur(cx, cy); }
      else { cx = x; cy = y; setCur(x, y); }
      await sleep(stepMs);
    }
    ev('pointerup', x0 + dx, y0 + dy, window);
    await sleep(settle);
  }

  // Type into a React controlled input, character by character. The native value setter has
  // to come from the RIGHT prototype: an <input> setter applied to a <textarea> is silently
  // ignored and the text snaps back on the next render, with no error anywhere.
  async function typeInto(el, text, per = 45) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    el.focus();
    set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of text) {
      set.call(el, el.value + ch);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(per);
    }
  }

  // Two white frames. Fire one immediately before the choreography and one immediately
  // after, so ffmpeg can find both ends of the action later. Do NOT rely on it as the sole
  // trim marker on a white-background app — the flash barely differs from the page. Pair it
  // with the recorder's own clock (`__cap.t0`) and use freezedetect only to cross-check.
  async function clap() {
    if (!document.body) return;
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;pointer-events:none';
    document.body.appendChild(f);
    await sleep(90);
    f.remove();
    await sleep(120);
  }


  // ---- Textual narration -------------------------------------------------
  // A caption is an INDEPENDENT primitive, deliberately not an argument to
  // focusAndClick: an agent composes cursor-only, caption-only, or both. say()
  // returns immediately unless you pass {hold}, so it layers over the existing
  // glide/hold/afterClick pacing instead of fighting it.
  //
  // Cues are logged even when captions are switched OFF. That is the point: one
  // run can ship burned-in captions OR a clean video plus a .vtt sidecar, and the
  // sidecar is complete either way. vtt() emits the file; the recorder writes it.
  let capEl = null, capOn = true, capT0 = null;
  const cues = [];

  function ensureCaption() {
    if (capEl) return capEl;
    capEl = document.createElement('div');
    capEl.setAttribute('data-ui-narration', 'caption');
    capEl.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:6%', 'transform:translateX(-50%)',
      'z-index:2147483646', 'pointer-events:none', 'max-width:min(80vw,900px)',
      'padding:12px 20px', 'border-radius:10px',
      'background:rgba(12,14,20,.86)', 'color:#f2f5fb',
      'font:500 20px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif',
      'text-align:center', 'text-wrap:balance',
      'box-shadow:0 6px 28px rgba(0,0,0,.45)',
      'opacity:0', 'transition:opacity .18s ease',
    ].join(';');
    document.body.appendChild(capEl);
    return capEl;
  }

  // at: omit for the subtitle band; pass an element to anchor the caption above it
  // (falls below if there is no room up top).
  function placeCaption(el, at) {
    if (!at) {
      el.style.left = '50%'; el.style.bottom = '6%';
      el.style.top = 'auto'; el.style.transform = 'translateX(-50%)';
      return;
    }
    const r = at.getBoundingClientRect();
    const above = r.top > 90;
    el.style.transform = 'translateX(-50%)';
    el.style.left = Math.round(r.left + r.width / 2) + 'px';
    el.style.bottom = 'auto';
    el.style.top = Math.round(above ? r.top - 58 : r.bottom + 18) + 'px';
  }

  async function say(text, { at = null, hold = 0 } = {}) {
    if (capT0 === null) capT0 = performance.now();
    if (text) cues.push({ t: performance.now() - capT0, text: String(text) });
    const el = ensureCaption();
    if (!text) { el.style.opacity = 0; return; }
    el.textContent = text;
    placeCaption(el, at);
    el.style.opacity = capOn ? 1 : 0;
    if (hold) await sleep(hold);
  }

  const captions = (on) => { capOn = !!on; if (capEl) capEl.style.opacity = capOn && capEl.textContent ? 1 : 0; };
  const captionsT0 = (ms) => { capT0 = (ms === undefined ? performance.now() : ms); };

  const vttTime = (ms) => {
    const t = Math.max(0, ms), h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60;
    const sec = Math.floor(t / 1000) % 60, msr = Math.floor(t) % 1000;
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(sec)}.${p(msr, 3)}`;
  };

  // A cue runs until the NEXT cue starts, capped at 6s. Cues must not overlap —
  // clamping every cue to a 900ms minimum did exactly that when two say() calls
  // landed close together. The minimum only applies to the last cue, which has no
  // successor to bound it.
  function vtt() {
    if (!cues.length) return 'WEBVTT\n';
    const out = ['WEBVTT', ''];
    cues.forEach((c, i) => {
      const next = cues[i + 1];
      const end = next ? Math.min(next.t, c.t + 6000)
                       : c.t + Math.max(900, Math.min(6000, 60 * String(c.text).length));
      out.push(`${i + 1}`, `${vttTime(c.t)} --> ${vttTime(end)}`, c.text, '');
    });
    return out.join('\n');
  }

  window.__narrate = { CFG, ready, focusAndClick, highlight, hideBox, moveTo, sleep, waitFor, realClick,
                  clickPulse, smoothScrollTo, drag, typeInto, clap,
                  say, captions, captionsT0, vtt, cues };
  return '__narrate ready';
})();
