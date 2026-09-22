/* fig-run.js — band 1, "Get Running".
 *
 * The three stops build ONE artifact between them: a real treemap of this
 * skill's own source. You watch it get asked for, then watch three plain-English
 * asks change it. Demonstrating the loop beats describing it, and using the
 * skill's own file sizes means every area on screen is a real number with no
 * privacy surface.
 */
import { squarify, fmtKB } from './treemap.js';
import { REDUCED } from './guide.js';

/* Real bytes, measured from the skill directory. Kept as a literal so the
 * static published copy shows the same thing the live one does — this figure
 * is deliberately NOT live data (that stays in the Dashboard). */
export const SOURCE = [
  { name: 'build.ts',        value: 112795, kind: 'publish' },
  { name: 'SKILL.md',        value: 39542,  kind: 'doc' },
  { name: 'manage.ts',       value: 38534,  kind: 'author' },
  { name: 'verify.ts',       value: 29638,  kind: 'verify' },
  { name: 'bootstrap.ts',    value: 25474,  kind: 'author' },
  { name: 'inline.ts',       value: 23095,  kind: 'publish' },
  { name: 'server.ts',       value: 20788,  kind: 'serve' },
  { name: 'comments.js',     value: 18557,  kind: 'verify' },
  { name: 'exchange.js',     value: 16681,  kind: 'kit' },
  { name: 'viz.js',          value: 14944,  kind: 'kit' },
  { name: 'deck-template',   value: 14578,  kind: 'kit' },
  { name: 'CONTEXT.md',      value: 12490,  kind: 'doc' },
  { name: 'viz-kit.css',     value: 11941,  kind: 'kit' },
  { name: 'exchange.css',    value: 9902,   kind: 'kit' },
  { name: 'viz-og.css',      value: 8267,   kind: 'kit' },
  { name: 'discovery.ts',    value: 7623,   kind: 'serve' },
  { name: 'deck.js',         value: 5905,   kind: 'kit' },
  { name: 'check-exchange',  value: 5019,   kind: 'verify' },
  { name: 'recordings.ts',   value: 4756,   kind: 'serve' },
  { name: 'keystore.ts',     value: 4324,   kind: 'publish' },
  { name: '_cvdprobe.ts',    value: 3990,   kind: 'verify' },
  { name: 'sync-runtimes',   value: 3768,   kind: 'author' },
  { name: 'deploy-all.ts',   value: 2605,   kind: 'publish' },
  { name: 'vendor-runtime',  value: 1744,   kind: 'author' },
];

export const KIND_TONE = {
  author:  'var(--accent)',
  serve:   'var(--good)',
  verify:  'var(--c5)',
  publish: 'var(--c4)',
  kit:     'var(--c8)',
  doc:     'var(--warn)',
};
const KIND_LABEL = {
  author: 'authoring', serve: 'serving', verify: 'verifying',
  publish: 'publishing', kit: 'shared kit', doc: 'docs',
};

/* Draw the treemap into an <svg>. `mode` is what the current refine step asked
 * for, so the same renderer serves all four states of the loop. */
