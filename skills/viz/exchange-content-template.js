// __SLUG__ — CONTENT ONLY. The experience lives in /_kit/exchange.js.
// Data shape, wire types and the layout budget: /_kit/EXCHANGE.md — read it
// before placing anything, the layout mistakes are the ones that cost rework.
//
// An exchange shows something being PRESENTED, PASSED or PROVEN between
// parties. Lanes are PHASES, not actors — they answer "how often does this
// happen?", which is the question a sequence diagram cannot ask.

const src  = t => `<div class="src">${t}</div>`;
const ours = t => `<div class="ours"><b>ours, not the spec's</b> — ${t}</div>`;

const content = {
  title: '__SLUG__',
  subtitle: 'what is being exchanged, and between whom',
  stage: { w: 1780, h: 900 },
  // Leave autoscroll ON when the stage is taller than a laptop window, or a
  // reader who never scrolls never sees the last phase.
  autoscroll: false,

  // Phases, not places. "Once" / "per token" / "per request" is the shape that
  // makes a protocol make sense. Zones + firewalls are for network diagrams —
  // leave them out unless the trust boundary is genuinely the point.
  lanes: [
    { id: 1, y: 150, h: 300, tag: 'Once',        name: 'Setup' },
    { id: 2, y: 480, h: 340, tag: 'Per request', name: 'The hop that repeats' },
  ],

  // Define each node once; every wire endpoint is computed from this geometry,
  // so moving a box can never strand its arrows.
  nodes: {
    a1: { x: 60,  y: 254, w: 280, h: 92, lane: 1, cls: 'actor', name: 'Client',
          role: 'A service, not a person' },
    b1: { x: 620, y: 254, w: 300, h: 92, lane: 1, name: 'The other party' },

    a2: { x: 60,  y: 604, w: 280, h: 92, lane: 2, cls: 'actor', name: 'Client' },
    b2: { x: 620, y: 604, w: 300, h: 92, lane: 2, name: 'The other party' },
  },

  // `{hand:1}` carries one phase's result into the next phase's actor — it is
  // what makes the page read as one story instead of separate diagrams.
  wires: [
    ['a1', 'b1'],
    ['a2', 'b2'],
    ['a1', 'a2', { hand: 1 }],
  ],

  panels: [
    { id: 'p-one', x: 1010, y: 190, w: 350, title: 'What this hop produces' },
  ],

  steps: [
    { p: 1, t: 'Say what happens, in one sentence, in the present tense',
      from: 'a1', to: 'b1', pkt: 'request',
      set: { 'p-one': `<div class="note">What came back.</div>`
             + src('<b>RFC ????? §0.0</b> — quote the spec verbatim, or delete this line.') } },

    { p: 2, t: 'The next hop — and note it is in a different phase band',
      from: 'a2', to: 'b2', pkt: 'and again' },
  ],
};

// Make every step's `set` CUMULATIVE. The runtime applies only the current
// step's `set` and never replays earlier ones, so without this a reload or a
// shared link at step N renders an almost-empty page. It also makes stepping
// backwards exact instead of leaving stale panels behind.
const seen = {};
for (const step of content.steps) {
  Object.assign(seen, step.set);
  step.set = { ...seen };
}

export default content;
