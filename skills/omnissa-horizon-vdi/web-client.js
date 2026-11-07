// Keyboard, mouse and screen helpers for a remote desktop shown in a browser tab.
// Inject once per page load; a reload wipes them.
// Defines window.vdi = { type, combo, paste, shot, click, watch, unwatch }. The keyboard three send to Horizon's hidden
// #clipboard-input textarea when present, else to the focused element.
//
//   await vdi.type('Hello, World!\n')   // ASCII only, ~50 WPM
//   await vdi.combo('ctrl+t')           // modifiers: ctrl, shift, alt; key: letter, enter, tab, escape
//   await vdi.paste('long or non-ASCII text')  // never touches the Mac clipboard
//   const s = await vdi.shot()          // { file, size }: guest screen as a PNG in ~/Downloads, no screenshot tokens
//   await vdi.click(x, y, s.size)       // canvas pixels from OCR on that shot; throws if the guest resized since
//   vdi.watch()  /  vdi.unwatch()       // a shot every 3 s for vdi-watch.sh to wait on; stops itself after 30 min
(() => {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const target = () => document.querySelector('#clipboard-input') || document.activeElement || document.body;
  const fire = (t, type, init) =>
    t.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }));

  const SHIFTED = '~!@#$%^&*()_+{}|:"<>?';
  const BASE = '`1234567890-=[]\\;\',./'; // unshifted key for each SHIFTED char, same index
  const CODE = { ' ': 'Space', '\n': 'Enter', '\t': 'Tab', '`': 'Backquote', '-': 'Minus', '=': 'Equal',
    '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote',
    ',': 'Comma', '.': 'Period', '/': 'Slash' };
  const KEYCODE = { '\n': 13, '\t': 9, ' ': 32, '`': 192, '-': 189, '=': 187, '[': 219, ']': 221,
    '\\': 220, ';': 186, "'": 222, ',': 188, '.': 190, '/': 191 };
  const MOD = { ctrl: ['Control', 'ControlLeft', 17, 'ctrlKey'], shift: ['Shift', 'ShiftLeft', 16, 'shiftKey'],
    alt: ['Alt', 'AltLeft', 18, 'altKey'] };
  const SHIFT = { key: 'Shift', code: 'ShiftLeft', keyCode: 16, which: 16 };

  async function type(text, { min = 45, max = 160, pauseEvery = [6, 14], pauseMs = [250, 700] } = {}) {
    const bad = [...text].find((ch) => ch.charCodeAt(0) > 126);
    if (bad) throw new Error(`non-ASCII ${JSON.stringify(bad)}: use vdi.paste`);
    const t = target();
    let n = 0, next = Math.round(rnd(...pauseEvery));
    for (const ch of text) {
      let base = ch, shift = /[A-Z]/.test(ch);
      const si = SHIFTED.indexOf(ch);
      if (si >= 0) { base = BASE[si]; shift = true; }
      const lower = base.toLowerCase();
      const key = ch === '\n' ? 'Enter' : ch === '\t' ? 'Tab' : ch;
      const code = /[a-z]/.test(lower) ? 'Key' + lower.toUpperCase() : /[0-9]/.test(lower) ? 'Digit' + lower : CODE[lower];
      const keyCode = KEYCODE[lower] ?? lower.toUpperCase().charCodeAt(0);
      if (shift) { fire(t, 'keydown', { ...SHIFT, shiftKey: true }); await sleep(rnd(20, 60)); }
      fire(t, 'keydown', { key, code, keyCode, which: keyCode, shiftKey: shift });
      if (key.length === 1) {
        const cc = ch.charCodeAt(0);
        fire(t, 'keypress', { key, code, keyCode: cc, charCode: cc, which: cc, shiftKey: shift });
      }
      await sleep(rnd(30, 90));
      fire(t, 'keyup', { key, code, keyCode, which: keyCode, shiftKey: shift });
      if (shift) { await sleep(rnd(10, 40)); fire(t, 'keyup', SHIFT); }
      if (++n >= next) { n = 0; next = Math.round(rnd(...pauseEvery)); await sleep(rnd(...pauseMs)); }
      else await sleep(rnd(min, max));
    }
    return text.length;
  }

  async function combo(spec) {
    const parts = spec.toLowerCase().split('+');
    const k = parts.pop();
    const mods = parts.map((m) => { if (!MOD[m]) throw new Error(`unknown modifier ${m}`); return MOD[m]; });
    const t = target(), flags = {};
    for (const [key, code, kc, flag] of mods) {
      flags[flag] = true;
      fire(t, 'keydown', { key, code, keyCode: kc, which: kc, ...flags });
      await sleep(rnd(30, 80));
    }
    const named = { enter: ['Enter', 13], tab: ['Tab', 9], escape: ['Escape', 27] }[k];
    const key = named ? named[0] : k, code = named ? named[0] : 'Key' + k.toUpperCase();
    const kc = named ? named[1] : k.toUpperCase().charCodeAt(0);
    fire(t, 'keydown', { key, code, keyCode: kc, which: kc, ...flags });
    await sleep(rnd(40, 90));
    fire(t, 'keyup', { key, code, keyCode: kc, which: kc, ...flags });
    for (const [key2, code2, kc2, flag] of mods.reverse()) {
      await sleep(rnd(20, 60));
      delete flags[flag];
      fire(t, 'keyup', { key: key2, code: code2, keyCode: kc2, which: kc2, ...flags });
    }
  }

  // Hands the text to the client's clipboard sync, then pastes it in the guest with Ctrl+V.
  async function paste(text) {
    const t = document.querySelector('#clipboard-input');
    if (!t) throw new Error('#clipboard-input missing: this client needs another paste route');
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(rnd(300, 600));
    await combo('ctrl+v');
    return text.length;
  }

  // Horizon draws the guest on one 2D canvas; shot() and click() work in its pixel space.
  const canvas = () => {
    const c = document.querySelector('#mainCanvas');
    if (!c) throw new Error('#mainCanvas missing: use the computer screenshot and click actions');
    return c;
  };

  // Chrome's "started debugging this browser" bar comes and goes with each attach, the page height
  // changes, and Horizon resizes the guest to match. Wait until the canvas size holds still.
  async function settle(ms = 800) {
    let last = '', since = Date.now();
    while (Date.now() - since < ms) {
      const c = canvas(), now = `${c.width}x${c.height}`;
      if (now !== last) { last = now; since = Date.now(); }
      await sleep(100);
    }
    return last;
  }

  // Downloads the canvas as vdi-shot-<ms>.png and returns that file name.
  async function save() {
    const blob = await new Promise((r) => canvas().toBlob(r, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vdi-shot-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return a.download;
  }

  // Saves the guest screen as a full-resolution PNG to the browser's download folder.
  // Returns { file, size }; pass size to click() so a resize in between is caught.
  async function shot() {
    const size = await settle();
    return { file: await save(), size };
  }

  // Downloads a frame every `every` ms for vdi-watch.sh to judge, until unwatch() or `max` ms.
  // The tick comes from a worker: Chrome slows a hidden tab's own timers to about one a minute after
  // 5 minutes, but not a worker's. No settle(), whose timers would stall the same way; watching never clicks.
  let ticker = null;
  function watch({ every = 3000, max = 30 * 60e3 } = {}) {
    unwatch();
    const until = Date.now() + max;
    let busy = false;
    const src = `setInterval(() => postMessage(0), ${every})`;
    ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    ticker.onmessage = async () => {
      if (Date.now() > until) return unwatch();
      if (busy) return;
      busy = true;
      try { await save(); } finally { busy = false; }
    };
    return { every, until: new Date(until).toLocaleTimeString() };
  }
  function unwatch() { ticker?.terminate(); ticker = null; }

  // Clicks at canvas pixels (x, y), the coordinates OCR reports on a shot() of the given size.
  async function click(x, y, size) {
    const now = await settle();
    if (size && size !== now) throw new Error(`guest resized ${size} -> ${now}: take a new shot()`);
    const c = canvas(), r = c.getBoundingClientRect();
    const cx = r.left + (x * r.width) / c.width, cy = r.top + (y * r.height) / c.height;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0, view: window };
    const ptr = { pointerType: 'mouse', isPrimary: true };
    c.dispatchEvent(new PointerEvent('pointermove', { ...base, ...ptr, buttons: 0 }));
    c.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 0 }));
    await sleep(rnd(60, 140));
    c.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...ptr, buttons: 1 }));
    c.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    await sleep(rnd(60, 120));
    c.dispatchEvent(new PointerEvent('pointerup', { ...base, ...ptr, buttons: 0 }));
    c.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    c.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
  }

  window.vdi = { type, combo, paste, shot, click, watch, unwatch };
  return Object.keys(window.vdi);
})();