export function drawTreemap(svg, { w, h, mode = 'plain', highlight = null }) {
  const items = mode === 'sorted'
    ? [...SOURCE].sort((a, b) => b.value - a.value)
    : SOURCE;
  const rects = squarify(items, 0, 0, w, h);
  const total = SOURCE.reduce((s, i) => s + i.value, 0);

  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = rects.map(r => {
    const tone = mode === 'plain' ? 'var(--panel-2)' : KIND_TONE[r.item.kind];
    const dim = highlight && r.item.kind !== highlight;
    // Derive the fit from the label's own length rather than one fixed width.
    // A flat `r.w > 54` overflowed on the long names (exchange.css, _cvdprobe.ts)
    // and verify caught it; mono advance is ~0.6em, so 9.5px ≈ 5.7px per char.
    const need = r.item.name.length * 5.7 + 12;
    const showLabel = r.w > need && r.h > 26;
    const showSize = r.w > Math.max(need, 78) && r.h > 42;
    return `
      <g class="tm-cell${dim ? ' dim' : ''}" data-viz-id="src-${r.item.name}"
         data-label="${r.item.name} — ${fmtKB(r.item.value)}, ${KIND_LABEL[r.item.kind]}">
        <rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}"
              width="${Math.max(0, r.w - 1.5).toFixed(1)}" height="${Math.max(0, r.h - 1.5).toFixed(1)}"
              rx="2" fill="${tone}" fill-opacity="${mode === 'plain' ? 1 : 0.22}"
              stroke="${tone}" stroke-width="1"/>
        ${showLabel ? `<text class="tm-n" x="${(r.x + 6).toFixed(1)}" y="${(r.y + 15).toFixed(1)}">${r.item.name}</text>` : ''}
        ${showSize ? `<text class="tm-v" x="${(r.x + 6).toFixed(1)}" y="${(r.y + 29).toFixed(1)}">${fmtKB(r.item.value)}</text>` : ''}
        <title>${r.item.name} · ${fmtKB(r.item.value)} · ${KIND_LABEL[r.item.kind]} · ${(r.item.value / total * 100).toFixed(1)}% of source</title>
      </g>`;
  }).join('');
}

export function legend(active = null) {
  return `<div class="legend tm-legend">
    ${Object.entries(KIND_LABEL).map(([k, l]) => `
      <span class="legend-item${active && active !== k ? ' off' : ''}" data-kind="${k}">
        <i class="swatch dot" style="background:${KIND_TONE[k]}"></i>${l}
      </span>`).join('')}
  </div>`;
}

/* ---- stop 1 · why bother -----------------------------------------------
 * The old version drew degrading ASCII across three panels and argued that
 * terminals are bad. It didn't land, because nobody needed convincing that
 * ASCII art is ugly — and "ugly" was never the point.
 *
 * This makes the actual claim instead, with the same 24 numbers on both sides:
 * a spatial encoding answers questions a list cannot. The three questions are
 * real, the answers are highlighted in BOTH panels, and you can watch yourself
 * scan the list while the picture has already told you.
 */
const QUESTIONS = [
  { q: 'Which single file is the biggest?',
    a: f => f.name === 'build.ts',
    say: 'build.ts — 110 KB, more than a quarter of everything.' },
  { q: 'Is publishing bigger than serving?',
    a: f => f.kind === 'publish' || f.kind === 'serve',
    say: 'Yes, by about 4×. Purple dwarfs green — obvious in the picture, a summing exercise in the list.' },
  { q: 'How much is the shared kit?',
    a: f => f.kind === 'kit',
    say: 'Six files, ~78 KB — about a fifth, spread thin enough to be easy to miss in a list.' },
];

