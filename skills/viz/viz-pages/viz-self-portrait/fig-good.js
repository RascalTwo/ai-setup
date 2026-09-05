/* fig-good.js — band 2, "Get Good".
 *
 * The capability band: what this tool can actually DO. This is the part people
 * forget they have — the skill has grown a lot of surface, and none of it is
 * discoverable from the one command you type to make a chart.
 *
 * Deliberately NOT internals. How the router resolves a slug is band 3; that
 * you can seal a whole site behind one password is this band, because it
 * changes what you'd choose to do.
 */
import { twoAxis } from '/_kit/viz.js';

/* ---- stop 5 · point at it ----------------------------------------------
 * Two halves of the same idea: the agent checks its own work, and you give
 * feedback by pointing rather than describing.
 */
export const review = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">The two things that close the loop without you
         writing a bug report. <b>Left:</b> the agent checking its own render. <b>Right:</b> how you
         say "that bit is wrong" by pointing at the bit.</p>

      <div class="rev-two">
        <div class="rev-card">
          <div class="rev-h"><span class="pill good">automatic</span> it tests its own output</div>
          <p>Before it says "done", it drives a real headless browser over the page: screenshot,
             console read, and a layout audit. You are not the one who discovers the blank page.</p>
          <ul class="rev-list">
            <li><b>Console errors</b> — a typo'd import that renders nothing looks <i>fine</i> in a
                screenshot. Caught as text, not by eye.</li>
            <li><b>Text past its box</b> — SVG <code>&lt;text&gt;</code> has no overflow protection,
                so this is the single most common visual bug.</li>
            <li><b>Silently clipped content</b> — a label truncated by an <code>overflow:hidden</code>
                ancestor looks deliberate in a picture.</li>
            <li><b>A mark census</b> — <code>rendered: 0 rect</code> when you drew twelve instantly
                separates "rendered nothing" from "rendered wrong".</li>
            <li><b>Multi-state checks</b> — drop a <code>verify.interactions.ts</code> beside the viz
                and it drives clicks, steps and tabs, screenshotting each. A plain run only ever sees
                state one, which is how most interactive vizzes ship unlooked-at past their opening frame.</li>
          </ul>
        </div>

        <div class="rev-card">
          <div class="rev-h"><span class="pill accent">yours</span> point at the thing</div>
          <p><b>Alt/Option-click any element</b> in a live viz. A comment pins to <i>that element</i> —
             not to a paragraph, not to a screenshot — and the pin follows it even as the thing animates.</p>
          <div class="rev-demo" id="rev-demo">
            <span class="rev-target" id="rev-target" data-viz-id="rev-demo-bar" data-label="a demo bar you can pin a comment to"></span>
            <span class="rev-pin" id="rev-pin">1</span>
            <span class="rev-hint" id="rev-hint">alt-click the bar →</span>
          </div>
          <p>The agent reads your located feedback and fixes it. The lifecycle is strict and
             deliberately asymmetric: <b>you delete, never resolve; it resolves, never deletes.</b>
             Comments live in a git-ignored <code>comments.json</code> beside the viz, so review notes
             never reach a repo.</p>
          <pre class="rev-art"><code>{ "anchor": { "vizId": "state-paid" },
  "text": "should loop back to cart on decline",
  "status": "open" }</code></pre>
        </div>
      </div>
      <p class="fig-foot">Together these are why it converges. The agent catches what is
         <i>broken</i>; you only have to catch what is <i>wrong</i> — and you do that by pointing.</p>`;

    // A tiny working version of the real thing, so "alt-click" is a verb you
    // have already performed by the time you read about it.
    const demo = el.querySelector('#rev-demo');
    const pin = el.querySelector('#rev-pin');
    const hint = el.querySelector('#rev-hint');
    demo.addEventListener('click', e => {
      if (!e.altKey) { hint.textContent = 'hold Alt (Option) and click →'; return; }
      const r = demo.getBoundingClientRect();
      pin.style.left = (e.clientX - r.left) + 'px';
      pin.style.top = (e.clientY - r.top) + 'px';
      pin.classList.add('on');
      hint.textContent = 'pinned — the agent reads it, fixes it, resolves it';
    });
  },
};

/* ---- stop 6 · ask for a shape ------------------------------------------
 * Moved down from the old band 2. Knowing the menu is a USER skill: you get
 * better output by naming the shape you want, or by recognising a bad pick.
 */
const FORMS = [
  { id: 'bar',     name: 'bar / histogram', fam: 'magnitude' },
  { id: 'line',    name: 'line / area',     fam: 'magnitude' },
  { id: 'spark',   name: 'sparkline grid',  fam: 'magnitude' },
  { id: 'treemap', name: 'treemap',         fam: 'part' },
  { id: 'sunburst',name: 'sunburst',        fam: 'part' },
  { id: 'stack',   name: 'stacked bar',     fam: 'part' },
  { id: 'scatter', name: 'scatter / bubble',fam: 'twovar' },
  { id: 'heat',    name: 'heatmap',         fam: 'twovar' },
  { id: 'tree',    name: 'tree / dendrogram',fam: 'hier' },
  { id: 'icicle',  name: 'icicle',          fam: 'hier' },
  { id: 'force',   name: 'force graph',     fam: 'rel' },
  { id: 'sankey',  name: 'sankey',          fam: 'rel' },
  { id: 'chord',   name: 'chord / arc',     fam: 'rel' },
  { id: 'state',   name: 'state machine',   fam: 'flow' },
  { id: 'seq',     name: 'sequence',        fam: 'flow' },
  { id: 'swim',    name: 'swimlane',        fam: 'flow' },
  { id: 'topo',    name: 'boxes + arrows',  fam: 'arch' },
  { id: 'radar',   name: 'radar / slope',   fam: 'compare' },
  { id: 'map',     name: 'map / floor plan',fam: 'spatial' },
  { id: 'three',   name: 'three.js scene',  fam: 'threed' },
  { id: 'steps',   name: 'stepped explainer',fam: 'explain' },
  { id: 'film',    name: 'timed film',      fam: 'explain' },
];
const FAMS = [
  { id: 'magnitude', label: 'magnitudes, distributions, time series' },
  { id: 'part',      label: 'part-to-whole' },
  { id: 'twovar',    label: 'two or more variables' },
  { id: 'hier',      label: 'hierarchy' },
  { id: 'rel',       label: 'relationships, dependencies, networks' },
  { id: 'flow',      label: 'sequence, flow, process, state' },
  { id: 'arch',      label: 'architecture, topology' },
  { id: 'compare',   label: 'comparison across categories' },
  { id: 'spatial',   label: 'spatial, geographic' },
  { id: 'threed',    label: '3D structures and scenes' },
  { id: 'explain',   label: 'explanatory' },
];
const SKETCH = {
  bar:      '<rect x="3" y="14" width="5" height="12"/><rect x="11" y="8" width="5" height="18"/><rect x="19" y="17" width="5" height="9"/><rect x="27" y="4" width="5" height="22"/>',
  line:     '<polyline points="3,22 11,14 19,18 27,6 33,10" fill="none" stroke-width="2"/>',
  spark:    '<polyline points="3,12 8,7 13,11 18,6" fill="none"/><polyline points="20,22 25,17 30,21 34,15" fill="none"/>',
  treemap:  '<rect x="3" y="4" width="16" height="14"/><rect x="21" y="4" width="12" height="8"/><rect x="21" y="14" width="12" height="12"/><rect x="3" y="20" width="16" height="6"/>',
  sunburst: '<path d="M18 15 m-9 0 a9 9 0 0 1 9 -9 l0 4 a5 5 0 0 0 -5 5 z"/><path d="M18 15 m0 -12 a12 12 0 0 1 12 12 l-4 0 a8 8 0 0 0 -8 -8 z"/>',
  stack:    '<rect x="6" y="16" width="9" height="10"/><rect x="6" y="8" width="9" height="7"/><rect x="20" y="12" width="9" height="14"/><rect x="20" y="5" width="9" height="6"/>',
  scatter:  '<circle cx="8" cy="20" r="2.5"/><circle cx="15" cy="12" r="3.5"/><circle cx="23" cy="17" r="2"/><circle cx="29" cy="8" r="4"/>',
  heat:     '<rect x="4" y="6" width="7" height="7" opacity=".3"/><rect x="13" y="6" width="7" height="7" opacity=".8"/><rect x="22" y="6" width="7" height="7" opacity=".5"/><rect x="4" y="15" width="7" height="7" opacity=".9"/><rect x="13" y="15" width="7" height="7" opacity=".2"/><rect x="22" y="15" width="7" height="7" opacity=".6"/>',
  tree:     '<line x1="18" y1="5" x2="9" y2="16"/><line x1="18" y1="5" x2="27" y2="16"/><line x1="9" y1="16" x2="5" y2="25"/><line x1="9" y1="16" x2="13" y2="25"/><circle cx="18" cy="5" r="2.5"/><circle cx="9" cy="16" r="2.5"/><circle cx="27" cy="16" r="2.5"/><circle cx="5" cy="25" r="2"/><circle cx="13" cy="25" r="2"/>',
  icicle:   '<rect x="3" y="4" width="30" height="6"/><rect x="3" y="12" width="17" height="6"/><rect x="22" y="12" width="11" height="6"/><rect x="3" y="20" width="9" height="6"/>',
  force:    '<line x1="9" y1="9" x2="20" y2="16"/><line x1="20" y1="16" x2="29" y2="8"/><line x1="20" y1="16" x2="14" y2="25"/><circle cx="9" cy="9" r="3"/><circle cx="20" cy="16" r="3.5"/><circle cx="29" cy="8" r="2.5"/><circle cx="14" cy="25" r="2.5"/>',
  sankey:   '<path d="M4 6 C 16 6, 16 13, 30 13 L30 19 C16 19, 16 12, 4 12 Z" opacity=".55"/><path d="M4 16 C 16 16, 16 22, 30 22 L30 26 C16 26, 16 21, 4 21 Z" opacity=".35"/>',
  chord:    '<circle cx="18" cy="15" r="11" fill="none" stroke-width="1.5"/><path d="M8 10 Q18 22 28 11" fill="none"/><path d="M11 23 Q20 8 26 21" fill="none"/>',
  state:    '<circle cx="8" cy="15" r="5" fill="none" stroke-width="1.5"/><circle cx="28" cy="15" r="5" fill="none" stroke-width="1.5"/><line x1="13" y1="15" x2="23" y2="15"/><path d="M23 15 l-4 -2 v4 z" stroke="none"/>',
  seq:      '<line x1="8" y1="4" x2="8" y2="26" stroke-dasharray="2 2"/><line x1="28" y1="4" x2="28" y2="26" stroke-dasharray="2 2"/><line x1="8" y1="11" x2="28" y2="11"/><line x1="28" y1="19" x2="8" y2="19"/>',
  swim:     '<line x1="3" y1="11" x2="33" y2="11" opacity=".4"/><line x1="3" y1="20" x2="33" y2="20" opacity=".4"/><rect x="6" y="4" width="8" height="5"/><rect x="18" y="13" width="8" height="5"/><rect x="10" y="22" width="8" height="5"/>',
  topo:     '<rect x="3" y="6" width="11" height="8"/><rect x="22" y="6" width="11" height="8"/><rect x="12" y="19" width="11" height="8"/><line x1="14" y1="10" x2="22" y2="10"/><line x1="17" y1="14" x2="17" y2="19"/>',
  radar:    '<polygon points="18,4 29,12 25,25 11,25 7,12" fill="none" stroke-width="1"/><polygon points="18,9 25,13 22,21 14,21 11,13" opacity=".5"/>',
  map:      '<path d="M5 8 L14 5 L23 9 L31 6 L31 24 L23 27 L14 23 L5 26 Z" fill="none" stroke-width="1.5"/><line x1="14" y1="5" x2="14" y2="23"/><line x1="23" y1="9" x2="23" y2="27"/>',
  three:    '<path d="M18 4 L30 11 L30 22 L18 28 L6 22 L6 11 Z" fill="none" stroke-width="1.5"/><path d="M18 4 L18 16 L30 11 M18 16 L6 11 M18 16 L18 28" fill="none" opacity=".6"/>',
  steps:    '<rect x="3" y="19" width="8" height="7"/><rect x="14" y="13" width="8" height="13"/><rect x="25" y="6" width="8" height="20"/>',
  film:     '<rect x="4" y="8" width="28" height="16" rx="2" fill="none" stroke-width="1.5"/><path d="M15 12 l7 4 l-7 4 z" stroke="none"/>',
};

export const forms = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">Every shape it can reach for, grouped by the
         <b>kind of content</b> that should choose it. Click a content kind to light up its forms.
         You do not have to know any of this — but naming the shape you want is the single
         highest-leverage thing you can say.</p>
      <div class="forms-wrap">
        <div class="forms-fams" id="forms-fams">
          <button class="ff on" data-f="all">everything</button>
          ${FAMS.map(f => `<button class="ff" data-f="${f.id}">${f.label}</button>`).join('')}
        </div>
        <div class="forms-grid" id="forms-grid">
          ${FORMS.map(f => `
            <div class="fm" data-fam="${f.fam}" data-viz-id="form-${f.id}" data-label="${f.name}">
              <svg viewBox="0 0 36 30" aria-hidden="true">${SKETCH[f.id] || ''}</svg>
              <span>${f.name}</span>
            </div>`).join('')}
        </div>
      </div>
      <p class="fig-foot"><b>And this menu is not the limit.</b> A viz is a real web page with a real
         browser under it, so anything you can build with HTML, CSS and JavaScript is on the table —
         WebGL scenes, physics toys, audio, canvas games, a working form, an actual little application.
         The menu above is where to start when the content has an obvious shape, not a fence.</p>
      <p class="fig-foot"><b>A styled page of cards and paragraphs is not on this menu by accident.</b>
         It is the documented fallback — allowed when no spatial form genuinely fits, but taking it is a
         decision the agent announces in one line so you can veto it, never a default it drifts into.
         If you get a page of boxes-with-words back and the content had magnitudes or relationships
         in it, say so: there was a real shape available.</p>`;

    el.querySelector('#forms-fams').addEventListener('click', e => {
      const b = e.target.closest('.ff');
      if (!b) return;
      el.querySelectorAll('.ff').forEach(x => x.classList.toggle('on', x === b));
      const f = b.dataset.f;
      el.querySelectorAll('.fm').forEach(m =>
        m.classList.toggle('off', f !== 'all' && m.dataset.fam !== f));
    });
  },
};

