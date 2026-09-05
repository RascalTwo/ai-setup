/* guide.js — the three-band journey.
 *
 * The guide is one continuous scroll with two "you can stop here" gates in it,
 * not three separate documents. Three things make that legible:
 *
 *   the rail      a vertical map down the left. Node spacing is measured from
 *                 each stop's REAL document height, so the gaps encode how much
 *                 content a section holds — a long stop looks long on the rail.
 *   the gates     rendered on the rail itself, so "you could stop here" is a
 *                 place you can see coming, not a sentence you scroll past.
 *   scrub         a stop's figure pins while you scroll through it, and scroll
 *                 progress drives its step.
 *
 * Scroll is the TRANSPORT, never the only control. Every figure is also
 * independently driveable (arrow keys, play/pause, visible position) because
 * bar 2 of the skill's own ambition standard says scrolling alone doesn't count.
 * Manual stepping scrolls the page to the matching offset rather than fighting
 * it, so there is exactly one source of truth for "which step am I on".
 */
import { $, $$ } from '/_kit/viz.js';

export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- the journey ------------------------------------------------------- */

/* Three bands, and the split between them is about WHAT YOU WANT, not about
 * difficulty:
 *
 *   1  get it running                 — install, ask, refine
 *   2  get good at it                 — every capability, i.e. what it can DO
 *   3  understand how it works        — the internals
 *
 * Band 2 used to be the internals, which was the wrong shape: someone who has
 * just made their first viz wants to know what else the tool can do, not how
 * its router resolves a slug. The mechanism is genuinely band-3 material —
 * interesting, and almost never load-bearing for using it well. */
export const BANDS = [
  {
    id: 'run', n: 1, name: 'Get Running', tone: 'var(--good)',
    blurb: 'Why you would want this, then install it and make a real picture. Five minutes.',
    gate: {
      title: "That's the whole loop, and it's most of the value",
      body: 'Ask, look, say what is wrong, look again. If you never read another ' +
            'line of this page you can already use the tool. Keep going to find out ' +
            'what else it does — publishing, live data, share cards, and the parts ' +
            'people forget they have.',
    },
  },
  {
    id: 'good', n: 2, name: 'Get Good', tone: 'var(--accent)',
    blurb: 'Everything it can actually do. This is the band worth reading twice — ' +
           'most of what people forget lives in here.',
    gate: {
      title: 'That is the whole feature surface',
      body: 'You can now use every part of this tool deliberately rather than by ' +
            'accident. What follows is only the machinery underneath — how a session ' +
            'actually runs, how the server works, and the standard the skill holds ' +
            'its own output to. Interesting, but you do not need it to be good at this.',
    },
  },
  {
    id: 'master', n: 3, name: 'Master', tone: 'var(--c4)',
    blurb: 'How the machine actually works, for when you want to change it or trust it.',
    gate: null,
  },
];

export const STOPS = [
  { id: 'why',       band: 'run',    title: 'Why bother',          sub: 'the same data, two ways' },
  { id: 'install',   band: 'run',    title: 'Install',             sub: 'four ways in, and what each gets you' },
  { id: 'ask',       band: 'run',    title: 'Your first ask',      sub: 'words in, live URL out' },
  { id: 'refine',    band: 'run',    title: 'The refine loop',     sub: 'and it checks its own work' },

  { id: 'review',    band: 'good',   title: 'Point at it',         sub: 'located feedback + self-verify' },
  { id: 'forms',     band: 'good',   title: 'Ask for a shape',     sub: 'the menu it picks from' },
  { id: 'scaffolds', band: 'good',   title: 'Every scaffold',      sub: 'decks, posters, dives, exchanges' },
  { id: 'data',      band: 'good',   title: 'Real data',           sub: 'a viz can touch your machine' },
  { id: 'library',   band: 'good',   title: 'Your whole library',  sub: 'every viz, everywhere' },
  { id: 'publish',   band: 'good',   title: 'Put it online',       sub: 'containers, lobbies, share cards' },
  { id: 'access',    band: 'good',   title: 'Who can see it',      sub: 'public, private, one password' },

  { id: 'session',   band: 'master', title: 'A whole session',     sub: 'what each step really does' },
  { id: 'runtime',   band: 'master', title: 'Under the hood',      sub: 'trace a packet through it' },
  { id: 'internals', band: 'master', title: 'The rest of it',      sub: 'films, management, colour' },
  { id: 'map',       band: 'master', title: 'The subsystems',      sub: 'what the skill is made of' },
  { id: 'bars',      band: 'master', title: 'The five bars',       sub: 'this page, graded' },
];

