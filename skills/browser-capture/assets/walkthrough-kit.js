/*
 * walkthrough-kit.js — the in-page visual layer for a recorded browser walkthrough.
 *
 * Defines window.__wt with a small API. It does NOT run a flow by itself — you drive it,
 * either from Node via scripts/record-flow.js (page.evaluate) or by pasting this into a
 * DevTools console and calling __wt.* yourself.
 *
 * WHY: a recording has no click annotations of its own. The cursor, the highlight box and
 * the click pulse ARE the narration — without them a viewer cannot tell what was clicked
 * or when, and the video reads as things randomly happening.
 *
 * API (all promises where they take time):
 *   __wt.focusAndClick(hlEl, clickEl?)  frame hlEl, glide to clickEl, pulse, click
 *   __wt.highlight(el) / __wt.hideBox()
 *   __wt.moveTo(x, y, dur) / __wt.sleep(ms)
 *   __wt.waitFor(fn, timeout?)          poll until fn() returns truthy, returns it
 *   __wt.realClick(el)                  framework-safe click at the element's centre
 *   __wt.CFG                            timings: { glide, hold, afterClick }
 */
(() => {
  const CFG = { glide: 950, hold: 550, afterClick: 1300 };

  // The overlay is built LAZILY, on first use. This matters: the recorder injects this kit
  // with page.evaluateOnNewDocument so it survives cross-document navigation, and that runs
  // at document-start — when document.body is still null. Touching body at top level would
  // throw here and window.__wt would never get defined at all, on any page.
  let cur = null, box = null;
  function ensureOverlay() {
    if (cur && cur.isConnected && box && box.isConnected) return true;
    if (!document.body) return false; // too early; caller will retry
    cur = document.getElementById('__wt_cur');
    box = document.getElementById('__wt_box');
    if (!cur) {
      cur = document.createElement('div');
      cur.id = '__wt_cur';
      cur.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))';
      cur.innerHTML = '<svg width="30" height="30" viewBox="0 0 26 26"><path d="M3 2 L3 20 L8 15 L11 22 L14.5 20.5 L11.5 14 L18 14 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.body.appendChild(cur);
    }
    if (!box) {
      box = document.createElement('div');
      box.id = '__wt_box';
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
      if (Date.now() - t0 > timeout) throw new Error('__wt: no document.body');
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

  window.__wt = { CFG, ready, focusAndClick, highlight, hideBox, moveTo, sleep, waitFor, realClick, clickPulse, smoothScrollTo };
  return '__wt ready';
})();