/* ---- stop 7 · every scaffold --------------------------------------------
 * Was a grid of click-to-open drawers, which meant the content you actually
 * wanted was hidden behind a click and appeared as a panel that shoved the
 * page around. Now it is one scrubbed walk: one scaffold per step, each with
 * a working miniature of what that scaffold actually produces.
 *
 * `--from` is deliberately not a step — it is not a shape, it is a way to
 * start from a shape you already have. It lives in the footnote.
 */
const SCAFFOLDS = [
  { flag: '--deck', name: 'Slide deck', tone: 'var(--accent)', stamp: 'deck',
    one: 'An arrow-key presentation instead of a single screen.',
    body: 'A scale-to-fit 16:9 canvas, <code>←/→/space</code>, <kbd>F</kbd> for fullscreen, a progress bar, and <b>reversible per-slide fragments</b> — so a build-up steps backwards as well as forwards. You add a slide by copying a <code>&lt;section class="slide"&gt;</code>.',
    when: 'You are going to present it to people.',
    demo: `<div class="mini deck-mini">
        <div class="dm-slide">
          <div class="dm-title">Why the queue backs up</div>
          <div class="dm-frag on">① arrivals are bursty</div>
          <div class="dm-frag on">② service time is fixed</div>
          <div class="dm-frag">③ so the tail explodes</div>
        </div>
        <div class="dm-bar"><i style="width:62%"></i></div>
        <div class="dm-n">4 / 7 · ← → to step · F for fullscreen</div>
      </div>` },

  { flag: '--poster', name: 'Poster', tone: 'var(--c4)', stamp: 'poster',
    one: 'The page IS its own 1200×630 share card.',
    body: 'One fixed <code>.og-card</code> element, which <code>verify.ts --og</code> clips straight to the share image — no separate hero file. Keep anything that must survive inside the middle ~1080×565, because Slack, X, Teams and Discord all centre-crop link cards.',
    when: 'The whole artifact is one image people will see in a chat.',
    demo: `<div class="mini poster-mini">
        <div class="pm-card">
          <div class="pm-left">
            <span class="pm-eyebrow">● measured</span>
            <div class="pm-title">Three blockers<br><span>outranks one.</span></div>
            <div class="pm-sub">Depth beats count when ordering a backlog.</div>
            <div class="pm-chips"><span>graph</span><span>backlog</span></div>
          </div>
          <div class="pm-right">
            <div class="pm-fig"><i style="height:38%"></i><i style="height:66%"></i><i style="height:92%"></i><i style="height:51%"></i></div>
            <div class="pm-stats"><b>53</b><span>tickets</span><b>7</b><span>roots</span></div>
          </div>
        </div>
        <div class="mini-cap">1200 × 630 — the whole page is the card</div>
      </div>` },

  { flag: '--poster-dive', name: 'Poster + dive', tone: 'var(--c4)', stamp: 'poster-dive',
    one: 'That card on top, a full deep-dive page underneath.',
    body: 'The card still clips to the share image, and everything below it is the long read. <b>This is the most-used scaffold in the library by a wide margin</b> — one link that both previews well and rewards a scroll.',
    when: 'You want one URL that works as a share AND as a document.',
    demo: `<div class="mini dive-mini">
        <div class="pm-card small">
          <div class="pm-left"><div class="pm-title">The dead knob</div>
            <div class="pm-sub">log_level was wired to a key nothing reads.</div></div>
          <div class="pm-right"><div class="pm-fig"><i style="height:70%"></i><i style="height:30%"></i><i style="height:88%"></i></div></div>
        </div>
        <div class="dv-fold">↓ the card ends here — everything below is the dive</div>
        <div class="dv-body">
          <span class="dv-h"></span><span class="dv-l"></span><span class="dv-l short"></span>
          <span class="dv-fig"></span>
          <span class="dv-l"></span><span class="dv-l"></span><span class="dv-l short"></span>
        </div>
      </div>` },

  { flag: '--exchange', name: 'Exchange', tone: 'var(--c5)', stamp: 'exchange',
    one: 'Something being passed or proven between parties.',
    body: 'Actors sit in <b>phase bands</b>, declared wires run between them, a labelled packet animates along a wire and a stepper narrates the hops. Deliberately <b>not</b> a UML sequence diagram — there are no lifelines, and the vertical axis is <b>phase, not time</b>, which is what lets it say how <i>often</i> each band happens: <code>once</code> / <code>per token</code> / <code>per request</code>.',
    when: 'A credential, token, request or obligation moves between systems.',
    demo: `<div class="mini xc-mini">
        <div class="xc-band"><span class="xc-tag">once</span>
          <div class="xc-node">client</div>
          <div class="xc-wire"><span class="xc-pkt">register</span></div>
          <div class="xc-node">auth server</div>
        </div>
        <div class="xc-band alt"><span class="xc-tag">per request</span>
          <div class="xc-node">client</div>
          <div class="xc-wire"><span class="xc-pkt ret">token</span></div>
          <div class="xc-node">resource</div>
        </div>
        <div class="mini-cap">actors repeat per band · the y axis is phase, not time</div>
      </div>` },

  { flag: '--hero', name: 'Hero card', tone: 'var(--warn)', stamp: '(none)',
    one: 'A share card that is not the page itself.',
    body: 'Adds a <code>hero.html</code> beside the viz and leaves <code>index.html</code> alone. Built on the kit\'s OG stylesheet, so it re-themes with the viz instead of drifting into a parallel palette. It is the only one here that stamps <b>no</b> scaffold value — it is an add-on, not a shape.',
    when: 'The viz is a normal page, but you still want the link to look deliberate.',
    demo: `<div class="mini hero-mini">
        <div class="hm-pair">
          <div class="hm-page"><span class="hm-h"></span><span class="hm-l"></span><span class="hm-l"></span>
            <span class="hm-fig"></span><span class="hm-l"></span><span class="hm-l short"></span>
            <em>index.html — the actual viz</em></div>
          <div class="hm-card"><div class="hm-ct">One repo.<br><span>Two agents.</span></div>
            <em>hero.html — what the link shows</em></div>
        </div>
        <div class="mini-cap">two files · the card is authored, not screenshotted</div>
      </div>` },
];