export const why = {
  steps: 0,
  render(el) {
    el.innerHTML = `
      <p class="fig-what"><b>The same 24 numbers, twice.</b> Left is what
         a terminal can give you — a perfectly good, perfectly accurate list. Right is the same data
         with area = bytes and colour = subsystem. <b>Pick a question</b> and try to answer it from
         each side.</p>
      <div class="why-qs" id="why-qs">
        ${QUESTIONS.map((q, i) => `<button data-q="${i}">${q.q}</button>`).join('')}
      </div>
      <div class="why-two">
        <div class="why-side">
          <div class="why-cap">a list <span>accurate · complete · slow</span></div>
          <div class="why-list" id="why-list"></div>
        </div>
        <div class="why-side">
          <div class="why-cap">a picture <span>same data · same accuracy</span></div>
          <svg class="tm" id="why-tm" role="img"
               aria-label="Treemap of the same 24 files, area proportional to bytes"></svg>
        </div>
      </div>
      <div class="why-answer" id="why-answer">Pick a question above. Both panels hold exactly the
        same information — the difference is only how long it takes you to see it.</div>
      <p class="fig-foot">That is the whole argument. Not "terminals are bad" — a list is fine, and
         sometimes it is the right answer. But some questions are <b>shaped like pictures</b>, and an
         agent that can only emit text can never answer those, no matter how well it writes.</p>`;

    const list = el.querySelector('#why-list');
    const svg = el.querySelector('#why-tm');
    let active = null;

    const paint = () => {
      const hit = active === null ? () => false : QUESTIONS[active].a;
      list.innerHTML = SOURCE.map(f => `
        <div class="why-row${hit(f) ? ' hit' : ''}">
          <span class="wr-n">${f.name}</span><span class="wr-v">${fmtKB(f.value)}</span>
        </div>`).join('');
      drawTreemap(svg, { w: 520, h: 330, mode: active === null ? 'kind' : 'kind' });
      // Dim everything the question doesn't touch, so the answer is the only lit thing.
      for (const g of svg.querySelectorAll('.tm-cell')) {
        const name = g.dataset.vizId.replace(/^src-/, '');
        const f = SOURCE.find(x => x.name === name);
        g.classList.toggle('dim', active !== null && !hit(f));
      }
      el.querySelector('#why-answer').innerHTML = active === null
        ? 'Pick a question above. Both panels hold exactly the same information — the difference is only how long it takes you to see it.'
        : `<b>${QUESTIONS[active].say}</b>`;
      el.querySelectorAll('#why-qs button').forEach((b, i) => b.classList.toggle('on', i === active));
    };

    el.querySelector('#why-qs').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      active = active === +b.dataset.q ? null : +b.dataset.q;
      paint();
    });
    paint();
  },
};

/* ---- stop 2 · install ---------------------------------------------------
 * The old version was a 3-column grid whose cells all said the same thing
 * behind a native tooltip — you had to hover, wait, and then read identical
 * text six times. The magnitude was never on screen.
 *
 * Now the magnitude IS the figure: one command against eighteen manual
 * actions, drawn, with the three manual steps named once rather than hidden
 * in six identical hovers.
 */
const AGENTS = ['Claude Code', 'Codex', 'Copilot', 'Cursor', 'Gemini Antigravity', '…and more'];
const MANUAL = ['clone the repo', 'find that agent\'s skills dir', 'symlink skills/viz/ into it'];

/* Which .mcpb a visitor wants. userAgentData is the modern answer and userAgent the
 * fallback; if neither is conclusive we highlight nothing rather than guess wrong, since
 * a confidently wrong download is worse than three equal choices. */
function detectPlatform() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (p.includes('mac') || ua.includes('mac os')) return 'darwin';
  if (p.includes('win') || ua.includes('windows')) return 'win32';
  if (p.includes('linux') || ua.includes('linux')) return 'linux';
  return null;
}

/* Links point at releases/latest/download/, which GitHub redirects to the newest
 * release — so this page never needs editing when a version is cut. */
const REPO = 'https://github.com/RascalTwo/ai-setup';
const PLATFORMS = [
  { id: 'darwin', label: 'macOS', note: 'Intel + Apple Silicon, one universal build' },
  { id: 'win32', label: 'Windows', note: 'x64' },
  { id: 'linux', label: 'Linux', note: 'x64 · Claude Desktop Linux is beta' },
];

function downloadHtml() {
  return `
    <div class="dl">
      <p class="dl-lead"><b>Claude Desktop: one click.</b> Download the bundle for your OS and open it —
         Claude Desktop installs it from Settings &rarr; Extensions. Bun ships inside, so there is
         nothing else to install.</p>
      <div class="dl-grid">
        ${PLATFORMS.map(p => `
          <a class="dl-card" data-platform="${p.id}" data-viz-id="dl-${p.id}" data-label="download for ${p.label}"
             href="${REPO}/releases/latest/download/viz-${p.id}.mcpb">
            <b>${p.label}</b>
            <i>${p.note}</i>
            <span class="dl-yours">your platform</span>
          </a>`).join('')}
      </div>
      <p class="dl-note"><span class="dl-ver" data-viz-id="dl-version" data-label="documented version">…</span>
         There is no auto-update — the .mcpb format has no update mechanism — so come back here when you
         want a newer one. <a href="${REPO}/releases">All releases</a>.</p>
    </div>`;
}

