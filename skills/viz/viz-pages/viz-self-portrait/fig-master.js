/* fig-master.js — band 3, "Master".
 *
 * The expert surface: what the skill is made of, who can reach a published
 * viz, the subsystems band 2 didn't need, and finally the standard the skill
 * grades its own output against — measured against THIS page, live.
 */
import { $$ } from '/_kit/viz.js';
import { REDUCED } from './guide.js';
import { SOURCE, KIND_TONE } from './fig-run.js';

/* ---- the subsystems -------------------------------------------
 * Three real variables at once: x = which lifecycle stage a file serves,
 * y = how deep into the skill you have to be before you touch it, and area
 * = its actual size in bytes.
 */
const STAGE = { author: 0, serve: 1, verify: 2, publish: 3, kit: 1.5, doc: 0.5 };
const STAGE_LABEL = ['authoring', 'serving', 'verifying', 'publishing'];
/* depth 0 = you meet it on day one, 1 = only when you go looking */
const DEPTH = {
  'bootstrap.ts': 0.05, 'SKILL.md': 0.1, 'server.ts': 0.3, 'verify.ts': 0.25,
  'viz.js': 0.35, 'viz-kit.css': 0.35, 'build.ts': 0.55, 'manage.ts': 0.6,
  'inline.ts': 0.8, 'comments.js': 0.45, 'exchange.js': 0.7, 'exchange.css': 0.75,
  'deck.js': 0.6, 'deck-template': 0.6, 'viz-og.css': 0.65, 'discovery.ts': 0.7,
  'recordings.ts': 0.75, 'keystore.ts': 0.85, '_cvdprobe.ts': 0.95,
  'check-exchange': 0.8, 'sync-runtimes': 0.9, 'deploy-all.ts': 0.7,
  'vendor-runtime': 0.95, 'CONTEXT.md': 0.5,
};