export const scaffolds = {
  steps: SCAFFOLDS.length,
  render(el, { onStep }) {
    el.innerHTML = `
      <p class="fig-what">Every starting shape the tool knows, one per step, with a working miniature
         of what each one actually produces. Adding a flag to <code>/viz</code> is the whole interface.</p>
      <div class="scaf-stage">
        <div class="scaf-copy">
          <div class="scaf-h"><code id="scaf-flag"></code><b id="scaf-name"></b></div>
          <p class="scaf-one" id="scaf-one"></p>
          <p class="scaf-body" id="scaf-body"></p>
          <p class="scaf-when" id="scaf-when"></p>
          <p class="scaf-stamp" id="scaf-stamp"></p>
        </div>
        <div class="scaf-demo" id="scaf-demo"></div>
      </div>
      <p class="fig-foot">No flag at all gives you a plain page, which is still the most common thing
         by far — <b>166 of 235</b> vizzes here. And you are rarely starting from zero:
         <code>--from &lt;viz&gt;</code> forks any viz you already have, which usually beats every
         scaffold above, since the layout and interaction wiring are already solved somewhere in your
         library. A fork inherits the scaffold stamp — a fork of a deck is still a deck — but always
         resets to <b>local/unlisted</b>, because posture is a trust decision and is never inherited.</p>`;

    onStep(i => {
      const s = SCAFFOLDS[i];
      el.style.setProperty('--tone', s.tone);
      el.querySelector('#scaf-flag').textContent = s.flag;
      el.querySelector('#scaf-name').textContent = s.name;
      el.querySelector('#scaf-one').textContent = s.one;
      el.querySelector('#scaf-body').innerHTML = s.body;
      el.querySelector('#scaf-when').innerHTML = `<b>Reach for it when:</b> ${s.when}`;
      el.querySelector('#scaf-stamp').innerHTML = `stamps <code>viz:scaffold = ${s.stamp}</code>`;
      el.querySelector('#scaf-demo').innerHTML = s.demo;
    });
  },
};