export const install = {
  steps: 0,
  render(el) {
    const n = AGENTS.length, per = MANUAL.length;

    // Three ways in, and they are also the three ANSWERS to "what do I get" — the
    // install you pick decides the mode you run in. That is why they are one figure
    // rather than an install section plus a modes section saying the same thing twice.
    const WAYS = [
      {
        id: 'agents',
        label: 'Coding agent',
        sub: 'Claude Code, Codex, Cursor, Copilot…',
        mode: 'full',
        modeNote: 'Live hot-reloading URL, per-viz git history, live data, publishing.',
        body: `
          <p class="fig-what">One command, every agent you have installed. Doing it by hand is the
             same three steps repeated per agent — <b>${per} × ${n} = ${per * n} actions</b> instead of one.</p>
          <div class="inst-cmp">
            <div class="inst-row good">
              <div class="inst-lab"><b>one command</b><i>npx skills add</i></div>
              <div class="inst-blocks"><span class="ib one" data-viz-id="inst-npx" data-label="one command, all agents">1</span></div>
              <div class="inst-tot"><b>1</b><i>action</i></div>
            </div>
            <div class="inst-row bad">
              <div class="inst-lab"><b>by hand</b><i>${per} steps × ${n} agents</i></div>
              <div class="inst-blocks">
                ${AGENTS.map((a, i) => `<span class="ib-group" title="${a}">
                  ${MANUAL.map((m, j) => `<span class="ib" data-viz-id="inst-m-${i}-${j}" data-label="${a}: ${m}"></span>`).join('')}
                </span>`).join('')}
              </div>
              <div class="inst-tot"><b>${per * n}</b><i>actions</i></div>
            </div>
          </div>`,
        cmds: [
          ['Install', 'works across every agent above, in one go', 'npx skills add RascalTwo/ai-setup -s viz'],
          ['The only prerequisite', 'should print a version number', 'bun --version'],
          ['Later', 'updates every agent at once, same deal', 'npx skills update'],
        ],
      },
      {
        id: 'chat',
        label: 'Chat app',
        sub: 'Claude Desktop, ChatGPT desktop',
        mode: 'full',
        modeNote: 'Same as a coding agent — the MCP server runs on your real machine, outside the sandbox.',
        body: `
          <p class="fig-what">Chat apps run skills in a sandbox with no shell, no Bun and no reachable
             <code>127.0.0.1</code>. They also run <b>local MCP servers as ordinary processes on your
             machine</b>, outside that sandbox — so pointing one at <code>mcp.ts</code> hands the chat
             app the real thing.</p>
          <p class="fig-what"><b>Codex CLI and ChatGPT desktop</b> share one config, so a single command
             covers both. <b>Claude Desktop has no such command</b> — it wants the server written into
             its JSON config by hand, via Claude menu &rarr; Settings &rarr; Developer &rarr; Edit Config.
             Paths must be absolute, and Claude Desktop only reloads config on restart.</p>
          <p class="fig-what">ChatGPT <i>web</i> and mobile cannot run local servers at all — that is
             what lite mode is for.</p>`,
        download: true,
        cmds: [
          ['Codex CLI + ChatGPT desktop', 'one command, both hosts', 'codex mcp add viz -- bun ~/.claude/skills/viz/mcp.ts'],
          ['Claude Desktop, by hand', 'if you would rather not use the bundle — then RESTART the app', '{ "mcpServers": { "viz": { "command": "bun", "args": ["/absolute/path/to/skills/viz/mcp.ts"] } } }'],
          ['Check it (Codex/ChatGPT)', 'lists the tools the server exposes', '/mcp'],
        ],
      },
      {
        id: 'none',
        label: 'Nothing installed',
        sub: 'ChatGPT web, mobile, any sandbox',
        mode: 'lite',
        modeNote: 'One self-contained HTML file, handed to you. No server, no git, no publishing — same design bar.',
        body: `
          <p class="fig-what">Where there is no shell at all, <code>/viz</code> writes <b>one
             self-contained HTML file</b> and hands it over, inlining the same kit so it still looks
             like a viz. Nothing to install, nothing to configure.</p>
          <p class="fig-what">You do not choose this — the skill works out that it is in a sandbox and
             does it. If you <i>do</i> have a shell but no Bun, it asks first rather than silently
             dropping down.</p>`,
        cmds: [],
      },
      {
        id: 'dev',
        label: 'Work on it',
        sub: 'contributing to the skill itself',
        mode: null,
        modeNote: null,
        body: `
          <p class="fig-what">The skill develops <b>in place</b> — clone the repo and symlink it into
             your agent's skills dir, and edits are live on the next invocation. No reinstall loop.</p>
          <p class="fig-what">One caveat: do not <code>npx skills add</code> this skill <b>globally</b>
             on a machine where you have the dev symlink — it replaces the symlink with a frozen copy.
             To rehearse the real install flow, do it in a throwaway project dir instead.</p>
          <p class="fig-what">Tests are black-box over the CLI: <code>bun test</code> from the skill dir.
             Every command's flags are documented by <code>viz &lt;verb&gt; --help</code>, generated from
             the same declaration the parser uses.</p>`,
        cmds: [
          ['Clone and link', 'edits go live immediately', 'git clone https://github.com/RascalTwo/ai-setup && ln -s "$PWD/ai-setup/skills/viz" ~/.claude/skills/viz'],
          ['Run the tests', 'from the skill directory', 'bun test'],
          ['See every verb', 'help is generated, never hand-written', 'bun viz.ts --help'],
        ],
      },
    ];

    const cmdHtml = (c) => c.map(([label, hint, cmd]) => `
      <div class="cmd${cmd.length > 60 ? ' wrap' : ' small'}">
        <label>${label} <span>${hint}</span></label>
        <pre><code>${cmd.replace(/</g, '&lt;')}</code></pre>
        <button class="copy" data-copy="${cmd.replace(/"/g, '&quot;')}">copy</button>
      </div>`).join('');

    el.innerHTML = `
      <div class="inst-tabs" role="tablist">
        ${WAYS.map((w, i) => `
          <button class="inst-tab${i === 0 ? ' on' : ''}" role="tab" data-way="${w.id}"
                  data-viz-id="way-${w.id}" data-label="${w.label}">
            <b>${w.label}</b><i>${w.sub}</i>
          </button>`).join('')}
      </div>
      ${WAYS.map((w, i) => `
        <div class="inst-pane${i === 0 ? ' on' : ''}" data-way="${w.id}">
          ${w.mode ? `<p class="inst-mode ${w.mode}"><b>${w.mode} mode</b> — ${w.modeNote}</p>` : ''}
          ${w.body}
          ${w.download ? downloadHtml() : ''}
          ${w.cmds.length ? `<div class="install-cmds">${cmdHtml(w.cmds)}</div>` : ''}
        </div>`).join('')}
    `;

    // Highlight the visitor's own platform. The bundle they need is the one for the OS
    // Claude Desktop runs on, and asking someone to know whether they want "darwin" is
    // asking the wrong person — the browser already knows.
    const here = detectPlatform();
    for (const card of el.querySelectorAll('.dl-card')) {
      card.classList.toggle('is-yours', card.dataset.platform === here);
    }

    // The page states which release it documents. Links still point at /latest/, so a
    // stale published copy still hands you a current bundle — but you can SEE it is
    // stale, which matters when nothing auto-updates.
    const ver = el.querySelector('.dl-ver');
    if (ver) {
      fetch('api/server-info')
        .then(r => r.json())
        .then(d => { ver.textContent = d.vizVersion ? `These docs describe viz ${d.vizVersion}. ` : ''; })
        .catch(() => { ver.textContent = ''; });
    }

    el.addEventListener('click', e => {
      const tab = e.target.closest('.inst-tab');
      if (tab) {
        for (const b of el.querySelectorAll('.inst-tab')) b.classList.toggle('on', b === tab);
        for (const p of el.querySelectorAll('.inst-pane')) p.classList.toggle('on', p.dataset.way === tab.dataset.way);
        return;
      }
      const b = e.target.closest('.copy');
      if (!b) return;
      navigator.clipboard?.writeText(b.dataset.copy);
      const was = b.textContent;
      b.textContent = 'copied ✓';
      b.classList.add('ok');
      setTimeout(() => { b.textContent = was; b.classList.remove('ok'); }, 1400);
    });
  },
};