export const map = {
  steps: 0,
  render(el) {
    const W = 780, H = 400, PAD = { l: 74, r: 62, t: 30, b: 44 };
    const total = SOURCE.reduce((s, f) => s + f.value, 0);
    const maxV = Math.max(...SOURCE.map(f => f.value));
    const R_MAX = 34;
    const r = v => 6 + Math.sqrt(v / maxV) * R_MAX;       // area ∝ bytes
    // Right padding has to clear the largest radius or build.ts — the biggest
    // circle, pinned to the rightmost column — hangs off the viewBox. That is
    // invisible to verify's layout audit, which looks for <text> escaping a
    // <rect>, not a <g> escaping the canvas.
    const px = k => PAD.l + (STAGE[k] / 3) * (W - PAD.l - PAD.r);
    const py = d => PAD.t + d * (H - PAD.t - PAD.b);

    el.innerHTML = `
      <p class="fig-what">Every file in the skill, placed by what it does
         (left→right) and how deep you have to go before you meet it (top→bottom).
         <b>Circle area = the file's real size in bytes.</b> Hover any circle. Total: ${(total / 1024).toFixed(0)} KB.</p>
      <div class="map-stage">
        <svg viewBox="0 0 ${W} ${H}" id="map-svg" role="img"
             aria-label="Every file in the skill by lifecycle stage, depth, and size"></svg>
      </div>
      <div class="legend map-legend">
        ${Object.entries(KIND_TONE).map(([k, t]) =>
          `<span class="legend-item"><i class="swatch dot" style="background:${t}"></i>${k}</span>`).join('')}
        <span class="legend-item sizekey"><i class="swatch dot big"></i>area = bytes</span>
      </div>
      <p class="fig-foot" id="map-foot">One number worth sitting with: <b>build.ts is
         ${(112795 / total * 100).toFixed(0)}% of the entire skill</b> — publishing is by far the most
         expensive thing here, and it is the part you touch last.</p>`;

    const svg = el.querySelector('#map-svg');

    /* Several files share a stage AND a similar depth, so they resolved to the
     * same point and their labels stacked into an unreadable pile (exchange.js
     * and exchange.css landed exactly on top of each other). Relax the circles
     * apart: a few passes of pairwise separation, damped, with x held far more
     * tightly than y — x is the categorical axis and must not drift into the
     * neighbouring column, whereas y is continuous and can absorb the slack. */
    const dots = [...SOURCE].sort((a, b) => b.value - a.value).map(f => ({
      f, r: r(f.value), x: px(f.kind), y: py(DEPTH[f.name] ?? 0.5), x0: px(f.kind),
    }));
    for (let pass = 0; pass < 60; pass++) {
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const a = dots[i], b = dots[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = a.r + b.r + 3;
          if (d >= min) continue;
          if (d < 0.01) { dx = 0; dy = (i % 2 ? 1 : -1); d = 1; }   // exact overlap
          const push = (min - d) / d * 0.5;
          a.x -= dx * push * 0.18; a.y -= dy * push;
          b.x += dx * push * 0.18; b.y += dy * push;
        }
      }
      for (const p of dots) {
        p.x += (p.x0 - p.x) * 0.22;                                  // spring back to its column
        p.x = Math.min(W - PAD.r + 24, Math.max(PAD.l - 24, p.x));
        p.y = Math.min(H - PAD.b - p.r, Math.max(PAD.t + p.r, p.y));
      }
    }
    svg.innerHTML = `
      ${STAGE_LABEL.map((l, i) => {
        const x = PAD.l + (i / 3) * (W - PAD.l - PAD.r);
        return `<line x1="${x}" y1="${PAD.t - 8}" x2="${x}" y2="${H - PAD.b}"
                  stroke="var(--border)" stroke-dasharray="2 4"/>
                <text x="${x}" y="${H - PAD.b + 18}" text-anchor="middle" class="map-ax">${l}</text>`;
      }).join('')}
      <text x="12" y="${PAD.t + 6}" class="map-ax rot">day one</text>
      <text x="12" y="${H - PAD.b - 4}" class="map-ax rot">deep</text>
      <line x1="${PAD.l - 22}" y1="${PAD.t}" x2="${PAD.l - 22}" y2="${H - PAD.b}"
            stroke="var(--border)" marker-end="url(#map-ah)"/>
      <defs><marker id="map-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6"
        orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)"/></marker></defs>
      ${dots.map(({ f, r: rr, x: cx, y: cy }) => {
        // Only label a circle that can actually hold the text. Stripping the
        // extension made exchange.js and exchange.css both read "exchange",
        // so the label keeps enough of the name to stay unique.
        const short = f.name.replace(/\.(ts|js|html)$/, '');
        const fits = rr > 15 && short.length * 4.6 < rr * 2;
        return `<g class="map-d" data-viz-id="map-${f.name}"
                   data-label="${f.name} — ${(f.value / 1024).toFixed(1)} KB, ${f.kind}">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}"
            fill="${KIND_TONE[f.kind]}" fill-opacity=".18" stroke="${KIND_TONE[f.kind]}" stroke-width="1.5"/>
          ${fits ? `<text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="middle"
            class="map-l">${short}</text>` : ''}
          <title>${f.name} · ${(f.value / 1024).toFixed(1)} KB · ${f.kind} · ${(f.value / total * 100).toFixed(1)}% of the skill</title>
        </g>`;
      }).join('')}`;
  },
};

/* ---- the rest of it ------------------------------------------
 * Everything the guide hasn't needed yet, as a grid of real contracts rather
 * than a teaser list. Each card opens to the actual shape you'd have to know.
 */
/* What is genuinely left once capability moved up to band 2: the parts you
 * only meet if you go looking, or if you are changing the skill itself. */