/* ---- stop 8 · real data ------------------------------------------------- */
export const data = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">The bit people forget: <b>a viz is not a picture of
         your data, it can be wired to it.</b> A viz folder can hold its own tiny backend that runs on
         your machine, with your files and your shell.</p>

      <div class="data-flow">
        <div class="df-node"><b>your machine</b><i>files · git · shell · any command</i></div>
        <div class="df-arrow"><span>reads</span></div>
        <div class="df-node accent"><b>api.ts</b><i>a Bun handler beside index.html</i></div>
        <div class="df-arrow"><span>/&lt;id&gt;/api/*</span></div>
        <div class="df-node"><b>your viz</b><i>fetch · SSE stream · live redraw</i></div>
      </div>

      <div class="data-cards">
        <div class="dc">
          <h4>It is genuinely live</h4>
          <p>The Dashboard tab on this very page is the example: it is a viz whose
             <code>api.ts</code> shells out, walks your disk and reads git, then streams the result
             back. <b>235 vizzes, 807 files, real commit counts</b> — none of that is baked in.</p>
        </div>
        <div class="dc">
          <h4>Frozen tapes, for when it leaves home</h4>
          <p>A published viz has no Bun process behind it, so an api-backed page would be dead on a
             static host. <b>Recording a tape</b> freezes the responses into the built page, which then
             ships behind a "snapshot, not live" banner.</p>
          <p class="dc-warn">⚠ Scan a tape for secrets before publishing. The tool seals whatever is on
             disk, and a <b>public</b> viz has no encryption backstop.</p>
        </div>
        <div class="dc">
          <h4>Use a relative URL</h4>
          <p><code>fetch("api/thing")</code>, never <code>fetch("/api/thing")</code>. A viz is served
             under its own path and published under a different one; an absolute URL works locally and
             breaks the moment it ships.</p>
        </div>
      </div>
      <p class="fig-foot">This is the difference between "draw me a chart of this JSON" and "build me a
         tool". Anything you can do in a shell, a viz can put a face on.</p>`;
  },
};

/* ---- stop 9 · your whole library ---------------------------------------- */
export const library = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">Where your vizzes actually live — and the answer is
         "in more places than you'd think", which is exactly why the Dashboard exists.</p>

      <div class="lib-two">
        <div class="lib-card">
          <div class="lib-h"><b>Two homes</b></div>
          <div class="lib-home"><span class="pill accent">central</span>
            <p>A shared scratch library. The default: fast to make, easy to throw away, versioned
               in its own git repo.</p></div>
          <div class="lib-home"><span class="pill">repo-local</span>
            <p><code>--local</code> puts the viz <b>inside a project's own repo</b>, in its
               <code>viz-pages/</code> folder, versioned alongside the code it describes. This is what
               most real vizzes end up being — the diagram lives with the thing it explains.</p></div>
          <p class="lib-note">One server serves <b>both</b>, from many roots at once. It walks your home
             directory on boot and finds every <code>viz-pages/</code> folder you have, so a viz you made
             in another repo six months ago is still one URL away.</p>
        </div>
        <div class="lib-card">
          <div class="lib-h"><b>And a way to see all of it</b></div>
          <p>That is the <a href="#dashboard" id="lib-dash">Dashboard</a> on this page: every viz on
             the machine, filterable by posture, listing, scaffold, whether it has a backend, and which
             container it lives in.</p>
          <ul class="rev-list">
            <li>Search across title <i>and</i> path</li>
            <li>Live thumbnails from each viz's own share card</li>
            <li>Per-viz file counts, commit counts, size and age</li>
            <li>A drawer per viz to rename, re-posture, mirror or vendor it — without hand-editing
                anything</li>
          </ul>
          <p class="lib-note">A growing library is the actual failure mode here. It is very easy to make
             a hundred of these and lose track of every one.</p>
        </div>
      </div>`;
    const a = el.querySelector('#lib-dash');
    if (a) a.onclick = e => { e.preventDefault(); window.showTab?.('dashboard'); };
  },
};

/* ---- stop 10 · put it online -------------------------------------------- */
export const publish = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">The path from "a page on my laptop" to "a URL I can
         send someone". Each <code>viz-pages/</code> folder is a <b>container</b>, and a container
         becomes a whole small website.</p>

      <div class="pub-chain">
        <div class="pc"><span class="pc-n">1</span><b>container</b>
          <p>Any <code>viz-pages/</code> folder — central, or inside one of your repos.</p></div>
        <div class="pc-arrow">→</div>
        <div class="pc"><span class="pc-n">2</span><b>build</b>
          <p>Each viz becomes <b>one self-contained HTML file</b>. JS, CSS, the kit, images — all
             inlined. Nothing to serve, nothing to install.</p></div>
        <div class="pc-arrow">→</div>
        <div class="pc"><span class="pc-n">3</span><b>lobby</b>
          <p>A front page is generated listing every viz as a card, with thumbnails, search and
             facets. You do not write it.</p></div>
        <div class="pc-arrow">→</div>
        <div class="pc"><span class="pc-n">4</span><b>deploy</b>
          <p>Static files. GitHub Pages, GitLab Pages, S3, anything. One container, or every
             container you have set up, in one command.</p></div>
      </div>

      <div class="pub-two">
        <div class="pub-card">
          <h4>The lobby is a real site, not an index</h4>
          <p>Cards carry each viz's title, blurb and tags — read from its own <code>&lt;head&gt;</code>,
             so there is no second place to update. It has list and grid views, search, and facets for
             tags and scaffold. You can drop a <code>_preamble.html</code> at the container root to put
             your own intro above the cards.</p>
          <p><b>Listing is its own axis.</b> <code>viz:listed=unlisted</code> keeps a viz off the lobby
             while still building it and leaving it reachable by direct URL. That is obscurity, not
             security — if the <i>name</i> is sensitive, that is what <b>private</b> is for.</p>
        </div>
        <div class="pub-card">
          <h4>Share cards — the thing that makes a link look real</h4>
          <p>Every <b>public</b> viz emits Open Graph tags, so its URL unfurls a preview card in Slack,
             Discord, iMessage and the rest. The image is picked by a ladder:</p>
          <ol class="pub-ladder">
            <li><code>og.png</code> — you made it by hand</li>
            <li><code>hero.html</code> — <b>a card authored in HTML</b>, scaffolded with
                <code>--hero</code> and shot by <code>verify.ts --og</code>. This is the good one.</li>
            <li><code>og.auto.png</code> — a bare screenshot of the page. Works, and the build warns you
                that you settled.</li>
            <li>nothing — a text-only card, which still unfurls</li>
          </ol>
          <p class="lib-note">So: if you author a hero, your link looks deliberate. If you don't, you
             still get something — just a screenshot of whatever the page happened to look like.</p>
        </div>
      </div>`;
  },
};