/* ---- stop 2 · your first ask -------------------------------------------
 * Five steps from a sentence to a rendered picture. The last step draws the
 * real treemap, so the payoff is an actual artifact rather than a mockup.
 */
export const ask = {
  steps: 5,
  render(el, { onStep }) {
    el.innerHTML = `
      <p class="fig-what">One <code>/viz</code> ask, start to finish.
         Left is what you and the agent say; right is what exists on your machine at that moment.
         Area in the final picture = file size in bytes.</p>
      <div class="ask-split">
        <div class="ask-talk" id="ask-talk"></div>
        <div class="ask-stage">
          <div class="ask-stage-cap" id="ask-cap">nothing yet</div>
          <div class="ask-stage-body" id="ask-body"></div>
        </div>
      </div>`;

    const talk = el.querySelector('#ask-talk');
    const cap = el.querySelector('#ask-cap');
    const body = el.querySelector('#ask-body');

    const TURNS = [
      { who: 'you', text: `/viz a treemap of this skill's own source files` },
      { who: 'agent', text: `Rendering this as a <b>treemap, area = file size in bytes</b>.` ,
        note: 'It names the spatial form before writing a line — a checkpoint you can interrupt.' },
      { who: 'sys', text: `scaffolded <code>viz-pages/skill-source/index.html</code>`,
        note: 'bootstrap.ts mints the folder, stamps safe posture metas, starts the server if it is not up.' },
      { who: 'sys', text: `serving at <code>127.0.0.1:5180/…/skill-source/</code>`,
        note: 'A live URL, hot-reloading. You installed and configured nothing.' },
      { who: 'agent', text: `Done — 24 files, 436 KB total.`,
        note: 'Before it says "done" it screenshots the page and reads the console, so a blank render never reaches you.' },
    ];

    const STAGE = [
      { cap: 'nothing yet', kind: 'empty' },
      { cap: 'form chosen — treemap, area = bytes', kind: 'form' },
      { cap: 'folder exists · index.html scaffolded', kind: 'files' },
      { cap: 'live at 127.0.0.1:5180 — hot-reloading', kind: 'url' },
      { cap: 'rendered · 24 files · 436 KB', kind: 'tree' },
    ];

    onStep(i => {
      talk.innerHTML = TURNS.slice(0, i + 1).map((t, j) => `
        <div class="turn ${t.who}${j === i ? ' now' : ''}">
          <span class="turn-who">${t.who === 'you' ? 'you' : t.who === 'agent' ? 'agent' : 'machine'}</span>
          <div class="turn-body">${t.text}${j === i && t.note ? `<em>${t.note}</em>` : ''}</div>
        </div>`).join('');

      const s = STAGE[i];
      cap.textContent = s.cap;
      if (s.kind === 'empty') {
        body.innerHTML = `<div class="stage-empty">your repo, before you asked</div>`;
      } else if (s.kind === 'form') {
        body.innerHTML = `<div class="stage-form">
            <div class="form-pick">treemap</div>
            <div class="form-why">area <b>=</b> file size (bytes)<br>colour <b>=</b> which subsystem</div>
          </div>`;
      } else if (s.kind === 'files') {
        body.innerHTML = `<pre class="stage-files"><code>viz-pages/skill-source/
└─ index.html   <span class="dim">scaffolded, posture=local</span></code></pre>`;
      } else if (s.kind === 'url') {
        body.innerHTML = `<div class="stage-url"><span class="dot-live"></span>
            <code>127.0.0.1:5180/…/skill-source/</code>
            <em>saves reload the page by themselves</em></div>`;
      } else {
        body.innerHTML = `<svg class="tm" id="ask-tm" role="img"
             aria-label="Treemap of the skill's source files, area proportional to size in bytes"></svg>`;
        drawTreemap(body.querySelector('#ask-tm'), { w: 520, h: 300, mode: 'plain' });
      }
    });
  },
};

