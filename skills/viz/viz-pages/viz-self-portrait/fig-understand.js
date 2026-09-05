/* fig-understand.js — band 3 mechanism.
 *
 * What a session actually does under the hood, and how the server works.
 *
 * These two used to be band 2. They moved down because they answer "how does
 * it work", not "what can it do" — which is interesting, but almost never the
 * thing standing between someone and a better viz. Band 2 is capability now.
 */
import { REDUCED } from './guide.js';

/* ---- a whole session ------------------------------------------
 * The same seven moves band 1 walked, but showing the machinery: what each
 * step actually writes, runs, or refuses. Every artifact shown is real — the
 * meta lines, the verify output shape, the comments.json record.
 */
const SESSION = [
  { k: 'bootstrap', t: 'Scaffold',
    d: 'Mints the folder, writes a starter <code>index.html</code>, spawns the server if it is not already up, and commits.',
    art: `viz-pages/checkout-states/
└─ index.html

&lt;meta name="viz:posture" content="local"&gt;
&lt;meta name="viz:listed"  content="unlisted"&gt;`,
    note: 'Stamped fail-closed on both axes. Nothing can ship by accident; opening it up is a separate, deliberate edit.' },
  { k: 'form', t: 'Pick the form',
    d: 'Names a spatial form before writing, and says so out loud.',
    art: `“Rendering this as a state machine,
 transitions as labelled arrows.”`,
    note: 'A checkpoint you can interrupt, not a question it waits on. If no real form fits, dropping to a styled page is announced too.' },
  { k: 'kit', t: 'Draw from the kit',
    d: 'Tokens and SVG helpers come from <code>/_kit/</code> rather than being re-guessed.',
    art: `import { arrowMarkers, connect, side,
         labelBox, stepper } from "/_kit/viz.js";`,
    note: 'Nodes are declared once as {x,y,w,h} and every arrow endpoint is derived from that geometry — so moving a box cannot strand its arrows.' },
  { k: 'verify', t: 'Verify',
    d: 'Drives headless Chrome, screenshots, reads the console, and audits the layout.',
    art: `✓ 0 error(s)
⚠ 2 layout finding(s) · rendered: 17 rect, 11 path, 40 text
  text-overflow: text.nsub spills 37px past its box
◐ visual density: 1.8 marks/1k chars → prose-shaped`,
    note: 'It checks what eyes are bad at: text past its box, content clipped by an overflow ancestor, a blank render. The density line is a mirror, never a gate.' },
  { k: 'review', t: 'Point at what is wrong',
    d: 'Alt/Option-click any element in the live page to pin a comment to it.',
    art: `{ "anchor": { "vizId": "state-paid" },
  "text": "should loop back to cart on decline",
  "status": "open" }`,
    note: 'The pin follows the element even as things animate. You resolve nothing and delete freely; the agent resolves and never deletes.' },
  { k: 'iterate', t: 'Refine',
    d: 'Same files, edited in place. The browser reloads itself on save.',
    art: `“mark the retry state red”
“add a cancel transition”`,
    note: 'Every change is committed, so any version rolls back. In-page JS state is nuked by the reload — persist anything that must survive to the URL hash.' },
  { k: 'publish', t: 'Ship',
    d: 'Bakes the viz into one self-contained HTML file for any static host.',
    art: `bun build.ts &lt;container&gt;
→ dist/checkout-states.html   (single file)`,
    note: 'build.ts never deploys. Deploying is a separate, human-confirmed step — and an undeclared posture makes the whole run refuse.' },
];

export const session = {
  steps: SESSION.length,
  render(el, { onStep }) {
    el.innerHTML = `
      <p class="fig-what">One session, left to right. The spine is the seven
         moves; the panel shows what each one actually writes or runs. Every artifact below is real
         output shape, not a mock-up.</p>
      <div class="sess-spine" id="sess-spine">
        ${SESSION.map((s, i) => `
          <button class="sess-st" data-i="${i}" data-viz-id="sess-${s.k}" data-label="${s.t}">
            <span class="sess-dot"></span><span class="sess-t">${s.t}</span>
          </button>`).join('')}
      </div>
      <div class="sess-panel">
        <div class="sess-copy"><h4 id="sess-h"></h4><p id="sess-d"></p><em id="sess-note"></em></div>
        <pre class="sess-art"><code id="sess-art"></code></pre>
      </div>`;

    const spine = el.querySelector('#sess-spine');
    onStep(i => {
      const s = SESSION[i];
      spine.querySelectorAll('.sess-st').forEach((b, j) => {
        b.classList.toggle('on', j === i);
        b.classList.toggle('past', j < i);
      });
      el.querySelector('#sess-h').textContent = `${i + 1}. ${s.t}`;
      el.querySelector('#sess-d').innerHTML = s.d;
      el.querySelector('#sess-note').innerHTML = s.note;
      el.querySelector('#sess-art').innerHTML = s.art;
    });
  },
};