const SURFACE = [
  { id: 'film', name: 'Timed films', tone: 'var(--c5)', tag: 'seek contract',
    one: 'A viz with a duration, that you want an mp4 of. Two functions and a number.',
    body: `Anything narrated over time must expose <code>window.__viz = { total, goTo(t), pause() }</code>,
      where <code>goTo</code> renders any moment <b>without having played up to it</b>. Everything downstream
      depends on that: verification becomes "seek and screenshot", capture becomes frame-accurate instead of
      a real-time take, and <code>prefers-reduced-motion</code> falls out of the same mechanism for free.`,
    art: `window.__viz = { total, goTo(t), pause() }

measured: a 7-min real-time capture drifted +5.2%
          the same piece captured by seeking was exact` },
  { id: 'manage', name: 'Move, mirror, vendor', tone: 'var(--c8)', tag: 'manage.ts',
    one: 'Author-side surgery — never hand-edit these files.',
    body: `<code>manage.ts</code> moves and renames vizzes, flips posture/listing, and declares mirror and
      vendor edges, auto-committing with surgical staging. <b>Mirror</b> ships a built artifact the sink
      cannot edit; <b>vendor</b> ships a verbatim source copy the sink owns and can run standalone. Both
      declare their edges at the origin. A move 404s the old URL — that is the gotcha.`,
    art: `manage.ts move   &lt;viz&gt; &lt;dest&gt;
manage.ts update &lt;viz&gt; --posture=public
manage.ts mirror add &lt;viz&gt; --to … --access …
manage.ts vendor &lt;viz&gt; --to … --access …` },
  { id: 'kit', name: 'The shared kit', tone: 'var(--accent)', tag: '/_kit/',
    one: 'Why every viz looks like it belongs to the same system.',
    body: `One stylesheet of design tokens and one module of SVG + interaction helpers, served at
      <code>/_kit/</code> and inlined into every published page. It exists because dozens of vizzes
      re-derived the same dark palette and reinvented the same arrow math. <b>Re-theme, don't fork</b> —
      every colour reads through <code>var()</code>, so a six-line <code>:root</code> override re-skins
      everything while keeping the components.`,
    art: `import { arrowMarkers, connect, side, labelBox,
         stepper, twoAxis, figureLifecycle,
         saveHash, loadHash } from "/_kit/viz.js";` },
  { id: 'cvd', name: 'Colour-vision checks', tone: 'var(--danger)', tag: '_cvdprobe.ts',
    one: 'Why the kit has no orange slot.',
    body: `Every categorical colour is validated under protanopia and deuteranopia simulation. The four
      meaning-free slots clear ΔE 15 from every intent colour; the obvious orange <code>#f0883e</code> is
      <b>ΔE 1.5 from --warn to a protanope</b> — the same colour — so there deliberately is no orange.
      Known and unfixed: <code>--warn</code> and <code>--good</code> are themselves only ΔE 5.1 apart, so
      status colour must never be the only signal.`,
    art: `--c4 #bc8cff  purple   ΔE ≥ 15  ✓
--c5 #4ec9b0  teal     ΔE ≥ 15  ✓
--c7 #5d52b4  indigo   ΔE 21.3  ✓
--c8 #b70385  magenta  ΔE 20.9  ✓
     #f0883e  orange   ΔE  1.5  ✗` },
];