/* ---- stop 3 · the refine loop ------------------------------------------
 * Same treemap, three plain-English asks. Each step actually changes the
 * picture, so the claim "just talk to it" is shown rather than asserted.
 */
export const refine = {
  steps: 5,
  render(el, { onStep }) {
    el.innerHTML = `
      <p class="fig-what">The same treemap from the last stop, being changed by
         plain sentences. Area is still bytes; what changes is colour, ordering, and what is emphasised.</p>
      <div class="refine-wrap">
        <div class="refine-asks" id="refine-asks"></div>
        <div class="refine-stage">
          <svg class="tm" id="refine-tm" role="img"
               aria-label="Treemap of the skill's source, area proportional to bytes"></svg>
          <div id="refine-legend"></div>
        </div>
      </div>
      <!-- The self-check. Easy to miss because it is invisible when it passes,
           and it is arguably the most valuable thing in the whole loop. -->
      <div class="refine-verify" id="refine-verify">
        <div class="rv-h">every edit is checked before it reaches you</div>
        <pre class="rv-out"><code>✓ 0 error(s)
⚠ 2 layout finding(s) · rendered: 24 rect, 0 path, 48 text
  text-overflow: text.tm-n "exchange.css" spills 20px past its box
  clipped: #why-ascii is cut off by 22px vertically
◐ visual density: 24 marks · 980 chars · 24.5 marks/1k → graphical</code></pre>
        <p>It drives a real headless browser: screenshots the page, reads the console, and audits the
           layout for the things eyes are worst at — text past its own box, content silently clipped by
           an <code>overflow:hidden</code> ancestor, a blank render. <b>Both findings above are real ones
           from building this page.</b> A broken render never gets handed to you as "done", and the
           feedback loop closes without you in it.</p>
      </div>`;

    const asks = el.querySelector('#refine-asks');
    const svg = el.querySelector('#refine-tm');
    const leg = el.querySelector('#refine-legend');

    const ASKS = [
      { say: 'the first render', mode: 'plain', hl: null,
        note: 'Everything one colour. Readable, but it only encodes one variable — size.' },
      { say: 'colour it by which subsystem the file belongs to', mode: 'kind', hl: null,
        note: 'Now two variables live in the picture at once: area is bytes, hue is subsystem.' },
      { say: 'add a legend, and dim everything that is not publishing', mode: 'kind', hl: 'publish',
        note: 'build.ts alone is a quarter of the skill. Publishing is where the weight actually is.' },
      { say: 'sort it biggest-first so the ordering means something', mode: 'sorted', hl: null,
        note: 'Same data, deliberate reading order. Each ask edited the same viz and hot-reloaded it.' },
      { say: 'and after every single one of those…', mode: 'sorted', hl: null, verify: true,
        note: 'It checks its own work before handing it back.' },
    ];

    onStep(i => {
      asks.innerHTML = ASKS.map((a, j) => `
        <div class="ask-line ${j === i ? 'now' : j < i ? 'done' : 'todo'}">
          <span class="ask-n">${j === 0 ? '·' : j}</span>
          <div><b>${j === 0 ? a.say : '“' + a.say + '”'}</b>${j === i ? `<em>${a.note}</em>` : ''}</div>
        </div>`).join('');
      drawTreemap(svg, { w: 520, h: 320, mode: ASKS[i].mode, highlight: ASKS[i].hl });
      leg.innerHTML = i === 0 ? '' : legend(ASKS[i].hl);
      el.querySelector('#refine-verify').classList.toggle('on', !!ASKS[i].verify);
    });
  },
};