/* ---- under the hood -------------------------------------------
 * The old page had a static 20-box poster of the runtime. This is the same
 * information as four traceable journeys instead: pick a scenario, watch the
 * packet take the actual path, one hop at a time.
 */
const RT_NODES = {
  you:     { x: 20,  y: 20,  w: 120, h: 42, label: 'You',        sub: 'edit + save' },
  agent:   { x: 20,  y: 92,  w: 120, h: 42, label: 'Agent',      sub: 'runs the skill' },
  boot:    { x: 20,  y: 164, w: 120, h: 42, label: 'bootstrap',  sub: 'mints a viz' },
  router:  { x: 210, y: 20,  w: 150, h: 42, label: 'Router',     sub: 'longest-prefix' },
  slugmap: { x: 210, y: 92,  w: 150, h: 42, label: 'Slug map',   sub: 'id → abs dir' },
  scanner: { x: 210, y: 164, w: 150, h: 42, label: 'Scanner',    sub: 'walks $HOME' },
  statich: { x: 405, y: 20,  w: 140, h: 42, label: 'Static',     sub: 'injects reload' },
  apil:    { x: 405, y: 92,  w: 140, h: 42, label: 'API loader', sub: 'imports api.ts' },
  watch:   { x: 405, y: 164, w: 140, h: 42, label: 'fs.watch',   sub: 'per container' },
  debounce:{ x: 405, y: 232, w: 140, h: 42, label: 'Debounce',   sub: '100 ms per id' },
  sse:     { x: 590, y: 198, w: 140, h: 42, label: 'SSE pump',   sub: '/&lt;id&gt;/_reload' },
  browser: { x: 590, y: 56,  w: 140, h: 78, label: 'Browser',    sub: 'renders + reloads' },
};

const RT_SCENARIOS = [
  { id: 'save', name: 'You save a file', tone: 'var(--good)',
    hops: [
      ['you', 'watch',      'a write lands in the viz folder'],
      ['watch', 'debounce', 'the watcher fires — possibly many times'],
      ['debounce', 'sse',   'coalesced to one event per id, 100 ms window'],
      ['sse', 'browser',    '"data: reload" to clients on that id only'],
      ['browser', 'browser','the page reloads itself — in-page JS state is gone'],
    ] },
  { id: 'get', name: 'The browser asks for a page', tone: 'var(--accent)',
    hops: [
      ['browser', 'router',  'GET /&lt;id&gt;/index.html'],
      ['router', 'slugmap',  'longest-known-id-prefix match → absolute dir'],
      ['slugmap', 'statich', 'resolve the file, refuse any ../ escape'],
      ['statich', 'browser', 'HTML, with the reload script and the viz id injected'],
    ] },
  { id: 'api', name: 'A viz asks its own backend', tone: 'var(--c5)',
    hops: [
      ['browser', 'router', 'GET /&lt;id&gt;/api/whatever'],
      ['router', 'apil',    'route lands on the api branch'],
      ['apil', 'apil',      'dynamic import of &lt;id-dir&gt;/api.ts, cache-busted'],
      ['apil', 'browser',   'the handler\'s response — or a clean 500 if it failed to load'],
    ] },
  { id: 'boot', name: 'You create a repo-local viz', tone: 'var(--c4)',
    hops: [
      ['agent', 'boot',     '/viz &lt;slug&gt; --local'],
      ['boot', 'boot',      'mint &lt;repo&gt;/viz-pages/&lt;slug&gt;/, stamp fail-closed metas'],
      ['boot', 'scanner',   'register in .discovered.json so it is servable now'],
      ['scanner', 'slugmap','the slug map is rebuilt'],
      ['slugmap', 'browser','the printed URL resolves — no restart needed'],
    ] },
];