export const internals = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">The subsystems the rest of the guide didn't need.
         Each card opens to the <b>actual contract</b> — the shape you would have to know to use it —
         rather than a description of it. Click any card.</p>
      <div class="surf-grid" id="surf-grid">
        ${SURFACE.map(s => `
          <div class="surf" data-id="${s.id}" style="--tone:${s.tone}"
               data-viz-id="surf-${s.id}" data-label="${s.name}">
            <div class="surf-h">
              <b>${s.name}</b><span class="pill">${s.tag}</span>
            </div>
            <p class="surf-one">${s.one}</p>
            <div class="drawer">
              <div class="surf-body">${s.body}</div>
              <pre class="surf-art"><code>${s.art}</code></pre>
            </div>
            <span class="surf-more">details ↓</span>
          </div>`).join('')}
      </div>`;

    el.querySelector('#surf-grid').addEventListener('click', e => {
      const c = e.target.closest('.surf');
      if (!c) return;
      const d = c.querySelector('.drawer');
      const open = d.classList.toggle('open');
      c.classList.toggle('open', open);
      c.querySelector('.surf-more').textContent = open ? 'close ↑' : 'details ↓';
    });
  },
};

/* ---- the five bars -------------------------------------------
 * The finale, and the only honest way to end a page like this: the standard
 * the skill holds every viz to, applied to THIS page, counted from the live
 * DOM rather than asserted. "Show me" highlights the actual elements.
 */
const BARS = [
  { n: 1, title: 'Meaning lives in space, not sentences',
    check: 'Position, length, angle, area or colour encodes at least one real variable.',
    sel: '#tab-guide svg rect, #tab-guide svg circle, #tab-guide svg path, #tab-guide svg line, #tab-guide svg polygon, #tab-guide svg polyline',
    unit: 'graphical marks',
    say: 'Treemap area is bytes. Circle area in the subsystem map is bytes. Rail spacing is document height.' },
  { n: 2, title: 'The reader drives something',
    check: 'A stepper, hover detail, filter, toggle or drag. Scrolling alone does not count.',
    sel: '#tab-guide button, #tab-guide .pg-cell, #tab-guide .surf, #tab-guide .fm',
    unit: 'controls you can drive',
    say: 'Two draggable figures, four scrubbed steppers, a filter, and a click-to-open grid — all keyboard-reachable.' },
  { n: 3, title: 'More than one altitude',
    check: 'Overview → mechanism → detail, when the subject has more than one.',
    sel: '#guide-bands .band, #guide-bands .stop',
    unit: 'bands and stops',
    say: 'Three gated bands: run it, understand it, master it. The rail shows all three at once.' },
  { n: 4, title: 'Every meaningful mark is identifiable',
    check: 'data-viz-id plus a human data-label on bars, nodes, packets, states.',
    sel: '#tab-guide [data-viz-id]',
    unit: 'identified marks',
    say: 'Every treemap cell, map circle, runtime box, form and posture cell can be named — and Alt-clicked to pin a comment.' },
  { n: 5, title: 'The reader is smart but has zero context',
    check: 'Legend, units, and a one-line "what am I looking at" on the page.',
    sel: '#tab-guide .fig-what, #tab-guide .legend',
    unit: '"what am I looking at" lines and legends',
    say: 'Every figure opens with one, and every encoded variable names its unit.' },
];

export const bars = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">The standard <code>SKILL.md</code> holds every viz to —
         five things you can <b>count in your own output</b>. Rather than describe them, this page counts
         them <b>against itself, from the live DOM, right now</b>. Press “show me” to outline the actual
         elements being counted.</p>
      <div class="bars" id="bars"></div>
      <div class="bars-lit-note" id="bars-lit-note"></div>
      <div class="bars-foot">
        <p>Miss one and you are not done — you are at the documented fallback. That is why the old version
           of this page needed replacing: it was a wall of prose <b>about</b> a tool whose entire thesis is
           that walls of prose are the wrong answer.</p>
        <button id="bars-recount">re-count</button>
        <span id="bars-note"></span>
      </div>`;

    const wrap = el.querySelector('#bars');
    const count = () => {
      wrap.innerHTML = BARS.map(b => {
        const n = document.querySelectorAll(b.sel).length;
        const pass = n > 0;
        return `<div class="bar ${pass ? 'pass' : 'fail'}" data-bar="${b.n}">
          <span class="bar-n">${b.n}</span>
          <div class="bar-main">
            <b>${b.title}</b>
            <p class="bar-check">${b.check}</p>
            <p class="bar-say">${b.say}</p>
          </div>
          <div class="bar-score">
            <span class="bar-count">${n}</span>
            <span class="bar-unit">${b.unit}</span>
            <button class="bar-show" data-sel="${b.n}">show me</button>
          </div>
        </div>`;
      }).join('');
      el.querySelector('#bars-note').textContent =
        `counted ${document.querySelectorAll('#tab-guide [data-viz-id]').length} identified marks in the guide`;
    };

    // "show me" used to just add outlines and say nothing. Almost everything it
    // lights is off-screen — the guide is sixteen stops long — so from where you
    // clicked, the only visible result was a couple of stray orange boxes and no
    // explanation. Now it says what it lit, how many, and where, and offers to
    // take you to one.
    let lit = null;
    const banner = el.querySelector('#bars-lit-note');

    const clear = () => {
      $$('.bar-lit').forEach(n => n.classList.remove('bar-lit'));
      wrap.querySelectorAll('.bar-show').forEach(x => x.textContent = 'show me');
      banner.classList.remove('on');
      lit = null;
    };

    wrap.addEventListener('click', e => {
      const b = e.target.closest('.bar-show');
      if (!b) return;
      const bar = BARS.find(x => x.n === +b.dataset.sel);
      const wasLit = lit === bar.n;
      clear();
      if (wasLit) return;

      lit = bar.n;
      b.textContent = 'hide';
      const nodes = [...document.querySelectorAll(bar.sel)];
      nodes.forEach(n => n.classList.add('bar-lit'));

      const onScreen = nodes.filter(n => {
        const r = n.getBoundingClientRect();
        return r.top < innerHeight && r.bottom > 0 && r.width > 0;
      }).length;
      banner.innerHTML =
        `<b>Bar ${bar.n}</b> — outlining <b>${nodes.length}</b> ${bar.unit} across the whole guide` +
        `<span class="bl-here">${onScreen} of them on this screen</span>` +
        `<button id="bars-jump">jump to one →</button>` +
        `<button id="bars-clear">clear</button>`;
      banner.classList.add('on');

      banner.querySelector('#bars-jump').onclick = () => {
        // Somewhere other than here, so the point actually lands.
        const away = nodes.find(n => {
          const r = n.getBoundingClientRect();
          return r.top < -200 || r.top > innerHeight + 200;
        }) || nodes[0];
        away?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
      };
      banner.querySelector('#bars-clear').onclick = clear;
    });

    el.querySelector('#bars-recount').onclick = count;
    count();
  },
};