/* ---- stop 11 · who can see it -------------------------------------------
 * The posture × listing state space, plus the thing people forget exists:
 * you can seal an entire site behind ONE password instead of handing out a
 * different magic link per viz.
 */
const POSTURES = ['local', 'private', 'public'];
const LISTINGS = ['unlisted', 'listed'];
const FATE = {
  'local|unlisted':   { ship: 'no',  txt: 'Never published. The scaffold default — a new viz is invisible on both axes until you decide otherwise.', tone: 'var(--muted)' },
  'local|listed':     { ship: 'no',  txt: 'Still never published. `listed` is advertising, and there is nothing to advertise — the axes really are independent.', tone: 'var(--muted)' },
  'private|unlisted': { ship: 'yes', txt: 'Built and encrypted. Reachable only by its magic link, whose key rides in the URL #fragment — possession is access. Off the lobby.', tone: 'var(--c4)' },
  'private|listed':   { ship: 'yes', txt: 'Encrypted, but it gets a lobby card. The card shows a real title and a 🔒 — no description, so listing it leaks nothing.', tone: 'var(--c4)' },
  'public|unlisted':  { ship: 'yes', txt: 'Hosted as-is and reachable by anyone with the URL — just not linked from the lobby. Obscurity, not security.', tone: 'var(--good)' },
  'public|listed':    { ship: 'yes', txt: 'Hosted as-is, a card on the lobby, and an OG card so the link unfurls. The fully-open corner.', tone: 'var(--good)' },
};