const bandOf = id => BANDS.find(b => b.id === STOPS.find(s => s.id === id).band);

/* ---- band + stop scaffolding ------------------------------------------
 * Rendered here rather than written into index.html so the journey's shape is
 * declared once, in STOPS, and the rail and the document can't disagree.
 *
 * A stop with `steps` is SCRUBBED: it gets a tall outer box and a sticky inner
 * one, so its figure pins to the viewport while the extra height scrolls past.
 * Height is derived from the step count — more steps, longer pin — so a figure
 * never runs out of scroll before it runs out of steps. */
export function buildBands(mount, registry) {
  mount.innerHTML = BANDS.map(b => {
    const stops = STOPS.filter(s => s.band === b.id).map(s => {
      const fig = registry[s.id] || {};
      const n = fig.steps || 0;
      const inner = `
        <div class="stop-head">
          <span class="stop-kicker" style="--tone:${b.tone}">${b.n} · ${b.name}</span>
          <h2>${s.title}</h2>
          <p class="stop-sub">${s.sub}</p>
        </div>
        <div class="stop-fig" id="fig-${s.id}"></div>
        ${n ? controls(n) : ''}`;
      return n
        ? `<section class="stop scrub" id="stop-${s.id}" data-stop="${s.id}"
                    style="--steps:${n}"><div class="stop-sticky">${inner}</div></section>`
        : `<section class="stop" id="stop-${s.id}" data-stop="${s.id}">${inner}</section>`;
    }).join('');

    const gate = b.gate ? `
      <div class="gate" id="gate-${b.id}" style="--tone:${b.tone}">
        <div class="gate-rule"><span class="gate-flag">⚑</span></div>
        <div class="gate-body">
          <h3>${b.gate.title}</h3>
          <p>${b.gate.body}</p>
          <div class="gate-acts">
            <button class="gate-stop" data-goto="dashboard">Stop here → open the Dashboard</button>
            <button class="gate-go">Keep going ↓</button>
          </div>
        </div>
      </div>` : '';

    return `<div class="band" data-band="${b.id}" style="--tone:${b.tone}">
              <div class="band-head">
                <span class="band-n">${b.n}</span>
                <div><h2>${b.name}</h2><p>${b.blurb}</p></div>
              </div>
              ${stops}
            </div>${gate}`;
  }).join('');

  mount.addEventListener('click', e => {
    if (e.target.closest('.gate-go')) {
      const gate = e.target.closest('.gate');
      const nextBand = gate.nextElementSibling;
      if (nextBand) nextBand.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    }
    const stopBtn = e.target.closest('.gate-stop');
    if (stopBtn && typeof window.showTab === 'function') window.showTab(stopBtn.dataset.goto);
  });
}

/* ---- rail -------------------------------------------------------------- */

/* The rail is measured, not evenly spaced. positionRail() runs after layout
 * and on resize; until it runs the nodes sit at their declared order, which is
 * wrong but never blank. */
export function buildRail(mount) {
  mount.innerHTML = `
    <div class="rail-inner">
      <div class="rail-head">
        <span class="rail-eyebrow">the guide</span>
        <span class="rail-progress" id="rail-pct">0%</span>
      </div>
      <div class="rail-track" id="rail-track">
        <div class="rail-line"></div>
        <div class="rail-fill" id="rail-fill"></div>
        ${BANDS.map(b => `<div class="rail-band" data-band="${b.id}" style="--tone:${b.tone}"></div>`).join('')}
        ${STOPS.map(s => {
          const b = bandOf(s.id);
          return `<button class="rail-stop" data-stop="${s.id}" style="--tone:${b.tone}"
                    aria-label="${s.title} — ${s.sub}">
                    <span class="rail-dot"></span>
                    <span class="rail-label"><b>${s.title}</b><i>${s.sub}</i></span>
                  </button>`;
        }).join('')}
        ${BANDS.filter(b => b.gate).map(b => `
          <div class="rail-gate" data-gate="${b.id}">
            <span class="rail-gate-flag">⚑</span>
            <span class="rail-gate-txt">you could stop here</span>
          </div>`).join('')}
      </div>
      <div class="rail-foot">
        ${BANDS.map(b => `<span class="rail-key" style="--tone:${b.tone}"><i></i>${b.n}. ${b.name}</span>`).join('')}
      </div>
    </div>`;

  mount.addEventListener('click', e => {
    const btn = e.target.closest('.rail-stop');
    if (btn) jumpTo(btn.dataset.stop);
  });
}