export const runtime = {
  steps: 5,
  render(el, { onStep }) {
    el.innerHTML = `
      <p class="fig-what">The running server, as four journeys rather than one
         poster. Pick a scenario, then step the packet along its real path. Boxes are components;
         a lit box is one the packet is touching right now.</p>
      <div class="rt-picker" id="rt-picker">
        ${RT_SCENARIOS.map((s, i) => `<button data-s="${i}" style="--tone:${s.tone}">${s.name}</button>`).join('')}
      </div>
      <div class="rt-stage">
        <svg viewBox="0 0 790 290" id="rt-svg" role="img"
             aria-label="The viz server's components, with the current packet path highlighted"></svg>
      </div>
      <div class="rt-narr" id="rt-narr"></div>`;

    let si = 0;
    let step = 0;

    const draw = () => {
      const sc = RT_SCENARIOS[si];
      const hop = sc.hops[Math.min(step, sc.hops.length - 1)];
      const [from, to] = hop;
      const svg = el.querySelector('#rt-svg');

      // every wire this scenario uses, so the reader sees the shape of the path
      const wire = (a, b, on) => {
        const A = RT_NODES[a], B = RT_NODES[b];
        if (a === b) {
          // A self-hop, drawn as a loop off the RIGHT edge rather than a small
          // arc floating above the box — the old version read as a stray
          // squiggle with no obvious owner.
          const x = A.x + A.w, y = A.y + A.h / 2;
          return `<path d="M ${x} ${y - 9} C ${x + 34} ${y - 22}, ${x + 34} ${y + 22}, ${x} ${y + 9}"
                    fill="none" stroke="${on ? sc.tone : 'var(--border)'}"
                    stroke-width="${on ? 2.5 : 1}" ${on ? '' : 'stroke-dasharray="3 3"'}
                    marker-end="url(#rt-ah${on ? '-on' : ''})"/>`;
        }
        // Stacked in the same column — go straight down (or up) between them,
        // not out one side and back in the other.
        if (A.x === B.x) {
          const x = A.x + A.w / 2;
          const down = B.y > A.y;
          const y1 = down ? A.y + A.h : A.y;
          const y2 = down ? B.y : B.y + B.h;
          return `<path d="M ${x} ${y1} L ${x} ${y2}" fill="none"
                    stroke="${on ? sc.tone : 'var(--border)'}" stroke-width="${on ? 2.5 : 1}"
                    ${on ? '' : 'stroke-dasharray="3 3"'} marker-end="url(#rt-ah${on ? '-on' : ''})"/>`;
        }
        const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2;
        const back = B.x < A.x;
        const d = back
          ? `M ${A.x} ${y1} C ${A.x - 40} ${y1}, ${B.x + B.w + 40} ${y2}, ${B.x + B.w} ${y2}`
          : `M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`;
        return `<path d="${d}" fill="none" stroke="${on ? sc.tone : 'var(--border)'}"
                  stroke-width="${on ? 2.5 : 1}" ${on ? '' : 'stroke-dasharray="3 3"'}
                  marker-end="url(#rt-ah${on ? '-on' : ''})"/>`;
      };

      const lit = new Set([from, to]);
      svg.innerHTML = `
        <defs>
          <marker id="rt-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)"/></marker>
          <marker id="rt-ah-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="${sc.tone}"/></marker>
        </defs>
        ${sc.hops.map(([a, b], i) => wire(a, b, i === Math.min(step, sc.hops.length - 1))).join('')}
        ${Object.entries(RT_NODES).map(([k, nd]) => `
          <g class="rt-n${lit.has(k) ? ' on' : ''}" data-viz-id="rt-${k}" data-label="${nd.label} — ${nd.sub}">
            <rect x="${nd.x}" y="${nd.y}" width="${nd.w}" height="${nd.h}" rx="5"
              fill="var(--panel)" stroke="${lit.has(k) ? sc.tone : 'var(--border)'}"
              stroke-width="${lit.has(k) ? 2 : 1}"/>
            <text x="${nd.x + nd.w / 2}" y="${nd.y + 18}" text-anchor="middle" class="rt-t">${nd.label}</text>
            <text x="${nd.x + nd.w / 2}" y="${nd.y + 32}" text-anchor="middle" class="rt-s">${nd.sub}</text>
            <title>${nd.label} — ${nd.sub}</title>
          </g>`).join('')}`;

      el.querySelector('#rt-narr').innerHTML = sc.hops.map((h, i) => `
        <div class="rt-hop ${i === Math.min(step, sc.hops.length - 1) ? 'now' : i < step ? 'past' : ''}">
          <span class="rt-hn">${i + 1}</span>
          <span class="rt-hw"><b>${RT_NODES[h[0]].label}</b> → <b>${RT_NODES[h[1]].label}</b></span>
          <span class="rt-hd">${h[2]}</span>
        </div>`).join('');

      el.querySelectorAll('#rt-picker button').forEach((b, i) => b.classList.toggle('on', i === si));
    };

    el.querySelector('#rt-picker').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      si = +b.dataset.s; draw();
    });

    onStep(i => { step = i; draw(); });
  },
};