export const access = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what">The two axes every viz declares in its
         <code>&lt;head&gt;</code>. They are <b>independent</b> — one controls who can reach it, the
         other only whether it is advertised. <b>Drag the grid</b>, or click a cell.</p>
      <div class="pg-wrap">
        <div class="pg-grid" id="pg-grid">
          <div class="pg-ylab">listed →</div>
          ${LISTINGS.slice().reverse().map(l => `
            <div class="pg-row" data-l="${l}">
              <span class="pg-rl">${l}</span>
              ${POSTURES.map(p => `
                <div class="pg-cell" data-k="${p}|${l}" data-viz-id="pg-${p}-${l}"
                     data-label="${p} + ${l}"><span class="pg-ship"></span></div>`).join('')}
            </div>`).join('')}
          <div class="pg-xlab">${POSTURES.map(p => `<span>${p}</span>`).join('')}</div>
        </div>
        <div class="pg-out">
          <div class="pg-meta" id="pg-meta"></div>
          <div class="pg-fate" id="pg-fate"></div>
        </div>
      </div>

      <div class="acc-lobby">
        <div class="al-h"><span class="pill warn">the one people forget</span> seal the whole site with ONE password</div>
        <p>Marking six vizzes <b>private</b> means six different magic links to hand out and keep track
           of. Instead you can make the <b>lobby</b> private: the entire published site — the front page
           <i>and</i> every public viz in it — sits behind a <b>single</b> password. Opt in with an empty
           marker file at the container root:</p>
        <pre><code>touch &lt;container&gt;/_private-lobby</code></pre>
        <p>Vizzes marked <b>private</b> keep their own separate keys on top of that. And because a sealed
           page's <code>&lt;head&gt;</code> is encrypted, it cannot carry a preview card — so each sealed
           viz also emits a tiny unsealed <b>share shim</b> at a secret path, which holds the card and
           bounces humans through to the real page. <b>The shim URL is the one you share.</b></p>
        <p class="lib-note">Changed your mind about who has access? <code>rotate</code> revokes and
           re-mints a viz's magic link — or the whole lobby key — and the old link dies.</p>
      </div>

      <p class="fig-foot"><b>There is no default.</b> A viz with no <code>viz:posture</code> is a hard
         error that makes the entire publish run refuse — nothing ships on a guess. A third axis,
         <code>viz:triaged</code>, exists but never touches publishing: it is a drain-to-zero audit
         worklist, kept separate precisely so a deliberately-local viz can leave the backlog.</p>`;

    const cells = el.querySelectorAll('.pg-cell');
    const paint = (pi, li) => {
      const p = POSTURES[Math.round(pi)], l = LISTINGS[Math.round(li)];
      const key = `${p}|${l}`, f = FATE[key];
      cells.forEach(c => {
        c.classList.toggle('on', c.dataset.k === key);
        c.style.setProperty('--tone', FATE[c.dataset.k].tone);
        c.querySelector('.pg-ship').textContent = FATE[c.dataset.k].ship === 'yes' ? '●' : '○';
      });
      el.querySelector('#pg-meta').innerHTML =
        `<pre><code>&lt;meta name="viz:posture" content="<b>${p}</b>"&gt;