/* Map document geometry onto the rail so spacing carries meaning.
 *
 * Raw proportional placement turned out to be too faithful to be usable: the
 * three short stops in band 1 collapsed into ~15% of the rail while the
 * scrubbed stops below them (which are several viewports tall each) took the
 * rest, and their labels overlapped into mush.
 *
 * So the spacing is RELAXED proportional, not exact — true positions first,
 * then a two-pass push-apart that enforces a minimum gap derived from the
 * actual label height. Order is preserved and long sections still read as
 * longer; they just can't crush their neighbours off the rail. */
export function positionRail() {
  const track = $('#rail-track');
  if (!track) return;
  const bands = $('#guide-bands');
  if (!bands) return;

  const top = bands.offsetTop;
  const span = bands.offsetHeight || 1;
  const pct = el => ((el.offsetTop - top) / span) * 100;

  // Everything that owns a slot on the rail, in document order.
  const items = [
    ...STOPS.map(s => ({ kind: 'stop', id: s.id, el: document.getElementById('stop-' + s.id),
                         node: track.querySelector(`.rail-stop[data-stop="${s.id}"]`) })),
    ...BANDS.filter(b => b.gate).map(b => ({ kind: 'gate', id: b.id, el: document.getElementById('gate-' + b.id),
                         node: track.querySelector(`.rail-gate[data-gate="${b.id}"]`) })),
  ].filter(i => i.el && i.node);
  items.sort((a, b) => a.el.offsetTop - b.el.offsetTop);

  // Labels are vertically centred on their node, so the space two neighbours
  // need is HALF of each — not the height of just one of them. Using only the
  // previous item's height left gate labels sitting on top of stop labels.
  const h = track.offsetHeight || 1;
  const halfOf = i => ((i.kind === 'gate' ? 14 : 30) / 2 / h) * 100;
  const gapBetween = (a, b) => halfOf(a) + halfOf(b) + (4 / h) * 100;

  const p = items.map(i => pct(i.el));
  const push = () => {
    for (let i = 1; i < p.length; i++)
      p[i] = Math.max(p[i], p[i - 1] + gapBetween(items[i - 1], items[i]));
  };
  push();
  if (p[p.length - 1] > 100) {
    // Ran off the bottom — relax backwards from the end, then re-settle forward.
    p[p.length - 1] = 100;
    for (let i = p.length - 2; i >= 0; i--)
      p[i] = Math.min(p[i], p[i + 1] - gapBetween(items[i], items[i + 1]));
    push();
  }
  items.forEach((it, i) => { it.node.style.top = Math.max(0, Math.min(100, p[i])).toFixed(2) + '%'; });

  for (const b of BANDS) {
    const first = document.getElementById('stop-' + STOPS.find(s => s.band === b.id).id);
    const stops = STOPS.filter(s => s.band === b.id);
    const last = document.getElementById('stop-' + stops[stops.length - 1].id);
    const seg = track.querySelector(`.rail-band[data-band="${b.id}"]`);
    if (first && last && seg) {
      const a = pct(first), z = pct(last) + (last.offsetHeight / span) * 100;
      seg.style.top = a.toFixed(2) + '%';
      seg.style.height = Math.max(0, z - a).toFixed(2) + '%';
    }
  }
}

/* ---- active stop + progress -------------------------------------------- */

let current = null;