&lt;meta name="viz:listed"  content="<b>${l}</b>"&gt;</code></pre>`;
      el.querySelector('#pg-fate').innerHTML =
        `<span class="pg-ships ${f.ship}" style="--tone:${f.tone}">${f.ship === 'yes' ? 'ships' : 'never leaves your machine'}</span>
         <p>${f.txt}</p>`;
    };
    const grid = el.querySelector('#pg-grid');
    const ax = twoAxis(grid, {
      x: [0, POSTURES.length - 1], y: [0, LISTINGS.length - 1],
      start: [0, 0], speed: 1.6, onChange: paint,
    });

    // Clicking a cell was dead. twoAxis() calls setPointerCapture() on the
    // GRID during the drag, which retargets the whole gesture to the grid — so
    // the browser never fires a `click` on the cell underneath and the listener
    // never ran. Resolve it from the pointer instead, and only treat it as a
    // click when the pointer barely moved, so a real drag doesn't also snap.
    let downAt = null;
    grid.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
    grid.addEventListener('pointerup', e => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 6) return;                       // that was a drag, not a click
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pg-cell');
      if (!cell) return;
      const [p, l] = cell.dataset.k.split('|');
      ax.set(POSTURES.indexOf(p), LISTINGS.indexOf(l));
    });
  },
};