function setActive(id) {
  if (id === current) return;
  current = id;
  for (const n of $$('.rail-stop')) n.classList.toggle('on', n.dataset.stop === id);
  const b = bandOf(id);
  for (const n of $$('.rail-key')) n.classList.toggle('on', n.textContent.includes(b.name));
  document.documentElement.style.setProperty('--band-tone', b.tone);

  // NOT saveHash() — the kit's helper serialises a JSON object into the hash,
  // which overwrites the "#guide" the tab shell routes on and left the page
  // unable to work out which tab it was showing. The tab owns the hash; the
  // stop rides behind an "&" that the tab router already splits on.
  const next = `#guide&stop=${id}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

/* Captured at module-evaluation time, before anything can rewrite the hash.
 * Read lazily and it loses a race: the tab shell scrolls to 0 on init, the
 * first scroll event fires setActive, and the deep link is overwritten with
 * whatever is at the top of the page before the load handler ever sees it. */
const DEEP_LINK = (() => {
  // window.__initialHash is snapshotted by the classic script in index.html,
  // which runs BEFORE this module — reading location.hash here is already too
  // late if anything has rewritten it.
  const m = (window.__initialHash || location.hash).match(/[&?]stop=([\w-]+)/);
  return m && STOPS.some(s => s.id === m[1]) ? m[1] : null;
})();

/** The stop named in the URL when the page loaded, if any. */
export function stopFromHash() { return DEEP_LINK; }

export function jumpTo(id) {
  const el = document.getElementById('stop-' + id);
  if (!el) return;
  el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}

export function watchScroll() {
  const bands = $('#guide-bands');
  const fill = $('#rail-fill');
  const pctEl = $('#rail-pct');
  if (!bands) return;

  // Active stop = the one whose top edge last crossed 45% of the viewport.
  // An IntersectionObserver on tall sections fires on the wrong one constantly;
  // this is the cheap version that gets it right.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const line = innerHeight * 0.45;
      let active = STOPS[0].id;
      for (const s of STOPS) {
        const el = document.getElementById('stop-' + s.id);
        if (el && el.getBoundingClientRect().top <= line) active = s.id;
      }
      setActive(active);

      const r = bands.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (line - r.top) / (r.height || 1)));
      if (fill) fill.style.height = (p * 100).toFixed(2) + '%';
      if (pctEl) pctEl.textContent = Math.round(p * 100) + '%';
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { positionRail(); onScroll(); });
  onScroll();
}

/* ---- scroll-scrub ------------------------------------------------------
 * Pins a figure while its stop scrolls past and maps scroll progress onto a
 * step index. Returns a driver with the same shape as the kit's stepper() so a
 * figure can be driven by scroll, by arrow keys, or by both.
 *
 * Manual navigation SCROLLS THE PAGE rather than setting state directly —
 * otherwise the next scroll event would immediately overwrite it and the
 * controls would feel broken. One source of truth. */
export function scrollScrub(stopId, { n, onStep, label }) {
  const stop = document.getElementById('stop-' + stopId);
  if (!stop) return { go(){}, next(){}, prev(){}, current: () => 0 };

  const readout = stop.querySelector('.fig-pos');
  const scrubEl = stop.querySelector('.fig-scrub');
  let idx = -1;

  const emit = i => {
    if (i === idx) return;
    idx = i;
    onStep(i);
    if (readout) readout.textContent = `${i + 1} / ${n}`;
    if (scrubEl) scrubEl.style.setProperty('--p', ((i + 1) / n * 100).toFixed(1) + '%');
    stop.querySelectorAll('.fig-tick').forEach((t, j) => t.classList.toggle('on', j <= i));
  };

  // progress → step. The pinned run is the stop's height minus one viewport,
  // which is the distance over which the sticky figure is actually stuck.
  const progress = () => {
    const r = stop.getBoundingClientRect();
    const run = Math.max(1, stop.offsetHeight - innerHeight);
    return Math.min(1, Math.max(0, -r.top / run));
  };
  const read = () => emit(Math.min(n - 1, Math.floor(progress() * n * 0.999)));

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; read(); });
  }, { passive: true });

  // Scroll the page so that `i` is the step under the read head.
  const scrollToStep = i => {
    const run = Math.max(1, stop.offsetHeight - innerHeight);
    const target = stop.offsetTop + run * ((i + 0.5) / n);
    scrollTo({ top: target, behavior: REDUCED ? 'auto' : 'smooth' });
  };

  const api = {
    go: i => scrollToStep(Math.min(n - 1, Math.max(0, i))),
    next: () => api.go(idx + 1),
    prev: () => api.go(idx - 1),
    current: () => idx,
  };

  // Controls. Arrow keys only while this stop owns the viewport, so two
  // figures on one page can't both claim the same keypress.
  const prevBtn = stop.querySelector('.fig-prev');
  const nextBtn = stop.querySelector('.fig-next');
  if (prevBtn) prevBtn.onclick = api.prev;
  if (nextBtn) nextBtn.onclick = api.next;
  stop.querySelectorAll('.fig-tick').forEach((t, j) => { t.onclick = () => api.go(j); });

  addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const r = stop.getBoundingClientRect();
    if (r.top > innerHeight * 0.5 || r.bottom < innerHeight * 0.5) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); api.next(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); api.prev(); }
  });

  read();
  if (label && readout) readout.dataset.label = label;
  return api;
}

/* Standard control strip for a scrubbed figure — one shape everywhere, so the
 * reader learns it once. n ticks, prev/next, and a visible position. */
export function controls(n, hint = 'scroll or use ←/→') {
  return `
    <div class="fig-ctl">
      <button class="fig-prev" aria-label="previous step">←</button>
      <div class="fig-scrub">
        ${Array.from({ length: n }, (_, i) => `<button class="fig-tick" aria-label="step ${i + 1}"></button>`).join('')}
      </div>
      <button class="fig-next" aria-label="next step">→</button>
      <span class="fig-pos">1 / ${n}</span>
      <span class="fig-hint">${hint}</span>
    </div>`;
}
